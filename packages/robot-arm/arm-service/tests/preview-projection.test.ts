import { expect, test } from '@rstest/core';
import {
  type CameraView,
  cameraPreviewContext,
} from '../src/ui/camera-preview';
import type { PreviewScreenGeometry } from '../src/ui/preview/projection';
import {
  createRawProjection,
  createRectifiedProjection,
  createScreenProjections,
  hitTestScreens,
} from '../src/ui/preview/projection';

const points = {
  topLeft: { x: 100, y: 100 },
  topRight: { x: 300, y: 100 },
  bottomRight: { x: 400, y: 300 },
  bottomLeft: { x: 0, y: 300 },
};

const screen = (
  rotation: 0 | 90 | 180 | 270 = 0,
  overrides: Partial<PreviewScreenGeometry> = {},
): PreviewScreenGeometry => ({
  id: 'screen-a',
  name: 'Screen A',
  correction: {
    points,
    sourceWidth: 800,
    sourceHeight: 400,
    rotation,
  },
  target: { width: 801, height: 401, rotation },
  pixelWidth: 801,
  pixelHeight: 401,
  calibrationId: 'cal-a',
  ...overrides,
});

test('keeps screen control enabled across raw and corrected previews until the control target changes', () => {
  const screens = [screen(), screen(90, { id: 'screen-b' })];
  const context = (
    view: CameraView,
    screenId = 'screen-a',
    targets = screens,
  ) =>
    cameraPreviewContext({
      cameraId: 'camera',
      screenId,
      view,
      revision: 0,
      standalone: false,
      connected: true,
      session: 'installation',
      screens: targets,
    });
  const raw = context('raw');
  const corrected = context('corrected');
  expect(corrected.previewKey).not.toBe(raw.previewKey);
  expect(corrected.controlContext).toBe(raw.controlContext);
  expect(context('raw').controlContext).toBe(corrected.controlContext);
  expect(context('corrected', 'screen-b').controlContext).not.toBe(
    raw.controlContext,
  );
  expect(
    context('raw', 'screen-a', [screen(90), screens[1]]).controlContext,
  ).not.toBe(raw.controlContext);
});

test('fits perspective foreshortening instead of a bounding box', () => {
  const projection = createRawProjection(screen(), 800, 400);
  expect(projection.toScreen({ x: 200, y: 500 / 3 })).toEqual({
    x: 400,
    y: 200,
  });
  const original = projection.toImage({ x: 400, y: 200 });
  expect(original.x).toBeCloseTo(200);
  expect(original.y).toBeCloseTo(500 / 3);
  expect(projection.contains({ x: 20, y: 110 })).toBe(false);
  expect(projection.contains({ x: 200, y: 500 / 3 })).toBe(true);
});

for (const [rotation, corner] of [
  [0, { x: 0, y: 0 }],
  [90, { x: 800, y: 0 }],
  [180, { x: 800, y: 400 }],
  [270, { x: 0, y: 400 }],
] as const) {
  test(`matches clockwise rotation ${rotation} in both directions`, () => {
    const projection = createRawProjection(screen(rotation), 800, 400);
    expect(projection.toScreen(points.topLeft)).toEqual(corner);
    const original = projection.toImage(corner);
    expect(original.x).toBeCloseTo(points.topLeft.x);
    expect(original.y).toBeCloseTo(points.topLeft.y);
  });
}

test('accounts for a preview resolution different from the saved source', () => {
  const projection = createRawProjection(screen(90), 1600, 800);
  expect(projection.toScreen({ x: 400, y: 1000 / 3 })).toEqual({
    x: 400,
    y: 200,
  });
  expect(projection.contains({ x: 40, y: 220 })).toBe(false);
});

test('clips swipes at the actual quadrilateral edges before transforming', () => {
  const projection = createRawProjection(screen(), 800, 400);
  const clipped = projection.clipSegment(
    { x: -100, y: 500 / 3 },
    { x: 500, y: 500 / 3 },
  );
  expect(clipped?.screenFrom).toEqual({ x: 0, y: 200 });
  expect(clipped?.screenTo).toEqual({ x: 800, y: 200 });
  expect(clipped?.from.x).toBeCloseTo(200 / 3);
  expect(clipped?.from.y).toBeCloseTo(500 / 3);
  expect(clipped?.to.x).toBeCloseTo(1000 / 3);
  expect(clipped?.to.y).toBeCloseTo(500 / 3);
  expect(
    projection.clipSegment({ x: 0, y: 50 }, { x: 400, y: 50 }),
  ).toBeUndefined();
  expect(
    projection.clipSegment({ x: 0, y: -100 }, { x: 400, y: -100 }),
  ).toBeUndefined();
});

test('rejects invalid geometry rather than sending incorrectly fitted coordinates', () => {
  expect(() =>
    createRawProjection(
      screen(0, {
        correction: {
          points: { ...points, bottomLeft: points.topRight },
          sourceWidth: 800,
          sourceHeight: 400,
          rotation: 0,
        },
      }),
      800,
      400,
    ),
  ).toThrow();
});

test('maps a downscaled corrected preview back to screen pixels', () => {
  const projection = createRectifiedProjection(screen(), 400, 200);
  expect(projection.toScreen({ x: 200, y: 100 })).toEqual({ x: 400, y: 200 });
  expect(projection.toImage({ x: 400, y: 200 })).toEqual({
    x: 200,
    y: 100,
  });
});

test('resolves one screen, overlapping screens and empty space', () => {
  const first = screen();
  const second = screen(0, {
    id: 'screen-b',
    name: 'Screen B',
    calibrationId: 'cal-b',
    correction: {
      points: {
        topLeft: { x: 200, y: 150 },
        topRight: { x: 500, y: 150 },
        bottomRight: { x: 500, y: 350 },
        bottomLeft: { x: 200, y: 350 },
      },
      sourceWidth: 800,
      sourceHeight: 400,
      rotation: 0,
    },
  });
  const projections = createScreenProjections([first, second], 800, 400);
  const single = hitTestScreens({ x: 80, y: 200 }, projections);
  expect(single.kind).toBe('screen');
  if (single.kind === 'screen') expect(single.hit.screen.id).toBe('screen-a');
  const overlap = hitTestScreens({ x: 250, y: 200 }, projections, 'screen-a');
  expect(overlap.kind).toBe('ambiguous');
  if (overlap.kind === 'ambiguous') {
    expect(overlap.hits).toHaveLength(2);
    expect(overlap.preferred?.screen.id).toBe('screen-a');
  }
  expect(hitTestScreens({ x: 750, y: 50 }, projections)).toEqual({
    kind: 'outside',
  });
});
