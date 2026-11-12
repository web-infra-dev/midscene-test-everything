import { expect, it } from '@rstest/core';
import {
  assertSurface,
  surfaceClearanceMm,
  surfaceOffsetMm,
} from '../src/calibration/surface.js';
import type { ScreenSurfaceCompensation } from '../src/contracts.js';

function surface(): Extract<ScreenSurfaceCompensation, { kind: 'sampled' }> {
  return {
    kind: 'sampled',
    widthMm: 100,
    heightMm: 200,
    limitMm: 1,
    samples: [
      { x: 10, y: 20, depthMm: -1, weight: 1 },
      { x: 90, y: 20, depthMm: 0.5, weight: 1 },
      { x: 50, y: 100, depthMm: 0, weight: 1 },
      { x: 10, y: 180, depthMm: 0.8, weight: 1 },
      { x: 90, y: 180, depthMm: -0.5, weight: 1 },
    ],
    patches: [],
  };
}
it('reproduces measured heights and never extrapolates beyond measurements at unsampled edges', () => {
  const model = surface();
  for (const sample of model.samples)
    expect(surfaceOffsetMm(model, sample)).toBe(sample.depthMm);
  for (let x = -20; x <= 120; x += 5) {
    for (let y = -20; y <= 220; y += 5) {
      const value = surfaceOffsetMm(model, { x, y });
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(0.8);
    }
  }
  expect(surfaceClearanceMm(model)).toBe(1);
});
it('preserves regional heights outside a later local repair and reserves its clearance', () => {
  const model = surface();
  model.patches.push({ x: 50, y: 100, depthMm: -2, radiusMm: 10 });
  expect(surfaceOffsetMm(model, { x: 50, y: 100 })).toBe(-2);
  expect(surfaceOffsetMm(model, model.samples[0])).toBe(-1);
  expect(surfaceClearanceMm(model)).toBe(2);
});
it('rejects malformed persisted regional models before contact or clearance planning', () => {
  for (const invalid of [
    { ...surface(), limitMm: 3 },
    { ...surface(), samples: surface().samples.slice(0, 3) },
    { ...surface(), widthMm: Number.NaN },
    {
      ...surface(),
      samples: surface().samples.map((s) => ({ ...s, weight: 0 })),
    },
  ]) {
    expect(() => assertSurface(invalid)).toThrow();
    expect(() => surfaceOffsetMm(invalid, { x: 50, y: 100 })).toThrow();
    expect(() => surfaceClearanceMm(invalid)).toThrow();
  }
});
