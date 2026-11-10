import {
  CameraScreen,
  type CameraScreenSettings,
  type CameraStreamManager,
} from '@midscene/robotics-vision';
import type { ScreenSession } from './source.js';
export class CameraScreenSession implements ScreenSession {
  private constructor(
    private screen: CameraScreen,
    private release: () => Promise<void>,
  ) {}
  static async open(
    streams: CameraStreamManager,
    settings: CameraScreenSettings,
  ) {
    const stream = await streams.create({
      deviceId: settings.cameraId,
      ...settings.capture,
    });
    return new CameraScreenSession(new CameraScreen(stream, settings), () =>
      streams.delete(stream.id),
    );
  }
  async getFrame(options = {}) {
    const frame = await this.screen.getFrame(options);
    return {
      jpeg: frame.jpeg,
      width: this.screen.settings.width,
      height: this.screen.settings.height,
      sequence: frame.id,
      receivedAt: frame.capturedAt,
    };
  }
  close() {
    return this.release();
  }
}
