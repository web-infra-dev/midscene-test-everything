import { expect, it, rstest } from '@rstest/core';
import {
  type CameraSession,
  CameraSessionManager,
} from '../src/camera/session.js';
import { RobotArmError } from '../src/contracts.js';
import { controllerRuntime } from '../src/controller-runtime.js';
import { ArmController } from '../src/controller.js';
import { RobotArmDevice } from '../src/device.js';
import { RobotDriverBoundary } from '../src/kernel/driver-boundary.js';
import { fixture, pose } from './fixtures.js';

async function setup(sharedObservation = false) {
  const f = await fixture(4, 30);
  await f.runtime.shutdown();
  const screenB = await f.store.putScreen({
    ...f.screen,
    id: 'screen-b',
    name: 'B',
  });
  const calibrationB = {
    ...f.calibration,
    id: 'calibration-b',
    screenProfileId: screenB.id,
    screenGeometryRevision: screenB.geometryRevision,
    screenRevision: screenB.revision,
    origin: { ...f.calibration.origin, x: f.calibration.origin.x + 300 },
    observationPose: sharedObservation
      ? f.calibration.observationPose
      : pose(400, -50, 100),
  };
  await f.store.saveCalibration(calibrationB);
  const vision = (id: string) => ({
    cameraId: id,
    cameraName: id,
    perspectiveProfileKey: 'p',
    fingerprint: 'f',
    width: 1000,
    height: 500,
  });
  for (const [id, calibration] of [
    ['a', f.calibration],
    ['b', calibrationB],
  ] as const)
    await f.store.acceptDeviceBinding({
      ...calibration,
      deviceId: id,
      cameraId: id,
      calibrationProfileId: calibration.id,
      revision: 0,
      vision: { ...vision(id), confirmedAt: new Date().toISOString() },
    });
  class Cameras extends CameraSessionManager {
    override async acquire(id: string) {
      return {
        binding: async () => vision(id),
        snapshot: async () => ({
          base64: 'aW1hZ2U=',
          width: 1000,
          height: 500,
          binding: vision(id),
        }),
      } as unknown as CameraSession;
    }
    override async release() {}
  }
  const arm = new ArmController({ adapter: f.adapter, profileStore: f.store });
  await arm.connect();
  await controllerRuntime(arm).lifecycle('enable');
  const cameraManager = new Cameras();
  const a = new RobotArmDevice({ arm, camera: 'a', cameraManager });
  const b = new RobotArmDevice({ arm, camera: 'b', cameraManager });
  const tap = (device: RobotArmDevice) =>
    device.perform({ type: 'tap', point: { x: 500, y: 250 } });
  return {
    ...f,
    arm,
    a,
    b,
    tap,
    calibrationB,
    cleanup: async () => {
      await Promise.allSettled([a.destroy(), b.destroy()]);
      await arm.close();
      await f.cleanup();
      rstest.restoreAllMocks();
    },
  };
}

it('switches a completed batch at the shared observation pose without separate transfer moves', async () => {
  const f = await setup(true);
  try {
    controllerRuntime(f.arm).batchTransferContext = () => ({
      id: 'batch',
      revision: 1,
      status: 'completed',
      currentIndex: 0,
      items: [],
      sharedSafePosition: f.calibration.observationPose,
      sharedSafePositionVerified: true,
    });
    await f.tap(f.a);
    const beforeSwitch = f.adapter.movements.length;
    await f.tap(f.b);
    const afterSwitch = f.adapter.movements.length;
    await f.tap(f.b);
    expect(f.adapter.movements.slice(beforeSwitch, afterSwitch)).toEqual(
      f.adapter.movements.slice(afterSwitch),
    );
  } finally {
    await f.cleanup();
  }
});

it('plans a lift and traverse inside a confirmed batch corridor', async () => {
  const f = await setup();
  try {
    controllerRuntime(f.arm).batchTransferContext = () => ({
      id: 'batch',
      revision: 1,
      status: 'completed',
      currentIndex: 0,
      items: [],
      transfer: {
        travelTipZMm: 120,
        highestObstacleZMm: 100,
        clearanceMm: 20,
        corridor: { minX: 90, maxX: 410, minY: -60, maxY: -40 },
        corridorConfirmed: true,
        waypoints: [],
      },
    });
    await f.tap(f.a);
    const before = f.adapter.movements.length;
    await f.tap(f.b);
    expect(f.adapter.movements.slice(before, before + 4)).toEqual([
      f.calibration.observationPose,
      pose(100, -50, 120),
      pose(400, -50, 120),
      f.calibrationB.observationPose,
    ]);
  } finally {
    await f.cleanup();
  }
});

it('validates without moving and transfers before the destination action; reverse travel needs its own route', async () => {
  const f = await setup();
  try {
    await f.a.configureTransferTo(f.b, {
      confirmed: true,
      waypoints: [pose(250, -50, 120)],
    });
    expect(f.adapter.movements).toHaveLength(0);
    await f.tap(f.a);
    const before = f.adapter.movements.length;
    await f.tap(f.b);
    expect(f.adapter.movements.slice(before, before + 3)).toEqual([
      f.calibration.observationPose,
      pose(250, -50, 120),
      f.calibrationB.observationPose,
    ]);
    const after = f.adapter.movements.length;
    await expect(f.tap(f.a)).rejects.toMatchObject({
      code: 'TRANSFER_REQUIRED',
    });
    expect(f.adapter.movements).toHaveLength(after);
  } finally {
    await f.cleanup();
  }
});

it('requires corridor confirmation and rejects a waypoint below the screen plane', async () => {
  const f = await setup();
  try {
    await expect(
      f.a.configureTransferTo(f.b, { confirmed: false, waypoints: [] }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    await expect(
      f.a.configureTransferTo(f.b, {
        confirmed: true,
        waypoints: [pose(250, -50, 25)],
      }),
    ).rejects.toMatchObject({ code: 'UNSAFE_OBSERVATION' });
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    await f.cleanup();
  }
});

it('checks intermediate reachability even when both endpoints are reachable', async () => {
  const f = await setup();
  const preflight = RobotDriverBoundary.prototype.preflightCartesian;
  try {
    rstest
      .spyOn(RobotDriverBoundary.prototype, 'preflightCartesian')
      .mockImplementation(async function (...args) {
        if (args[1].positionMm.x > 245 && args[1].positionMm.x < 255)
          throw new RobotArmError(
            'UNREACHABLE',
            'Interior of route is unreachable',
          );
        return preflight.apply(this, args);
      });
    await expect(
      f.a.configureTransferTo(f.b, { confirmed: true, waypoints: [] }),
    ).rejects.toMatchObject({ code: 'UNREACHABLE' });
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    await f.cleanup();
  }
});

it('rejects an old route after a saved safe position changes without moving', async () => {
  const f = await setup();
  try {
    await f.a.configureTransferTo(f.b, { confirmed: true, waypoints: [] });
    await f.tap(f.a);
    await f.store.saveCalibration({
      ...f.calibration,
      revision: 2,
      observationPose: pose(100, -50, 110),
    });
    const before = f.adapter.movements.length;
    await expect(f.tap(f.b)).rejects.toMatchObject({ code: 'TRANSFER_STALE' });
    expect(f.adapter.movements).toHaveLength(before);
  } finally {
    await f.cleanup();
  }
});

it('stops a cancelled transfer without lifting against destination geometry, and blocks subsequent actions', async () => {
  const f = await setup();
  try {
    await f.a.configureTransferTo(f.b, { confirmed: true, waypoints: [] });
    await f.tap(f.a);
    const before = f.adapter.movements.length;
    const action = f.tap(f.b);
    const outcome = action.catch((error) => error);
    await rstest.waitFor(
      () => expect(f.adapter.movements.length).toBeGreaterThan(before),
      { interval: 1 },
    );
    await f.b.destroy();
    expect(await outcome).toMatchObject({
      details: { recoveryRequired: true },
    });
    expect(f.adapter.movements.slice(before)).toEqual([
      f.calibration.observationPose,
    ]);
    expect((await f.arm.getStatus()).recoveryRequired).toBe(false);
    await expect(f.tap(f.a)).rejects.toMatchObject({
      code: 'POSITION_UNKNOWN',
    });
  } finally {
    await f.cleanup();
  }
});

it('rejects an invalid destination gesture before beginning its transfer', async () => {
  const f = await setup();
  try {
    await f.a.configureTransferTo(f.b, { confirmed: true, waypoints: [] });
    await f.tap(f.a);
    const before = f.adapter.movements.length;
    await expect(
      f.b.perform({ type: 'tap', point: { x: 99999, y: 0 } }),
    ).rejects.toThrow();
    expect(f.adapter.movements).toHaveLength(before);
  } finally {
    await f.cleanup();
  }
});

it('refuses an unconfirmed approach corridor after the arm was moved away from the source safe position', async () => {
  const f = await setup();
  try {
    await f.a.configureTransferTo(f.b, { confirmed: true, waypoints: [] });
    await f.tap(f.a);
    f.adapter.setPoseForTesting(pose(-200, -50, 100));
    const before = f.adapter.movements.length;
    await expect(f.tap(f.b)).rejects.toMatchObject({
      code: 'TRANSFER_START_CHANGED',
    });
    expect(f.adapter.movements).toHaveLength(before);
    await expect(f.tap(f.a)).rejects.toMatchObject({
      code: 'POSITION_UNKNOWN',
    });
  } finally {
    await f.cleanup();
  }
});

it('serializes concurrent actions across both verified directions', async () => {
  const f = await setup();
  try {
    await f.a.configureTransferTo(f.b, { confirmed: true, waypoints: [] });
    await f.b.configureTransferTo(f.a, { confirmed: true, waypoints: [] });
    await Promise.all([f.tap(f.a), f.tap(f.b), f.tap(f.a)]);
    expect(f.adapter.movements.at(-1)).toEqual(f.calibration.observationPose);
    expect(f.adapter.movements).toContainEqual(f.calibrationB.observationPose);
    expect(f.arm.current()?.status).toBe('completed');
  } finally {
    await f.cleanup();
  }
});

it('cancels queued route registration when its destination is destroyed', async () => {
  const f = await setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = f.arm.calibrateForDevice('other-owner', async () => {
    await gate;
    return f.calibration;
  });
  const configured = rstest.spyOn(f.arm, 'configureTransfer');
  try {
    const route = f.a
      .configureTransferTo(f.b, { confirmed: true, waypoints: [] })
      .then(
        () => undefined,
        (error) => error,
      );
    await rstest.waitFor(() => expect(configured).toHaveBeenCalled());
    await f.b.destroy();
    expect((await route)?.message).toBe('Device work cancelled');
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    release();
    await held;
    await f.cleanup();
  }
});

it('rejects calibration revisions changed while route verification was queued', async () => {
  const f = await setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = f.arm.calibrateForDevice('other-owner', async () => {
    await gate;
    return f.calibration;
  });
  const configured = rstest.spyOn(f.arm, 'configureTransfer');
  try {
    const route = f.a
      .configureTransferTo(f.b, { confirmed: true, waypoints: [] })
      .catch((error) => error);
    await rstest.waitFor(() => expect(configured).toHaveBeenCalled());
    await f.store.saveCalibration({
      ...f.calibration,
      revision: f.calibration.revision + 1,
    });
    release();
    await held;
    expect(await route).toMatchObject({ code: 'TRANSFER_STALE' });
    expect(f.arm.transferRoutes()).toEqual([]);
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    release();
    await held;
    await f.cleanup();
  }
});
