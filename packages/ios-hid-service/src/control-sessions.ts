import { randomUUID } from 'node:crypto';
import type { InputAction, ScreenFrame } from '@midscene/ios-hid';
import { type RequestHandler, Router, json } from 'express';
import { z } from 'zod';

export type ControlledDevice = {
  screenshot(): Promise<ScreenFrame>;
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

const point = z
  .object({ x: z.number().finite(), y: z.number().finite() })
  .strict();
const inputAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('home') }).strict(),
  z.object({ type: z.literal('back') }).strict(),
  z.object({ type: z.literal('clearInput') }).strict(),
  z.object({ type: z.literal('tap'), point }).strict(),
  z
    .object({
      type: z.literal('swipe'),
      from: point,
      to: point,
      durationMs: z.number().min(0).max(5000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('typeText'),
      text: z.string().max(8192),
      replace: z.boolean().optional(),
    })
    .strict(),
  z
    .object({ type: z.literal('key'), key: z.string().min(1).max(128) })
    .strict(),
]);
const sessionInput = z
  .object({ deviceId: z.string().min(1).max(128) })
  .strict();
const leaseMs = 30_000;

type Lease = {
  id: string;
  deviceId: string;
  device: ControlledDevice;
  lifetime: AbortController;
  expires: number;
  action?: Promise<void>;
  closing?: Promise<void>;
};

export class ControlSessions {
  private closed = false;
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

  private acquire(deviceId: string) {
    if (this.closed) throw new ControlError(503, '设备服务正在停止。');
    if (this.busy(deviceId))
      throw new ControlError(409, '设备正在使用，请先断开现有连接。');
    const device = this.readyDevice(deviceId);
    if (!device)
      throw new ControlError(409, '设备未就绪，请先在设备管理台连接手机。');
    const lease = {
      id: randomUUID(),
      deviceId,
      device,
      lifetime: new AbortController(),
      expires: Date.now() + leaseMs,
    };
    this.byId.set(lease.id, lease);
    this.byDevice.set(deviceId, lease);
    return { id: lease.id, deviceId, expiresInMs: leaseMs };
  }

  private require(id: string) {
    const lease = this.byId.get(id);
    if (!lease || lease.closing || lease.expires <= Date.now())
      throw new ControlError(410, '设备控制会话已结束，请重新连接。');
    return lease;
  }

  private release(lease: Lease) {
    lease.closing ??= (async () => {
      lease.lifetime.abort();
      await lease.action?.catch(() => {});
      this.byId.delete(lease.id);
      this.byDevice.delete(lease.deviceId);
    })();
    return lease.closing;
  }

  router(): Router {
    const router = Router();
    const handle =
      (
        handler: (...args: Parameters<RequestHandler>) => unknown,
      ): RequestHandler =>
      (req, res, next) => {
        void Promise.resolve()
          .then(() => handler(req, res, next))
          .catch((error: Error) => {
            if (res.destroyed) return;
            res
              .status(
                error instanceof ControlError
                  ? error.status
                  : error instanceof z.ZodError
                    ? 400
                    : 409,
              )
              .json({
                error:
                  error instanceof z.ZodError
                    ? 'Invalid device control request'
                    : error.message,
              });
          });
      };

    router.use(json({ limit: '32kb' }));
    router.post(
      '/',
      handle((req, res) =>
        res
          .status(201)
          .json(this.acquire(sessionInput.parse(req.body).deviceId)),
      ),
    );
    router.post(
      '/:id/heartbeat',
      handle((req, res) => {
        this.require(req.params.id).expires = Date.now() + leaseMs;
        res.json({});
      }),
    );
    router.delete(
      '/:id',
      handle(async (req, res) => {
        const lease = this.byId.get(req.params.id);
        if (lease) await this.release(lease);
        res.json({});
      }),
    );
    router.get(
      '/:id/screenshot',
      handle(async (req, res) => {
        const lease = this.require(req.params.id);
        const frame = await lease.device.screenshot();
        lease.lifetime.signal.throwIfAborted();
        res.json({ ...frame, jpeg: frame.jpeg.toString('base64') });
      }),
    );
    router.post(
      '/:id/actions',
      handle(async (req, res) => {
        const lease = this.require(req.params.id);
        const action = inputAction.parse(req.body);
        if (lease.action)
          throw new ControlError(409, '设备正在执行另一项操作。');
        const request = new AbortController();
        const abort = () => request.abort();
        res.once('close', abort);
        try {
          lease.action = lease.device.execute(
            action,
            AbortSignal.any([lease.lifetime.signal, request.signal]),
          );
          await lease.action;
          res.json({});
        } finally {
          lease.action = undefined;
          res.off('close', abort);
        }
      }),
    );
    return router;
  }

  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await Promise.all(
      [...this.byId.values()].map((lease) => this.release(lease)),
    );
  }
}
