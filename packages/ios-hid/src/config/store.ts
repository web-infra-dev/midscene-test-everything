import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DeviceConfig, IOSHIDDeviceOptions } from '../types.js';

export const configDirectory = join(homedir(), '.midscene', 'ios-hid');

export class DeviceSelectionRequired extends Error {
  constructor(readonly devices: DeviceConfig[]) {
    super('Multiple devices match. Select a device.');
  }
}

/** Only the Host writes this store. Writes are serialized and atomic. */
export class DeviceConfigStore {
  constructor(private directory = configDirectory) {}
  private devices: DeviceConfig[] = [];
  private pending: Promise<unknown> = Promise.resolve();
  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const value = JSON.parse(
        await readFile(join(this.directory, 'devices.json'), 'utf8'),
      );
      if (
        value.version !== 1 ||
        !Array.isArray(value.devices) ||
        !value.devices.every(
          (d: DeviceConfig) =>
            typeof d.id === 'string' &&
            typeof d.name === 'string' &&
            ['usb', 'airplay', 'camera'].includes(d.screen?.source),
        )
      )
        throw new Error('Invalid device configuration');
      this.devices = value.devices;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  list() {
    return structuredClone(this.devices);
  }
  resolve(options: IOSHIDDeviceOptions): DeviceConfig {
    // An unnamed explicitly selected phone must not reuse an unrelated saved profile.
    const physicalSelection =
      !options.id &&
      !options.name &&
      (options.bluetoothPeerId || options.screen);
    const matches = this.devices.filter((d) =>
      physicalSelection
        ? options.bluetoothPeerId
          ? d.bluetoothPeerId === options.bluetoothPeerId
          : options.screen?.source === 'usb' &&
              d.screen.source === 'usb' &&
              Boolean(options.screen.deviceId)
            ? d.screen.deviceId === options.screen.deviceId
            : options.screen?.source === 'camera' && options.screen.cameraId
              ? (d.camera?.cameraId ??
                  (d.screen.source === 'camera'
                    ? d.screen.cameraId
                    : undefined)) === options.screen.cameraId
              : d.screen.source === options.screen?.source
        : options.id
          ? d.id === options.id
          : options.name
            ? d.name === options.name
            : true,
    );
    if (matches.length > 1)
      throw new DeviceSelectionRequired(structuredClone(matches));
    if (options.id && matches.length === 0)
      throw new Error('Saved device ID not found');
    const found = matches[0];
    if (!found)
      return structuredClone({
        id: randomUUID(),
        name: options.name ?? 'iPhone',
        screen: options.screen ?? { source: 'usb' },
        bluetoothPeerId: options.bluetoothPeerId,
      });
    const config = structuredClone(found);
    if (options.screen) {
      const next = options.screen;
      const changed =
        next.source !== found.screen.source ||
        (next.source === 'usb' &&
          next.deviceId !== undefined &&
          (found.screen.source !== 'usb' ||
            next.deviceId !== found.screen.deviceId)) ||
        (next.source === 'camera' &&
          next.cameraId !== undefined &&
          next.cameraId !== found.camera?.cameraId);
      config.screen =
        next.source === found.screen.source
          ? { ...found.screen, ...next }
          : structuredClone(next);
      // A new capture binding must be confirmed against the Bluetooth phone.
      // Keep the system pairing; only repeat the local identity confirmation.
      if (changed) config.bluetoothPeerId = undefined;
    }
    if (options.bluetoothPeerId)
      config.bluetoothPeerId = options.bluetoothPeerId;
    return config;
  }
  async save(config: DeviceConfig) {
    const operation = this.pending.then(async () => {
      const next = this.devices
        .filter((d) => d.id !== config.id)
        .concat(structuredClone(config));
      const target = join(this.directory, 'devices.json');
      const temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(
        temporary,
        JSON.stringify({ version: 1, devices: next }, null, 2),
        { mode: 0o600 },
      );
      await rename(temporary, target);
      this.devices = next;
    });
    this.pending = operation.catch(() => undefined);
    await operation;
  }
}
