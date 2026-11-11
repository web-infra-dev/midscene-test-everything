import { expect, it } from '@rstest/core';
import sharp from 'sharp';
import { CALIBRATION_PHONE_POLICY } from '../src/assisted-contracts.js';
import { measureScreenVisibility } from '../src/camera/screen-visibility.js';

const width = 240;
const height = 360;
const screens = [
  {
    id: 'phone',
    sourceWidth: width,
    sourceHeight: height,
    points: [
      { x: 0, y: 0 },
      { x: width - 1, y: 0 },
      { x: width - 1, y: height - 1 },
      { x: 0, y: height - 1 },
    ],
  },
];

async function pattern(
  phase: number,
  blocked?: 'center' | 'edge' | 'speckled',
  gridOffset = 0,
  leftInset = 0,
) {
  const pixels = Buffer.alloc(width * height * 3);
  const { columns, rows, colors } = CALIBRATION_PHONE_POLICY.visibilityPattern;
  const viewportWidth = width - leftInset;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const viewportX =
        (Math.max(0, x - leftInset) + gridOffset) % viewportWidth;
      const column = Math.floor((viewportX * columns) / viewportWidth);
      const row = Math.floor((((y + gridOffset) % height) * rows) / height);
      const color = colors[(column + row + phase) % 2];
      const covered =
        x < leftInset ||
        (blocked === 'edge' && x < 12) ||
        (blocked === 'speckled' &&
          x % 30 >= 11 &&
          x % 30 <= 13 &&
          y % 30 >= 11 &&
          y % 30 <= 13) ||
        (blocked === 'center' && x >= 90 && x < 120 && y >= 120 && y < 180);
      const offset = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel++)
        pixels[offset + channel] = covered
          ? 30
          : Number.parseInt(color.slice(1 + channel * 2, 3 + channel * 2), 16);
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

it('confirms full-screen pattern response and detects a central obstruction', async () => {
  const clear = await Promise.all([0, 1, 0].map((phase) => pattern(phase)));
  expect((await measureScreenVisibility(clear, screens)).clear).toBe(true);
  const blocked = await Promise.all(
    [0, 1, 0].map((phase) => pattern(phase, 'center')),
  );
  const result = await measureScreenVisibility(blocked, screens);
  expect(result.clear).toBe(false);
  expect(result.screens[0].minimumTileFraction).toBeLessThan(0.85);
});

it('allows a thin bezel in the fitted outline while requiring a clear interior', async () => {
  const frames = await Promise.all(
    [0, 1, 0].map((phase) => pattern(phase, 'edge')),
  );
  const result = await measureScreenVisibility(frames, screens);
  expect(result.screens[0].visibleFraction).toBeLessThan(0.98);
  expect(result.clear).toBe(true);
});

it('rejects repeated frames instead of accepting stale screen content', async () => {
  const image = await pattern(0);
  await expect(
    measureScreenVisibility([image, image, image], screens),
  ).rejects.toMatchObject({ code: 'VISIBILITY_UNAVAILABLE' });
});

it('tolerates scattered misses when every tile still responds', async () => {
  const frames = await Promise.all(
    [0, 1, 0].map((phase) => pattern(phase, 'speckled')),
  );
  const result = await measureScreenVisibility(frames, screens);
  expect(result.screens[0].interiorVisibleFraction).toBeLessThan(0.98);
  expect(result.clear).toBe(true);
});

it('allows shifted tile boundaries while rejecting an obstruction in the shifted pattern', async () => {
  const clear = await Promise.all(
    [0, 1, 0].map((phase) => pattern(phase, undefined, 8)),
  );
  expect((await measureScreenVisibility(clear, screens)).clear).toBe(true);
  const blocked = await Promise.all(
    [0, 1, 0].map((phase) => pattern(phase, 'center', 8)),
  );
  expect((await measureScreenVisibility(blocked, screens)).clear).toBe(false);
});

it('excludes a browser status strip while checking the drawable viewport', async () => {
  const leftInset = 18;
  const viewportScreen = {
    ...screens[0],
    layout: {
      revision: 1,
      width: width - leftInset,
      height,
      screen: { width, height, devicePixelRatio: 1 },
      markers: [],
    },
  };
  const clear = await Promise.all(
    [0, 1, 0].map((phase) => pattern(phase, undefined, 0, leftInset)),
  );
  expect((await measureScreenVisibility(clear, [viewportScreen])).clear).toBe(
    true,
  );
  const blocked = await Promise.all(
    [0, 1, 0].map((phase) => pattern(phase, 'center', 0, leftInset)),
  );
  expect((await measureScreenVisibility(blocked, [viewportScreen])).clear).toBe(
    false,
  );
});
