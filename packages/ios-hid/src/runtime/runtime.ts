import { CameraStreamManager, cameraBackend } from '@midscene/robotics-vision';
import { HIDInputManager, type HIDInputSession } from '../input/session.js';
import type { PointerDiagnostics } from '../pointer/diagnostics.js';
import { AirPlayScreenSession } from '../screen/airplay.js';
import { CameraScreenSession } from '../screen/camera.js';
import type { ScreenSession } from '../screen/source.js';
import { USBScreenSession, closeUSBDiscovery } from '../screen/usb.js';
import type { DeviceConfig } from '../types.js';
import { DeviceSession } from './device-session.js';

/** All native resources, including first-time setup previews, belong to this runtime. */
export class IOSHIDRuntime {
  readonly cameras = new CameraStreamManager(cameraBackend());
  readonly input: HIDInputManager;
  constructor(options: { pointerDiagnostics?: PointerDiagnostics } = {}) {
    this.input = new HIDInputManager(options.pointerDiagnostics);
  }
  private owners = new Set<string>();
  private sessions = new Set<DeviceSession>();
  private screens = new Map<ScreenSession, string>();
  private openings = new Set<Promise<unknown>>();
  private lifetime = new AbortController();
  private closing?: Promise<void>;

  private reserve(keys: string[]) {
    this.lifetime.signal.throwIfAborted();
    if (keys.some((key) => this.owners.has(key)))
      throw new Error('Device or hardware resource already in use');
    keys.forEach((key) => this.owners.add(key));
    return () => keys.forEach((key) => this.owners.delete(key));
  }
  private track<T>(operation: Promise<T>): Promise<T> {
    this.openings.add(operation);
    void operation.then(
      () => this.openings.delete(operation),
      () => this.openings.delete(operation),
    );
    return operation;
  }
  private screenKey(config: DeviceConfig) {
    if (config.screen.source === 'usb') {
      if (!config.screen.deviceId) throw new Error('Select a USB device first');
      return `usb:${config.screen.deviceId}`;
    }
    if (config.screen.source === 'camera') {
      if (!config.camera) throw new Error('Configure the camera first');
      return `camera:${config.camera.cameraId}`;
    }
    // UxPlay currently uses one receiver's default ports per Host.
    return 'airplay';
  }

  openScreen(config: DeviceConfig): Promise<ScreenSession> {
    return this.track(this.createScreen(config));
  }
  private async createScreen(config: DeviceConfig): Promise<ScreenSession> {
    const key = this.screenKey(config);
    const release = this.reserve([key]);
    let source: ScreenSession | undefined;
    try {
      if (config.screen.source === 'usb')
        source = await USBScreenSession.open(config.screen.deviceId!);
      else if (config.screen.source === 'camera')
        source = await CameraScreenSession.open(this.cameras, config.camera!);
      else source = await AirPlayScreenSession.open(config.id, config.name);
      this.lifetime.signal.throwIfAborted();
      const opened = source;
      let closing: Promise<void> | undefined;
      const screen: ScreenSession = {
        getFrame: (options) => {
          if (closing)
            return Promise.reject(new Error('Screen session closed'));
          return opened.getFrame(options);
        },
        getSetupInfo: () => opened.getSetupInfo?.(),
        close: () => {
          closing ??= (async () => {
            try {
              await opened.close();
            } finally {
              this.screens.delete(screen);
              release();
            }
          })();
          return closing;
        },
      };
      this.screens.set(screen, key);
      return screen;
    } catch (error) {
      try {
        await source?.close();
      } finally {
        release();
      }
      throw error;
    }
  }

  open(
    config: DeviceConfig,
    existingScreen?: ScreenSession,
    signal?: AbortSignal,
    persistConfig?: () => Promise<void>,
  ): Promise<DeviceSession> {
    return this.track(
      this.openDevice(config, existingScreen, signal, persistConfig),
    );
  }
  private async openDevice(
    config: DeviceConfig,
    existingScreen?: ScreenSession,
    cancellation?: AbortSignal,
    persistConfig?: () => Promise<void>,
  ): Promise<DeviceSession> {
    const signal = cancellation
      ? AbortSignal.any([this.lifetime.signal, cancellation])
      : this.lifetime.signal;
    let release: (() => void) | undefined;
    let screen = existingScreen;
    let input: HIDInputSession | undefined;
    let session: DeviceSession | undefined;
    const cancelInput = () => input?.cancel();
    try {
      signal.throwIfAborted();
      release = this.reserve([
        `device:${config.id}`,
        `bluetooth:${config.bluetoothPeerId}`,
      ]);
      if (screen && this.screens.get(screen) !== this.screenKey(config))
        throw new Error('Preview does not belong to this device source');
      screen ??= await this.openScreen(config);
      signal.throwIfAborted();
      if (!config.bluetoothPeerId)
        throw new Error('Select a Bluetooth peer first');
      input = await this.input.open(config.bluetoothPeerId, signal);
      input.configureMotion(config, persistConfig);
      signal.addEventListener('abort', cancelInput, { once: true });
      signal.throwIfAborted();
      session = new DeviceSession(config, screen, input, () => {
        signal.removeEventListener('abort', cancelInput);
        this.sessions.delete(session!);
        release!();
      });
      this.sessions.add(session);
      await session.verifyPointer();
      signal.throwIfAborted();
      return session;
    } catch (error) {
      signal.removeEventListener('abort', cancelInput);
      if (session) await session.close();
      else {
        try {
          await Promise.allSettled([screen?.close(), input?.close()]);
        } finally {
          release?.();
        }
      }
      throw error;
    }
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      this.lifetime.abort(new Error('Runtime closing'));
      await Promise.allSettled([...this.openings]);
      await Promise.allSettled(
        [...this.sessions].map((session) => session.close()),
      );
      await Promise.allSettled(
        [...this.screens.keys()].map((screen) => screen.close()),
      );
      try {
        const results = await Promise.allSettled([
          this.input.close(),
          closeUSBDiscovery(),
        ]);
        const failures = results.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        );
        if (failures.length)
          throw new AggregateError(failures, 'Native service cleanup failed');
      } finally {
        await this.cameras.close();
      }
    })();
    return this.closing;
  }
}
