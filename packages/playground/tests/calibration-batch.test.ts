import type { ArmController } from '@midscene/arm-kit';
import { RobotArmError } from '@midscene/arm-kit';
import { ArmActionQueue } from '@midscene/arm-kit/internal/action-queue';
import { registerControllerRuntime } from '@midscene/arm-kit/internal/controller-runtime';
import { fixture, pose } from '@midscene/arm-kit/internal/testkit/fixtures';
import type { AssistedCalibrationState } from '@midscene/robotics-shared/assisted-contracts';
import { afterEach, expect, it, rstest } from '@rstest/core';
import { CalibrationBatch } from '../src/server/calibration-batch.js';
import type { PlaygroundDevices } from '../src/server/devices.js';
import { ScreenControl } from '../src/server/screen-control.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup() {
  const f = await fixture();
  const queue = new ArmActionQueue();
  const arm = {
    calibrationBatchForDevices: (
      id: string,
      work: (signal: AbortSignal) => Promise<unknown>,
      signal: AbortSignal,
    ) => queue.enqueue(id, work, signal),
  } as unknown as ArmController;
  registerControllerRuntime(arm, f.runtime);
  await f.store.saveCalibrationSetup({
    deviceId: 'one',
    cameraId: 'cam',
    ...f.binding,
    width: 1000,
    height: 500,
    autoOutput: true,
  });
  await f.store.saveInstallationTeaching({
    id: 'mount',
    robotProfileId: f.robot.id,
    toolProfileId: f.tool.id,
    cameraId: 'cam',
    referenceDeviceId: 'one',
    robotGeometryRevision: f.robot.geometryRevision,
    toolGeometryRevision: f.tool.geometryRevision,
    recordedAt: new Date().toISOString(),
    referencePose: pose(100, -50, 100),
    poses: {
      reference: pose(100, -50, 100),
      cameraBoundary: pose(100, 100, 100),
    },
    cameraBoundary: { point: { x: 100, y: 100 }, normal: { x: 0, y: 1 } },
    corridorConfirmed: true,
  });
  const sessions = new Map<string, AssistedCalibrationState | null>();
  const starts: string[] = [];
  const stops: string[] = [];
  const entries = new Map();
  for (const [index, id] of ['one', 'two'].entries()) {
    await f.store.saveScreenTarget({ id, name: id, cameraId: 'cam' });
    const host = {
      alignForBatch: rstest.fn(async () => {}),
      service: {
        status: () => sessions.get(id),
        setup: () => ({ prepared: true, phoneConnected: true, mapping: {} }),
        create: async () => {
          const state = {
            id: `${id}-${starts.length}`,
            stage: 'ready',
            referencePosition: pose(100, -50, 100),
          } as AssistedCalibrationState;
          sessions.set(id, state);
          starts.push(id);
          return state;
        },
        setBatchTravelHeight: rstest.fn(),
        setBatchParking: rstest.fn(),
        setBatchReference: rstest.fn(),
        command: rstest.fn(async (_id: string, command: string) => {
          if (command === 'accept') complete(id);
          else sessions.set(id, { ...sessions.get(id)!, stage: 'review' });
        }),
        acceptAutomatically: rstest.fn(async () => ({
          accepted: false,
          reasons: ['Review the result'],
        })),
        stop: async () => {
          stops.push(id);
          sessions.set(id, { ...sessions.get(id)!, stage: 'cancelled' });
        },
      },
    };
    entries.set(id, {
      host,
      camera: {
        isBindingCurrent: () => true,
        assertPerspectiveCurrent: rstest.fn(async () => {}),
        getCorrection: () => ({
          points: {
            topLeft: { x: index * 500, y: 0 },
            topRight: { x: index * 500 + 400, y: 0 },
            bottomRight: { x: index * 500 + 400, y: 800 },
            bottomLeft: { x: index * 500, y: 800 },
          },
          sourceWidth: 1000,
          sourceHeight: 900,
          rotation: 0,
        }),
      },
    });
  }
  const devices = {
    arm,
    entries,
    screens: () => f.store.list().screenTargets!,
    ensureHost: async (id: string) => entries.get(id).host,
  } as unknown as PlaygroundDevices;
  const batch = new CalibrationBatch(devices);
  rstest.spyOn(f.runtime, 'parkScreenGroup').mockImplementation(async () => {
    expect(batch.read()?.automaticSharedParking).toBe(true);
    return {
      pose: f.calibration.observationPose,
      visibility: {
        clear: true,
        checkedAt: new Date().toISOString(),
        screens: ['one', 'two'].map((id) => ({
          id,
          visibleFraction: 1,
          minimumTileFraction: 1,
        })),
      },
    };
  });
  cleanups.push(async () => {
    await batch.close();
    await queue.close();
    await f.cleanup();
  });
  const complete = (id: string) =>
    sessions.set(id, {
      ...sessions.get(id)!,
      stage: 'completed',
      result: { ...f.calibration, id: `saved-${id}` },
    });
  const start = async (acceptance: 'manual' | 'automatic' = 'manual') => {
    const plan = await batch.plan('cam');
    return batch.start({
      cameraId: 'cam',
      planVersion: plan.version,
      horizontalConfirmed: true,
      acceptance,
    });
  };
  return {
    ...f,
    batch,
    devices,
    sessions,
    complete,
    starts,
    stops,
    start,
    queue,
    entries,
  };
}
it('reads saved screen status without opening a calibration host', async () => {
  const f = await setup();
  f.entries.get('one').host = undefined;
  const ensureHost = rstest.spyOn(f.devices, 'ensureHost');
  try {
    expect(f.batch.screens('cam')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          screenId: 'one',
          ready: false,
          status: 'mapping-required',
        }),
      ]),
    );
    expect(ensureHost).not.toHaveBeenCalled();
  } finally {
    ensureHost.mockRestore();
  }
});

it('uses the active screen tool after the camera default screen is archived', async () => {
  const f = await setup();
  const oldTool = await f.store.putTool({ ...f.tool, id: 'old-tool' });
  await f.store.saveScreenTarget({
    id: 'cam',
    cameraId: 'cam',
    name: 'Old screen',
  });
  await f.store.saveCalibrationSetup({
    ...f.store.calibrationSetup('one')!,
    deviceId: 'cam',
    toolProfileId: oldTool.id,
  });
  await f.store.archiveScreenTarget('cam');
  await f.store.acceptDeviceBinding({
    deviceId: 'one',
    cameraId: 'cam',
    ...f.binding,
    calibrationProfileId: f.calibration.id,
    revision: 0,
    vision: f.store.list().workstation!.vision!,
  });
  expect(f.batch.screens('cam')).toMatchObject([
    {
      screenId: 'one',
      status: 'ready',
      calibrationProfileId: f.calibration.id,
    },
    { screenId: 'two', status: 'calibration-required' },
  ]);
  expect((await f.batch.plan('cam')).screens).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ screenId: 'one', calibrated: true }),
    ]),
  );
});

it('rejects an unconfirmed tool payload before creating a batch or starting sampling', async () => {
  const f = await setup();
  const check = rstest
    .spyOn(f.runtime, 'assertCalibrationMotionReady')
    .mockRejectedValueOnce(
      new RobotArmError(
        'TOOL_PAYLOAD_NOT_APPLIED',
        'Tool payload is unconfirmed',
        409,
      ),
    );
  try {
    await expect(f.start()).rejects.toMatchObject({
      code: 'TOOL_PAYLOAD_NOT_APPLIED',
    });
    expect(f.batch.read()).toBeNull();
    expect(f.starts).toHaveLength(0);
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    check.mockRestore();
  }
});

it('holds the shared queue while waiting for acceptance and retains completed screen results', async () => {
  const f = await setup();
  await f.start();
  await rstest.waitFor(() =>
    expect(f.batch.read()?.items[0].status).toBe('awaiting-acceptance'),
  );
  expect(f.starts).toEqual(['one']);
  let otherRan = false;
  const other = f.queue.enqueue('other-device', async () => {
    otherRan = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(otherRan).toBe(false);
  f.complete('one');
  await rstest.waitFor(() =>
    expect(f.batch.read()?.items[1].status).toBe('awaiting-acceptance'),
  );
  expect(f.batch.read()?.items[0].calibrationProfileId).toBe('saved-one');
  f.complete('two');
  await rstest.waitFor(() => expect(f.batch.read()?.status).toBe('completed'));
  await other;
  expect(
    f.batch.read()?.items.map((item) => item.calibrationProfileId),
  ).toEqual(['saved-one', 'saved-two']);
  expect(f.store.list().calibrationBatch?.items[0].runIds).toHaveLength(1);
  expect(f.adapter.movements).toHaveLength(0);
});
it('rejects stale commands, retries only the failed screen and stops its current run', async () => {
  const f = await setup();
  await f.start();
  await rstest.waitFor(() =>
    expect(f.batch.read()?.items[0].status).toBe('awaiting-acceptance'),
  );
  f.complete('one');
  await rstest.waitFor(() =>
    expect(f.batch.read()?.items[1].status).toBe('awaiting-acceptance'),
  );
  f.sessions.set('two', {
    ...f.sessions.get('two')!,
    stage: 'interrupted',
    error: 'phone lost',
  });
  await rstest.waitFor(() => expect(f.batch.read()?.status).toBe('failed'));
  await expect(f.batch.command(0, 'retry')).rejects.toMatchObject({
    code: 'STALE_CONTEXT',
  });
  Object.assign(f.devices, { hasActiveScreenCalibration: true });
  await expect(
    f.batch.command(f.batch.read()!.revision, 'retry'),
  ).rejects.toMatchObject({ code: 'BUSY' });
  expect(f.batch.read()?.status).toBe('failed');
  Object.assign(f.devices, { hasActiveScreenCalibration: false });
  await f.batch.command(f.batch.read()!.revision, 'retry');
  await rstest.waitFor(() => expect(f.starts).toEqual(['one', 'two', 'two']));
  await f.batch.command(f.batch.read()!.revision, 'stop');
  expect(f.batch.read()?.status).toBe('stopped');
  expect(f.batch.read()?.items[0].calibrationProfileId).toBe('saved-one');
  expect(f.stops).toContain('two');
});

it('continues boundary review on the same samples and screen before batch acceptance', async () => {
  const f = await setup();
  const service = f.entries.get('one').host.service;
  service.command.mockImplementationOnce(async () => {
    f.sessions.set('one', {
      ...f.sessions.get('one')!,
      stage: 'boundary-review',
    });
  });
  await f.start('automatic');
  await rstest.waitFor(() =>
    expect(f.batch.read()?.items[0].status).toBe('awaiting-boundary-review'),
  );
  expect(service.acceptAutomatically).not.toHaveBeenCalled();
  const id = f.sessions.get('one')!.id;
  await f.batch.command(f.batch.read()!.revision, 'continue');
  expect(service.command).toHaveBeenCalledWith(id, 'verify-boundary', true);
  await rstest.waitFor(() =>
    expect(f.batch.read()?.items[0].status).toBe('awaiting-acceptance'),
  );
  expect(f.starts).toEqual(['one']);
  expect(f.batch.read()?.items[0].runIds).toEqual([id]);
});
it('requires the reviewed plan and operator confirmation before reserving the queue', async () => {
  const f = await setup();
  const plan = await f.batch.plan('cam');
  await expect(
    f.batch.start({
      cameraId: 'cam',
      planVersion: plan.version,
      horizontalConfirmed: false,
    }),
  ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
  await f.store.updateScreenTarget('two', { name: 'Renamed' });
  await expect(
    f.batch.start({
      cameraId: 'cam',
      planVersion: plan.version,
      horizontalConfirmed: true,
    }),
  ).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
  expect(f.starts).toHaveLength(0);
});
it('falls back to operator acceptance when automatic evidence fails and preserves history after a restart', async () => {
  const f = await setup();
  await f.start('automatic');
  await rstest.waitFor(() =>
    expect(f.batch.read()?.items[0].status).toBe('awaiting-acceptance'),
  );
  expect(f.batch.read()?.items[0].note).toBe('Review the result');
  expect(
    f.entries.get('one').host.service.acceptAutomatically,
  ).toHaveBeenCalledTimes(1);
  const restored = new CalibrationBatch(f.devices);
  expect(restored.read()?.status).toBe('stopped');
  expect(restored.read()?.items[0].runIds).toHaveLength(1);
  expect(f.starts).toEqual(['one']);
  await f.batch.command(f.batch.read()!.revision, 'accept');
  await rstest.waitFor(() =>
    expect(f.batch.read()?.items[0].status).toBe('completed'),
  );
});
it('runs a fast batch with automatic acceptance and parks after both screens', async () => {
  const f = await setup();
  for (const id of ['one', 'two']) {
    f.entries
      .get(id)
      .host.service.acceptAutomatically.mockImplementation(async () => {
        expect(f.runtime.parkScreenGroup).not.toHaveBeenCalled();
        f.complete(id);
        return { accepted: true, reasons: [] };
      });
  }
  const plan = await f.batch.plan('cam');
  await f.batch.start({
    cameraId: 'cam',
    planVersion: plan.version,
    horizontalConfirmed: true,
    samplingMode: 'slide',
  });
  await rstest.waitFor(() => expect(f.batch.read()?.status).toBe('completed'));
  expect(f.batch.read()?.automaticSharedParking).toBeUndefined();
  expect(f.batch.read()?.sharedSafePosition).toEqual(
    f.calibration.observationPose,
  );
  for (const id of ['one', 'two'])
    expect(f.entries.get(id).host.service.command).toHaveBeenCalledWith(
      expect.any(String),
      'start-slide',
      true,
    );
  expect(
    f.entries.get('two').host.service.setBatchParking,
  ).toHaveBeenCalledWith(f.batch.read()?.id);
  expect(f.runtime.parkScreenGroup).toHaveBeenCalledTimes(1);
});
it('includes the measured start in the confirmed transfer corridor and invalidates a plan after repositioning', async () => {
  const f = await setup();
  const secondScreen = await f.store.putScreen({
    ...f.screen,
    id: 'second-screen',
    name: 'Second screen',
  });
  const secondCalibration = {
    ...f.calibration,
    id: 'second-calibration',
    screenProfileId: secondScreen.id,
    screenGeometryRevision: secondScreen.geometryRevision,
    screenRevision: secondScreen.revision,
    origin: { ...f.calibration.origin, x: f.calibration.origin.x + 300 },
  };
  await f.store.saveCalibration(secondCalibration);
  const vision = f.store.list().workstation!.vision!;
  for (const [deviceId, calibration] of [
    ['one', f.calibration],
    ['two', secondCalibration],
  ] as const) {
    await f.store.acceptDeviceBinding({
      deviceId,
      cameraId: 'cam',
      robotProfileId: f.robot.id,
      toolProfileId: f.tool.id,
      screenProfileId: calibration.screenProfileId,
      calibrationProfileId: calibration.id,
      revision: 0,
      vision,
    });
  }
  f.adapter.setPoseForTesting(pose(100, -180, 130));
  const plan = await f.batch.plan('cam');
  expect(plan.transfer).toBeDefined();
  expect(plan.transfer!.corridor.minY).toBeLessThanOrEqual(-180);
  expect(plan.transfer!.travelTipZMm).toBeGreaterThanOrEqual(130);
  f.adapter.setPoseForTesting(pose(100, -250, 130));
  await expect(
    f.batch.start({
      cameraId: 'cam',
      planVersion: plan.version,
      horizontalConfirmed: true,
      corridorConfirmed: true,
    }),
  ).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
  expect(f.adapter.movements).toHaveLength(0);
});
it('rejects retry after geometry changes and releases the per-batch travel floor on stop', async () => {
  const f = await setup();
  await f.start();
  await rstest.waitFor(() =>
    expect(f.batch.read()?.items[0].status).toBe('awaiting-acceptance'),
  );
  await f.batch.command(f.batch.read()!.revision, 'stop');
  expect(
    f.entries.get('one').host.service.setBatchTravelHeight,
  ).toHaveBeenLastCalledWith();
  await f.store.putTool({ ...f.tool, offsetMm: { x: 0, y: 0, z: -20 } });
  await expect(
    f.batch.command(f.batch.read()!.revision, 'retry'),
  ).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
  expect(f.starts).toEqual(['one']);
  expect(f.adapter.movements).toHaveLength(0);
});
it('honours Stop while a retry is waiting for motion readiness', async () => {
  const f = await setup();
  await f.start();
  await rstest.waitFor(() =>
    expect(f.batch.read()?.items[0].status).toBe('awaiting-acceptance'),
  );
  const stopped = (await f.batch.command(f.batch.read()!.revision, 'stop'))!;
  let resumeCheck!: () => void;
  const pausedCheck = new Promise<void>((resolve) => {
    resumeCheck = resolve;
  });
  const readiness = rstest
    .spyOn(f.runtime, 'assertCalibrationMotionReady')
    .mockImplementationOnce(async () => {
      await pausedCheck;
      return f.calibration.observationPose;
    });
  const retry = f.batch.command(stopped.revision, 'retry');
  try {
    await rstest.waitFor(() => expect(readiness).toHaveBeenCalled());
    expect(f.batch.active).toBe(true);
    await f.batch.command(stopped.revision, 'stop', stopped.id);
    resumeCheck();
    await expect(retry).rejects.toMatchObject({ code: 'STALE_CONTEXT' });
    expect(f.batch.read()?.status).toBe('stopped');
    expect(f.starts).toEqual(['one']);
  } finally {
    resumeCheck();
    readiness.mockRestore();
  }
});
it('restores the confirmed travel height after a stopped batch is loaded again', async () => {
  const f = await setup();
  const secondScreen = await f.store.putScreen({
    ...f.screen,
    id: 'second-screen',
    name: 'Second screen',
  });
  const secondCalibration = {
    ...f.calibration,
    id: 'second-calibration',
    screenProfileId: secondScreen.id,
    screenGeometryRevision: secondScreen.geometryRevision,
    screenRevision: secondScreen.revision,
    origin: { ...f.calibration.origin, x: f.calibration.origin.x + 300 },
  };
  await f.store.saveCalibration(secondCalibration);
  const vision = f.store.list().workstation!.vision!;
  for (const [deviceId, calibration] of [
    ['one', f.calibration],
    ['two', secondCalibration],
  ] as const)
    await f.store.acceptDeviceBinding({
      deviceId,
      cameraId: 'cam',
      robotProfileId: f.robot.id,
      toolProfileId: f.tool.id,
      screenProfileId: calibration.screenProfileId,
      calibrationProfileId: calibration.id,
      revision: 0,
      vision,
    });
  const plan = await f.batch.plan('cam');
  await f.batch.start({
    cameraId: 'cam',
    planVersion: plan.version,
    horizontalConfirmed: true,
    corridorConfirmed: true,
    acceptance: 'manual',
  });
  await rstest.waitFor(() =>
    expect(f.batch.read()?.items[0].status).toBe('awaiting-acceptance'),
  );
  await f.batch.command(f.batch.read()!.revision, 'stop');
  await f.runtime.recover();
  const restored = new CalibrationBatch(f.devices);
  try {
    expect(restored.read()?.transfer).toEqual(plan.transfer);
    await restored.command(restored.read()!.revision, 'retry');
    await rstest.waitFor(() =>
      expect(restored.read()?.items[0].status).toBe('awaiting-acceptance'),
    );
    expect(
      f.entries.get('one').host.service.setBatchTravelHeight,
    ).toHaveBeenLastCalledWith(plan.transfer!.travelTipZMm);
    expect(f.starts).toEqual(['one', 'one']);
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    await restored.close();
  }
});

it('honours a stale Stop command and exits standalone Drag Mode before releasing the queue', async () => {
  const f = await setup();
  await f.start();
  await rstest.waitFor(() =>
    expect(f.batch.read()?.items[0].status).toBe('awaiting-acceptance'),
  );
  await f.runtime.enterDragMode(f.binding);
  expect((await f.runtime.state()).state.dragMode).toBe(true);
  await f.batch.command(-100, 'stop', f.batch.read()!.id);
  expect(f.batch.read()?.status).toBe('stopped');
  expect((await f.runtime.state()).state.dragMode).toBe(false);
  expect(f.adapter.movements).toHaveLength(0);
});
it('cancels a queued batch without stopping the Device that currently owns the Controller', async () => {
  const f = await setup();
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const other = f.queue.enqueue('other-device', async () => {
    entered();
    await gate;
  });
  const stopping = rstest.spyOn(f.runtime, 'stop');
  try {
    await ready;
    await f.start();
    await f.batch.command(-100, 'stop', f.batch.read()!.id);
    expect(stopping).not.toHaveBeenCalled();
    expect(f.starts).toHaveLength(0);
    expect(f.batch.read()?.status).toBe('stopped');
  } finally {
    release();
    await other;
    stopping.mockRestore();
  }
});
it('does not estimate a new screen from an accepted calibration whose camera evidence is stale', async () => {
  const f = await setup();
  await f.store.acceptDeviceBinding({
    deviceId: 'one',
    cameraId: 'cam',
    ...f.binding,
    calibrationProfileId: f.calibration.id,
    revision: 0,
    vision: f.store.list().workstation!.vision!,
  });
  expect(
    (await f.batch.plan('cam')).screens.find((s) => s.screenId === 'one')
      ?.calibrated,
  ).toBe(true);
  const screens = f.devices.screens().map((screen) => ({
    ...screen,
    correction: f.entries.get(screen.id).camera.getCorrection(),
    perspectiveTarget: { width: 1000, height: 500, rotation: 0 as const },
  }));
  rstest.spyOn(f.devices, 'screens').mockReturnValue(screens);
  const control = new ScreenControl(f.devices, () => undefined);
  expect(control.screens().get('one')?.ready).toBe(true);
  f.entries.get('one').camera.isBindingCurrent = () => false;
  expect(control.screens().get('one')).toMatchObject({
    ready: false,
    reason: 'MAPPING_REQUIRED',
  });
  expect(
    f.batch.screens('cam').find((s) => s.screenId === 'one'),
  ).toMatchObject({
    ready: false,
    status: 'camera-mapping-changed',
  });
  const plan = await f.batch.plan('cam');
  expect(plan.screens.find((s) => s.screenId === 'one')).toMatchObject({
    calibrated: false,
    cameraMappingChanged: true,
  });
  expect(
    plan.screens.find((s) => s.screenId === 'two')?.expectedCenterMm,
  ).toBeUndefined();
  expect(f.adapter.movements).toHaveLength(0);
});

it('rejects a fresh plan when any screen outline has drifted without starting a calibration', async () => {
  const f = await setup();
  f.entries
    .get('two')
    .camera.assertPerspectiveCurrent.mockRejectedValue(
      new Error('screen two shifted'),
    );
  await expect(f.batch.plan('cam')).rejects.toThrow('screen two shifted');
  expect(f.starts).toHaveLength(0);
  expect(f.adapter.movements).toHaveLength(0);
});

it('checks outlines again after waiting for the Controller queue', async () => {
  const f = await setup();
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const owner = f.queue.enqueue('other', async () => {
    await gate;
  });
  try {
    await f.start();
    f.entries
      .get('two')
      .camera.assertPerspectiveCurrent.mockRejectedValue(
        new Error('screen shifted while queued'),
      );
    release();
    await owner;
    await rstest.waitFor(() => expect(f.batch.read()?.status).toBe('stopped'));
    expect(f.starts).toHaveLength(0);
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    release();
    await owner;
  }
});
