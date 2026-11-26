import { CameraStream } from '@midscene/robotics-vision';
import sharp from 'sharp';
import {
  openUSBCapture,
  prepareUSBCaptureApp,
} from '../native/usb-capture-app.js';
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
    devices?: USBDevice[];
    identities?: unknown;
  };
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
    // Compile or verify the capture app before starting the frame startup timer.
    await prepareUSBCaptureApp();
    const stream = new CameraStream(
      deviceId,
      {
        listDevices: async () => [],
        openStream: (_options, signal) => openUSBCapture(deviceId, signal),
      },
      {
        deviceId,
        width: 0,
        height: 0,
        fps: 24,
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
  async getFrame(
    options: {
      fresh?: boolean;
      afterSequence?: number;
      timeoutMs?: number;
      allowUnchanged?: boolean;
    } = {},
  ) {
    let frame;
    // Only a calibration observer that has already seen a frame can use
    // an unchanged sequence. Fresh screenshots and input preflights must wait.
    if (
      options.fresh &&
      options.allowUnchanged &&
      options.afterSequence !== undefined
    ) {
      try {
        frame = await this.stream.getFrame({
          ...options,
          timeoutMs: Math.min(options.timeoutMs ?? 2000, 300),
        });
      } catch (error) {
        // CoreMediaIO stops pushing buffers when an iOS screen has no pixel changes.
        if (
          !(error instanceof Error) ||
          !/No camera frame arrived/.test(error.message)
        )
          throw error;
        frame = await this.stream.getFrame();
      }
    } else {
      frame = await this.stream.getFrame(options);
    }
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
