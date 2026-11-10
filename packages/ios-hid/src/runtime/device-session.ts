import type { HIDInputSession } from '../input/session.js';
import type { ScreenSession } from '../screen/source.js';
import type { DeviceConfig, InputAction } from '../types.js';

/** Host-local hardware session; never calls the HTTP Device proxy. */
export class DeviceSession {
  private pending: Promise<unknown> = Promise.resolve();
  private closed = false;
  private closing?: Promise<void>;
  constructor(
    readonly config: DeviceConfig,
    private screen: ScreenSession,
    private input: HIDInputSession,
    private release: () => void,
  ) {}
  verifyPointer() {
    return this.input.verify(this.screen);
  }
  screenshot() {
    if (this.closed) throw new Error('Device session closed');
    return this.screen.getFrame({ fresh: true, timeoutMs: 10000 });
  }
  execute(action: InputAction, signal?: AbortSignal) {
    const operation = this.pending.then(async () => {
      if (this.closed) throw new Error('Device session closed');
      signal?.throwIfAborted();
      try {
        // Never continue keyboard or pointer input after the screen source stops.
        await this.screen.getFrame({ fresh: true, timeoutMs: 10000 });
        signal?.throwIfAborted();
        await this.input.execute(action, this.screen, signal);
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
