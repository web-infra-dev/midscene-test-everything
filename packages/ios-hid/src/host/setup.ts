import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { IOSHIDRuntime } from '../runtime/runtime.js';
import type { ScreenSession } from '../screen/source.js';
import { type USBDevice, listUSBDevices } from '../screen/usb.js';
import type { DeviceConfig } from '../types.js';
import { json, readJSON } from './http.js';

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
  constructor(
    private config: DeviceConfig,
    private runtime: IOSHIDRuntime,
  ) {
    this.result = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    void this.result.catch(() => undefined);
  }
  takePreview() {
    const preview = this.preview;
    this.preview = undefined;
    return preview;
  }
  async handle(req: IncomingMessage, res: ServerResponse, path: string) {
    if (this.closed) throw new Error('Device setup closed');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && path === '/state') {
      this.devices ??=
        this.config.screen.source === 'usb' ? await listUSBDevices() : [];
      json(res, {
        source: this.config.screen.source,
        computerName: 'Midscene',
        devices: this.devices,
        selectedUSB:
          this.config.screen.source === 'usb'
            ? this.config.screen.deviceId
            : undefined,
        selectedPeer: this.config.bluetoothPeerId,
        bluetooth: await this.runtime.input.status(),
        airplay: this.preview?.getSetupInfo?.(),
      });
      return;
    }
    if (req.method === 'GET' && path === '/frame') {
      if (!this.preview) throw new Error('Select a screen first');
      const frame = await this.preview.getFrame({
        fresh: true,
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
          (this.config.screen.source !== 'usb' ||
            value.usbDeviceId === this.config.screen.deviceId)
        ) {
          json(res, {});
          return;
        }
        await this.preview?.close();
        this.preview = undefined;
        if (this.config.screen.source === 'usb') {
          this.devices ??= await listUSBDevices();
          const device = this.devices.find((d) => d.id === value.usbDeviceId);
          if (!device) throw new Error('Select a connected USB iPhone');
          this.config.screen.deviceId = device.id;
        }
        this.preview = await this.runtime.openScreen(this.config);
        json(res, {});
        return;
      }
      if (path === '/confirm') {
        if (!this.preview || !value.confirmed)
          throw new Error(
            'Confirm the screen and Bluetooth peer belong to the same phone',
          );
        const peer = (await this.runtime.input.listPeers()).find(
          (p) => p.id === value.bluetoothPeerId,
        );
        if (
          !peer ||
          ![1, 2, 3].every((report) => peer.reports.includes(report))
        )
          throw new Error(
            'Wait for the phone to subscribe to mouse and keyboard reports',
          );
        await this.preview.getFrame({ timeoutMs: 10000 });
        this.config.bluetoothPeerId = peer.id;
        json(res, {});
        this.resolve();
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
    await this.pending;
    await this.preview?.close();
  }
}
