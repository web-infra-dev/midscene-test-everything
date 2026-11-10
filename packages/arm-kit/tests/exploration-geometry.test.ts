import { describe, expect, it } from '@rstest/core';
import {
  affinePoint,
  autoCalibrationGeometry,
  fitAffine,
  invertAffine,
  maxSurfaceResidualMm,
  screenFrame,
  screenResidualMm,
} from '../src/calibration/exploration/geometry.js';
import { surfaceDepthMm } from '../src/calibration/exploration/plane.js';
import { screenContactMm } from '../src/calibration/geometry.js';
import { surfaceOffsetMm as offset } from '../src/calibration/surface.js';
const surfaceOffsetMm = (
  c: Parameters<typeof surfaceDepthMm>[0],
  point: { x: number; y: number },
) => offset(c.surface, point);
import { fixture, pose } from './fixtures.js';

describe('automatic calibration geometry', () => {
  it('checks held-out heights against both the local surface and the absolute compensation limit', async () => {
    const f = await fixture();
    try {
      const candidate = {
        ...f.calibration,
        surface: {
          kind: 'sampled' as const,
          patches: [],
          widthMm: 200,
          heightMm: 100,
          limitMm: 1.75,
          samples: [
            [0, 0],
            [200, 0],
            [0, 100],
            [200, 100],
            [100, 50],
          ].map(([x, y]) => ({
            x,
            y,
            depthMm: 1.75,
            weight: 1,
          })),
        },
      };
      const contacts = (depthMm: number) => [
        { x: 50, y: -25, z: 30 - depthMm },
      ];
      expect(maxSurfaceResidualMm(candidate, contacts(1.75))).toBeCloseTo(0);
      // A 0.75 mm local residual cannot excuse a measured 2.5 mm deviation.
      expect(() => maxSurfaceResidualMm(candidate, contacts(2.5))).toThrow(
        '2 mm compensation limit',
      );
      expect(maxSurfaceResidualMm(candidate, contacts(0.5))).toBeCloseTo(1.25);
    } finally {
      await f.cleanup();
    }
  });
  it('fits and inverts a pixel affine from three touch samples', () => {
    const transform = [2, 0.25, 100, -0.5, 3, 200] as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const from = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    const to = from.map((point) => affinePoint(transform, point));
    const fitted = fitAffine(from, to);
    const probe = affinePoint(fitted, { x: 4, y: 7 });
    const expected = affinePoint(transform, { x: 4, y: 7 });
    expect(probe.x).toBeCloseTo(expected.x, 8);
    expect(probe.y).toBeCloseTo(expected.y, 8);
    const inverse = invertAffine(fitted);
    const roundTrip = affinePoint(inverse, probe);
    expect(roundTrip.x).toBeCloseTo(4, 8);
    expect(roundTrip.y).toBeCloseTo(7, 8);
  });
  it('converts a robot-to-pixel affine into the physical screen frame', () => {
    const frame = screenFrame([5, 0, 0, 0, 5, 0], {
      pixelWidth: 401,
      pixelHeight: 801,
      physicalWidthMm: 80,
      physicalHeightMm: 160,
    });
    expect(frame.origin).toEqual({ x: 0, y: 0 });
    expect(frame.uAxis.x).toBeCloseTo(1, 8);
    expect(frame.uAxis.y).toBeCloseTo(0, 8);
    expect(frame.vAxis.x).toBeCloseTo(0, 8);
    expect(frame.vAxis.y).toBeCloseTo(1, 8);
    expect(frame.uCorner.x).toBeCloseTo(80, 8);
    expect(frame.vCorner.y).toBeCloseTo(160, 8);
  });
  it('supports a rotated screen and measures dimensions independently of configured size', () => {
    const rotated = screenFrame([0, 5, 0, -5, 0, 0], {
      pixelWidth: 401,
      pixelHeight: 801,
      physicalWidthMm: 80,
      physicalHeightMm: 160,
    });
    expect(Math.abs(rotated.uAxis.y)).toBeGreaterThan(0.9);
    expect(Math.abs(rotated.vAxis.x)).toBeGreaterThan(0.9);
    const measured = screenFrame([5, 0, 0, 0, 5, 0], {
      pixelWidth: 401,
      pixelHeight: 801,
      physicalWidthMm: 120,
      physicalHeightMm: 160,
    });
    expect(measured.physicalWidthMm).toBeCloseTo(80);
    expect(measured.physicalHeightMm).toBeCloseTo(160);
  });
  it('builds a pending candidate profile from a planar touch grid', async () => {
    const f = await fixture();
    try {
      const points = [
        [0, 0],
        [200, 0],
        [200, -100],
        [0, -100],
        [100, -50],
      ] as const;
      const samples = points.map(([x, y]) => ({
        robot: { x, y, z: 30 },
        screen: { x: (x / 200) * 999, y: (-y / 100) * 499 },
      }));
      const result = autoCalibrationGeometry({
        startPose: pose(100, -50, 100),
        samples,
        screen: {
          ...f.screen,
          physicalWidthMm: 0,
          physicalHeightMm: 0,
        },
        tool: f.tool,
        capabilities: f.runtime.capabilities,
        binding: {
          id: 'auto-candidate',
          robotProfileId: f.binding.robotProfileId,
          toolProfileId: f.binding.toolProfileId,
          screenProfileId: f.binding.screenProfileId,
          robotGeometryRevision: f.robot.geometryRevision,
          toolGeometryRevision: f.tool.geometryRevision,
          screenGeometryRevision: f.screen.geometryRevision,
        },
      });
      expect(result.measuredSize.physicalWidthMm).toBeCloseTo(200);
      expect(result.measuredSize.physicalHeightMm).toBeCloseTo(100);
      expect(result.candidate.id).toBe('auto-candidate');
      expect(result.candidate.kind).toBe('restrictedPlane');
      expect(result.candidate.geometryStatus).toBe('valid');
      expect(result.candidate.acceptanceStatus).toBe('pending');
      // The start pose only locates the screen; the Safe Position is recorded
      // by the operator after verification.
      expect(result.candidate.observationPose).toBeUndefined();
      expect(result.candidate.origin.x).toBeCloseTo(0, 6);
      expect(result.candidate.origin.y).toBeCloseTo(0, 6);
      expect(result.candidate.origin.z).toBeCloseTo(30, 6);
      expect(result.candidate.xAxis.x).toBeCloseTo(1, 6);
      expect(result.candidate.yAxis.y).toBeCloseTo(-1, 6);
      expect(result.quality.rmseMm).toBeLessThan(0.001);
      expect(result.gridRmsPx).toBeLessThan(0.001);
      expect(result.gridRmsMm).toBeLessThan(0.001);
      expect(result.surfaceMaxMm).toBeLessThan(0.001);
      expect(result.candidate.surface).toBeUndefined();
      expect(result.coverage).toBeGreaterThan(0.99);
    } finally {
      await f.cleanup();
    }
  });
  it('converts held-out residuals with both measured axis scales when the fit is exact', async () => {
    const f = await fixture();
    try {
      const samples = [
        [0, 0],
        [200, 0],
        [0, -100],
        [200, -100],
        [100, -50],
      ].map(([x, y]) => ({
        robot: { x, y, z: 30 },
        screen: { x: (x / 200) * 999, y: (-y / 100) * 999 },
      }));
      const result = autoCalibrationGeometry({
        startPose: pose(100, -50, 100),
        samples,
        screen: {
          ...f.screen,
          pixelHeight: 1000,
          physicalWidthMm: 0,
          physicalHeightMm: 0,
        },
        tool: f.tool,
        capabilities: f.runtime.capabilities,
        binding: {
          id: 'anisotropic-candidate',
          robotProfileId: f.binding.robotProfileId,
          toolProfileId: f.binding.toolProfileId,
          screenProfileId: f.binding.screenProfileId,
          robotGeometryRevision: f.robot.geometryRevision,
          toolGeometryRevision: f.tool.geometryRevision,
          screenGeometryRevision: f.screen.geometryRevision,
        },
      });
      expect(result.gridRmsPx).toBeLessThan(1e-9);
      expect(result.gridRmsMm).toBeLessThan(1e-9);
      expect(result.frame.physicalWidthMm).toBeCloseTo(200, 6);
      expect(result.frame.physicalHeightMm).toBeCloseTo(100, 6);
      // Four pixels on the narrower axis are worth half of four on the wider
      // axis. A zero fit residual must not collapse these held-out millimetres.
      expect(screenResidualMm(result.frame, { x: 4, y: 0 })).toBeCloseTo(
        800 / 999,
        9,
      );
      expect(screenResidualMm(result.frame, { x: 0, y: 4 })).toBeCloseTo(
        400 / 999,
        9,
      );
      expect(screenResidualMm(result.frame, { x: 4, y: 4 })).toBeCloseTo(
        Math.hypot(800 / 999, 400 / 999),
        9,
      );
    } finally {
      await f.cleanup();
    }
  });
  it('fits and compensates a smooth local surface on a slightly uneven screen', async () => {
    const f = await fixture();
    try {
      const width = 200;
      const height = 100;
      const samples = [0, 0.5, 1].flatMap((u) =>
        [0, 0.5, 1].map((v) => ({
          robot: {
            x: u * width,
            y: -v * height,
            // Gentle bulge: +0.3 mm at the centre and 0 mm at the corners.
            z: 30 + 0.3 * (1 - 2 * ((u - 0.5) ** 2 + (v - 0.5) ** 2)),
          },
          screen: { x: u * 999, y: v * 499 },
        })),
      );
      const result = autoCalibrationGeometry({
        startPose: pose(100, -50, 100),
        samples,
        screen: {
          ...f.screen,
          physicalWidthMm: 0,
          physicalHeightMm: 0,
        },
        tool: f.tool,
        capabilities: f.runtime.capabilities,
        binding: {
          id: 'curved-candidate',
          robotProfileId: f.binding.robotProfileId,
          toolProfileId: f.binding.toolProfileId,
          screenProfileId: f.binding.screenProfileId,
          robotGeometryRevision: f.robot.geometryRevision,
          toolGeometryRevision: f.tool.geometryRevision,
          screenGeometryRevision: f.screen.geometryRevision,
        },
      });
      expect(result.candidate.surface).toBeDefined();
      expect(result.candidate.surface?.kind).toBe('sampled');
      expect(result.candidate.surface?.widthMm).toBeCloseTo(200, 3);
      expect(result.candidate.surface?.heightMm).toBeCloseTo(100, 3);
      expect(result.surfaceMaxMm).toBeGreaterThan(0.19);
      expect(result.gridRmsMm).toBeCloseTo(
        (result.gridRmsPx * (200 / 1000 + 100 / 500)) / 2,
        6,
      );
      const centre = { x: 100, y: 50 };
      const corner = { x: 0, y: 0 };
      // Positive offsets lie below the plane: the centre bulges toward the tool.
      expect(
        surfaceOffsetMm(result.candidate, centre) -
          surfaceOffsetMm(result.candidate, corner),
      ).toBeCloseTo(-0.3, 2);
      // Contacts apply the correction along inward, so the centre contact is
      // 0.3 mm closer to the tool than the corner contact.
      expect(
        screenContactMm(result.candidate, centre).z -
          screenContactMm(result.candidate, corner).z,
      ).toBeCloseTo(0.3, 2);
    } finally {
      await f.cleanup();
    }
  });
  it('keeps regional heights bounded when a polynomial would overshoot unsampled edges', async () => {
    const f = await fixture();
    try {
      // Only 0.2 mm of measured curvature, but extending this quadratic from
      // the sampled central strip to x=0/200 predicts a 5 mm excursion.
      const samples = [0.4, 0.5, 0.6].flatMap((u) =>
        [0.2, 0.5, 0.8].map((v) => ({
          robot: { x: 200 * u, y: -100 * v, z: 30 + 20 * (u - 0.5) ** 2 },
          screen: { x: 999 * u, y: 499 * v },
        })),
      );
      const result = autoCalibrationGeometry({
        startPose: pose(100, -50, 100),
        samples,
        screen: f.screen,
        tool: f.tool,
        capabilities: f.runtime.capabilities,
        binding: {
          id: 'regional',
          ...f.binding,
          robotGeometryRevision: 1,
          toolGeometryRevision: 1,
          screenGeometryRevision: 1,
        },
      });
      expect(result.candidate.surface?.kind).toBe('sampled');
      expect(result.surfaceMaxMm).toBeLessThan(0.21);
      for (const sample of samples) {
        const contact = screenContactMm(result.candidate, {
          x: sample.robot.x,
          y: -sample.robot.y,
        });
        expect(contact.z).toBeCloseTo(sample.robot.z, 5);
        expect(surfaceDepthMm(result.candidate, sample.robot)).toBeCloseTo(
          0,
          5,
        );
      }
      for (let x = -10; x <= 210; x += 10)
        for (let y = -10; y <= 110; y += 10)
          expect(
            Math.abs(surfaceOffsetMm(result.candidate, { x, y })),
          ).toBeLessThanOrEqual(result.surfaceMaxMm + 1e-10);
    } finally {
      await f.cleanup();
    }
  });
  it('rejects a measured local excursion above 2 mm even when the plane ignores it', async () => {
    const f = await fixture();
    try {
      const samples = [0, 0.5, 1].flatMap((u) =>
        [0, 0.5, 1].map((v) => ({
          robot: {
            x: 200 * u,
            y: -100 * v,
            z: 30 + (u === 0.5 && v === 0.5 ? 2.2 : 0),
          },
          screen: { x: 999 * u, y: 499 * v },
        })),
      );
      expect(() =>
        autoCalibrationGeometry({
          startPose: pose(100, -50, 100),
          samples,
          screen: f.screen,
          tool: f.tool,
          capabilities: f.runtime.capabilities,
          binding: {
            id: 'unsafe-regional',
            ...f.binding,
            robotGeometryRevision: 1,
            toolGeometryRevision: 1,
            screenGeometryRevision: 1,
          },
        }),
      ).toThrow('2 mm compensation limit');
    } finally {
      await f.cleanup();
    }
  });
  it('uses three-dimensional edge lengths and measures skew in the executable frame', async () => {
    const f = await fixture();
    try {
      const angle = Math.PI / 6;
      const samples = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
        [0.5, 0.5],
        [0.2, 0.8],
      ].map(([u, v]) => ({
        robot: {
          x: 10 + u * 200 * Math.cos(angle),
          y: -v * 100,
          z: 30 + u * 200 * Math.sin(angle),
        },
        screen: { x: u * 999, y: v * 499 },
      }));
      const input = {
        startPose: pose(100, -50, 100),
        samples,
        screen: {
          ...f.screen,
          physicalWidthMm: 0,
          physicalHeightMm: 0,
        },
        tool: f.tool,
        capabilities: {
          ...f.runtime.capabilities,
          orientation: 'full' as const,
        },
        binding: {
          id: 'inclined',
          ...f.binding,
          robotGeometryRevision: 1,
          toolGeometryRevision: 1,
          screenGeometryRevision: 1,
        },
      };
      const result = autoCalibrationGeometry(input);
      expect(result.measuredSize.physicalWidthMm).toBeCloseTo(200, 5);
      expect(result.measuredSize.physicalHeightMm).toBeCloseTo(100, 5);
      expect(result.candidate.xAxis.z).toBeCloseTo(0.5, 5);
      const sheared = autoCalibrationGeometry({
        ...input,
        samples: samples.map((s) => ({
          ...s,
          robot: { ...s.robot, x: s.robot.x + s.screen.y * 0.1 },
        })),
      });
      expect(sheared.axisSkewRatio).toBeGreaterThan(0.03);
      expect(sheared.gridRmsMm).toBeGreaterThan(1);
    } finally {
      await f.cleanup();
    }
  });
});
