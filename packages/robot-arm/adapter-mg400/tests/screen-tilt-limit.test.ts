import { fitContactPlane } from '@midscene/arm-kit/internal/calibration/exploration/plane';
import { screenGeometry } from '@midscene/arm-kit/internal/calibration/geometry';
import {
  SCREEN_TILT_LIMIT_DEGREES,
  type ScreenProfile,
  type ToolProfile,
} from '@midscene/arm-kit/internal/contracts';
import { dot } from '@midscene/arm-kit/internal/domain';
import { RobotKernel } from '@midscene/arm-kit/internal/kernel';
import { fixture, pose } from '@midscene/arm-kit/internal/testkit/fixtures';
import { TestRobotAdapter } from '@midscene/arm-kit/internal/testkit/test-adapter';
import { describe, expect, it } from '@rstest/core';
import { Mg400Adapter } from '../src/mg400.js';

const degrees = (value: number) => (value * Math.PI) / 180;

/**
 * Five contacts exactly on a plane tilted `tilt` degrees about Y, so the fit has
 * one inlier set and the declared tilt limit is the only thing that can reject it.
 * They sit inside one 200 x 100 mm physical screen whose top-left corner is the
 * (0, 0) sample, which is what P1/P2 axes have to be consistent with.
 */
function planeTiltedBy(tilt: number) {
  const normal = {
    x: Math.sin(degrees(tilt)),
    y: 0,
    z: -Math.cos(degrees(tilt)),
  };
  const onPlane = (x: number, y: number) => ({
    x,
    y,
    z: (dot(normal, { x, y, z: 0 }) + 30) / -normal.z,
  });
  return {
    samples: [
      [0, 0],
      [0, -100],
      [100, -50],
      [200, 0],
      [200, -100],
    ].map(([x, y]) => onPlane(x, y)),
    p1: onPlane(0, 0),
    p2: onPlane(200, 0),
  };
}

/**
 * The two profiles the geometry path consumes, built as complete values so the
 * test would fail to compile if a new required field changed their meaning.
 */
const measuredTool: ToolProfile = {
  id: 'tool',
  name: 'Tool',
  revision: 1,
  geometryRevision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
  offsetMm: { x: 0, y: 0, z: 0 },
  contactDirection: { x: 0, y: 0, z: -1 },
};
const measuredScreen: ScreenProfile = {
  id: 'screen',
  name: 'Screen',
  revision: 1,
  geometryRevision: 1,
  updatedAt: '2026-01-01T00:00:00Z',
  pixelWidth: 1000,
  pixelHeight: 500,
  physicalWidthMm: 200,
  physicalHeightMm: 100,
  direction: 'right/down',
  pressDepthMm: 1,
  safeHeightMm: 20,
  actionSpeed: { kind: 'ratio', value: 0.1 },
  actionAcceleration: { kind: 'ratio', value: 0.1 },
  contactMs: 60,
  swipeEndpointHoldMs: 50,
  longPressMs: 800,
  dragHoldMs: 80,
  releaseSpeedFactor: 0.4,
  releaseAccelerationFactor: 0.4,
  successorStartLeadMs: 0,
  motionTimeoutMs: 60000,
};

function screenFor(adapter: TestRobotAdapter, tilt: number) {
  const { samples, p1, p2 } = planeTiltedBy(tilt);
  const kernel = new RobotKernel(adapter);
  const plane = fitContactPlane(
    samples,
    { x: 0, y: 0, z: -1 },
    measuredScreen,
  ).plane;
  return () =>
    screenGeometry(
      plane,
      p1,
      p2,
      pose().orientation,
      measuredTool,
      kernel.capabilities,
    );
}

describe('repository screen tilt limit', () => {
  it('is declared by every restricted-orientation arm and enforced on geometry', () => {
    const adapter = new TestRobotAdapter({ jointCount: 4 });
    expect(adapter.kinematics.screenNormalToleranceDegrees).toBe(
      SCREEN_TILT_LIMIT_DEGREES,
    );
    const mg400 = new Mg400Adapter({ host: '127.0.0.1' });
    expect(mg400.kinematics.screenNormalToleranceDegrees).toBe(
      SCREEN_TILT_LIMIT_DEGREES,
    );
    expect(
      new RobotKernel(mg400).capabilities.screenNormalToleranceDegrees,
    ).toBe(SCREEN_TILT_LIMIT_DEGREES);
    // One degree inside the limit is usable; three degrees past it is not, which
    // is the whole point of installing the screen nearly level.
    expect(() =>
      screenFor(adapter, SCREEN_TILT_LIMIT_DEGREES - 1)(),
    ).not.toThrow();
    expect(() => screenFor(adapter, SCREEN_TILT_LIMIT_DEGREES + 3)()).toThrow(
      expect.objectContaining({ code: 'SCREEN_TILT_UNSUPPORTED' }),
    );
  });
  it('is the value that decides the outcome, on identical geometry', () => {
    // The Simulator declaration is a test seam: the shipped configuration never
    // sets it, so this only proves the declared limit is what drives the check.
    const strict = new TestRobotAdapter({
      jointCount: 4,
      screenTiltLimitDegrees: 1,
    });
    const relaxed = new TestRobotAdapter({
      jointCount: 4,
      screenTiltLimitDegrees: 5,
    });
    expect(() => screenFor(strict, 2)()).toThrow(
      expect.objectContaining({ code: 'SCREEN_TILT_UNSUPPORTED' }),
    );
    expect(() => screenFor(relaxed, 2)()).not.toThrow();
    expect(() => screenFor(relaxed, 4)()).not.toThrow();
  });
  it('refuses a tilt limit declared by a full-orientation arm', () => {
    expect(
      () =>
        new TestRobotAdapter({
          jointCount: 6,
          orientation: 'full',
          screenTiltLimitDegrees: 4,
        }),
    ).toThrow(
      expect.objectContaining({
        code: 'INVALID_CONFIG',
        message: expect.stringContaining(
          'restricted-orientation adapters only',
        ),
      }),
    );
  });
  it('leaves a six-axis arm free to work on an inclined screen', () => {
    const sixAxis = new TestRobotAdapter({ jointCount: 6 });
    // A screen standing 90 degrees to the tool: only a full-orientation arm can
    // reach it, and no tilt limit applies because it aligns to the fitted plane.
    const vertical = [
      { x: 100, y: 0, z: 0 },
      { x: 100, y: 200, z: 0 },
      { x: 100, y: 0, z: 100 },
      { x: 100, y: 200, z: 100 },
      { x: 100, y: 100, z: 50 },
    ];
    const geometry = screenGeometry(
      fitContactPlane(vertical, { x: 1, y: 0, z: 0 }, measuredScreen).plane,
      vertical[0],
      vertical[1],
      pose().orientation,
      measuredTool,
      new RobotKernel(sixAxis).capabilities,
    );
    expect(geometry.kind).toBe('spatialPlane');
  });
});
