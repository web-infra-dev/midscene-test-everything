import { spawn } from 'node:child_process';
import { CameraStream } from '@midscene/robotics-vision';
import { JpegProcessCameraSource } from '@midscene/robotics-vision/camera/jpeg-process-camera-source';
import sharp from 'sharp';
import { nativeHelper } from '../native/compiler.js';
import { USBDiscoveryClient } from '../native/usb-discovery.js';
import type { ScreenSession } from './source.js';
import { type USBIdentity, enrichUSBDevices } from './usb-identity.js';

let discovery: USBDiscoveryClient | undefined;
export async function closeUSBDiscovery() {
  const current = discovery;
  discovery = undefined;
  discoveredDevices = [];
  await current?.close();
}
export interface USBDevice {
  id: string;
  name: string;
  model: string;
  modelName?: string;
  productType?: string;
}
let discoveredDevices: USBDevice[] = [];
export function cachedUSBDevice(id: string) {
  return discoveredDevices.find((device) => device.id === id);
}
export async function listUSBDevices(): Promise<USBDevice[]> {
  discovery ??= new USBDiscoveryClient();
  const value = (await discovery.list()) as {
    authorization?: number;
    devices?: USBDevice[];
    identities?: unknown;
  };
  if (value.authorization === 1 || value.authorization === 2)
    throw new Error(
      'macOS camera access is denied. Allow the launching application in System Settings → Privacy & Security → Camera, then reconnect.',
    );
  if (
    !Array.isArray(value.devices) ||
    !value.devices.every(
      (d: USBDevice) => typeof d.id === 'string' && typeof d.name === 'string',
    )
  )
    throw new Error('Invalid USB discovery response');
  let identities: USBIdentity[] = [];
  try {
    const parsed = value.identities;
    if (Array.isArray(parsed))
      identities = parsed.filter(
        (device: USBIdentity) =>
          typeof device.id === 'string' &&
          typeof device.name === 'string' &&
          typeof device.productType === 'string',
      );
  } catch {
    /* Metadata is optional; keep screen discovery available. */
  }
  discoveredDevices = enrichUSBDevices(value.devices, identities);
  return discoveredDevices;
}
export class USBScreenSession implements ScreenSession {
  private constructor(private stream: CameraStream) {}
  static async open(deviceId: string) {
    const helper = await nativeHelper('usb-capture');
    const stream = new CameraStream(
      deviceId,
      {
        listDevices: async () => [],
        openStream: async () =>
          new JpegProcessCameraSource(
            spawn(helper, ['capture', deviceId], { stdio: 'pipe' }),
            'iPhone USB capture',
          ),
      },
      {
        deviceId,
        width: 0,
        height: 0,
        fps: 12,
        horizontalFlip: false,
        verticalFlip: false,
      },
    );
    const session = new USBScreenSession(stream);
    try {
      await stream.start();
      await stream.getFrame({ timeoutMs: 20_000 });
      return session;
    } catch (error) {
      await session.close();
      throw error;
    }
  }
  async getFrame(options = {}) {
    const frame = await this.stream.getFrame(options);
    const metadata = await sharp(frame.jpeg).metadata();
    if (!metadata.width || !metadata.height)
      throw new Error('Invalid USB frame dimensions');
    return {
      jpeg: frame.jpeg,
      width: metadata.width,
      height: metadata.height,
      sequence: frame.id,
      receivedAt: frame.capturedAt,
    };
  }
  async close() {
    await this.stream.stop();
  }
}
