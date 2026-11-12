import type { HIDInputSession } from '../input/session.js';
import { settledFrame } from '../screen/settled-frame.js';
import type { PreviewReader, ScreenSession } from '../screen/source.js';
import type { DeviceConfig, InputAction } from '../types.js';

/** Owns one connected phone’s capture and serialized input. */
export class DeviceSession {
  private pending: Promise<unknown> = Promise.resolve();
  private closed = false;
  private closing?: Promise<void>;
  private generation = 1;
  private settledGeneration = 0;
  private settling?: Promise<Awaited<ReturnType<ScreenSession['getFrame']>>>;
  constructor(
    readonly config: DeviceConfig,
    private screen: ScreenSession,
    private input: HIDInputSession,
    private release: () => void,
  ) {}
  verifyPointer() {
    return this.input.verify(this.screen);
  }
  openPreview(signal: AbortSignal): PreviewReader {
    if (this.closed) throw new Error('Device session closed');
    return (
      this.screen.openPreview?.(signal) ?? {
        getFrame: () =>
          this.screen.getFrame({ allowUnchanged: true, timeoutMs: 2000 }),
        close: async () => {},
      }
    );
  }
  screenshot() {
    if (this.closed) throw new Error('Device session closed');
    if (this.settledGeneration === this.generation)
      return this.screen.getFrame({
        fresh: true,
        allowUnchanged: true,
        timeoutMs: 10000,
      });
    const generation = this.generation;
    this.settling ??= settledFrame(this.screen)
      .then((frame) => {
        this.settledGeneration = generation;
        return frame;
      })
      .finally(() => {
        this.settling = undefined;
      });
    return this.settling;
  }
  execute(action: InputAction, signal?: AbortSignal) {
    const operation = this.pending.then(async () => {
      if (this.closed) throw new Error('Device session closed');
      signal?.throwIfAborted();
      try {
        // Never continue keyboard or pointer input after the screen source stops.
        await this.screen.getFrame({
          fresh: true,
          allowUnchanged: true,
          timeoutMs: 10000,
        });
        signal?.throwIfAborted();
        await this.input.execute(action, this.screen, signal);
        this.generation++;
      } catch (error) {
        await this.input.releaseAll();
        throw error;
      }
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }
  close(): Promise<void> {
    this.closing ??= (async () => {
      this.closed = true;
      this.input.cancel();
      await this.pending;
      try {
        await this.input.close();
      } finally {
        try {
          await this.screen.close();
        } finally {
          this.release();
        }
      }
    })();
    return this.closing;
  }
}
