import { EventEmitter } from 'node:events';
import { expect, it } from '@rstest/core';
import { CameraStream } from '../src/camera/camera-stream.js';
import type { CameraSource } from '../src/camera/types.js';
async function fixture() {
  const sources: CameraSource[] = [];
  const options = {
    deviceId: 'camera',
    width: 100,
    height: 100,
    fps: 30,
    verticalFlip: false,
    horizontalFlip: false,
  };
  const stream = new CameraStream(
    'stream',
    {
      listDevices: async () => [],
      openStream: async () => {
        const source = new EventEmitter() as CameraSource;
        source.close = async () => {
          source.emit('exit', { code: 0, signal: null });
        };
        sources.push(source);
        return source;
      },
    },
    options,
  );
  await stream.start();
  return { stream, sources, options };
}
it('rejects waiting and cached reads when capture fails', async () => {
  const { stream, sources } = await fixture();
  try {
    sources[0].emit('frame', Buffer.from('first'));
    const pending = stream.getFrame({ fresh: true, timeoutMs: 60000 });
    const rejected = expect(pending).rejects.toThrow('unplugged');
    sources[0].emit('error', new Error('unplugged'));
    await rejected;
    await expect(stream.getFrame()).rejects.toThrow('unplugged');
    expect(stream.listenerCount('frame')).toBe(0);
  } finally {
    await stream.stop();
  }
});
it('rejects a pending capture immediately on stop', async () => {
  const { stream } = await fixture();
  const pending = expect(
    stream.getFrame({ fresh: true, timeoutMs: 60000 }),
  ).rejects.toThrow('stopped');
  await stream.stop();
  await pending;
});
it('ignores frames and failures from a source replaced during restart', async () => {
  const { stream, sources, options } = await fixture();
  try {
    await stream.restart({ ...options, horizontalFlip: true });
    sources[1].emit('frame', Buffer.from('new'));
    sources[0].emit('frame', Buffer.from('stale'));
    sources[0].emit('error', new Error('old process'));
    expect(stream.getInfo().state).toBe('running');
    expect((await stream.getFrame()).jpeg.toString()).toBe('new');
  } finally {
    await stream.stop();
  }
});
