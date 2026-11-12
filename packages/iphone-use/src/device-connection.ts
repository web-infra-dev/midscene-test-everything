import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ControlledDevice } from '@midscene/open-device/server';
import type { ConnectionManager } from './hardware/runtime/connections.js';
import { LocalDevice } from './hardware/runtime/local-device.js';
import type {
  ConnectionState,
  ScreenFrame,
  ScreenOptions,
} from './hardware/types.js';

export class DeviceConnection {
  private stateListeners = new Set<() => void>();
  onStateChange(listener: () => void) {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }
  protected notifyStateChange() {
    for (const listener of this.stateListeners) listener();
  }
  constructor(private connections: ConnectionManager) {}

  protected device?: LocalDevice;
  private creating = false;
  private connectionState?: ConnectionState;
  private input: Record<string, unknown> = {};
  private screenError?: string;
  private lastScreenCheck = 0;
  private refreshPending?: Promise<ConnectionState | undefined>;
  private recoveryPending?: Promise<void>;
  updateBluetoothStatus(hosts: { id: string; reports: number[] }[]) {
    if (this.connectionState?.phase !== 'ready') return;
    const peer = hosts.find((peer) => peer.id === this.input.bluetoothPeerId);
    if (!peer || ![1, 2, 3].every((report) => peer.reports.includes(report))) {
      this.connectionState = {
        ...this.connectionState,
        phase: 'failed',
        error: '蓝牙连接已断开，请在手机连接后点击刷新。',
      };
      this.notifyStateChange();
    }
  }
  getSnapshot() {
    return {
      state: this.getConnectionState(),
      source: this.input.source ?? 'usb',
      bluetoothPeerId: this.input.bluetoothPeerId as string | undefined,
      sourceId: (this.input.deviceId ?? this.input.cameraId) as
        | string
        | undefined,
      screenError: this.screenError,
      refreshing: Boolean(this.recoveryPending),
    };
  }
  refreshConnectionState() {
    this.refreshPending ??= this.refreshState().finally(() => {
      this.refreshPending = undefined;
      this.notifyStateChange();
    });
    return this.refreshPending;
  }
  refreshDevice(): Promise<void> {
    this.recoveryPending ??= this.recoverDevice().finally(() => {
      this.recoveryPending = undefined;
      this.notifyStateChange();
    });
    return this.recoveryPending;
  }
  private async recoverDevice() {
    const device = this.device;
    if (!device) throw new Error('设备尚未连接，请先添加设备。');
    this.creating = true;
    try {
      await this.refreshPending;
      if (this.device !== device) throw new Error('设备已移除。');
      this.screenError = undefined;
      this.connectionState = {
        ...this.connectionState!,
        phase: 'connecting',
        error: undefined,
      };
      this.notifyStateChange();
      await device.refreshConnection({
        timeoutMs: this.input.source === 'airplay' ? 10 * 60_000 : 180000,
        onState: (state) => {
          if (this.device !== device) return;
          // A ready input lease still needs a fresh video frame before enabling tasks.
          this.connectionState = {
            ...state,
            phase: state.phase === 'ready' ? 'connecting' : state.phase,
          };
          this.notifyStateChange();
        },
      });
      await device.screenshot();
      const state = await device.getConnectionState();
      if (this.device !== device) throw new Error('设备已移除。');
      if (state.phase !== 'ready')
        throw new Error(state.error ?? '设备尚未就绪，请检查连接后刷新。');
      this.connectionState = state;
      this.lastScreenCheck = Date.now();
    } catch (error) {
      if (this.device === device)
        this.connectionState = {
          ...this.connectionState!,
          phase: 'failed',
          error:
            error instanceof Error
              ? error.message
              : '恢复失败，请检查连接后刷新。',
        };
      throw error;
    } finally {
      this.creating = false;
    }
  }
  private async refreshState() {
    const device = this.device;
    if (device && !this.creating) {
      try {
        const state = await device.getConnectionState();
        if (this.device !== device || this.creating)
          return this.getConnectionState();
        this.connectionState = state;
        if (
          state.phase === 'ready' &&
          Date.now() - this.lastScreenCheck > 2000
        ) {
          this.lastScreenCheck = Date.now();
          let screenError: string | undefined;
          try {
            await device.screenshot();
          } catch {
            screenError = '画面已中断，请检查连接后点击刷新。';
          }
          if (this.device === device) this.screenError = screenError;
        }
      } catch {
        if (this.device === device && !this.creating)
          this.connectionState = {
            ...this.connectionState!,
            phase: 'failed',
            error: '设备连接已失效，请检查连接后点击刷新。',
          };
      }
    }
    return this.getConnectionState();
  }
  getConnectionState() {
    return this.connectionState
      ? structuredClone(this.connectionState)
      : undefined;
  }
  async connect(input: Record<string, unknown> = {}) {
    if (this.creating || this.device)
      throw new Error(
        'Disconnect the current device before connecting another',
      );
    const source = input.source;
    if (
      source &&
      !['saved', 'usb', 'camera', 'airplay'].includes(String(source))
    )
      throw new Error('Invalid screen source');
    if (
      source === 'usb' &&
      (typeof input.deviceId !== 'string' || !input.deviceId)
    )
      throw new Error('请选择 USB 手机');
    if (
      source === 'camera' &&
      (typeof input.cameraId !== 'string' || !input.cameraId)
    )
      throw new Error('请选择摄像头');
    if (
      !input.id &&
      (typeof input.bluetoothPeerId !== 'string' || !input.bluetoothPeerId)
    )
      throw new Error('请选择蓝牙手机');
    this.creating = true;
    this.input = { ...input };
    this.screenError = undefined;
    this.connectionState = undefined;
    this.notifyStateChange();
    const device = new LocalDevice(
      {
        id: typeof input.id === 'string' ? input.id : undefined,
        name:
          typeof input.name === 'string' && input.name.trim()
            ? input.name.trim()
            : undefined,
        reuseConfiguration: input.reuseConfiguration !== false,
        bluetoothPeerId:
          typeof input.bluetoothPeerId === 'string'
            ? input.bluetoothPeerId
            : undefined,
        screen:
          source && source !== 'saved'
            ? ({
                source,
                ...(source === 'usb'
                  ? { deviceId: input.deviceId }
                  : source === 'camera'
                    ? { cameraId: input.cameraId }
                    : {}),
              } as ScreenOptions)
            : undefined,
      },
      this.connections,
    );
    this.device = device;
    try {
      await device.connect({
        onState: (state) => {
          if (this.device !== device) return;
          this.connectionState = state;
          this.notifyStateChange();
        },
      });
      if (this.device !== device) throw new Error('Session cancelled');
    } catch (error) {
      try {
        await device.destroy();
      } finally {
        if (this.device === device) {
          this.device = undefined;
          this.connectionState = {
            id: this.getConnectionState()?.id ?? '',
            phase: 'failed',
            error:
              error instanceof Error ? error.message : '连接失败，请重试。',
          };
          this.notifyStateChange();
        }
      }
      throw error;
    } finally {
      this.creating = false;
    }
  }
  async screenshot(): Promise<ScreenFrame> {
    if (!this.device || this.connectionState?.phase !== 'ready')
      throw new Error('设备尚未就绪。');
    return this.device.screenshot();
  }

  controlDevice(id: string): ControlledDevice | undefined {
    if (
      this.connectionState?.device?.id !== id ||
      this.connectionState.phase !== 'ready' ||
      this.creating ||
      this.screenError
    )
      return undefined;

    const connection = this.device?.controlConnection();
    if (!connection) return undefined;
    const { session, signal } = connection;
    return {
      signal,
      screenshot: () => session.screenshot(),
      openPreview: (signal) => session.openPreview(signal),
      execute: async (action, cancellation) => {
        cancellation.throwIfAborted();
        if (this.screenError)
          throw new Error('设备连接异常，请先在设备管理台恢复。');
        await session.execute(action, cancellation);
      },
    };
  }

  async handleSetup(
    id: string,
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
  ) {
    const device = this.device;
    if (!device) {
      res.writeHead(410, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'This setup has ended. Reconnect the device.',
        }),
      );
      return;
    }
    await device.handleSetup(id, req, res, path);
  }

  async destroySession() {
    const device = this.device;
    this.device = undefined;
    await device?.destroy();
    this.connectionState = undefined;
    this.notifyStateChange();
  }
}
