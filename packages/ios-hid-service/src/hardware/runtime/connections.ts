import { randomUUID } from 'node:crypto';
import { createCameraSetup } from '@midscene/robotics-vision/setup';
import {
  type DeviceConfigStore,
  DeviceSelectionRequired,
} from '../config/store.js';
import type { ScreenSession } from '../screen/source.js';
import { listUSBDevices } from '../screen/usb.js';
import type {
  ConnectionState,
  DeviceConfig,
  IOSHIDDeviceOptions,
} from '../types.js';
import type { DeviceSession } from './device-session.js';
import type { IOSHIDRuntime } from './runtime.js';
import { DeviceSelectionSession } from './selection.js';
import { DeviceSetupSession, type SetupSession } from './setup.js';

export interface Connection {
  state: ConnectionState;
  config: DeviceConfig;
  lifetime: AbortController;
  session?: DeviceSession;
  setup?: SetupSession;
  opening?: Promise<void>;
  closing?: Promise<void>;
}
export class ConnectionManager {
  private entries = new Map<string, Connection>();
  constructor(
    private runtime: IOSHIDRuntime,
    private store: DeviceConfigStore,
  ) {}
  private watchBluetooth() {
    this.unsubscribeBluetooth ??= this.runtime.input.subscribe((status) => {
      for (const connection of this.entries.values()) {
        if (connection.state.phase !== 'ready') continue;
        const peer = status.hosts.find(
          (peer) => peer.id === connection.config.bluetoothPeerId,
        );
        if (peer && [1, 2, 3].every((report) => peer.reports.includes(report)))
          continue;
        connection.state = {
          ...connection.state,
          phase: 'failed',
          error: '蓝牙连接已断开，请在手机连接后点击刷新。',
        };
        connection.lifetime.abort(new Error(connection.state.error));
        void connection.session?.close().catch(() => {});
      }
    });
  }
  private unsubscribeBluetooth?: () => void;
  list() {
    return [...this.entries.values()];
  }
  get(id: string) {
    const c = this.entries.get(id);
    if (!c) throw new Error('Device connection not found');
    return c;
  }
  begin(options: IOSHIDDeviceOptions, restore = false) {
    if (restore && !options.id) throw new Error('Saved device ID required');
    let config: DeviceConfig;
    let choices: DeviceConfig[] | undefined;
    try {
      config = this.store.resolve(options);
    } catch (error) {
      if (!(error instanceof DeviceSelectionRequired)) throw error;
      choices = error.devices;
      config = {
        id: randomUUID(),
        name: options.name ?? 'iPhone',
        screen: options.screen ?? { source: 'usb' },
      };
    }
    if (
      this.list().some(
        (c) =>
          c.config.id === config.id &&
          !['failed', 'closed'].includes(c.state.phase),
      )
    )
      throw new Error('Device already in use');
    const id = randomUUID();
    const c: Connection = {
      state: {
        id,
        phase: 'connecting',
        device: { id: config.id, name: config.name },
      },
      config,
      lifetime: new AbortController(),
    };
    this.entries.set(id, c);
    this.watchBluetooth();
    c.opening = this.open(c, options, choices, restore).catch(
      async (error: Error) => {
        let message = error.message;
        try {
          await c.session?.close();
        } catch (cleanup) {
          message += `; cleanup failed: ${String(cleanup)}`;
        }
        c.session = undefined;
        if (c.state.phase !== 'closed')
          c.state = {
            ...c.state,
            phase: 'failed',
            setupId: undefined,
            setupKind: undefined,
            error: message,
          };
      },
    );
    return c.state;
  }
  private async open(
    c: Connection,
    options: IOSHIDDeviceOptions,
    choices?: DeviceConfig[],
    restore = false,
  ) {
    if (choices) {
      const setup = new DeviceSelectionSession(choices, this.store, options);
      c.setup = setup;
      c.state.phase = 'setup-required';
      c.state.device = undefined;
      c.state.setupKind = 'selection';
      c.state.setupId = setup.id;
      try {
        c.config = await setup.result;
      } finally {
        await setup.close();
        c.setup = undefined;
        c.state.setupId = undefined;
        c.state.setupKind = undefined;
      }
      if (c.lifetime.signal.aborted) return;
      if (
        this.list().some(
          (other) =>
            other !== c &&
            other.config.id === c.config.id &&
            !['failed', 'closed'].includes(other.state.phase),
        )
      )
        throw new Error('Device already in use');
      c.state.device = { id: c.config.id, name: c.config.name };
      c.state.phase = 'connecting';
    }
    const config = c.config;
    let preview: ScreenSession | undefined;
    if (
      restore &&
      (!config.bluetoothPeerId ||
        (config.screen.source === 'usb' && !config.screen.deviceId) ||
        (config.screen.source === 'camera' &&
          (!config.camera ||
            (config.screen.cameraId &&
              config.screen.cameraId !== config.camera.cameraId))))
    )
      throw new Error('原设备配置不完整，请移除设备后重新添加。');
    if (!restore) {
      if (config.screen.source === 'usb' && !config.screen.deviceId) {
        const devices = await listUSBDevices();
        if (devices.length === 1) config.screen.deviceId = devices[0].id;
      }
      if (
        config.screen.source === 'camera' &&
        (!config.camera ||
          (config.screen.cameraId &&
            config.screen.cameraId !== config.camera.cameraId))
      ) {
        c.state.phase = 'setup-required';
        const setup = createCameraSetup({
          streams: this.runtime.cameras,
          cameraId: config.screen.cameraId,
          initialValue:
            !config.screen.cameraId ||
            config.screen.cameraId === config.camera?.cameraId
              ? config.camera
              : undefined,
          onConfirm: async (settings) => {
            config.camera = settings;
          },
        });
        c.setup = setup;
        c.state.setupKind = 'camera';
        c.state.setupId = setup.id;
        try {
          await setup.result;
        } finally {
          await setup.close();
          c.setup = undefined;
          c.state.setupId = undefined;
          c.state.setupKind = undefined;
        }
      }
      if (c.state.phase === 'closed') return;
    }
    // Restoring AirPlay also requires the person to reconnect screen mirroring.
    // Reuse the original setup and transfer its live receiver into the session.
    if (!restore || config.screen.source === 'airplay') {
      if (
        config.screen.source === 'airplay' ||
        config.screen.source === 'camera' ||
        !config.bluetoothPeerId ||
        (config.screen.source === 'usb' && !config.screen.deviceId)
      ) {
        const setup = new DeviceSetupSession(config, this.runtime, restore);
        c.setup = setup;
        c.state.phase = 'setup-required';
        c.state.setupKind = 'device';
        c.state.setupId = setup.id;
        try {
          await setup.result;
          preview = setup.takePreview();
        } finally {
          await setup.close();
          c.setup = undefined;
          c.state.setupId = undefined;
          c.state.setupKind = undefined;
        }
      }
    }
    if ((c.state.phase as string) === 'closed') {
      await preview?.close();
      return;
    }
    const peer = (await this.runtime.input.listPeers()).find(
      (peer) => peer.id === config.bluetoothPeerId,
    );
    if (peer) config.name = peer.name;
    config.modelName = undefined;
    c.state.phase = 'connecting';
    const session = await this.runtime.open(
      config,
      preview,
      c.lifetime.signal,
      async () => {
        c.lifetime.signal.throwIfAborted();
        await this.store.save(config);
      },
    );
    if ((c.state.phase as string) === 'closed') {
      await session.close();
      return;
    }
    c.session = session;
    c.state.device = {
      id: config.id,
      name: config.name,
      modelName: config.modelName,
    };
    await this.store.save(config);
    c.lifetime.signal.throwIfAborted();
    c.state.phase = 'ready';
  }
  close(c: Connection): Promise<void> {
    c.closing ??= (async () => {
      c.state.phase = 'closed';
      c.lifetime.abort(new Error('Device connection closed'));
      try {
        await c.setup?.close();
      } finally {
        try {
          await c.opening;
        } finally {
          try {
            await c.session?.close();
          } finally {
            this.entries.delete(c.state.id);
          }
        }
      }
    })();
    return c.closing;
  }
  async closeAll() {
    this.unsubscribeBluetooth?.();
    await Promise.allSettled(this.list().map((c) => this.close(c)));
  }
}
