import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { CameraScreenSession } from '../dist/hardware/screen/camera.js';

test('camera preview worker rectifies a frame and skips a repeated capture', async () => {
  const jpeg = await sharp({
    create: { width: 80, height: 100, channels: 3, background: 'white' },
  })
    .jpeg()
    .toBuffer();
  const stream = { getFrame: async () => ({ jpeg, id: 1 }) };
  const screen = CameraScreenSession.fromStream(
    stream,
    {
      cameraId: 'camera',
      width: 40,
      height: 60,
      correction: {
        sourceWidth: 80,
        sourceHeight: 100,
        points: {
          topLeft: { x: 10, y: 10 },
          topRight: { x: 70, y: 10 },
          bottomRight: { x: 70, y: 90 },
          bottomLeft: { x: 10, y: 90 },
        },
      },
    },
    async () => {},
  );
  const preview = screen.openPreview(AbortSignal.timeout(5000));
  try {
    const frame = await preview.getFrame();
    assert.equal(frame.sequence, 1);
    const metadata = await sharp(frame.jpeg).metadata();
    assert.deepEqual([metadata.width, metadata.height], [40, 60]);
    assert.equal(await preview.getFrame(), undefined);
  } finally {
    await preview.close();
  }
});
