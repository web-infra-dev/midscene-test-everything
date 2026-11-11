import { randomUUID } from 'node:crypto';
import type {
  CameraStream,
  CameraStreamManager,
} from '@midscene/robotics-vision';

/** Short-lived, uncorrected previews; the same runtime owns setup and capture. */
export class CameraPreviews {
  private entries = new Map<
    string,
    { stream: Promise<CameraStream>; touched: number }
  >();
  constructor(
    private streams: CameraStreamManager,
    private now = Date.now,
  ) {}
  async open(cameraId: string) {
    if (!cameraId || typeof cameraId !== 'string')
      throw new Error('Select a camera');
    const id = randomUUID();
    const entry = {
      stream: this.streams.create({ deviceId: cameraId }),
      touched: this.now(),
    };
    this.entries.set(id, entry);
    try {
      await entry.stream;
      return { id };
    } catch (error) {
      this.entries.delete(id);
      throw error;
    }
  }
  async frame(id: string) {
    const entry = this.entries.get(id);
    if (!entry)
      throw new Error('Camera preview expired; select the camera again');
    entry.touched = this.now();
    const stream = await entry.stream;
    const frame = await stream.getFrame({ fresh: true, timeoutMs: 10000 });
    return frame;
  }
  async release(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    const stream = await entry.stream.catch(() => undefined);
    if (stream) await this.streams.delete(stream.id);
  }
  async sweep() {
    await Promise.allSettled(
      [...this.entries]
        .filter(([, entry]) => this.now() - entry.touched > 30000)
        .map(([id]) => this.release(id)),
    );
  }
  async close() {
    await Promise.allSettled(
      [...this.entries.keys()].map((id) => this.release(id)),
    );
  }
}
