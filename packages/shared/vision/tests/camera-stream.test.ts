import { EventEmitter } from 'node:events';
import { expect, it } from '@rstest/core';
import { CameraStream } from '../src/camera/camera-stream.js';

function createStream(source: EventEmitter, close: () => Promise<void>) {
  return new CameraStream(
    'test-stream',
    {
      listDevices: async () => [],
      openStream: async () => Object.assign(source, { close }),
    },
    {
      deviceId: 'test-camera',
      width: 640,
      height: 480,
      fps: 30,
      verticalFlip: false,
      horizontalFlip: false,
    },
  );
}

it('returns a buffered newer frame and waits when the caller has already seen it', async () => {
  const source = new EventEmitter();
  const stream = createStream(source, async () => {});
  await stream.start();
  try {
    source.emit('frame', Buffer.from([1]));
    source.emit('frame', Buffer.from([2]));
    const buffered = await stream.getFrame({
      fresh: true,
      afterSequence: 1,
      timeoutMs: 100,
    });
    expect(buffered.id).toBe(2);
    const waiting = stream.getFrame({
      fresh: true,
      afterSequence: buffered.id,
    });
    source.emit('frame', Buffer.from([3]));
    expect((await waiting).id).toBe(3);
  } finally {
    await stream.stop();
  }
});

it('waits for the failed capture to close before releasing the stream', async () => {
  const source = new EventEmitter();
  let finishClose!: () => void;
  const closed = new Promise<void>((resolve) => {
    finishClose = resolve;
  });
  const stream = createStream(source, () => closed);
  await stream.start();
  source.emit('error', new Error('capture failed'));

  let stopped = false;
  const stopping = stream.stop().then(() => {
    stopped = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(stopped).toBe(false);
  finishClose();
  await stopping;
  expect(stopped).toBe(true);
});
