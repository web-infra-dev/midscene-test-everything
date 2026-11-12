import { expect, it } from '@rstest/core';
import { fitExploration } from '../src/calibration/exploration/fit.js';
import { coverage } from '../src/calibration/exploration/geometry.js';
import { explorationQualityWarnings } from '../src/calibration/exploration/quality.js';
import { mappedExplorationTargets } from '../src/calibration/exploration/targets.js';
import { fixture, pose } from './fixtures.js';

// The recorded iPhone mapping includes browser chrome. Coordinates remain
// full-screen pixels, as in dev; viewport normalization would hide missing area.
const phoneMap = (p: { x: number; y: number }) => {
  const m = [
    0.9797428925542602, -0.007008650339437902, 10.56938608385807,
    0.04488652529770618, 0.9970842759321542, 81.32758940111954,
    3.5805979938451246e-5, -2.663432205301461e-5, 1,
  ];
  const d = m[6] * p.x + m[7] * p.y + 1;
  return {
    x: (m[0] * p.x + m[1] * p.y + m[2]) / d,
    y: (m[3] * p.x + m[4] * p.y + m[5]) / d,
  };
};

it.each([
  [1.58, 2.01, []],
  [1.65, 2.2, []],
  [1.66, 2.2, ['Grid RMS']],
  [1.65, 2.21, ['Holdout maximum']],
] as const)(
  'reviews touch errors of %s and %s percent against the short edge',
  (gridRmsMm, validationMaxMm, labels) => {
    const warnings = explorationQualityWarnings(
      { physicalWidthMm: 200, physicalHeightMm: 100 },
      { rmseMm: 0, total: 9, inliers: 9, minorSpanMm: 80, majorSpanMm: 160 },
      {
        gridRmsMm,
        validationMaxMm,
        planeRmseMm: 0,
        gridRmsPx: 0,
        validationMaxPx: 0,
        validationRmsPx: 0,
        coverage: 0.64,
        samples: [],
      },
    );
    expect(warnings.map((warning) => warning.label)).toEqual(labels);
  },
);

it.each([67, 40])(
  'retains a 5.4 px / 1.01 mm holdout on a screen with a %i mm short edge',
  async (shortSideMm) => {
    const f = await fixture();
    try {
      const screen = { ...f.screen, pixelWidth: 1001, pixelHeight: 501 };
      const { targets } = mappedExplorationTargets(
        { width: 1000, height: 500 },
        (p) => p,
        { width: 1001, height: 501 },
      );
      const grid = targets.map(({ point, purpose }, i) => ({
        contact: {
          x: point.x * (1.01 / 5.4),
          y: (-point.y * shortSideMm) / 500,
          z: 30,
        },
        screen: { ...point, x: point.x + (purpose === 'check' ? 5.4 : 0) },
        target: {
          id: String(i),
          css: point,
          screen: point,
          role:
            purpose === 'check' ? ('validation' as const) : ('fit' as const),
        },
        pressedZ: 29.5,
      }));
      const result = fitExploration(
        { grid, probes: [], screen, start: pose(100, -30, 80) },
        f.tool,
        f.runtime.capabilities,
        {
          id: 'relative-fit',
          ...f.binding,
          robotGeometryRevision: 1,
          toolGeometryRevision: 1,
          screenGeometryRevision: 1,
        },
        false,
      );
      expect(result.candidate.acceptanceStatus).toBe('pending');
      expect(result.evidence.validationMaxPx).toBeCloseTo(5.4);
      expect(result.evidence.validationMaxMm).toBeCloseTo(1.01);
      expect(result.evidence.gridRmsMm).toBeCloseTo(0);
      const warning = result.warnings.find(
        (reading) => reading.label === 'Holdout maximum',
      );
      if (shortSideMm === 67) expect(warning).toBeUndefined();
      else expect(warning?.percent).toBeCloseTo((100 * 1.01) / shortSideMm);
    } finally {
      await f.cleanup();
    }
  },
);

it.each([
  [false, 844],
  [true, 844],
  [false, 800],
  [true, 800],
  [false, 667],
  [true, 667],
] as const)(
  'uses dev measured full-screen coverage after collection (fast=%s, height=%s)',
  async (fast, height) => {
    const f = await fixture();
    try {
      const map =
        height === 667 ? phoneMap : (p: { x: number; y: number }) => p;
      const layout = { width: 390, height };
      const { targets, inset } = mappedExplorationTargets(
        layout,
        map,
        { width: 390, height: 844 },
        fast,
      );
      expect(inset).toBe(0.1);
      const sample = (p: { x: number; y: number }) => {
        const screen = map(p);
        return {
          screen,
          contact: { x: screen.x / 5, y: -screen.y / 5, z: 30 },
          pressedZ: 29.5,
          weight: 1,
        };
      };
      const grid = targets.map((t, i) => ({
        ...sample(t.point),
        target: {
          id: String(i),
          css: t.point,
          screen: map(t.point),
          role:
            t.purpose === 'check' ? ('validation' as const) : ('fit' as const),
        },
      }));
      const probes = [
        { x: 195, y: height / 2 },
        { x: 205, y: height / 2 },
        { x: 195, y: height / 2 + 10 },
      ].map(sample);
      const screen = {
        ...f.screen,
        pixelWidth: 390,
        pixelHeight: 844,
        physicalWidthMm: 0,
        physicalHeightMm: 0,
      };
      const measuredCoverage = coverage(
        [...probes, ...grid.filter((p) => p.target.role === 'fit')].map(
          (p) => p.screen,
        ),
        screen,
      );
      const fit = () =>
        fitExploration(
          { probes, grid, start: pose(39, -height / 10, 100), screen },
          f.tool,
          f.runtime.capabilities,
          {
            id: 'coverage',
            ...f.binding,
            robotGeometryRevision: 1,
            toolGeometryRevision: 1,
            screenGeometryRevision: 1,
          },
          fast,
        );
      const result = fit();
      if (height === 667) {
        expect(measuredCoverage).toBeLessThan(0.6);
        expect(result.warnings).toContainEqual(
          expect.objectContaining({ label: 'Touch coverage' }),
        );
      } else {
        if (height === 800) {
          expect(measuredCoverage).toBeGreaterThan(0.6);
          expect(measuredCoverage).toBeLessThan(0.62);
        }
        expect(result.warnings).toEqual([]);
      }
      expect(result.coverage).toBeCloseTo(measuredCoverage, 10);
      expect(result.candidate.acceptanceStatus).toBe('pending');
    } finally {
      await f.cleanup();
    }
  },
);
