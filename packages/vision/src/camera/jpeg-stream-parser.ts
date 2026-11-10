const JPEG_START = Buffer.from([0xff, 0xd8]);
const JPEG_END = Buffer.from([0xff, 0xd9]);
const DEFAULT_MAX_BUFFER_BYTES = 32 * 1024 * 1024;

export class JpegStreamParser {
  private pending = Buffer.alloc(0);

  constructor(private readonly maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES) {}

  push(chunk: Buffer): Buffer[] {
    if (chunk.length === 0) return [];
    this.pending = Buffer.concat([this.pending, chunk]);
    const frames: Buffer[] = [];

    while (this.pending.length > 0) {
      const start = this.pending.indexOf(JPEG_START);
      if (start < 0) {
        this.pending = this.pending.subarray(
          Math.max(0, this.pending.length - 1),
        );
        break;
      }

      if (start > 0) {
        this.pending = this.pending.subarray(start);
      }

      const end = this.pending.indexOf(JPEG_END, JPEG_START.length);
      if (end < 0) break;

      const frameEnd = end + JPEG_END.length;
      frames.push(Buffer.from(this.pending.subarray(0, frameEnd)));
      this.pending = this.pending.subarray(frameEnd);
    }

    if (this.pending.length > this.maxBufferBytes) {
      const lastStart = this.pending.lastIndexOf(JPEG_START);
      this.pending =
        lastStart >= 0
          ? this.pending.subarray(lastStart)
          : this.pending.subarray(this.pending.length - 1);
    }

    return frames;
  }

  reset(): void {
    this.pending = Buffer.alloc(0);
  }
}
