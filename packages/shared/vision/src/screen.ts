import type { CameraCorrection } from '@midscene/robotics-shared/camera/profile';
import sharp from 'sharp';
import type { CameraStream } from './camera/camera-stream.js';
import { PerspectiveTransformer } from './camera/perspective-transformer.js';

export interface CameraScreenSettings {
  cameraId: string;
  capture?: { width: number; height: number; fps: number };
  correction: CameraCorrection;
  width: number;
  height: number;
}

/** Geometry only; the caller owns the camera and persisted settings. */
export class CameraScreen {
  private transformer = new PerspectiveTransformer();
  constructor(
    private stream: CameraStream,
    readonly settings: CameraScreenSettings,
  ) {}

  async getFrame(
    options: {
      fresh?: boolean;
      afterSequence?: number;
      timeoutMs?: number;
    } = {},
  ) {
    const frame = await this.stream.getFrame(options);
    const jpeg = await rectifyCameraFrame(
      frame.jpeg,
      this.settings,
      this.transformer,
    );
    return { ...frame, jpeg };
  }
}

export async function rectifyCameraFrame(
  jpeg: Buffer,
  settings: CameraScreenSettings,
  transformer = new PerspectiveTransformer(),
) {
  const metadata = await sharp(jpeg).metadata();
  if (
    metadata.width !== settings.correction.sourceWidth ||
    metadata.height !== settings.correction.sourceHeight
  )
    throw new Error('Camera resolution changed; repeat screen setup');
  return transformer.transform(jpeg, {
    points: settings.correction.points,
    rotation: settings.correction.rotation,
    targetWidth: settings.width,
    targetHeight: settings.height,
  });
}
