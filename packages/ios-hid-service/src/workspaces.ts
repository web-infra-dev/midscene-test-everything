import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { connectIOSHIDHost } from '@midscene/ios-hid';
import express, { type Request, type Router } from 'express';
import type { ControlledDevice } from './control-sessions.js';
import { DeviceConnection } from './device-connection.js';
import { mountSetupRoutes } from './setup-routes.js';

type Entry = {
  id: string;
  router: Router;
  manager: DeviceConnection;
  connected: boolean;
  deviceId?: string;
  unsubscribe: () => void;
};

export class DeviceWorkspaces {
  private entries = new Map<string, Entry>();
  private closing = false;
  private streams = new Set<ServerResponse>();
  private bluetoothWatch?: AbortController;
  private healthTimer?: ReturnType<typeof setInterval>;
  private lastPublished = '';
  publish() {
    const data = JSON.stringify(
      [...this.entries.values()].map((entry) => this.describe(entry)),
    );
    if (data === this.lastPublished) return;
    this.lastPublished = data;
    for (const response of this.streams)
      if (!response.destroyed && !response.write(`data: ${data}\n\n`))
        response.end();
  }
  private watchBluetooth() {
    if (this.bluetoothWatch || !this.watchNativeBluetooth) return;
    const cancellation = new AbortController();
    this.bluetoothWatch = cancellation;
    void (async () => {
      while (!cancellation.signal.aborted) {
        try {
          const host = await connectIOSHIDHost();
          const response = await fetch(`${host.address.url}/bluetooth/events`, {
            headers: { Authorization: `Bearer ${host.address.token}` },
            signal: cancellation.signal,
          });
          if (!response.ok || !response.body)
            throw new Error('Bluetooth stream unavailable');
          let buffer = '';
          const decoder = new TextDecoder();
          for await (const chunk of response.body) {
            buffer += decoder.decode(chunk, { stream: true });
            while (buffer.includes('\n\n')) {
              const end = buffer.indexOf('\n\n');
              const event = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              const data = event
                .split('\n')
                .find((line) => line.startsWith('data: '));
              if (!data) continue;
              const status = JSON.parse(data.slice(6));
              for (const entry of this.entries.values())
                entry.manager.updateBluetoothStatus(status.hosts);
              this.publish();
            }
          }
        } catch {
          if (cancellation.signal.aborted) break;
        }
        if (cancellation.signal.aborted) break;
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            cancellation.signal.removeEventListener('abort', done);
            resolve();
          };
          const timer = setTimeout(done, 1000);
          cancellation.signal.addEventListener('abort', done, { once: true });
        });
      }
    })();
  }
  constructor(
    private createManager = () => new DeviceConnection(),
    private watchNativeBluetooth = true,
  ) {}

  async create() {
    if (this.closing) throw new Error('Device service is closing');
    if (this.entries.size >= 32)
      throw new Error('最多支持 32 个设备工作区，请先移除不用的设备。');
    const id = randomUUID();
    const manager = this.createManager();
    const router = express.Router();
    mountSetupRoutes(router, manager);
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
      void manager
        .connect(req.body)
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
    const entry = {
      id,
      router,
      manager,
      connected: false,
      unsubscribe: manager.onStateChange(() => this.publish()),
    };
    this.entries.set(id, entry);
    this.publish();
    return this.describe(entry);
  }
  private describe(entry: Entry) {
    const snapshot = entry.manager.getSnapshot();
    if (snapshot.state?.phase === 'ready') {
      entry.connected = true;
      entry.deviceId = snapshot.state.device?.id;
    }
    return {
      id: entry.id,
      apiBase: `/ios-hid/workspaces/${entry.id}`,
      ...snapshot,
      connected: entry.connected,
    };
  }
  list() {
    return [...this.entries.values()].map((entry) => {
      void entry.manager.refreshConnectionState().catch(() => {});
      return this.describe(entry);
    });
  }
  readyDevice(id: string): ControlledDevice | undefined {
    const entry = [...this.entries.values()].find((item) => {
      const state = item.manager.getSnapshot();
      return (
        state.state?.device?.id === id &&
        state.state.phase === 'ready' &&
        !state.screenError &&
        !state.refreshing
      );
    });
    return entry?.manager;
  }
  async remove(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.unsubscribe();
    this.entries.delete(id);
    this.publish();
    await entry.manager.destroySession();
  }
  mount(app: Router, inUse: (deviceId: string) => boolean = () => false) {
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
    app.get('/ios-hid/workspaces/events', (_req, res) => {
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
        if (!res.destroyed) res.write(': heartbeat\n\n');
      }, 15000);
      res.once('close', () => {
        this.streams.delete(res);
        clearInterval(heartbeat);
      });
      this.watchBluetooth();
    });
    app.get('/ios-hid/workspaces', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json(this.list());
    });
    app.post('/ios-hid/workspaces', (req, res) => {
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
    app.delete('/ios-hid/workspaces/:id', (req, res) => {
      if (!allowed(req)) {
        res.status(403).end();
        return;
      }
      const entry = this.entries.get(req.params.id);
      if (entry?.deviceId && inUse(entry.deviceId)) {
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
    app.post('/ios-hid/workspaces/:id/refresh', (req, res) => {
      if (!allowed(req)) {
        res.status(403).end();
        return;
      }
      const entry = this.entries.get(req.params.id);
      if (!entry) {
        res.status(404).json({ error: '设备工作区不存在。' });
        return;
      }
      if (entry.deviceId && inUse(entry.deviceId)) {
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
    app.use('/ios-hid/workspaces/:id', (req, res, next) => {
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
    this.bluetoothWatch?.abort();
    clearInterval(this.healthTimer);
    for (const stream of this.streams) stream.end();
    this.streams.clear();
    await Promise.all([...this.entries.keys()].map((id) => this.remove(id)));
  }
}
