import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { connectIOSHIDHost } from '@midscene/ios-hid';
import {
  type LaunchPlaygroundOptions,
  PlaygroundServer,
} from '@midscene/playground';
import { IOSHIDSessionManager } from './platform.js';
import { type Handler, type Routes, mountSetupRoutes } from './setup-routes.js';

type Entry = {
  id: string;
  server: PlaygroundServer;
  manager: IOSHIDSessionManager;
  connected: boolean;
  activeRequests: number;
  unsubscribe: () => void;
};
/** One upstream session/controller/report store per phone; all routes share the parent listener. */
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
    private staticPath: string,
    private createManager = () => new IOSHIDSessionManager(),
    private watchNativeBluetooth = true,
  ) {}
  async create() {
    if (this.closing) throw new Error('Playground is closing');
    if (this.entries.size >= 32)
      throw new Error('最多支持 32 个设备工作区，请先移除不用的设备。');
    const id = randomUUID();
    const manager = this.createManager();
    const server = new PlaygroundServer(
      undefined,
      this.staticPath,
      `ios-hid-${id}`,
    );
    server.setPreparedPlatform({
      platformId: 'ios-hid',
      title: 'iOS HID Playground',
      sessionManager: manager,
      preview: { kind: 'screenshot' },
    });
    mountSetupRoutes(server, manager);
    const guard: Handler = (req, res, next) => {
      void (async () => {
        if (
          req.method === 'POST' &&
          ['/execute', '/interact'].includes(req.path)
        ) {
          const entry = this.entries.get(id)!;
          entry.activeRequests++;
          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            entry.activeRequests--;
          };
          res.once('finish', finish);
          res.once('close', finish);
          await manager.refreshConnectionState();
          const snapshot = manager.getSnapshot();
          if (
            snapshot.state?.phase !== 'ready' ||
            snapshot.screenError ||
            snapshot.refreshing
          ) {
            res.status(409).json({
              error:
                snapshot.state?.error ??
                snapshot.screenError ??
                '设备未就绪，请检查连接后刷新。',
            });
            return;
          }
        }
        const json = res.json.bind(res);
        // The upstream report links are origin-relative. Scope them to the owning phone.
        res.json = (value: unknown) => {
          const entry = this.entries.get(id);
          if (entry && manager.getConnectionState()?.phase === 'ready')
            entry.connected = true;
          this.publish();
          return json(
            JSON.parse(
              JSON.stringify(value, (key, item) =>
                ['url', 'replayUrl'].includes(key) &&
                typeof item === 'string' &&
                item.startsWith('/reports/')
                  ? `/ios-hid/workspaces/${id}${item}`
                  : item,
              ),
            ),
          );
        };
        next();
      })().catch((error: Error) => {
        if (!res.headersSent) res.status(500).json({ error: error.message });
      });
    };
    server.app.use(guard);
    // The upstream public API initializes routes in launch(). Release its temporary
    // loopback listener; the parent Express app mounts the initialized handler.
    await server.launch(0);
    const listener = server.server!;
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
    server.server = undefined;
    if (this.closing) {
      await server.close();
      throw new Error('Playground is closing');
    }
    const unsubscribe = manager.onStateChange(() => this.publish());
    this.entries.set(id, {
      id,
      server,
      manager,
      connected: false,
      activeRequests: 0,
      unsubscribe,
    });
    this.publish();
    return this.describe(this.entries.get(id)!);
  }
  private describe(entry: Entry) {
    const snapshot = entry.manager.getSnapshot();
    if (snapshot.state?.phase === 'ready') entry.connected = true;
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
  get(id: string) {
    return this.entries.get(id);
  }
  async remove(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.unsubscribe();
    this.entries.delete(id);
    this.publish();
    await entry.server.close();
  }
  mount(
    server: Parameters<
      NonNullable<LaunchPlaygroundOptions['configureServer']>
    >[0],
  ) {
    const app = server.app as Routes;
    const allowed = (req: { headers: Record<string, unknown> }) =>
      req.headers['x-midscene-playground'] === 'workspace';
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
      if (entry.activeRequests) {
        res.status(409).json({ error: '请先停止当前任务，再刷新设备。' });
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
      entry.server.app(req, res, next);
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
