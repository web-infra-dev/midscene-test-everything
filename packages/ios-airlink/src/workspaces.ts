import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { ControlledDevice } from '@midscene/universal-device/server';
import express, { type Request, type Router } from 'express';
import { DeviceConnection } from './device-connection.js';
import { DeviceConfigStore } from './hardware/config/store.js';
import { ConnectionManager } from './hardware/runtime/connections.js';
import { IPhoneRuntime } from './hardware/runtime/runtime.js';
import type { PhoneCalibration } from './phone-calibration.js';
import { mountSetupRoutes } from './setup-routes.js';

type Entry = {
  id: string;
  router: Router;
  manager: DeviceConnection;
  connected: boolean;
  deviceId?: string;
  unsubscribe: () => void;
  closeSetup: () => Promise<void>;
};

export class DeviceWorkspaces {
  private entries = new Map<string, Entry>();
  private closing = false;
  private streams = new Set<ServerResponse>();
  private connections: ConnectionManager;
  private storeLoaded?: Promise<void>;
  private bluetoothWatch?: () => void;
  private healthTimer?: ReturnType<typeof setInterval>;
  private lastPublished = '';
  private inUse: (deviceId: string) => boolean = () => false;
  publish() {
    const data = JSON.stringify(
      [...this.entries.values()].map((entry) => this.describe(entry)),
    );
    if (data === this.lastPublished) return;
    this.lastPublished = data;
    for (const response of this.streams)
      if (
        !response.destroyed &&
        !response.writableEnded &&
        !response.write(`data: ${data}\n\n`)
      )
        response.end();
  }
  private watchBluetooth() {
    if (this.bluetoothWatch) return;
    this.bluetoothWatch = this.runtime.input.subscribe(({ hosts }) => {
      for (const entry of this.entries.values())
        entry.manager.updateBluetoothStatus(hosts);
      this.publish();
    });
  }
  constructor(
    private runtime = new IPhoneRuntime(),
    private store = new DeviceConfigStore(),
  ) {
    this.connections = new ConnectionManager(runtime, store);
  }

  private loadStore() {
    this.storeLoaded ??= this.store.load().catch((error) => {
      this.storeLoaded = undefined;
      throw error;
    });
    return this.storeLoaded;
  }

  async listDevices() {
    await this.loadStore();
    return this.store.list();
  }

  async create() {
    if (this.closing) throw new Error('Device service is closing');
    if (this.entries.size >= 32)
      throw new Error('最多支持 32 个设备工作区，请先移除不用的设备。');
    const id = randomUUID();
    const manager = new DeviceConnection(this.connections);
    const router = express.Router();
    const closeSetup = mountSetupRoutes(router, manager, this.runtime);
    router.post('/session', express.json({ limit: '64kb' }), (req, res) => {
      if (req.get('x-midscene-playground') !== 'setup') {
        res.status(403).end();
        return;
      }
      if (
        !req.body ||
        typeof req.body !== 'object' ||
        Array.isArray(req.body)
      ) {
        res.status(400).json({ error: 'Invalid device setup' });
        return;
      }
      void this.loadStore()
        .then(() => {
          if (this.closing || !this.entries.has(id))
            throw new Error('Device workspace closed');
          return manager.connect(req.body);
        })
        .then(() => res.json(this.describe(entry)))
        .catch((error: Error) =>
          res.status(400).json({ error: error.message }),
        );
    });
    router.get('/screenshot', (_req, res) => {
      void manager
        .screenshot()
        .then((frame) => {
          res.set('Cache-Control', 'no-store').json({
            screenshot: `data:image/jpeg;base64,${frame.jpeg.toString('base64')}`,
            timestamp: frame.receivedAt,
          });
        })
        .catch((error: Error) =>
          res.status(409).json({ error: error.message }),
        );
    });
    router.get('/preview-screenshot', (_req, res) => {
      void manager
        .previewScreenshot()
        .then((frame) => {
          res.set('Cache-Control', 'no-store').json({
            screenshot: `data:image/jpeg;base64,${frame.jpeg.toString('base64')}`,
            timestamp: frame.receivedAt,
          });
        })
        .catch((error: Error) =>
          res.status(409).json({ error: error.message }),
        );
    });
    const entry = {
      id,
      router,
      manager,
      connected: false,
      closeSetup,
      unsubscribe: manager.onStateChange(() => this.publish()),
    };
    this.entries.set(id, entry);
    this.publish();
    return this.describe(entry);
  }
  private isOccupied(entry?: Entry) {
    return Boolean(
      entry?.deviceId &&
        entry.manager.controlDevice(entry.deviceId) &&
        this.inUse(entry.deviceId),
    );
  }
  private describe(entry: Entry) {
    const snapshot = entry.manager.getSnapshot();
    if (snapshot.state?.phase === 'ready') {
      entry.connected = true;
      entry.deviceId = snapshot.state.device?.id;
    }
    return {
      id: entry.id,
      apiBase: `/ios-airlink/workspaces/${entry.id}`,
      ...snapshot,
      connected: entry.connected,
      occupied: this.isOccupied(entry),
    };
  }
  list() {
    return [...this.entries.values()].map((entry) => {
      void entry.manager.refreshConnectionState().catch(() => {});
      return this.describe(entry);
    });
  }
  readyDevice(id: string): ControlledDevice | undefined {
    for (const entry of this.entries.values()) {
      const device = entry.manager.controlDevice(id);
      if (device) return device;
    }
  }
  async remove(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.unsubscribe();
    this.entries.delete(id);
    this.publish();
    try {
      await entry.manager.destroySession();
    } finally {
      await entry.closeSetup();
    }
  }
  mount(
    app: Router,
    inUse: (deviceId: string) => boolean = () => false,
    phoneCalibration?: PhoneCalibration,
  ) {
    this.inUse = inUse;
    this.connections.phoneCalibration = phoneCalibration;
    const allowed = (req: Request) =>
      req.get('x-midscene-playground') === 'workspace';
    if (!this.healthTimer) {
      this.healthTimer = setInterval(() => {
        for (const entry of this.entries.values())
          void entry.manager
            .refreshConnectionState()
            .then(() => this.publish())
            .catch(() => {});
      }, 2000);
      this.healthTimer.unref();
    }
    app.get('/ios-airlink/workspaces/events', (_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      this.streams.add(res);
      res.write(
        `data: ${JSON.stringify([...this.entries.values()].map((entry) => this.describe(entry)))}\n\n`,
      );
      const heartbeat = setInterval(() => {
        if (!res.destroyed && !res.writableEnded) res.write(': heartbeat\n\n');
      }, 15000);
      res.once('close', () => {
        this.streams.delete(res);
        clearInterval(heartbeat);
      });
      this.watchBluetooth();
    });
    app.get('/ios-airlink/workspaces', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json(this.list());
    });
    app.post('/ios-airlink/workspaces', (req, res) => {
      if (!allowed(req)) {
        res.status(403).end();
        return;
      }
      void this.create()
        .then((value) => res.json(value))
        .catch((error: Error) =>
          res.status(400).json({ error: error.message }),
        );
    });
    app.delete('/ios-airlink/workspaces/:id', (req, res) => {
      if (!allowed(req)) {
        res.status(403).end();
        return;
      }
      const entry = this.entries.get(req.params.id);
      if (this.isOccupied(entry)) {
        res
          .status(409)
          .json({ error: '设备正在使用，请先在 Playground 断开连接。' });
        return;
      }
      void this.remove(req.params.id)
        .then(() => res.json({}))
        .catch((error: Error) =>
          res.status(400).json({ error: error.message }),
        );
    });
    app.post('/ios-airlink/workspaces/:id/refresh', (req, res) => {
      if (!allowed(req)) {
        res.status(403).end();
        return;
      }
      const entry = this.entries.get(req.params.id);
      if (!entry) {
        res.status(404).json({ error: '设备工作区不存在。' });
        return;
      }
      if (this.isOccupied(entry)) {
        res
          .status(409)
          .json({ error: '设备正在使用，请先在 Playground 断开连接。' });
        return;
      }
      void entry.manager
        .refreshDevice()
        .then(() => {
          this.publish();
          res.json(this.describe(entry));
        })
        .catch((error: Error) =>
          res.status(400).json({ error: error.message }),
        );
    });
    app.use('/ios-airlink/workspaces/:id', (req, res, next) => {
      const entry = this.entries.get(req.params.id);
      if (!entry) {
        res.status(404).json({ error: '设备工作区不存在，请返回首页。' });
        return;
      }
      entry.router(req, res, next);
    });
  }
  async close() {
    this.closing = true;
    this.bluetoothWatch?.();
    clearInterval(this.healthTimer);
    for (const stream of this.streams) stream.end();
    this.streams.clear();
    const results = await Promise.allSettled(
      [...this.entries.keys()].map((id) => this.remove(id)),
    );
    try {
      await this.connections.closeAll();
    } finally {
      await this.runtime.close();
    }
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length)
      throw new AggregateError(failures, 'Device workspace cleanup failed');
  }
}
