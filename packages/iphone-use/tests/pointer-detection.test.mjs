import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {
  detectPointerChanges,
  scorePointerPositions,
} from '../dist/hardware/pointer/detector.js';

const width = 192;
const height = 144;
const from = { x: 51, y: 64 };
const to = { x: 128, y: 81 };

async function frame(pointer, { dx = 0, dy = 0, inverted = false } = {}) {
  const raw = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = Math.max(0, Math.min(width - 1, x - dx));
      const py = Math.max(0, Math.min(height - 1, y - dy));
      const row = Math.floor(py / 7);
      const column = Math.floor(px / 9);
      const background =
        75 + ((row * 37 + column * 23 + row * column * 11) % 140);
      raw[y * width + x] =
        Math.hypot(px - pointer.x, py - pointer.y) <= 5
          ? 8
          : inverted
            ? 255 - background
            : background;
    }
  }
  return {
    width,
    height,
    jpeg: await sharp(raw, { raw: { width, height, channels: 1 } })
      .jpeg({ quality: 100 })
      .toBuffer(),
  };
}

test('camera registration preserves both pointer positions under small background drift', async () => {
  const before = await frame(from);
  const after = await frame(to, { dx: 2, dy: -2 });
  const candidates = await detectPointerChanges(before, after);
  for (const point of [from, to]) {
    assert.ok(
      candidates.some(({ x, y }) => Math.hypot(x - point.x, y - point.y) < 1),
      `Pointer missing near (${point.x}, ${point.y})`,
    );
  }
  assert.equal(candidates.length, 2);
  const [atPointer, atBackground] = await scorePointerPositions(
    before,
    after,
    [to, { x: 100, y: 40 }].map(({ x, y }) => ({
      x: x / (width - 1),
      y: y / (height - 1),
    })),
  );
  assert.ok(atPointer.mean > atBackground.mean * 4);
});

test('large shifts and scene changes still fail pointer detection', async () => {
  const before = await frame(from);
  for (const options of [{ dx: 13, dy: 9 }, { inverted: true }]) {
    await assert.rejects(
      detectPointerChanges(before, await frame(to, options)),
      /Screen changed during pointer measurement/,
    );
  }
});
