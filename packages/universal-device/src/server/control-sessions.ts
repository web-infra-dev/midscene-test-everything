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

export type ControlErrorCode =
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'PAYLOAD_TOO_LARGE'
  | 'DEVICE_BUSY'
  | 'DEVICE_OFFLINE'
  | 'ACTION_IN_PROGRESS'
  | 'ACTION_UNSUPPORTED'
  | 'ACTION_FAILED'
  | 'SESSION_EXPIRED'
  | 'PREVIEW_UNAVAILABLE'
  | 'SERVICE_STOPPING'
  | 'SERVICE_UPDATING'
  | 'SERVICE_UNAVAILABLE';

export class ControlError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: ControlErrorCode,
  ) {
    super(message);
  }
}

const defaultLeaseMs = 30_000;
const minLeaseMs = 5_000;
const maxLeaseMs = 300_000;
const sessionInput = z
  .object({
    deviceId: z.string().min(1).max(128),
    leaseMs: z.number().int().min(minLeaseMs).max(maxLeaseMs).optional(),
  })
  .strict();

type Lease = {
  id: string;
  deviceId: string;
  resourceId: string;
  device: ControlledDevice;
  lifetime: AbortController;
  leaseMs: number;
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
      throw new ControlError(
        503,
        'An update is already in progress.',
        'SERVICE_UPDATING',
      );
    const busy = [...this.byDevice.keys()];
    if (busy.length) return { busy, expiresAt: undefined };
    // Acquisition and this check run synchronously in the same process.
    this.updateUntil = Date.now() + 60_000;
    return { busy, expiresAt: this.updateUntil };
  }

  acquire(deviceId: string, leaseMs = defaultLeaseMs) {
    if (this.closed)
      throw new ControlError(
        503,
        'Device service is stopping.',
        'SERVICE_STOPPING',
      );
    if (this.updateUntil > Date.now())
      throw new ControlError(
        503,
        'Device service is updating, please retry shortly.',
        'SERVICE_UPDATING',
      );
    if (this.busy(deviceId))
      throw new ControlError(
        409,
        'Device is busy; disconnect the existing session first.',
        'DEVICE_BUSY',
      );
    const device = this.readyDevice(deviceId);
    if (!device || device.signal.aborted)
      throw new ControlError(
        409,
        'Device is not ready; connect it in the device manager first.',
        'DEVICE_OFFLINE',
      );
    const resourceId = device.resourceId ?? deviceId;
    if (this.busy(resourceId))
      throw new ControlError(
        409,
        'Device is busy; disconnect the existing session first.',
        'DEVICE_BUSY',
      );
    const lease: Lease = {
      id: randomUUID(),
      deviceId,
      resourceId,
      device,
      lifetime: new AbortController(),
      leaseMs,
      expires: Date.now() + leaseMs,
      disconnect: () => void this.release(lease),
    };
    this.byId.set(lease.id, lease);
    this.byDevice.set(resourceId, lease);
    device.signal.addEventListener('abort', lease.disconnect, { once: true });
    return { id: lease.id, deviceId, expiresInMs: leaseMs };
  }

  private renew(lease: Lease) {
    lease.expires = Date.now() + lease.leaseMs;
  }

  private require(id: string) {
    const lease = this.byId.get(id);
    if (
      !lease ||
      lease.closing ||
      lease.device.signal.aborted ||
      lease.expires <= Date.now()
    )
      throw new ControlError(
        410,
        'Control session has ended; reconnect to continue.',
        'SESSION_EXPIRED',
      );
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
        const { deviceId, leaseMs } = sessionInput.parse(await readBody(req));
        return send(201, this.acquire(deviceId, leaseMs));
      }
      const route = /^\/sessions\/([^/]+)(?:\/([^/]+))?$/.exec(path);
      if (!route)
        return send(404, {
          error: 'Unknown device API route',
          code: 'NOT_FOUND',
        });
      const id = decodeURIComponent(route[1]);
      const operation = route[2];
      if (!operation && req.method === 'DELETE') {
        const lease = this.byId.get(id);
        if (lease) await this.release(lease);
        return send(200, {});
      }
      const lease = this.require(id);
      if (operation === 'heartbeat' && req.method === 'POST') {
        this.renew(lease);
        return send(200, {});
      }
      if (operation === 'screenshot' && req.method === 'GET') {
        this.renew(lease);
        const frame = await lease.device.screenshot();
        this.renew(this.require(id));
        const accept = req.headers.accept ?? '';
        if (
          accept.includes('image/jpeg') &&
          !accept.includes('application/json')
        ) {
          res.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'X-Screen-Width': String(frame.width),
            'X-Screen-Height': String(frame.height),
            'X-Screen-Sequence': String(frame.sequence),
            'X-Screen-Received-At': String(frame.receivedAt),
          });
          res.end(frame.jpeg);
          return;
        }
        return send(200, { ...frame, jpeg: frame.jpeg.toString('base64') });
      }
      if (operation === 'preview' && req.method === 'GET') {
        const open = lease.device.openPreview;
        if (!open)
          throw new ControlError(
            404,
            'Device has no live preview',
            'PREVIEW_UNAVAILABLE',
          );
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
          throw new ControlError(
            422,
            'Device does not support this action',
            'ACTION_UNSUPPORTED',
          );
        if (lease.action)
          throw new ControlError(
            409,
            'Another action is already in progress.',
            'ACTION_IN_PROGRESS',
          );
        const request = new AbortController();
        const abort = () => request.abort();
        res.once('close', abort);
        try {
          if (res.destroyed) return;
          this.renew(lease);
          lease.action = lease.device.execute(
            action,
            AbortSignal.any([lease.lifetime.signal, request.signal]),
          );
          await lease.action.finally(() => this.renew(this.require(id)));
          return send(200, {});
        } finally {
          lease.action = undefined;
          res.off('close', abort);
        }
      }
      return send(404, {
        error: 'Unknown device API route',
        code: 'NOT_FOUND',
      });
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) return res.destroy();
      const isBadInput =
        error instanceof z.ZodError ||
        error instanceof SyntaxError ||
        error instanceof URIError;
      const status =
        error instanceof ControlError ? error.status : isBadInput ? 400 : 409;
      const code: ControlErrorCode =
        error instanceof ControlError
          ? (error.code ?? 'ACTION_FAILED')
          : isBadInput
            ? 'INVALID_REQUEST'
            : 'ACTION_FAILED';
      send(status, {
        error:
          error instanceof z.ZodError
            ? 'Invalid device control request'
            : error instanceof Error
              ? error.message
              : String(error),
        code,
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
      throw new ControlError(413, 'Request too large', 'PAYLOAD_TOO_LARGE');
    }
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
