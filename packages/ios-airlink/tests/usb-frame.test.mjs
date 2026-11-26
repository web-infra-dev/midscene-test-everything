import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { USBScreenSession } from '../dist/hardware/screen/usb.js';

test('a stalled USB stream cannot satisfy the input preflight with an old frame', async () => {
  const jpeg = await sharp({
    create: { width: 8, height: 8, channels: 3, background: 'white' },
  })
    .jpeg()
    .toBuffer();
  const stream = new USBScreenSession({
    getFrame: async (options) => {
      if (options?.fresh) throw new Error('No camera frame arrived');
      return { id: 4, jpeg, capturedAt: 1 };
    },
  });
  const options = { fresh: true, allowUnchanged: true };
  await assert.rejects(stream.getFrame(options), /No camera frame arrived/);
  assert.equal(
    (await stream.getFrame({ ...options, afterSequence: 4 })).sequence,
    4,
  );
});
