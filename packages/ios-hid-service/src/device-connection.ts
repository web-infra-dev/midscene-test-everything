import {
  type ConnectionState,
  IOSHIDDevice,
  type InputAction,
  type ScreenFrame,
  type ScreenOptions,
} from '@midscene/ios-hid';

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
  protected device?: IOSHIDDevice;
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
    const { setupUrl, ...state } = this.getConnectionState() ?? {};
    return {
      state: this.connectionState
        ? {
            ...state,
            setupId: setupUrl
              ? new URL(setupUrl).pathname.split('/').filter(Boolean).at(-1)
              : undefined,
          }
        : undefined,
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
      await device.screenshotBase64();
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
    if (this.device && !this.creating) {
      try {
        this.connectionState = await this.device.getConnectionState();
        if (
          this.connectionState.phase === 'ready' &&
          Date.now() - this.lastScreenCheck > 2000
        ) {
          this.lastScreenCheck = Date.now();
          try {
            await this.device.screenshotBase64();
            this.screenError = undefined;
          } catch {
            this.screenError = '画面已中断，请检查连接后点击刷新。';
          }
        }
      } catch {
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
    const device = new IOSHIDDevice({
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
    });
    this.device = device;
    try {
      await device.connect({
        onState: (state) => {
          this.connectionState = state;
          this.notifyStateChange();
        },
      });
      if (this.device !== device) throw new Error('Session cancelled');
    } catch (error) {
      if (this.device === device) this.device = undefined;
      await device.destroy();
      this.connectionState = {
        id: this.getConnectionState()?.id ?? '',
        phase: 'failed',
        error: error instanceof Error ? error.message : '连接失败，请重试。',
      };
      this.notifyStateChange();
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

  async execute(action: InputAction, signal: AbortSignal) {
    if (
      !this.device ||
      this.connectionState?.phase !== 'ready' ||
      this.creating ||
      this.screenError
    )
      throw new Error('设备连接异常，请先在设备管理台恢复。');
    await this.device.execute(action, { signal });
  }

  async destroySession() {
    const device = this.device;
    this.device = undefined;
    await device?.destroy();
    this.connectionState = undefined;
    this.notifyStateChange();
  }
}
