import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { type InputAction, inputAction } from '../input-action.js';
import type { PreviewReader, ScreenFrame } from '../protocol.js';
import { ControlPreview } from './control-preview.js';

export type ControlledDevice = {
  signal: AbortSignal;
  screenshot(): Promise<ScreenFrame>;
  openPreview?(signal: AbortSignal): PreviewReader;
  actions?: InputAction['type'][];
  resourceId?: string;
  execute(action: InputAction, signal: AbortSignal): Promise<void>;
};

export class ControlError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const sessionInput = z
  .object({ deviceId: z.string().min(1).max(128) })
  .strict();
const leaseMs = 30_000;

type Lease = {
  id: string;
  deviceId: string;
  resourceId: string;
  device: ControlledDevice;
  lifetime: AbortController;
  expires: number;
  disconnect: () => void;
  action?: Promise<void>;
  preview?: ControlPreview;
  closing?: Promise<void>;
};

export class ControlSessions {
  private closed = false;
  private updateUntil = 0;
  private byId = new Map<string, Lease>();
  private byDevice = new Map<string, Lease>();
  private timer = setInterval(() => {
    for (const lease of this.byId.values())
      if (lease.expires <= Date.now()) void this.release(lease);
  }, 1000).unref();

  constructor(
    private readyDevice: (id: string) => ControlledDevice | undefined,
  ) {}

  busy(id: string) {
    return this.byDevice.has(id);
  }

  prepareUpdate() {
    if (this.closed || this.updateUntil > Date.now())
      throw new ControlError(503, 'An update is already in progress.');
    const busy = [...this.byDevice.keys()];
    if (busy.length) return { busy, expiresAt: undefined };
    // Acquisition and this check run synchronously in the same process.
    this.updateUntil = Date.now() + 60_000;
    return { busy, expiresAt: this.updateUntil };
  }

  acquire(deviceId: string) {
    if (this.closed) throw new ControlError(503, '设备服务正在停止。');
    if (this.updateUntil > Date.now())
      throw new ControlError(503, '设备服务正在更新，请稍后重试。');
    if (this.busy(deviceId))
      throw new ControlError(409, '设备正在使用，请先断开现有连接。');
    const device = this.readyDevice(deviceId);
    if (!device || device.signal.aborted)
      throw new ControlError(409, '设备未就绪，请先在设备管理台连接手机。');
    const resourceId = device.resourceId ?? deviceId;
    if (this.busy(resourceId))
      throw new ControlError(409, '设备正在使用，请先断开现有连接。');
    const lease: Lease = {
      id: randomUUID(),
      deviceId,
      resourceId,
      device,
      lifetime: new AbortController(),
      expires: Date.now() + leaseMs,
      disconnect: () => void this.release(lease),
    };
    this.byId.set(lease.id, lease);
    this.byDevice.set(resourceId, lease);
    device.signal.addEventListener('abort', lease.disconnect, { once: true });
    return { id: lease.id, deviceId, expiresInMs: leaseMs };
  }

  private require(id: string) {
    const lease = this.byId.get(id);
    if (
      !lease ||
      lease.closing ||
      lease.device.signal.aborted ||
      lease.expires <= Date.now()
    )
      throw new ControlError(410, '设备控制会话已结束，请重新连接。');
    return lease;
  }

  private release(lease: Lease) {
    lease.closing ??= (async () => {
      lease.device.signal.removeEventListener('abort', lease.disconnect);
      lease.lifetime.abort();
      await lease.action?.catch(() => {});
      this.byId.delete(lease.id);
      this.byDevice.delete(lease.resourceId);
    })();
    return lease.closing;
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string) {
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    try {
      if (path === '/sessions' && req.method === 'POST') {
        const { deviceId } = sessionInput.parse(await readBody(req));
        return send(201, this.acquire(deviceId));
      }
      const route = /^\/sessions\/([^/]+)(?:\/([^/]+))?$/.exec(path);
      if (!route) return send(404, { error: 'Unknown device API route' });
      const id = decodeURIComponent(route[1]);
      const operation = route[2];
      if (!operation && req.method === 'DELETE') {
        const lease = this.byId.get(id);
        if (lease) await this.release(lease);
        return send(200, {});
      }
      const lease = this.require(id);
      if (operation === 'heartbeat' && req.method === 'POST') {
        lease.expires = Date.now() + leaseMs;
        return send(200, {});
      }
      if (operation === 'screenshot' && req.method === 'GET') {
        const frame = await lease.device.screenshot();
        this.require(id);
        return send(200, { ...frame, jpeg: frame.jpeg.toString('base64') });
      }
      if (operation === 'preview' && req.method === 'GET') {
        const open = lease.device.openPreview;
        if (!open) throw new ControlError(404, 'Device has no live preview');
        lease.preview ??= new ControlPreview(
          (signal) => open.call(lease.device, signal),
          lease.lifetime.signal,
        );
        return lease.preview.add(res);
      }
      if (operation === 'actions' && req.method === 'POST') {
        const action = inputAction.parse(await readBody(req));
        this.require(id);
        if (lease.device.actions && !lease.device.actions.includes(action.type))
          throw new ControlError(422, 'Device does not support this action');
        if (lease.action)
          throw new ControlError(409, '设备正在执行另一项操作。');
        const request = new AbortController();
        const abort = () => request.abort();
        res.once('close', abort);
        try {
          if (res.destroyed) return;
          lease.action = lease.device.execute(
            action,
            AbortSignal.any([lease.lifetime.signal, request.signal]),
          );
          await lease.action.finally(() => this.require(id));
          return send(200, {});
        } finally {
          lease.action = undefined;
          res.off('close', abort);
        }
      }
      return send(404, { error: 'Unknown device API route' });
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) return res.destroy();
      const status =
        error instanceof ControlError
          ? error.status
          : error instanceof z.ZodError ||
              error instanceof SyntaxError ||
              error instanceof URIError
            ? 400
            : 409;
      send(status, {
        error:
          error instanceof z.ZodError
            ? 'Invalid device control request'
            : error instanceof Error
              ? error.message
              : String(error),
      });
    }
  }

  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await Promise.all(
      [...this.byId.values()].map((lease) => this.release(lease)),
    );
  }
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 32 * 1024) {
      req.resume();
      throw new ControlError(413, 'Request too large');
    }
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
