import { describe, expect, it } from '@rstest/core';
import { ArmActionQueue } from '../src/action-queue.js';
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};
describe('shared physical action queue', () => {
  it('serializes complete actions across owners', async () => {
    const queue = new ArmActionQueue();
    const first = gate();
    const events: string[] = [];
    const a = queue.enqueue('a', async () => {
      events.push('a:start');
      await first.promise;
      events.push('a:end');
    });
    const b = queue.enqueue('b', async () => {
      events.push('b');
      return 2;
    });
    expect(events).toEqual(['a:start']);
    first.release();
    await a;
    expect(await b).toBe(2);
    expect(events).toEqual(['a:start', 'a:end', 'b']);
  });
  it('removing a device cancels its queued actions but preserves another owner', async () => {
    const queue = new ArmActionQueue();
    const first = gate();
    const a = queue.enqueue('a', async () => first.promise);
    const cancelled = queue
      .enqueue('b', async () => 2)
      .catch((error) => error.message);
    const c = queue.enqueue('c', async () => 3);
    queue.cancelOwner('b');
    first.release();
    await a;
    expect(await cancelled).toBe('Device work cancelled');
    expect(await c).toBe(3);
  });
  it('does not hand off an aborted operation before cleanup settles', async () => {
    const queue = new ArmActionQueue();
    const cleanup = gate();
    let signal: AbortSignal | undefined;
    let started = false;
    const a = queue
      .enqueue('a', async (value) => {
        signal = value;
        await cleanup.promise;
      })
      .catch((error) => error.message);
    const b = queue.enqueue('b', async () => {
      started = true;
    });
    queue.cancelOwner('a');
    expect(signal?.aborted).toBe(true);
    expect(started).toBe(false);
    cleanup.release();
    expect(await a).toBe('Device work cancelled');
    await b;
    expect(started).toBe(true);
  });
  it('stop rejects pending work and requires explicit recovery', async () => {
    const queue = new ArmActionQueue();
    const first = gate();
    const a = queue
      .enqueue('a', async () => first.promise)
      .catch(() => undefined);
    const b = queue.enqueue('b', async () => 2).catch((error) => error.message);
    queue.stop();
    expect(() => queue.resume()).toThrow('not settled');
    await expect(queue.enqueue('c', async () => 3)).rejects.toThrow('recovery');
    first.release();
    await a;
    expect(await b).toBe('Arm actions stopped');
    queue.resume();
    expect(await queue.enqueue('c', async () => 3)).toBe(3);
  });
  it('rejects pre-aborted work without invoking it and settles close after cleanup', async () => {
    const queue = new ArmActionQueue();
    const abort = new AbortController();
    abort.abort(new Error('cancelled'));
    let invoked = false;
    await expect(
      queue.enqueue(
        'a',
        async () => {
          invoked = true;
        },
        abort.signal,
      ),
    ).rejects.toThrow('cancelled');
    expect(invoked).toBe(false);
    await queue.close();
    await expect(queue.enqueue('a', async () => 1)).rejects.toThrow('closed');
  });
});
