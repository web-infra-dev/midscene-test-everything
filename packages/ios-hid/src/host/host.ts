import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import {
  type IncomingMessage,
  type ServerResponse,
  createServer,
} from 'node:http';
import { join } from 'node:path';
import { listCameras } from '@midscene/robotics-vision';
import { DeviceConfigStore, configDirectory } from '../config/store.js';
import type { PointerDiagnostics } from '../pointer/diagnostics.js';
import { IOSHIDRuntime } from '../runtime/runtime.js';
import { listUSBDevices } from '../screen/usb.js';
import {
  HOST_PROTOCOL_VERSION,
  type HostAddress,
  type IOSHIDDeviceOptions,
  type InputAction,
} from '../types.js';
import type { TaskRequest } from '../types.js';
import { CameraPreviews } from './camera-previews.js';
import { ConnectionManager } from './connections.js';
import { json, readJSON } from './http.js';
import { HostTaskManager } from './tasks.js';

export class IOSHIDHost {
  private token = randomBytes(32).toString('hex');
  private config = new DeviceConfigStore();
  private runtime: IOSHIDRuntime;
  private cameraPreviews: CameraPreviews;
  constructor(options: { pointerDiagnostics?: PointerDiagnostics } = {}) {
    this.runtime = new IOSHIDRuntime(options);
    this.cameraPreviews = new CameraPreviews(this.runtime.cameras);
  }
  private connections?: ConnectionManager;
  private tasks?: HostTaskManager;
  private server = createServer((req, res) => {
    void this.route(req, res).catch((error: Error) => {
      if (!res.headersSent) json(res, { error: error.message }, 400);
      else res.end();
    });
  });
  private address?: HostAddress;
  private timer?: NodeJS.Timeout;
  private bluetoothStreams = new Set<ServerResponse>();
  private closing = false;
  private closePromise?: Promise<void>;
  onShutdown?: () => Promise<void>;
  async start(): Promise<HostAddress> {
    await this.config.load();
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', resolve);
    });
    const address = this.server.address();
    if (!address || typeof address === 'string')
      throw new Error('Host failed to bind');
    this.address = {
      url: `http://127.0.0.1:${address.port}`,
      token: this.token,
      pid: process.pid,
      protocol: HOST_PROTOCOL_VERSION,
    };
    this.connections = new ConnectionManager(
      this.runtime,
      this.config,
      this.address.url,
    );
    this.tasks = new HostTaskManager(this.connections);
    await writeFile(
      join(configDirectory, 'host.json'),
      JSON.stringify(this.address),
      { mode: 0o600 },
    );
    this.timer = setInterval(() => {
      void this.connections?.sweep();
      void this.cameraPreviews.sweep();
    }, 5000);
    return this.address;
  }
  private authorized(req: IncomingMessage) {
    const supplied = Buffer.from(
      req.headers.authorization?.replace(/^Bearer /, '') ?? '',
    );
    const expected = Buffer.from(this.token);
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    );
  }
  private async route(req: IncomingMessage, res: ServerResponse) {
    if (this.closing) {
      json(res, { error: 'Host closing' }, 503);
      return;
    }
    const path = new URL(
      req.url ?? '/',
      this.address?.url ?? 'http://localhost',
    ).pathname;
    const setup = /^\/setup\/([^/]+)(\/.*)$/.exec(path);
    if (setup) {
      const c = this.connections!.list().find((c) => c.setup?.id === setup[1]);
      if (!c?.setup) {
        if (req.method === 'GET' && setup[2] === '/') {
          res.writeHead(410, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          res.end(
            '<!doctype html><html lang="zh"><meta charset="utf-8"><title>设备设置已结束</title><main style="font:16px system-ui;max-width:680px;margin:80px auto;padding:20px"><h1>这次设备设置已结束</h1><p>设置可能已完成、被取消，或等待超时。请回到 Playground 重新连接；使用脚本时，请重新运行脚本。</p><p>辅助页只在对应连接过程中有效，不需要保存这个网址。</p></main></html>',
          );
          return;
        }
        json(res, { error: 'Setup expired' }, 404);
        return;
      }
      await c.setup.handle(req, res, setup[2]);
      return;
    }
    if (!this.authorized(req)) {
      json(res, { error: 'Unauthorized' }, 401);
      return;
    }
    if (req.method === 'GET' && path === '/health') {
      json(res, { protocol: HOST_PROTOCOL_VERSION });
      return;
    }
    if (req.method === 'POST' && path === '/shutdown') {
      if (!this.onShutdown)
        throw new Error('This Host is managed by its embedding application');
      json(res, {});
      setImmediate(
        () => void this.onShutdown!().catch((error) => console.error(error)),
      );
      return;
    }
    if (req.method === 'GET' && path === '/bluetooth/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      this.bluetoothStreams.add(res);
      const unsubscribe = this.runtime.input.subscribe((status) => {
        if (!res.destroyed) {
          if (!res.write(`data: ${JSON.stringify(status)}\n\n`)) res.end();
        }
      });
      const heartbeat = setInterval(() => {
        if (!res.destroyed) res.write(': heartbeat\n\n');
      }, 15000);
      res.once('close', () => {
        unsubscribe();
        clearInterval(heartbeat);
        this.bluetoothStreams.delete(res);
      });
      return;
    }
    if (req.method === 'GET' && path === '/devices') {
      json(res, this.config.list());
      return;
    }
    if (req.method === 'POST' && path === '/camera-previews') {
      const body = (await readJSON(req)) as { cameraId: string };
      json(res, await this.cameraPreviews.open(body.cameraId));
      return;
    }
    const preview = /^\/camera-previews\/([^/]+)\/(frame|close)$/.exec(path);
    if (preview) {
      if (req.method === 'GET' && preview[2] === 'frame') {
        json(res, await this.cameraPreviews.frame(preview[1]));
        return;
      }
      if (req.method === 'POST' && preview[2] === 'close') {
        await this.cameraPreviews.release(preview[1]);
        json(res, {});
        return;
      }
    }
    if (req.method === 'GET' && path === '/discover/camera') {
      json(res, await listCameras({ includeBuiltIn: true }));
      return;
    }
    if (req.method === 'GET' && path === '/discover/usb') {
      json(res, await listUSBDevices());
      return;
    }
    if (req.method === 'GET' && path === '/discover/bluetooth') {
      json(res, await this.runtime.input.status());
      return;
    }
    const restore = /^\/devices\/([^/]+)\/restore$/.exec(path);
    if (req.method === 'POST' && restore) {
      json(
        res,
        this.connections!.begin({ id: decodeURIComponent(restore[1]) }, true),
        202,
      );
      return;
    }
    if (req.method === 'POST' && path === '/connections') {
      const options = (await readJSON(req)) as IOSHIDDeviceOptions;
      if (
        !options ||
        typeof options !== 'object' ||
        (options.name !== undefined && typeof options.name !== 'string') ||
        (options.id !== undefined && typeof options.id !== 'string') ||
        (options.screen &&
          !['usb', 'camera', 'airplay'].includes(options.screen.source))
      )
        throw new Error('Invalid device options');
      json(res, this.connections!.begin(options), 202);
      return;
    }
    if (req.method === 'POST' && path === '/tasks') {
      json(res, this.tasks!.submit((await readJSON(req)) as TaskRequest), 202);
      return;
    }
    const task = /^\/tasks\/([^/]+)$/.exec(path);
    if (task) {
      if (req.method === 'GET') {
        json(res, this.tasks!.get(task[1]));
        return;
      }
      if (req.method === 'DELETE') {
        await this.tasks!.cancel(task[1]);
        json(res, {});
        return;
      }
    }
    const match = /^\/connections\/([^/]+)(?:\/(.*))?$/.exec(path);
    if (match) {
      const c = this.connections!.get(match[1]);
      if (req.method === 'GET' && !match[2]) {
        json(res, c.state);
        return;
      }
      if (req.method === 'DELETE' && !match[2]) {
        await this.connections!.close(c);
        json(res, {});
        return;
      }
      if (c.state.phase !== 'ready' || !c.session)
        throw new Error(c.state.error ?? 'Device not ready');
      if (req.method === 'GET' && match[2] === 'frame') {
        const frame = await c.session.screenshot();
        json(res, { ...frame, jpeg: frame.jpeg.toString('base64') });
        return;
      }
      if (req.method === 'POST' && match[2] === 'actions') {
        const action = (await readJSON(req)) as InputAction;
        const operation = new AbortController();
        const onDisconnect = () => {
          if (!res.writableEnded)
            operation.abort(new Error('Action client disconnected'));
        };
        res.once('close', onDisconnect);
        if (res.destroyed) onDisconnect();
        try {
          await c.session.execute(action, operation.signal);
          json(res, {});
        } finally {
          res.off('close', onDisconnect);
        }
        return;
      }
    }
    json(res, { error: 'Not found' }, 404);
  }
  close(): Promise<void> {
    this.closePromise ??= this.closeResources();
    return this.closePromise;
  }
  private async closeResources() {
    this.closing = true;
    for (const res of this.bluetoothStreams) res.end();
    clearInterval(this.timer);
    const failures: unknown[] = [];
    // Preserve shutdown order, but one failed cleanup must not leave native
    // resources or the listening server behind.
    for (const close of [
      () => this.tasks?.close(),
      () => this.connections?.closeAll(),
      () => this.cameraPreviews.close(),
      () => this.runtime.close(),
      () => {
        this.server.closeAllConnections();
        return new Promise<void>((resolve) =>
          this.server.close(() => resolve()),
        );
      },
    ]) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      const current = JSON.parse(
        await readFile(join(configDirectory, 'host.json'), 'utf8'),
      );
      if (current.token === this.token)
        await rm(join(configDirectory, 'host.json'), { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        failures.push(error);
    }
    if (failures.length)
      throw new AggregateError(failures, 'Host cleanup failed');
  }
}
