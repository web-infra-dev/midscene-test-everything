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

  async getFrame(options: { fresh?: boolean; timeoutMs?: number } = {}) {
    const frame = await this.stream.getFrame(options);
    const metadata = await sharp(frame.jpeg).metadata();
    if (
      metadata.width !== this.settings.correction.sourceWidth ||
      metadata.height !== this.settings.correction.sourceHeight
    )
      throw new Error('Camera resolution changed; repeat screen setup');
    const jpeg = await this.transformer.transform(frame.jpeg, {
      points: this.settings.correction.points,
      rotation: this.settings.correction.rotation,
      targetWidth: this.settings.width,
      targetHeight: this.settings.height,
    });
    return { ...frame, jpeg };
  }
}
