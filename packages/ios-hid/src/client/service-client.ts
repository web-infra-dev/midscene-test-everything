import { IOSHIDInterface } from '../interface.js';
import type { InputAction, ScreenFrame } from '../types.js';

export type IOSHIDServiceOptions = { host: string; token: string };
export type IOSHIDServiceProfile = {
  id: string;
  name: string;
  screenSource: 'usb' | 'camera' | 'airplay';
  status: 'available' | 'busy' | 'offline';
};

class ServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

class ServiceClient {
  private base: string;
  constructor({ host, token }: IOSHIDServiceOptions) {
    const url = new URL(host);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('请输入设备服务地址，例如 http://localhost:5801。');
    if (!token.trim()) throw new Error('请输入设备服务访问凭证。');
    this.base = url.origin;
    this.token = token.trim();
  }

  private token: string;

  async request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(
      path.endsWith('/actions') ? 120_000 : 12_000,
    );
    let response: Response;
    try {
      response = await fetch(`${this.base}/api/v1${path}`, {
        method,
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error('无法连接设备服务，请检查地址和网络。');
    }
    const value = await response.json().catch(() => undefined);
    if (!response.ok)
      throw new ServiceError(
        response.status,
        value?.error ?? `设备服务请求失败 (${response.status})`,
      );
    if (value === undefined) throw new Error('设备服务响应无效。');
    return value as T;
  }
}

export async function listIOSHIDDevices(options: IOSHIDServiceOptions) {
  const result = await new ServiceClient(options).request<{
    devices: IOSHIDServiceProfile[];
  }>('/devices');
  if (!Array.isArray(result.devices))
    throw new Error('设备服务未返回设备列表。');
  return result.devices;
}

export class IOSHIDServiceDevice extends IOSHIDInterface {
  private timer?: ReturnType<typeof setTimeout>;
  private closing?: Promise<void>;
  private closed = false;
  private lastHeartbeat = Date.now();
  private ended = false;

  private constructor(
    private client: ServiceClient,
    private path: string,
    readonly id: string,
    private name: string,
    private leaseMs: number,
  ) {
    super();
    this.heartbeat();
  }

  static async connect(
    options: IOSHIDServiceOptions & { deviceId: string; name?: string },
  ) {
    const client = new ServiceClient(options);
    const result = await client.request<{
      id: string;
      deviceId: string;
      expiresInMs: number;
    }>('/sessions', 'POST', { deviceId: options.deviceId });
    return new IOSHIDServiceDevice(
      client,
      `/sessions/${encodeURIComponent(result.id)}`,
      result.deviceId,
      options.name ?? result.deviceId,
      result.expiresInMs,
    );
  }

  private heartbeat() {
    if (this.closed || this.ended) return;
    this.timer = setTimeout(async () => {
      if (this.closed || this.ended) return;
      try {
        await this.sessionRequest(`${this.path}/heartbeat`, 'POST');
        this.lastHeartbeat = Date.now();
      } catch {
        if (Date.now() - this.lastHeartbeat >= this.leaseMs) this.endSession();
      }
      this.heartbeat();
    }, 5000).unref();
  }

  get sessionEnded() {
    return this.ended;
  }

  private endSession() {
    if (this.closed) return;
    this.ended = true;
    clearTimeout(this.timer);
  }

  private async sessionRequest<T>(
    path: string,
    method?: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.closed) throw new Error('设备已断开。');
    if (this.ended) throw new Error('设备控制会话已结束，请重新连接。');
    try {
      return await this.client.request<T>(path, method, body, signal);
    } catch (error) {
      if (error instanceof ServiceError && error.status === 410)
        this.endSession();
      throw error;
    }
  }

  describe() {
    return `iOS HID device: ${this.name}`;
  }

  async execute(action: InputAction, options?: { signal?: AbortSignal }) {
    await this.sessionRequest(
      `${this.path}/actions`,
      'POST',
      action,
      options?.signal,
    );
  }

  protected async getFrame(): Promise<ScreenFrame> {
    const frame = await this.sessionRequest<
      Omit<ScreenFrame, 'jpeg'> & { jpeg: string }
    >(`${this.path}/screenshot`);
    return { ...frame, jpeg: Buffer.from(frame.jpeg, 'base64') };
  }

  destroy() {
    this.closed = true;
    clearTimeout(this.timer);
    this.closing ??= this.client
      .request(`${this.path}`, 'DELETE')
      .then(() => undefined);
    return this.closing;
  }
}
