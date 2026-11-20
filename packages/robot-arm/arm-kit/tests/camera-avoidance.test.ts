import { expect, it, rstest } from '@rstest/core';
import type { ApplicationContext } from '../src/application/context.js';
import {
  cameraAvoidanceTargets,
  sharedParkingPoints,
  taughtCameraSide,
} from '../src/calibration/camera-avoidance.js';
import {
  type CameraAvoidanceState,
  avoidCamera,
} from '../src/calibration/verification/camera-avoidance.js';
import type { CalibrationHost } from '../src/calibration/verification/commands.js';
import type {
  CalibrationSession,
  InstallationTeaching,
} from '../src/contracts.js';
import { fixture, pose } from './fixtures.js';

type CameraAvoidanceMove = Parameters<typeof avoidCamera>[0]['move'];

async function setup(initial = pose(100, -50, 80)) {
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
  let actual = initial;
  const preflight = rstest.fn(
    async (_targets: Parameters<CalibrationHost['preflight']>[0]) => {},
  );
  const move = rstest.fn(
    async (...[target]: Parameters<CameraAvoidanceMove>) => {
      actual = target;
      return {} as never;
    },
  );
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
it('keeps candidate poses and ranks fixed and verifies in place on a repeated search', async () => {
  const f = await setup(pose(100, -50, 100));
  try {
    f.session.auto!.batchParking = {
      obstacles: [],
      corridor: { minX: 80, maxX: 120, minY: -150, maxY: 0 },
      complete: true,
    };
    const verify = rstest.fn(async () => ({
      clear: true,
      checkedAt: new Date().toISOString(),
      screens: [],
    }));
    const auditParking = rstest.fn((_detail: Record<string, unknown>) => {});
    const host = { ...f.host, verifyCameraVisibility: verify, auditParking };
    expect(await avoidCamera(host, f.session, f.ctx)).toBe(true);
    const selected = f.session.candidate!.observationPose;
    expect(selected.positionMm.z).toBeCloseTo(80.5);
    expect(f.move.mock.calls.map(([target]) => target)).toEqual([
      { ...selected, positionMm: { ...selected.positionMm, z: 100 } },
      selected,
    ]);
    expect(f.move.mock.calls.map(([, , , , travel]) => travel)).toEqual([
      { rank: 1, leg: 'Shared parking traverse' },
      undefined,
    ]);
    const selection = auditParking.mock.calls
      .map(([detail]) => detail)
      .find(
        ({ stage, result }) =>
          stage === 'shared-parking-candidate' && result === 'selected',
      );
    expect(selection?.skippedLegs).toEqual(['Shared parking lift']);

    f.move.mockClear();
    verify.mockClear();
    expect(await avoidCamera(host, f.session, f.ctx)).toBe(true);
    expect(verify).toHaveBeenCalledWith(selected);
    expect(f.move).not.toHaveBeenCalled();
    const plans = auditParking.mock.calls
      .map(([detail]) => detail)
      .filter(({ stage }) => stage === 'shared-parking-candidates');
    expect(plans).toHaveLength(2);
    expect(plans[1].start).not.toEqual(plans[0].start);
    expect(plans[1].candidates).toEqual(plans[0].candidates);
  } finally {
    await f.cleanup();
  }
});
it('uses the corridor height for traversal and settles at the independent parking height', async () => {
  const f = await setup(pose(100, -50, 90));
  try {
    f.session.auto!.batchParking = {
      obstacles: [],
      corridor: { minX: 80, maxX: 120, minY: -150, maxY: 0 },
      corridorTravelTipZMm: 110,
      complete: true,
    };
    const verify = rstest.fn(async () => ({
      clear: true,
      checkedAt: new Date().toISOString(),
      screens: [],
    }));
    f.host.verifyCameraVisibility = verify;

    expect(await avoidCamera(f.host, f.session, f.ctx)).toBe(true);
    expect(f.move.mock.calls.map(([target]) => target.positionMm.z)).toEqual([
      110.5, 110.5, 80.5,
    ]);
    expect(verify).toHaveBeenCalledWith(f.session.candidate!.observationPose);
  } finally {
    await f.cleanup();
  }
});
it('raises the planned observation above every fitted screen clearance', async () => {
  const f = await setup();
  try {
    f.session.auto!.batchParking = {
      obstacles: [],
      corridor: { minX: 80, maxX: 120, minY: -150, maxY: 0 },
      complete: true,
    };
    const state: CameraAvoidanceState = {
      ...f.session,
      screenClearances: [
        {
          geometry: {
            plane: { normal: { x: 0, y: 0, z: -1 }, offset: -77 },
            inward: { x: 0, y: 0, z: -1 },
          },
          clearanceMm: 5,
        },
      ],
    };
    const verify = rstest.fn(async () => ({
      clear: true,
      checkedAt: new Date().toISOString(),
      screens: [],
    }));
    f.host.verifyCameraVisibility = verify;

    expect(await avoidCamera(f.host, state, f.ctx)).toBe(true);
    const selected = f.session.candidate!.observationPose;
    expect(selected.positionMm.z).toBeCloseTo(82.5);
    expect(verify).toHaveBeenCalledWith(selected);
  } finally {
    await f.cleanup();
  }
});
it('stops once during preparation when the current orientation differs from teaching', async () => {
  const initial = pose(100, -50, 100);
  initial.orientation = { x: 0, y: 0, z: Math.sin(0.015), w: Math.cos(0.015) };
  const f = await setup(initial);
  try {
    f.session.auto!.batchParking = { obstacles: [], complete: true };
    const verifyCameraVisibility = rstest.fn();
    const auditParking = rstest.fn((_detail: Record<string, unknown>) => {});
    await expect(
      avoidCamera(
        { ...f.host, verifyCameraVisibility, auditParking },
        f.session,
        f.ctx,
      ),
    ).rejects.toMatchObject({ code: 'PARKING_ORIENTATION_REQUIRED' });
    expect(f.preflight).not.toHaveBeenCalled();
    expect(f.move).not.toHaveBeenCalled();
    expect(verifyCameraVisibility).not.toHaveBeenCalled();
    expect(
      auditParking.mock.calls.filter(
        ([detail]) => detail.stage === 'shared-parking-preparation',
      ),
    ).toHaveLength(1);
  } finally {
    await f.cleanup();
  }
});
it('keeps a coaxial MG400 at its measured yaw throughout an ordinary parking search', async () => {
  const initial = pose(100, -50, 100);
  initial.orientation = { x: 0, y: 0, z: Math.sin(0.3), w: Math.cos(0.3) };
  const f = await setup(initial);
  try {
    const ctx = {
      ...f.ctx,
      robot: { ...f.ctx.robot, adapterId: 'dobot-mg400' },
      tool: { ...f.ctx.tool, offsetMm: { x: 0, y: 0, z: -15 } },
    };
    f.session.auto!.batchParking = {
      obstacles: [],
      corridor: { minX: 80, maxX: 120, minY: -150, maxY: 0 },
      complete: true,
    };
    f.host.verifyCameraVisibility = rstest.fn(async () => ({
      clear: true,
      checkedAt: new Date().toISOString(),
      screens: [],
    }));
    expect(await avoidCamera(f.host, f.session, ctx)).toBe(true);
    expect(f.move).toHaveBeenCalled();
    for (const [target] of f.move.mock.calls)
      expect(target.orientation).toEqual(initial.orientation);
    expect(f.host.verifyCameraVisibility).toHaveBeenCalledWith(
      expect.objectContaining({ orientation: initial.orientation }),
    );
  } finally {
    await f.cleanup();
  }
});
it('refuses an MG400 yaw correction below the parking travel height', async () => {
  const initial = pose(100, -50, 70);
  initial.orientation = { x: 0, y: 0, z: Math.sin(0.015), w: Math.cos(0.015) };
  const f = await setup(initial);
  try {
    const ctx = {
      ...f.ctx,
      robot: { ...f.ctx.robot, adapterId: 'dobot-mg400' },
    };
    f.session.auto!.batchParking = { obstacles: [], complete: true };
    f.host.verifyCameraVisibility = rstest.fn();
    const state: CameraAvoidanceState = {
      ...f.session,
      parkingRecheck: { pose: pose(90, -130, 90), source: 'audit' },
    };
    await expect(avoidCamera(f.host, state, ctx)).rejects.toMatchObject({
      code: 'PARKING_ORIENTATION_REQUIRED',
    });
    expect(f.preflight).not.toHaveBeenCalled();
    expect(f.move).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});
it('rechecks the full historical pose at its original height', async () => {
  const initial = pose(100, -50, 100);
  initial.orientation = { x: 0, y: 0, z: Math.sin(0.015), w: Math.cos(0.015) };
  const f = await setup(initial);
  try {
    const ctx = {
      ...f.ctx,
      robot: { ...f.ctx.robot, adapterId: 'dobot-mg400' },
    };
    const target = pose(90, -130, 90);
    f.session.auto!.batchParking = { obstacles: [], complete: true };
    const verifyCameraVisibility = rstest.fn(async () => ({
      clear: true,
      checkedAt: new Date().toISOString(),
      screens: [],
    }));
    const state: CameraAvoidanceState = {
      ...f.session,
      parkingRecheck: { pose: target, source: 'audit' },
    };
    expect(
      await avoidCamera({ ...f.host, verifyCameraVisibility }, state, ctx),
    ).toBe(true);
    expect(f.move.mock.calls[0][0]).toEqual(pose(100, -50, 100));
    expect(verifyCameraVisibility).toHaveBeenCalledWith(target);
  } finally {
    await f.cleanup();
  }
});
it('tries the closest point along the group edge and stops after four occluded poses', async () => {
  const f = await setup();
  try {
    f.session.auto!.batchParking = {
      obstacles: [
        [
          { x: 220, y: 0 },
          { x: 420, y: 0 },
          { x: 420, y: -100 },
          { x: 220, y: -100 },
        ],
      ],
      corridor: { minX: 80, maxX: 340, minY: -140, maxY: 0 },
      complete: true,
    };
    const verify = rstest.fn(async (_target: ReturnType<typeof pose>) => ({
      clear: false,
      checkedAt: new Date().toISOString(),
      screens: [],
    }));
    f.host.verifyCameraVisibility = verify;
    const state: CameraAvoidanceState = {
      ...f.session,
      screenReferences: [
        { x: 100, y: -50 },
        { x: 320, y: -50 },
      ],
    };

    expect(await avoidCamera(f.host, state, f.ctx)).toBe(false);
    expect(verify).toHaveBeenCalledTimes(4);
    const first = verify.mock.calls[0][0].positionMm;
    expect(first.x).toBeCloseTo(210, 1);
    expect(first.y).toBeCloseTo(-112);
    expect(f.session.auto?.observationRecorded).toBe(false);
  } finally {
    await f.cleanup();
  }
});
it('ends a shared parking search at the current candidate when image evidence is insufficient', async () => {
  const f = await setup();
  try {
    f.session.auto!.batchParking = { obstacles: [], complete: true };
    const verify = rstest.fn(async () => ({
      clear: false,
      checkedAt: new Date().toISOString(),
      screens: [
        {
          id: 'phone',
          clear: false,
          assessment: 'insufficient-evidence' as const,
          reason: 'glare' as const,
          visibleFraction: 0.99,
          minimumTileFraction: 0.83,
        },
      ],
    }));
    f.host.verifyCameraVisibility = verify;
    expect(await avoidCamera(f.host, f.session, f.ctx)).toBe(false);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(f.session.auto?.observationRecorded).toBe(false);
  } finally {
    await f.cleanup();
  }
});
it.each([
  { confirmed: true, expectedY: -112 },
  { confirmed: false, expectedY: -130 },
])(
  'uses the fixed camera margin only within a confirmed corridor ($confirmed)',
  async ({ confirmed, expectedY }) => {
    const f = await setup(pose(100, -125, 100));
    try {
      f.session.auto!.batchParking = {
        obstacles: [],
        corridor: confirmed
          ? { minX: 80, maxX: 120, minY: -150, maxY: 0 }
          : undefined,
        complete: true,
      };
      f.host.verifyCameraVisibility = rstest.fn(async () => ({
        clear: true,
        checkedAt: new Date().toISOString(),
        screens: [],
      }));
      expect(await avoidCamera(f.host, f.session, f.ctx)).toBe(true);
      expect(f.session.candidate!.observationPose.positionMm.y).toBeCloseTo(
        expectedY,
      );
    } finally {
      await f.cleanup();
    }
  },
);

it('includes an interior point on the reference segment where it clears the screen group', () => {
  const points = sharedParkingPoints(
    [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ],
    [
      { x: 30, y: 20 },
      { x: 30, y: -60 },
    ],
    { minX: 0, maxX: 100, minY: -50, maxY: 100 },
    (point) => point.y + 30,
  );

  // The feasible portion of the segment runs from y = -50 to y = -30.
  expect(points).toContainEqual({ x: 30, y: -40 });
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
