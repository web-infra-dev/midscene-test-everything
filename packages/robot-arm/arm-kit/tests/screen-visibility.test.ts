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
  blocked?:
    | 'center'
    | 'edge'
    | 'rounded-corner'
    | 'speckled'
    | 'scattered-gaps'
    | 'top-tile'
    | 'small-spot'
    | 'thin-diagonal'
    | 'glare',
  gridOffset = 0,
  leftInset = 0,
  iosFirstRow?: number,
  offsetPattern = false,
) {
  const pixels = Buffer.alloc(width * height * 3);
  const { columns, rows, colors, contrastColors } =
    CALIBRATION_PHONE_POLICY.visibilityPattern;
  const viewportWidth = width - leftInset;
  const firstRowHeight = iosFirstRow ?? height / rows;
  for (let y = 0; y < height; y++) {
    const viewportY = (y + gridOffset) % height;
    const rowPosition =
      viewportY < firstRowHeight
        ? viewportY / firstRowHeight
        : 1 +
          ((viewportY - firstRowHeight) * (rows - 1)) /
            (height - firstRowHeight);
    const row = Math.floor(rowPosition);
    for (let x = 0; x < width; x++) {
      const viewportX =
        (Math.max(0, x - leftInset) + gridOffset) % viewportWidth;
      const columnPosition = (viewportX * columns) / viewportWidth;
      const column = Math.floor(columnPosition);
      const quadrant =
        Number(columnPosition - column >= 0.5) +
        Number(rowPosition - row >= 0.5);
      const color = offsetPattern
        ? contrastColors[(column + row + phase + quadrant) % 2]
        : colors[(column + row + phase) % 2];
      const sampleColumn = Math.floor(x / 5);
      const sampleRow = Math.floor(y / 5);
      const covered =
        x < leftInset ||
        (iosFirstRow !== undefined &&
          y > 4 &&
          y < 20 &&
          Math.abs(x - width / 2) < 36) ||
        (blocked === 'top-tile' && x >= 30 && x < 60 && y < 48) ||
        (blocked === 'edge' && x < 12) ||
        (blocked === 'rounded-corner' && x < 27 && y < 27 && x + y < 44) ||
        (blocked === 'speckled' &&
          x % 30 >= 11 &&
          x % 30 <= 13 &&
          y % 30 >= 11 &&
          y % 30 <= 13) ||
        (blocked === 'scattered-gaps' &&
          sampleColumn % 3 === 0 &&
          sampleRow % 4 === 0) ||
        (blocked === 'small-spot' &&
          sampleColumn >= 18 &&
          sampleColumn < 21 &&
          sampleRow >= 24 &&
          (sampleRow < 26 || (sampleRow === 26 && sampleColumn === 18))) ||
        (blocked === 'thin-diagonal' &&
          sampleColumn >= 18 &&
          sampleColumn < 26 &&
          sampleRow === sampleColumn + 7) ||
        (blocked === 'center' && x >= 90 && x < 120 && y >= 120 && y < 180);
      const offset = (y * width + x) * 3;
      const glare =
        blocked === 'glare' && x >= 90 && x < 120 && y >= 120 && y < 180;
      for (let channel = 0; channel < 3; channel++) {
        const intensity = Number.parseInt(
          color.slice(1 + channel * 2, 3 + channel * 2),
          16,
        );
        pixels[offset + channel] = covered
          ? 30
          : Math.min(255, intensity + (glare ? 100 : 0));
      }
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

it('distinguishes a muted checkerboard reversal from a stationary obstruction', async () => {
  for (const blocked of [undefined, 'center'] as const) {
    const frames = await Promise.all(
      [0, 1, 0].map(async (phase) =>
        sharp(await pattern(phase, blocked))
          .recomb([
            [0.625, 0, 0.375],
            [0, 1, 0],
            [0.375, 0, 0.625],
          ])
          .png()
          .toBuffer(),
      ),
    );
    expect((await measureScreenVisibility(frames, screens)).clear).toBe(
      !blocked,
    );
  }
});

it('allows a thin bezel in the fitted outline while requiring a clear interior', async () => {
  const frames = await Promise.all(
    [0, 1, 0].map((phase) => pattern(phase, 'edge')),
  );
  const result = await measureScreenVisibility(frames, screens);
  expect(result.screens[0].visibleFraction).toBeLessThan(0.98);
  expect(result.clear).toBe(true);
});

it('tolerates a few missing samples near a rounded screen corner', async () => {
  const frames = await Promise.all(
    [0, 1, 0].map((phase) => pattern(phase, 'rounded-corner')),
  );
  expect((await measureScreenVisibility(frames, screens)).clear).toBe(true);
});

it('rejects repeated frames instead of accepting stale screen content', async () => {
  const image = await pattern(0);
  await expect(
    measureScreenVisibility([image, image, image], screens),
  ).rejects.toMatchObject({ code: 'VISIBILITY_UNAVAILABLE' });
  const diagnostic = await measureScreenVisibility(
    [image, image, image],
    screens,
    {
      includeUndetected: true,
    },
  );
  expect(diagnostic.clear).toBe(false);
  expect(diagnostic.screens[0].visibleFraction).toBe(0);
});

it('tolerates scattered misses when every tile still responds', async () => {
  const frames = await Promise.all(
    [0, 1, 0].map((phase) => pattern(phase, 'speckled')),
  );
  const result = await measureScreenVisibility(frames, screens);
  expect(result.screens[0].interiorVisibleFraction).toBeLessThan(0.98);
  expect(result.clear).toBe(true);
});

it('accepts extra scattered gaps only in the shared parking fallback', async () => {
  const phases = [0, 1, 0];
  const frames = await Promise.all(
    phases.map((phase) =>
      pattern(phase, 'scattered-gaps', 0, 0, undefined, true),
    ),
  );
  const options = { pattern: 'offset-contrast' as const };
  expect((await measureScreenVisibility(frames, screens, options)).clear).toBe(
    false,
  );
  expect(
    (
      await measureScreenVisibility(frames, screens, {
        ...options,
        sharedParking: true,
      })
    ).clear,
  ).toBe(true);
  const obstruction = await Promise.all(
    phases.map((phase) =>
      pattern(phase, 'thin-diagonal', 0, 0, undefined, true),
    ),
  );
  expect(
    (
      await measureScreenVisibility(obstruction, screens, {
        ...options,
        sharedParking: true,
      })
    ).clear,
  ).toBe(false);
});

it('allows a small spot but rejects a thin obstruction with high local coverage', async () => {
  const spot = await Promise.all(
    [0, 1, 0].map((phase) => pattern(phase, 'small-spot')),
  );
  const spotResult = await measureScreenVisibility(spot, screens);
  expect(spotResult.screens[0].minimumTileFraction).toBeLessThan(0.85);
  expect(spotResult.clear).toBe(true);
  const diagonal = await Promise.all(
    [0, 1, 0].map((phase) => pattern(phase, 'thin-diagonal')),
  );
  const diagonalResult = await measureScreenVisibility(diagonal, screens);
  expect(diagonalResult.screens[0].minimumTileFraction).toBeGreaterThan(0.85);
  expect(diagonalResult.clear).toBe(false);
});

it('uses offset contrast to recover from glare while still detecting a stationary obstruction', async () => {
  const phases = [0, 1, 0];
  const primary = await Promise.all(
    phases.map((phase) => pattern(phase, 'glare')),
  );
  expect((await measureScreenVisibility(primary, screens)).clear).toBe(false);

  for (const blocked of ['glare', 'center', undefined] as const) {
    const frames = await Promise.all(
      phases.map((phase) =>
        pattern(phase, blocked, 0, 0, undefined, blocked !== undefined),
      ),
    );
    const result = await measureScreenVisibility(frames, screens, {
      pattern: 'offset-contrast',
    });
    expect(result.clear).toBe(blocked === 'glare');
  }
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

it('checks the full iPhone grid around a camera cutout and detects an obstruction in its first row', async () => {
  const firstRowHeight = 48;
  const screen = {
    ...screens[0],
    firstRowHeight,
    layout: {
      revision: 1,
      width,
      height,
      screen: { width, height, devicePixelRatio: 1 },
      markers: [],
    },
  };
  for (const blocked of [undefined, 'top-tile'] as const) {
    const frames = await Promise.all(
      [0, 1, 0].map((phase) => pattern(phase, blocked, 0, 0, firstRowHeight)),
    );
    expect((await measureScreenVisibility(frames, [screen])).clear).toBe(
      !blocked,
    );
  }
});
