import { randomUUID } from 'node:crypto';
import type { DeviceConfig, TaskState } from '../types.js';
import {
  type ConnectionState,
  HOST_PROTOCOL_VERSION,
  type HostAddress,
  type IOSHIDDeviceOptions,
  type InputAction,
  type ScreenFrame,
} from '../types.js';

export class HostClient {
  constructor(readonly address: Pick<HostAddress, 'url' | 'token'>) {}
  async request<T>(
    path: string,
    method = 'GET',
    body?: unknown,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<T> {
    const response = await fetch(`${this.address.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.address.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal
        ? AbortSignal.any([
            options.signal,
            AbortSignal.timeout(options.timeoutMs ?? 30_000),
          ])
        : AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
    const value = await response.json();
    if (!response.ok)
      throw new Error(
        value.error ?? `Host request failed (${response.status})`,
      );
    return value as T;
  }
  async health() {
    const value = await this.request<{ protocol: number }>(
      '/health',
      'GET',
      undefined,
      { timeoutMs: 2000 },
    );
    if (value.protocol !== HOST_PROTOCOL_VERSION)
      throw new Error('Incompatible iOS HID Host version');
  }
  shutdown() {
    return this.request('/shutdown', 'POST');
  }
  listDevices() {
    return this.request<DeviceConfig[]>('/devices');
  }
  submitTask(options: {
    deviceId: string;
    instruction: string;
    requestId?: string;
  }) {
    return this.request<TaskState>('/tasks', 'POST', {
      ...options,
      requestId: options.requestId ?? randomUUID(),
    });
  }
  async task(id: string) {
    const state = await this.request<TaskState>(`/tasks/${id}`);
    if (state.setupUrl)
      state.setupUrl = new URL(
        new URL(state.setupUrl).pathname,
        this.address.url,
      ).href;
    return state;
  }
  cancelTask(id: string) {
    return this.request(`/tasks/${id}`, 'DELETE');
  }
  beginConnect(options: IOSHIDDeviceOptions) {
    return this.request<ConnectionState>('/connections', 'POST', options);
  }
  restoreDevice(id: string) {
    return this.request<ConnectionState>(
      `/devices/${encodeURIComponent(id)}/restore`,
      'POST',
    );
  }
  async state(id: string) {
    const state = await this.request<ConnectionState>(`/connections/${id}`);
    if (state.setupUrl)
      state.setupUrl = new URL(
        new URL(state.setupUrl).pathname,
        this.address.url,
      ).href;
    return state;
  }
  close(id: string) {
    return this.request(`/connections/${id}`, 'DELETE');
  }
  execute(id: string, action: InputAction, signal?: AbortSignal) {
    return this.request<void>(`/connections/${id}/actions`, 'POST', action, {
      signal,
      timeoutMs: 120_000,
    });
  }
  async screenshot(id: string): Promise<ScreenFrame> {
    const frame = await this.request<
      Omit<ScreenFrame, 'jpeg'> & { jpeg: string }
    >(`/connections/${id}/frame`);
    return { ...frame, jpeg: Buffer.from(frame.jpeg, 'base64') };
  }
}
