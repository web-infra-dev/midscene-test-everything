/** One shared physical-action queue; planning stays outside it. */
export class ArmActionQueue {
  private entries: Entry[] = [];
  private active?: Entry;
  private closed = false;
  private blocked = false;

  enqueue<T>(
    ownerId: string,
    work: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Arm queue is closed'));
    if (this.blocked)
      return Promise.reject(new Error('Arm queue requires recovery'));
    if (!ownerId) return Promise.reject(new Error('Action owner is required'));
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      const entry: Entry = {
        ownerId,
        controller,
        work,
        resolve: (value) => resolve(value as T),
        reject,
        cleanup: () => signal?.removeEventListener('abort', abort),
      };
      const abort = () => this.cancelEntry(entry, signal?.reason);
      signal?.addEventListener('abort', abort, { once: true });
      this.entries.push(entry);
      void this.drain();
    });
  }

  cancelOwner(
    ownerId: string,
    reason = new Error('Device work cancelled'),
  ): void {
    for (const entry of [...this.entries])
      if (entry.ownerId === ownerId) this.cancelEntry(entry, reason);
    if (this.active?.ownerId === ownerId) this.cancelEntry(this.active, reason);
  }

  /** Stop blocks successors before signalling the active operation. */
  stop(reason = new Error('Arm actions stopped')): void {
    this.blocked = true;
    this.cancelAll(reason);
  }

  cancelAll(reason: unknown): void {
    for (const entry of [...this.entries]) this.cancelEntry(entry, reason);
    if (this.active) this.cancelEntry(this.active, reason);
  }

  resume(): void {
    if (this.closed) throw new Error('Arm queue is closed');
    if (!this.blocked) return;
    if (this.active) throw new Error('Current operation has not settled');
    this.blocked = false;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.stop(new Error('Arm queue is closed'));
    await this.active?.settled;
  }

  private cancelEntry(entry: Entry, reason: unknown): void {
    entry.controller.abort(reason);
    // Active cancellation settles only after the operation releases hardware.
    if (this.active === entry) return;
    this.entries = this.entries.filter((candidate) => candidate !== entry);
    entry.cleanup();
    entry.reject(reason);
  }

  private async drain(): Promise<void> {
    if (this.active || this.closed || this.blocked) return;
    const entry = this.entries.shift();
    if (!entry) return;
    this.active = entry;
    entry.settled = (async () => {
      try {
        entry.controller.signal.throwIfAborted();
        const result = await entry.work(entry.controller.signal);
        entry.controller.signal.throwIfAborted();
        entry.resolve(result);
      } catch (error) {
        entry.reject(error);
      } finally {
        entry.cleanup();
        this.active = undefined;
        void this.drain();
      }
    })();
    await entry.settled;
  }
}
interface Entry {
  ownerId: string;
  controller: AbortController;
  work: (signal: AbortSignal) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  cleanup: () => void;
  settled?: Promise<void>;
}
