import { expect, it } from '@rstest/core';
import {
  explorationTargets,
  mappedExplorationTargets,
} from '../src/calibration/exploration/targets.js';

it('keeps dev standard holdouts out of the six fitting targets', () => {
  const targets = explorationTargets({ width: 400, height: 800 });
  expect(targets.filter((t) => t.purpose === 'fit')).toHaveLength(6);
  expect(
    targets.filter((t) => t.purpose === 'check').map((t) => t.point),
  ).toEqual([
    { x: 40, y: 400 },
    { x: 360, y: 400 },
    { x: 200, y: 720 },
  ]);
});
it('selects four distributed corners and two independent edge checks in serpentine order', () => {
  const targets = explorationTargets({ width: 400, height: 800 }, true);
  expect(targets.map((t) => [t.point.x, t.point.y, t.purpose])).toEqual([
    [40, 80, 'fit'],
    [360, 80, 'fit'],
    [360, 400, 'check'],
    [40, 400, 'check'],
    [40, 720, 'fit'],
    [360, 720, 'fit'],
  ]);
});
it('accepts the real iPhone viewport without an extra preflight coverage gate', () => {
  const m = [
    0.9797428925542602, -0.007008650339437902, 10.56938608385807,
    0.04488652529770618, 0.9970842759321542, 81.32758940111954,
    3.5805979938451246e-5, -2.663432205301461e-5, 1,
  ];
  const project = (p: { x: number; y: number }) => {
    const d = m[6] * p.x + m[7] * p.y + 1;
    return {
      x: (m[0] * p.x + m[1] * p.y + m[2]) / d,
      y: (m[3] * p.x + m[4] * p.y + m[5]) / d,
    };
  };
  const result = mappedExplorationTargets(
    { width: 390, height: 667 },
    project,
    { width: 390, height: 844 },
  );
  expect(result.inset).toBe(0.1);
  expect(result.targets[0].point).toEqual({ x: 39, y: 66.7 });
  expect(() =>
    mappedExplorationTargets({ width: 390, height: 300 }, (p) => p, {
      width: 390,
      height: 844,
    }),
  ).not.toThrow();
});

it.each([false, true])(
  'keeps fixed 10% targets with sufficient coverage (fast=%s)',
  (fast) => {
    const result = mappedExplorationTargets(
      { width: 400, height: 800 },
      (p) => p,
      { width: 400, height: 800 },
      fast,
    );
    expect(result.inset).toBe(0.1);
    expect(result.targets).toHaveLength(fast ? 6 : 9);
    expect(
      result.targets.every(
        ({ point }) =>
          point.x >= 40 && point.x <= 360 && point.y >= 80 && point.y <= 720,
      ),
    ).toBe(true);
  },
);
it('rejects mapped targets outside the screen', () => {
  expect(() =>
    mappedExplorationTargets(
      { width: 400, height: 800 },
      (p) => ({ x: p.x + 400, y: p.y }),
      { width: 400, height: 800 },
    ),
  ).toThrow('outside the screen');
});
