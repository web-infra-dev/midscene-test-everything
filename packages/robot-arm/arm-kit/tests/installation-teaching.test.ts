import { expect, it, rstest } from '@rstest/core';
import { assertCameraBoundary } from '../src/application/teaching-constraints.js';
import { type InstallationTeaching, RobotArmError } from '../src/contracts.js';
import { RobotDriverBoundary } from '../src/kernel/driver-boundary.js';
import { ProfileStore } from '../src/runtime/profile-store.js';
import { fixture, pose } from './fixtures.js';

it('rebuilds the calibration approach after a disconnect known to precede dispatch', async () => {
  const f = await fixture();
  const move = rstest
    .spyOn(RobotDriverBoundary.prototype, 'moveLinear')
    .mockRejectedValueOnce(
      new RobotArmError(
        'DISCONNECTED',
        'Motion channel dropped before dispatch',
        503,
        {
          beforeMotionSubmission: true,
        },
      ),
    );
  const rechecking: boolean[] = [];
  const collect = rstest.fn(
    async (
      host: Parameters<
        Parameters<typeof f.runtime.collectAutomaticPoints>[1]
      >[0],
    ) => {
      await host.read();
      await host.move(pose(110, -50, 100));
    },
  );
  try {
    await f.runtime.collectAutomaticPoints(
      {
        ...f.binding,
        onPayloadRecheck: (waiting) => rechecking.push(waiting),
      },
      collect,
    );
    expect(collect).toHaveBeenCalledTimes(2);
    expect(rechecking).toEqual([true, false]);
    expect(f.adapter.movements).toEqual([pose(110, -50, 100)]);
    expect((await f.runtime.state()).recoveryRequired).toBe(false);
    expect(f.store.list().pendingOperation).toBeUndefined();
  } finally {
    move.mockRestore();
    await f.cleanup();
  }
});

it('returns from boundary readback noise without commanding a point across the plane, and uses configured motion for both taught positions', async () => {
  const f = await fixture();
  try {
    const tool = await f.store.putTool({
      ...f.tool,
      offsetMm: { x: 4, y: -2, z: -10 },
    });
    const binding = {
      ...f.binding,
      cameraId: 'cam',
    };
    const motion = {
      actionSpeed: { kind: 'ratio' as const, value: 0.35 },
      actionAcceleration: { kind: 'ratio' as const, value: 0.22 },
    };
    const reference = pose(100, -50, 90);
    const boundary = pose(160, 30, 75);
    await f.store.saveInstallationTeaching({
      ...binding,
      id: 'mount',
      recordedAt: new Date().toISOString(),
      robotGeometryRevision: f.robot.geometryRevision,
      toolGeometryRevision: tool.geometryRevision,
      referencePose: reference,
      poses: { reference, cameraBoundary: boundary },
      cameraBoundary: { point: { x: 164, y: 28 }, normal: { x: 0.6, y: 0.8 } },
      corridorConfirmed: true,
    });
    // A 0.5 mm readback error along the taught plane's unit normal.
    const justOutside = pose(160.3, 30.4, 75);
    const move = rstest.spyOn(f.adapter, 'moveLinear');
    f.adapter.setPoseForTesting(justOutside);
    await f.runtime.positionInstallationPoint(
      { ...binding, motion },
      'cameraBoundary',
    );
    for (const [, options] of move.mock.calls) {
      expect(options).toMatchObject({
        speed: motion.actionSpeed,
        acceleration: motion.actionAcceleration,
      });
    }
    expect(f.adapter.movements.at(-1)).toEqual(boundary);
    for (const { positionMm: p } of f.adapter.movements) {
      expect((p.x - 160) * 0.6 + (p.y - 30) * 0.8).toBeLessThanOrEqual(1e-10);
    }
    move.mockClear();
    f.adapter.setPoseForTesting(justOutside);
    await f.runtime.positionInstallationPoint(
      { ...binding, motion },
      'reference',
    );
    expect(move.mock.calls.map(([p]) => p.positionMm.z)).toEqual([90, 90, 90]);
    expect(move.mock.calls[0][0].positionMm.x).toBeCloseTo(160, 9);
    expect(move.mock.calls[0][0].positionMm.y).toBeCloseTo(30, 9);
    for (const [, options] of move.mock.calls) {
      expect(options).toMatchObject({
        speed: motion.actionSpeed,
        acceleration: motion.actionAcceleration,
      });
    }
    expect(f.adapter.movements.at(-1)).toEqual(reference);
    move.mockClear();
    // Even a much smaller excess is rejected for a requested target.
    await expect(
      f.runtime.collectAutomaticPoints(binding, (host) =>
        host.move(pose(160.000006, 30.000008, 75)),
      ),
    ).rejects.toMatchObject({ code: 'CAMERA_BOUNDARY_EXCEEDED' });
    f.adapter.setPoseForTesting(pose(160.3006, 30.4008, 75));
    for (const point of ['reference', 'cameraBoundary'] as const) {
      await expect(
        f.runtime.positionInstallationPoint({ ...binding, motion }, point),
      ).rejects.toMatchObject({ code: 'CAMERA_BOUNDARY_EXCEEDED' });
    }
    expect(move).not.toHaveBeenCalled();
  } finally {
    await f.cleanup();
  }
});

it('persists mounting per camera, reuses it across screens and invalidates changed tool geometry', async () => {
  const f = await fixture();
  try {
    const teaching: InstallationTeaching = {
      id: 'mount',
      recordedAt: new Date().toISOString(),
      robotProfileId: f.robot.id,
      toolProfileId: f.tool.id,
      cameraId: 'cam',
      robotGeometryRevision: f.robot.geometryRevision,
      toolGeometryRevision: f.tool.geometryRevision,
      referencePose: pose(100, 50, 80),
      poses: {
        reference: pose(100, 50, 80),
        cameraBoundary: pose(100, 100, 80),
      },
      cameraBoundary: { point: { x: 100, y: 100 }, normal: { x: 0, y: 1 } },
      corridorConfirmed: true,
    };
    await f.store.saveInstallationTeaching(teaching);
    const reloaded = new ProfileStore(f.store.filePath);
    await reloaded.load();
    const selection = {
      robotProfileId: f.robot.id,
      toolProfileId: f.tool.id,
      cameraId: 'cam',
    };
    expect(reloaded.installationTeaching(selection)?.id).toBe('mount');
    expect(
      reloaded.installationTeaching({ ...selection, cameraId: 'other' }),
    ).toBeUndefined();
    expect(() =>
      assertCameraBoundary(pose(10000, 100, 80), teaching, { tool: f.tool }),
    ).not.toThrow();
    expect(() =>
      assertCameraBoundary(pose(100, 100.01, 80), teaching, { tool: f.tool }),
    ).toThrow('boundary');
    await reloaded.putTool({ ...f.tool, offsetMm: { x: 0, y: 0, z: -100 } });
    expect(reloaded.installationTeaching(selection)).toBeUndefined();
  } finally {
    await f.cleanup();
  }
});

it('rejects probe routes crossing a taught camera boundary before submitting movement', async () => {
  const f = await fixture();
  try {
    await f.store.saveInstallationTeaching({
      id: 'mount',
      recordedAt: new Date().toISOString(),
      robotProfileId: f.robot.id,
      toolProfileId: f.tool.id,
      cameraId: 'cam',
      robotGeometryRevision: f.robot.geometryRevision,
      toolGeometryRevision: f.tool.geometryRevision,
      referencePose: pose(100, 50, 80),
      poses: {
        reference: pose(100, 50, 80),
        cameraBoundary: pose(100, 100, 80),
      },
      cameraBoundary: { point: { x: 100, y: 100 }, normal: { x: 0, y: 1 } },
      corridorConfirmed: true,
    });
    await expect(
      f.runtime.collectAutomaticPoints(
        { ...f.binding, cameraId: 'cam' },
        async (host) => {
          await host.preflight!([pose(100, 50, 80), pose(100, 101, 80)]);
          await host.move(pose(100, 50, 80));
        },
      ),
    ).rejects.toMatchObject({ code: 'CAMERA_BOUNDARY_EXCEEDED' });
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    await f.cleanup();
  }
});

it('keeps drag mode while capturing a persistent two-point draft and saves only the current confirmed draft', async () => {
  const f = await fixture();
  try {
    const binding = { ...f.binding, cameraId: 'cam' };
    await f.runtime.enterDragMode(binding);
    const reference = await f.runtime.captureInstallationPoint(
      binding,
      'reference',
    );
    expect((await f.runtime.state()).state.dragMode).toBe(true);
    expect(reference.poses.reference?.positionMm).toEqual({
      x: 100,
      y: -50,
      z: 100,
    });
    f.adapter.setPoseForTesting(pose(100, 20, 100));
    const boundary = await f.runtime.captureInstallationPoint(
      binding,
      'cameraBoundary',
    );
    expect((await f.runtime.state()).state.dragMode).toBe(true);
    const reloaded = new ProfileStore(f.store.filePath);
    await reloaded.load();
    expect(reloaded.list().installationTeachingDrafts?.[0].id).toBe(
      boundary.id,
    );
    await f.runtime.exitDragMode();
    await expect(
      f.runtime.teachInstallation({
        binding,
        draftId: reference.id,
        corridorConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
    await expect(
      f.runtime.teachInstallation({
        binding,
        draftId: boundary.id,
        corridorConfirmed: false,
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    const saved = await f.runtime.teachInstallation({
      binding,
      draftId: boundary.id,
      corridorConfirmed: true,
    });
    expect(saved.cameraBoundary.normal).toEqual({ x: 0, y: 1 });
    expect(saved.referenceDeviceId).toBe(f.screen.id);
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    await f.cleanup();
  }
});
it('can confirm Drag exit after Stop while retaining the explicit recovery gate', async () => {
  const f = await fixture();
  try {
    await f.runtime.enterDragMode(f.binding);
    await f.runtime.stop();
    await f.runtime.exitDragMode();
    const state = await f.runtime.state(undefined, { fresh: true });
    expect(state.state.dragMode).toBe(false);
    expect(state.recoveryRequired).toBe(true);
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    await f.cleanup();
  }
});
