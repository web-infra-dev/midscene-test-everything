import {
  CameraScreen,
  type CameraScreenSettings,
  type CameraStream,
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
    return CameraScreenSession.fromStream(stream, settings, () =>
      streams.delete(stream.id),
    );
  }
  static fromStream(
    stream: CameraStream,
    settings: CameraScreenSettings,
    release: () => Promise<void>,
  ) {
    return new CameraScreenSession(new CameraScreen(stream, settings), release);
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
