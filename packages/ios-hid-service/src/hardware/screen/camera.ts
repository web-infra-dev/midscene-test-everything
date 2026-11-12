import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import {
  CameraScreen,
  type CameraScreenSettings,
  type CameraStream,
  type CameraStreamManager,
} from '@midscene/robotics-vision';
import type { PreviewReader, ScreenSession } from './source.js';
export class CameraScreenSession implements ScreenSession {
  private constructor(
    private screen: CameraScreen,
    private stream: CameraStream,
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
    return new CameraScreenSession(
      new CameraScreen(stream, settings),
      stream,
      release,
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
  openPreview(signal: AbortSignal): PreviewReader {
    const worker = new Worker(
      new URL('./camera-preview-worker.js', import.meta.url),
      {
        workerData: this.screen.settings,
      },
    );
    const failed = new AbortController();
    worker.once('error', (error) => failed.abort(error));
    worker.once('exit', () =>
      failed.abort(new Error('Camera preview worker exited')),
    );
    const lifetime = AbortSignal.any([signal, failed.signal]);
    let lastSequence = 0;
    return {
      getFrame: async () => {
        lifetime.throwIfAborted();
        const frame = await this.stream.getFrame({ timeoutMs: 2000 });
        if (frame.id === lastSequence) return;
        lifetime.throwIfAborted();
        const jpeg = Uint8Array.from(frame.jpeg);
        const reply = once(worker, 'message', { signal: lifetime });
        worker.postMessage(jpeg, [jpeg.buffer]);
        const [result] = (await reply) as [
          { jpeg: Uint8Array } | { error: string },
        ];
        if ('error' in result) throw new Error(result.error);
        lastSequence = frame.id;
        return { jpeg: Buffer.from(result.jpeg), sequence: frame.id };
      },
      close: async () => {
        await worker.terminate();
      },
    };
  }
  close() {
    return this.release();
  }
}
