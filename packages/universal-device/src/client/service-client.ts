import { UniversalDeviceInterface } from '../interface.js';
import type { DeviceProfile, InputAction, ScreenFrame } from '../protocol.js';

export type UniversalDeviceOptions = { host: string; token: string };
export type UniversalDeviceProfile = DeviceProfile;

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
  constructor({ host, token }: UniversalDeviceOptions) {
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

  async openPreview(path: string, signal: AbortSignal) {
    const headersTimeout = new AbortController();
    const timer = setTimeout(() => headersTimeout.abort(), 12_000).unref();
    try {
      const response = await fetch(`${this.base}/api/v1${path}/preview`, {
        redirect: 'error',
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.any([signal, headersTimeout.signal]),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new ServiceError(response.status, '设备预览不可用。');
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

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

export async function listUniversalDevices(options: UniversalDeviceOptions) {
  const result = await new ServiceClient(options).request<{
    devices: UniversalDeviceProfile[];
  }>('/devices');
  if (!Array.isArray(result.devices))
    throw new Error('设备服务未返回设备列表。');
  return result.devices;
}

export class UniversalDevice extends UniversalDeviceInterface {
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
    capabilities: Pick<DeviceProfile, 'actions' | 'inputGuidance'>,
  ) {
    super(capabilities);
    this.heartbeat();
  }

  static async connect(
    options: UniversalDeviceOptions & {
      deviceId: string;
      name?: string;
      actions?: InputAction['type'][];
      inputGuidance?: string;
    },
  ) {
    const client = new ServiceClient(options);
    const result = await client.request<{
      id: string;
      deviceId: string;
      expiresInMs: number;
    }>('/sessions', 'POST', { deviceId: options.deviceId });
    return new UniversalDevice(
      client,
      `/sessions/${encodeURIComponent(result.id)}`,
      result.deviceId,
      options.name ?? result.deviceId,
      result.expiresInMs,
      {
        actions: options.actions ?? ['tap', 'swipe'],
        inputGuidance: options.inputGuidance,
      },
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
    return `Universal Device: ${this.name}`;
  }

  async execute(action: InputAction, options?: { signal?: AbortSignal }) {
    await this.sessionRequest(
      `${this.path}/actions`,
      'POST',
      action,
      options?.signal,
    );
  }

  async openPreview(signal: AbortSignal) {
    if (this.closed || this.ended)
      throw new ServiceError(410, '设备控制会话已结束，请重新连接。');
    try {
      return await this.client.openPreview(this.path, signal);
    } catch (error) {
      if (error instanceof ServiceError && error.status === 410)
        this.endSession();
      throw error;
    }
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
