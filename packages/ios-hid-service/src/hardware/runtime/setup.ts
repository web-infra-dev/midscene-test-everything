import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ScreenSession } from '../screen/source.js';
import { type USBDevice, listUSBDevices } from '../screen/usb.js';
import type { DeviceConfig } from '../types.js';
import { json, readJSON } from './http.js';
import type { IOSHIDRuntime } from './runtime.js';

export interface SetupSession {
  id: string;
  handle(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
  ): Promise<void>;
  close(): Promise<void>;
}

/** Explicit capture-to-Bluetooth binding; a shared name is not an identity. */
export class DeviceSetupSession implements SetupSession {
  readonly id = randomUUID();
  readonly result: Promise<void>;
  private resolve!: () => void;
  private reject!: (error: Error) => void;
  private devices?: USBDevice[];
  private preview?: ScreenSession;
  private pending: Promise<unknown> = Promise.resolve();
  private closed = false;
  private readonly streams = new Set<ServerResponse>();
  private unsubscribePreview?: () => void;
  private unsubscribeBluetooth?: () => void;
  private confirmed = false;
  private publish() {
    const data = `data: ${JSON.stringify({ airplay: this.preview?.getSetupInfo?.() })}\n\n`;
    for (const res of this.streams)
      if (!res.destroyed && !res.write(data)) res.end();
  }
  constructor(
    private config: DeviceConfig,
    private runtime: IOSHIDRuntime,
    private recovering = false,
  ) {
    this.result = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    void this.result.catch(() => undefined);
    if (recovering)
      this.unsubscribeBluetooth = runtime.input.subscribe(() =>
        this.resumeWhenReady(),
      );
  }
  private resumeWhenReady() {
    if (!this.recovering || this.closed || this.confirmed || !this.preview)
      return;
    const info = this.preview.getSetupInfo?.();
    if (info?.state === 'failed') {
      this.reject(new Error(info.error ?? 'AirPlay 接收器启动失败。'));
      return;
    }
    if (info?.state !== 'streaming') return;
    const operation = this.pending.then(() =>
      this.confirmPeer(this.config.bluetoothPeerId, true),
    );
    this.pending = operation.catch((error) => this.reject(error));
  }
  private async confirmPeer(peerId?: string, waitForPeer = false) {
    if (this.closed || this.confirmed) return;
    if (!this.preview) throw new Error('Select a screen first');
    const peer = (await this.runtime.input.listPeers()).find(
      (p) => p.id === peerId,
    );
    if (!peer || ![1, 2, 3].every((report) => peer.reports.includes(report))) {
      if (waitForPeer) return;
      throw new Error(
        'Connect the selected phone to the Mac using classic Bluetooth HID',
      );
    }
    const airplay = this.preview.getSetupInfo?.();
    if (airplay && airplay.state !== 'streaming')
      throw new Error(
        airplay.error ?? '请先在手机上开始屏幕镜像，收到画面后再验证。',
      );
    await this.preview.getFrame({
      fresh: true,
      allowUnchanged: true,
      timeoutMs: 10000,
    });
    if (this.closed) throw new Error('Device setup closed');
    this.config.bluetoothPeerId = peer.id;
    this.config.name = peer.name;
    this.confirmed = true;
    this.resolve();
  }
  takePreview() {
    this.unsubscribePreview?.();
    this.unsubscribePreview = undefined;
    const preview = this.preview;
    this.preview = undefined;
    return preview;
  }
  async handle(req: IncomingMessage, res: ServerResponse, path: string) {
    if (this.closed) throw new Error('Device setup closed');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && path === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      this.streams.add(res);
      this.publish();
      const heartbeat = setInterval(() => {
        if (!res.destroyed) res.write(': heartbeat\n\n');
      }, 15000);
      res.once('close', () => {
        clearInterval(heartbeat);
        this.streams.delete(res);
      });
      return;
    }
    if (req.method === 'GET' && path === '/state') {
      this.devices ??=
        this.config.screen.source === 'usb' ? await listUSBDevices() : [];
      const bluetooth = await this.runtime.input.status();
      json(res, {
        source: this.config.screen.source,
        computerName: bluetooth.serviceName ?? 'Mac',
        devices: this.devices,
        selectedUSB:
          this.config.screen.source === 'usb'
            ? this.config.screen.deviceId
            : undefined,
        selectedPeer: this.config.bluetoothPeerId,
        bluetooth,
        airplay: this.preview?.getSetupInfo?.(),
      });
      return;
    }
    if (req.method === 'GET' && path === '/frame') {
      if (this.preview?.getSetupInfo?.()?.state === 'waiting') {
        res.writeHead(204).end();
        return;
      }
      if (!this.preview) throw new Error('Select a screen first');
      const frame = await this.preview.getFrame({
        // AirPlay's first decoded frame is already available when SSE announces
        // streaming. Display it immediately; confirmation still requires fresh video.
        fresh: this.config.screen.source !== 'airplay',
        timeoutMs: 10000,
      });
      res.setHeader('Content-Type', 'image/jpeg');
      res.end(frame.jpeg);
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    if (req.headers['x-midscene-setup'] !== this.id) {
      res.writeHead(403).end();
      return;
    }
    const value = (await readJSON(req)) as {
      usbDeviceId?: string;
      bluetoothPeerId?: string;
      confirmed?: boolean;
    };
    const operation = this.pending.then(async () => {
      if (this.closed) throw new Error('Device setup closed');
      if (path === '/select') {
        if (
          this.preview &&
          this.preview.getSetupInfo?.()?.state !== 'failed' &&
          (this.config.screen.source !== 'usb' ||
            value.usbDeviceId === this.config.screen.deviceId)
        ) {
          json(res, {});
          return;
        }
        this.unsubscribePreview?.();
        this.unsubscribePreview = undefined;
        await this.preview?.close();
        this.preview = undefined;
        if (this.config.screen.source === 'usb') {
          this.devices ??= await listUSBDevices();
          const device = this.devices.find((d) => d.id === value.usbDeviceId);
          if (!device) throw new Error('Select a connected USB iPhone');
          this.config.screen.deviceId = device.id;
        }
        this.preview = await this.runtime.openScreen(this.config);
        this.unsubscribePreview = this.preview.subscribeSetup?.(() => {
          this.publish();
          this.resumeWhenReady();
        });
        this.publish();
        this.resumeWhenReady();
        json(res, {});
        return;
      }
      if (path === '/confirm') {
        if (!this.preview || !value.confirmed)
          throw new Error(
            'Confirm the screen and Bluetooth peer belong to the same phone',
          );
        await this.confirmPeer(value.bluetoothPeerId);
        json(res, {});
        return;
      }
      if (path === '/cancel') {
        this.reject(new Error('Device setup cancelled'));
        json(res, {});
        return;
      }
      res.writeHead(404).end();
    });
    this.pending = operation.catch(() => undefined);
    await operation;
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.reject(new Error('Device setup closed'));
    this.unsubscribePreview?.();
    this.unsubscribeBluetooth?.();
    for (const res of this.streams) res.end();
    this.streams.clear();
    await this.pending;
    await this.preview?.close();
  }
}
