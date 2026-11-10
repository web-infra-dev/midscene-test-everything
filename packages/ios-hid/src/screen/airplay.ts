import { spawn } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { CameraStream } from '@midscene/robotics-vision';
import { JpegProcessCameraSource } from '@midscene/robotics-vision/camera/jpeg-process-camera-source';
import { getDebug } from '@midscene/shared/logger';
import sharp from 'sharp';
import { configDirectory } from '../config/store.js';
import { nativeHelper } from '../native/compiler.js';
import type { AirPlaySetupInfo } from '../types.js';
import type { ScreenSession } from './source.js';

const debug = getDebug('ios-hid-airplay');

/** UxPlay is an external receiver; its video output goes directly to a JPEG pipe. */
export class AirPlayScreenSession implements ScreenSession {
  readonly pin = String(randomInt(1000, 10000));
  readonly receiverName: string;
  private stream: CameraStream;
  private readonly listeners = new Set<(info: AirPlaySetupInfo) => void>();
  private frameDeadline?: ReturnType<typeof setTimeout>;
  private state: AirPlaySetupInfo['state'] = 'waiting';
  private closed = false;
  private frames = 0;
  private clientHeartbeatAt = 0;
  private sentFps?: number;
  private logTail = '';
  private receiverLines = '';
  private idle = false;
  private clientDisconnected = false;
  private lastFrameAt?: number;
  private healthTimer?: ReturnType<typeof setInterval>;
  private constructor(
    id: string,
    name: string,
    keyPath: string,
    launch = spawn,
    launcher = 'uxplay',
  ) {
    this.receiverName = `Midscene ${name} ${id.slice(0, 6)}`;
    const bytes = createHash('sha256').update(id).digest().subarray(0, 6);
    bytes[0] = (bytes[0] | 2) & 254;
    const mac = [...bytes]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(':');
    this.stream = new CameraStream(
      id,
      {
        listDevices: async () => [],
        openStream: async () => {
          debug('%s starting receiver %s', id, this.receiverName);
          const child = launch(
            launcher,
            [
              'uxplay',
              '-d',
              '-n',
              this.receiverName,
              '-nh',
              '-m',
              mac,
              '-p2p',
              '-pin',
              this.pin,
              '-key',
              keyPath,
              '-h265',
              '-avdec',
              '-as',
              '0',
              '-vsync',
              'no',
              '-vs',
              'jpegenc quality=85 ! fdsink fd=3 sync=false',
              '-s',
              '720x1280@30',
              '-fps',
              '15',
              '-FPSdata',
            ],
            { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] },
          );
          for (const output of [child.stdout, child.stderr])
            output.on('data', (chunk: Buffer) => {
              this.readReceiverLog(chunk.toString('utf8'));
            });
          child.once('error', (error) =>
            debug('%s spawn error: %s', id, error),
          );
          child.once('exit', (code, signal) => {
            clearInterval(this.healthTimer);
            debug(
              '%s exit code=%s signal=%s intentional=%s',
              id,
              code,
              signal,
              this.closed,
            );
          });
          this.healthTimer = setInterval(() => this.checkLiveness(), 5000);
          this.healthTimer.unref();
          return new JpegProcessCameraSource(
            child,
            'UxPlay AirPlay receiver',
            child.stdio[3] as Readable,
            [child.stdout, child.stderr],
          );
        },
      },
      {
        deviceId: id,
        width: 720,
        height: 1280,
        fps: 15,
        horizontalFlip: false,
        verticalFlip: false,
      },
      0, // Waiting for a person to start mirroring is not a camera startup failure.
    );
    this.stream.on('frame', () => {
      this.clientDisconnected = false;
      this.frames++;
      this.lastFrameAt = Date.now();
      clearTimeout(this.frameDeadline);
      this.update('streaming');
      this.frameDeadline = setTimeout(() => this.checkLiveness(), 5000);
      this.frameDeadline.unref();
    });
    this.stream.on('failed', () => {
      clearTimeout(this.frameDeadline);
      this.update('failed');
    });
  }
  private readReceiverLog(text: string) {
    this.receiverLines += text;
    const newline = this.receiverLines.lastIndexOf('\n');
    const lines = newline < 0 ? '' : this.receiverLines.slice(0, newline + 1);
    this.receiverLines = this.receiverLines.slice(newline + 1).slice(-4096);
    this.logTail = (this.logTail + text).slice(-16384);
    // Client performance reports continue even when iOS sends no video for an
    // unchanged screen. They are independent of decoded JPEG arrival.
    const reports = [
      ...this.logTail.matchAll(
        /<key>sentFramesAvg<\/key>\s*<(?:real|integer)>([\d.]+)<\/(?:real|integer)>/g,
      ),
    ];
    if (reports.length) {
      this.sentFps = Number(reports.at(-1)![1]);
      this.clientHeartbeatAt = Date.now();
      const last = reports.at(-1)!;
      this.logTail = this.logTail.slice(last.index! + last[0].length);
      this.checkLiveness();
    }
    if (
      /Open connections: 0|video_reset: type = RTP_Shutdown|ERROR lost connection with client/.test(
        lines,
      )
    ) {
      this.clientDisconnected = this.frames > 0;
      this.clientHeartbeatAt = 0;
      this.sentFps = undefined;
      this.idle = false;
      this.update(this.frames ? 'interrupted' : 'waiting');
    }
  }
  private checkLiveness() {
    if (this.stream.getInfo().state === 'failed') {
      this.update('failed');
      return;
    }
    if (this.clientDisconnected) {
      this.update('interrupted');
      return;
    }
    const age = this.lastFrameAt
      ? Date.now() - this.lastFrameAt
      : Number.POSITIVE_INFINITY;
    this.idle =
      this.sentFps === 0 && Date.now() - this.clientHeartbeatAt < 10000;
    if (this.frames)
      this.update(age < 5000 || this.idle ? 'streaming' : 'interrupted');
  }
  private update(state: AirPlaySetupInfo['state']) {
    if (this.closed || this.state === state) return;
    debug(
      '%s state %s -> %s error=%s',
      this.receiverName,
      this.state,
      state,
      this.stream.getInfo().error,
    );
    this.state = state;
    for (const listener of this.listeners) listener(this.getSetupInfo());
  }
  subscribeSetup(listener: (info: AirPlaySetupInfo) => void) {
    this.listeners.add(listener);
    listener(this.getSetupInfo());
    return () => {
      this.listeners.delete(listener);
    };
  }
  static async open(id: string, name: string) {
    const directory = join(configDirectory, 'airplay');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const session = new AirPlayScreenSession(
      id,
      name,
      join(directory, `${id}.key`),
      spawn,
      await nativeHelper('airplay-launcher'),
    );
    try {
      await session.stream.start();
      return session;
    } catch (error) {
      await session.close();
      throw error;
    }
  }
  async getFrame(
    options: {
      fresh?: boolean;
      timeoutMs?: number;
      allowUnchanged?: boolean;
    } = {},
  ) {
    this.checkLiveness();
    if (options.allowUnchanged && this.state === 'interrupted')
      throw new Error(
        'AirPlay 连接已中断，或手机仍在发送但视频解码停滞，请重新投屏。',
      );
    const deadline = Date.now() + (options.timeoutMs ?? 2000);
    let frame;
    while (!frame) {
      this.checkLiveness();
      if (options.allowUnchanged && this.state === 'interrupted')
        throw new Error('AirPlay 画面不可用，请重新投屏。');
      if (options.allowUnchanged && this.idle && this.frames) {
        frame = await this.stream.getFrame();
        break;
      }
      try {
        frame = await this.stream.getFrame({
          fresh: options.fresh,
          timeoutMs: Math.max(1, Math.min(500, deadline - Date.now())),
        });
      } catch (error) {
        // Recheck client heartbeats while waiting for video; do not mistake an
        // idle sender for a dead stream, or swallow actual decoder/process errors.
        if (
          !(error instanceof Error) ||
          !/No camera frame arrived/.test(error.message) ||
          Date.now() >= deadline
        )
          throw error;
      }
    }
    const metadata = await sharp(frame.jpeg).metadata();
    if (!metadata.width || !metadata.height)
      throw new Error('Invalid AirPlay frame');
    return {
      jpeg: frame.jpeg,
      width: metadata.width,
      height: metadata.height,
      sequence: frame.id,
      receivedAt: frame.capturedAt,
    };
  }
  getSetupInfo(): AirPlaySetupInfo {
    const error = this.stream.getInfo().error;
    return {
      name: this.receiverName,
      pin: this.pin,
      state: this.state,
      ...(error
        ? {
            error: /ENOENT|receiver exec: No such file/.test(error)
              ? '未找到 UxPlay，请安装后重新启动接收器。'
              : error,
          }
        : {}),
    };
  }
  close() {
    this.closed = true;
    clearInterval(this.healthTimer);
    clearTimeout(this.frameDeadline);
    this.listeners.clear();
    return this.stream.stop();
  }
}
