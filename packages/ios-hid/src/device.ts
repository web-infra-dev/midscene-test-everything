import { ensureLocalHost } from './client/ensure-local-host.js';
import { HostClient } from './client/host-client.js';
import { presentTerminalSetup } from './client/terminal-setup.js';
import { IOSHIDInterface } from './interface.js';
import type {
  ConnectOptions,
  IOSHIDDeviceOptions,
  InputAction,
} from './types.js';

/** Public Device is a client; only the Host holds hardware. */
export class IOSHIDDevice extends IOSHIDInterface {
  describe() {
    return `iOS HID device: ${this.options.name ?? this.deviceId ?? 'unconnected'}`;
  }
  private client?: HostClient;
  private connectionId?: string;
  private opening?: Promise<void>;
  private closing?: Promise<void>;
  private destroyed = false;
  private timer?: NodeJS.Timeout;
  private leaseError?: Error;
  private deviceId?: string;
  private refreshing?: Promise<void>;
  private heartbeatEpoch = 0;
  constructor(private options: IOSHIDDeviceOptions = {}) {
    super();
  }
  get id() {
    return this.deviceId;
  }
  connect(options: ConnectOptions = {}): Promise<void> {
    if (this.destroyed) return Promise.reject(new Error('Device destroyed'));
    if (this.refreshing) return this.refreshing;
    if (this.leaseError) return Promise.reject(this.leaseError);
    this.opening ??= this.open(options).catch((error) => {
      this.opening = undefined;
      throw error;
    });
    return this.opening;
  }
  /** Explicit recovery keeps this Device (and Agents borrowing it) alive. */
  refreshConnection(
    options: Pick<ConnectOptions, 'timeoutMs' | 'onState'> = {},
  ): Promise<void> {
    if (this.destroyed) return Promise.reject(new Error('Device destroyed'));
    if (!this.deviceId)
      return Promise.reject(new Error('Connect the device before refreshing'));
    this.refreshing ??= this.restore(options).finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }
  private async restore(
    options: Pick<ConnectOptions, 'timeoutMs' | 'onState'>,
  ) {
    const previousClient = this.client;
    const previousId = this.connectionId;
    this.heartbeatEpoch++;
    clearInterval(this.timer);
    this.connectionId = undefined;
    this.leaseError = new Error('设备正在恢复连接，请稍候。');
    try {
      // The old Host may no longer exist. A live Host still enforces resource ownership.
      if (previousClient && previousId)
        await previousClient.close(previousId).catch(() => {});
      if (this.destroyed) throw new Error('Device destroyed');
      this.leaseError = undefined;
      await this.open(
        {
          ...options,
          interactive: false,
          timeoutMs: options.timeoutMs ?? 60000,
        },
        true,
      );
    } catch (error) {
      this.leaseError =
        error instanceof Error ? error : new Error(String(error));
      throw error;
    }
  }
  private async open(
    { interactive = true, timeoutMs = 10 * 60_000, onState }: ConnectOptions,
    restore = false,
  ) {
    this.client = this.options.host
      ? new HostClient(this.options.host)
      : await ensureLocalHost();
    await this.client.health();
    if (this.destroyed) throw new Error('Device destroyed');
    const { host: _host, ...deviceOptions } = this.options;
    const initial = restore
      ? await this.client.restoreDevice(this.deviceId!)
      : await this.client.beginConnect(deviceOptions);
    this.connectionId = initial.id;
    const opened = new Set<string>();
    const presentation = new AbortController();
    let presentationFailure: unknown;
    const deadline = Date.now() + timeoutMs;
    try {
      while (Date.now() < deadline) {
        if (this.destroyed) throw new Error('Device destroyed');
        if (presentationFailure) throw presentationFailure;
        const state = await this.client.state(initial.id);
        onState?.(structuredClone(state));
        if (state.phase === 'ready') {
          this.deviceId = state.device!.id;
          this.startHeartbeat();
          return;
        }
        if (state.phase === 'failed' || state.phase === 'closed')
          throw new Error(state.error ?? 'Device connection closed');
        if (restore && state.phase === 'setup-required' && !onState)
          throw new Error('原设备配置无法恢复，请移除设备后重新添加。');
        if (
          state.phase === 'setup-required' &&
          state.setupUrl &&
          !onState &&
          !opened.has(state.setupUrl)
        ) {
          if (!interactive)
            throw new Error(
              `Device setup required (${state.setupKind ?? 'device'}). Use Playground, an interactive terminal, or connect({ onState }).`,
            );
          void presentTerminalSetup(state, presentation.signal).catch(
            (error) => {
              if (!presentation.signal.aborted) presentationFailure = error;
            },
          );
          opened.add(state.setupUrl);
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      throw new Error('Device connection timed out');
    } catch (error) {
      await this.client.close(initial.id).catch(() => undefined);
      this.connectionId = undefined;
      throw error;
    } finally {
      presentation.abort();
    }
  }
  private startHeartbeat() {
    clearInterval(this.timer);
    const epoch = ++this.heartbeatEpoch;
    const client = this.client!;
    const connectionId = this.connectionId!;
    this.timer = setInterval(() => {
      void client
        .state(connectionId)
        .then((state) => {
          if (epoch !== this.heartbeatEpoch) return;
          if (state.phase !== 'ready')
            throw new Error(state.error ?? 'Device lease lost');
        })
        .catch((error: Error) => {
          if (epoch !== this.heartbeatEpoch) return;
          this.leaseError = error;
          clearInterval(this.timer);
        });
    }, 5000);
    this.timer.unref();
  }
  async getConnectionState() {
    if (this.destroyed) throw new Error('Device destroyed');
    if (!this.client || !this.connectionId)
      throw new Error('Device not connected');
    return this.client.state(this.connectionId);
  }
  private assertReady() {
    if (this.destroyed) throw new Error('Device destroyed');
    if (this.leaseError) throw this.leaseError;
    if (!this.client || !this.connectionId || !this.deviceId)
      throw new Error('Call connect() before using the device');
  }
  async execute(action: InputAction, options?: { signal?: AbortSignal }) {
    this.assertReady();
    await this.client!.execute(this.connectionId!, action, options?.signal);
  }
  protected async getFrame() {
    this.assertReady();
    return this.client!.screenshot(this.connectionId!);
  }
  destroy(): Promise<void> {
    this.closing ??= (async () => {
      this.destroyed = true;
      this.heartbeatEpoch++;
      clearInterval(this.timer);
      if (this.client && this.connectionId)
        await this.client.close(this.connectionId);
      await this.opening?.catch(() => undefined);
      await this.refreshing?.catch(() => undefined);
    })();
    return this.closing;
  }
}
