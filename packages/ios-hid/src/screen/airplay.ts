import { spawn } from 'node:child_process';
import { createHash, randomInt } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { CameraStream } from '@midscene/robotics-vision';
import { JpegProcessCameraSource } from '@midscene/robotics-vision/camera/jpeg-process-camera-source';
import sharp from 'sharp';
import { configDirectory } from '../config/store.js';
import type { ScreenSession } from './source.js';

/** UxPlay is an external receiver; its video output goes directly to a JPEG pipe. */
export class AirPlayScreenSession implements ScreenSession {
  readonly pin = String(randomInt(1000, 10000));
  readonly receiverName: string;
  private stream: CameraStream;
  private constructor(id: string, name: string, keyPath: string) {
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
          const child = spawn(
            'uxplay',
            [
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
            ],
            { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] },
          );
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
      10 * 60_000,
    );
  }
  static async open(id: string, name: string) {
    const directory = join(configDirectory, 'airplay');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const session = new AirPlayScreenSession(
      id,
      name,
      join(directory, `${id}.key`),
    );
    try {
      await session.stream.start();
      return session;
    } catch (error) {
      await session.close();
      throw error;
    }
  }
  async getFrame(options: { fresh?: boolean; timeoutMs?: number } = {}) {
    const frame = await this.stream.getFrame(options);
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
  getSetupInfo() {
    return { name: this.receiverName, pin: this.pin };
  }
  close() {
    return this.stream.stop();
  }
}
