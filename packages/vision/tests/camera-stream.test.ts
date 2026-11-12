import { EventEmitter } from 'node:events';
import { expect, it } from '@rstest/core';
import { CameraStream } from '../src/camera/camera-stream.js';

it('waits for the failed capture to close before releasing the stream', async () => {
  const source = new EventEmitter();
  let finishClose!: () => void;
  const closed = new Promise<void>((resolve) => {
    finishClose = resolve;
  });
  const stream = new CameraStream(
    'test-stream',
    {
      listDevices: async () => [],
      openStream: async () => Object.assign(source, { close: () => closed }),
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
