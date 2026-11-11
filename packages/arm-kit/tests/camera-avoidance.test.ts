import { expect, it, rstest } from '@rstest/core';
import type { ApplicationContext } from '../src/application/context.js';
import {
  cameraAvoidanceTargets,
  taughtCameraSide,
} from '../src/calibration/camera-avoidance.js';
import { avoidCamera } from '../src/calibration/verification/camera-avoidance.js';
import type { CalibrationHost } from '../src/calibration/verification/commands.js';
import type {
  CalibrationSession,
  InstallationTeaching,
} from '../src/contracts.js';
import { fixture, pose } from './fixtures.js';

async function setup() {
  const f = await fixture();
  const teaching: InstallationTeaching = {
    id: 'mount',
    recordedAt: new Date().toISOString(),
    robotProfileId: f.robot.id,
    toolProfileId: f.tool.id,
    cameraId: 'cam',
    robotGeometryRevision: f.robot.geometryRevision,
    toolGeometryRevision: f.tool.geometryRevision,
    referencePose: pose(100, -50, 80),
    poses: {
      reference: pose(100, -50, 80),
      cameraBoundary: pose(100, 100, 80),
    },
    cameraBoundary: { point: { x: 100, y: 100 }, normal: { x: 0, y: 1 } },
    corridorConfirmed: true,
  };
  const ctx: ApplicationContext = {
    robot: f.robot,
    tool: f.tool,
    screen: f.screen,
    installationTeaching: teaching,
    minimumTravelTipZMm: 80,
  };
  const session = {
    ...f.binding,
    candidate: structuredClone(f.calibration),
    stage: 'observation',
    auto: { observationRecorded: false },
  } as CalibrationSession;
  let actual = pose(100, -50, 80);
  const preflight = rstest.fn(
    async (_targets: Parameters<CalibrationHost['preflight']>[0]) => {},
  );
  const move = rstest.fn(async (target: ReturnType<typeof pose>) => {
    actual = target;
    return {} as never;
  });
  const host = {
    profileStore: f.store,
    check() {},
    interrupted: () => false,
    progress() {},
    preflight,
    move,
    stable: async () => {},
    stationaryPose: async () => actual,
    safeLift: () => actual,
  } as unknown as CalibrationHost;
  return { ...f, ctx, session, host, preflight, move };
}

it('tries lateral exits first, respects the measured travel floor and records measured arrival', async () => {
  const f = await setup();
  try {
    f.preflight.mockRejectedValueOnce(new Error('unreachable'));
    expect(await avoidCamera(f.host, f.session, f.ctx)).toBe(true);
    expect(f.preflight).toHaveBeenCalledTimes(2);
    expect(f.move).toHaveBeenCalledTimes(2);
    expect(
      f.session.candidate!.observationPose.positionMm.z,
    ).toBeGreaterThanOrEqual(80);
    expect(f.session.auto?.observationRecorded).toBe(true);
    expect(f.session.stage).toBe('verification');
    expect(f.session.candidate!.acceptanceStatus).toBe('accepted'); // avoidance itself never changes acceptance
  } finally {
    await f.cleanup();
  }
});
it('tries the next exit after occlusion and replans from the measured current position', async () => {
  const f = await setup();
  try {
    f.host.verifyCameraVisibility = rstest
      .fn()
      .mockResolvedValueOnce({
        clear: false,
        checkedAt: new Date().toISOString(),
        screens: [],
      })
      .mockResolvedValueOnce({
        clear: true,
        checkedAt: new Date().toISOString(),
        screens: [],
      });
    expect(await avoidCamera(f.host, f.session, f.ctx)).toBe(true);
    expect(f.host.verifyCameraVisibility).toHaveBeenCalledTimes(2);
    expect(f.preflight.mock.calls[1][0][0].pose).toEqual(
      f.move.mock.calls[1][0],
    );
    expect(f.session.auto?.cameraVisibility?.clear).toBe(true);
  } finally {
    await f.cleanup();
  }
});
it('keeps manual fallback when every candidate is refused; a submitted movement failure never tries another exit', async () => {
  const f = await setup();
  try {
    f.preflight.mockRejectedValue(new Error('unreachable'));
    expect(await avoidCamera(f.host, f.session, f.ctx)).toBe(false);
    expect(f.move).not.toHaveBeenCalled();
    f.preflight.mockResolvedValue(undefined);
    f.move.mockRejectedValue(new Error('feedback lost'));
    await expect(avoidCamera(f.host, f.session, f.ctx)).rejects.toThrow(
      'feedback lost',
    );
    expect(f.move).toHaveBeenCalledTimes(1);
    expect(f.session.auto?.observationRecorded).toBe(false);
    expect(f.session.auto?.avoidingCamera).toBe(false);
  } finally {
    await f.cleanup();
  }
});
it('requires confirmed teaching and parks outside the combined multi-screen footprint, including gaps', async () => {
  const f = await setup();
  try {
    expect(
      await avoidCamera(f.host, f.session, {
        ...f.ctx,
        installationTeaching: undefined,
      }),
    ).toBe(false);
    const estimate = taughtCameraSide(
      f.calibration,
      f.screen,
      f.ctx.installationTeaching!,
    );
    const obstacles: [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ][] = [
      [
        { x: 220, y: 0 },
        { x: 420, y: 0 },
        { x: 420, y: -100 },
        { x: 220, y: -100 },
      ],
    ];
    const targets = cameraAvoidanceTargets(
      f.calibration,
      f.screen,
      f.tool,
      estimate,
      obstacles,
    );
    expect(targets).toHaveLength(3);
    for (const t of targets) {
      const p = t.positionMm;
      expect(p.x < -10 || p.x > 430 || p.y < -110 || p.y > 10).toBe(true);
    }
  } finally {
    await f.cleanup();
  }
});
