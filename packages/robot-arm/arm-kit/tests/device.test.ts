import { expect, it, rstest } from '@rstest/core';
import {
  type CameraSession,
  CameraSessionManager,
} from '../src/camera/session.js';
import { controllerRuntime } from '../src/controller-runtime.js';
import { ArmController } from '../src/controller.js';
import { RobotArmDevice } from '../src/device.js';
import { fixture } from './fixtures.js';
async function setup() {
  const f = await fixture();
  await f.runtime.shutdown();
  const arm = new ArmController({ adapter: f.adapter, profileStore: f.store });
  await arm.connect();
  await controllerRuntime(arm).lifecycle('enable');
  const vision = {
    cameraId: 'cam',
    cameraName: 'Camera',
    perspectiveProfileKey: 'p',
    fingerprint: 'f',
    width: 1000,
    height: 500,
  };
  await f.store.acceptDeviceBinding({
    ...f.binding,
    deviceId: 'cam',
    cameraId: 'cam',
    calibrationProfileId: f.calibration.id,
    revision: 0,
    vision: { ...vision, confirmedAt: new Date().toISOString() },
  });
  const owners = new Set<string>();
  const session = {
    binding: rstest.fn(async () => ({ ...vision })),
    snapshot: rstest.fn(async () => ({
      base64: 'aW1hZ2U=',
      width: 1000,
      height: 500,
      binding: { ...vision },
    })),
  } as unknown as CameraSession;
  class TestCameras extends CameraSessionManager {
    override async acquire(_camera: string, owner: string) {
      owners.add(owner);
      return session;
    }
    override async release(_camera: string, owner: string) {
      owners.delete(owner);
    }
  }
  const manager = new TestCameras();
  const devices: RobotArmDevice[] = [];
  const create = () => {
    const device = new RobotArmDevice({
      arm,
      camera: 'cam',
      cameraManager: manager,
    });
    devices.push(device);
    return device;
  };
  return {
    ...f,
    arm,
    vision,
    session,
    owners,
    create,
    dispose: async () => {
      await Promise.allSettled(devices.map((d) => d.destroy()));
      await arm.close();
      await f.cleanup();
    },
  };
}
it('exposes screenshots and real queued touch primitives through the public Device', async () => {
  const f = await setup();
  try {
    const device = f.create();
    await device.connect();
    expect(await device.size()).toEqual({ width: 1000, height: 500 });
    expect(await device.screenshotBase64()).toBe('aW1hZ2U=');
    await device.perform({ type: 'tap', point: { x: 500, y: 250 } });
    expect(f.adapter.movements.length).toBeGreaterThan(0);
  } finally {
    await f.dispose();
  }
});
it('performs a bounded screen action through the public Device', async () => {
  const f = await setup();
  try {
    const device = f.create();
    await device.connect();
    await expect(
      device.perform({ type: 'tap', point: { x: 500, y: 250 } }),
    ).resolves.toMatchObject({ action: 'tap' });
    await expect(
      device.perform({ type: 'tap', point: { x: 1001, y: 250 } }),
    ).rejects.toMatchObject({ code: 'INVALID_ACTION' });
    await expect(
      device.perform({
        type: 'swipe',
        from: { x: 200, y: 200 },
        to: { x: 200, y: 200 },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ACTION' });
    expect(f.adapter.movements.length).toBeGreaterThan(0);
  } finally {
    await f.dispose();
  }
});
it('releasing one Device leaves the shared arm and another Device usable', async () => {
  const f = await setup();
  try {
    const a = f.create();
    const b = f.create();
    await Promise.all([a.connect(), b.connect()]);
    expect(f.owners.size).toBe(2);
    await a.destroy();
    expect(f.owners.size).toBe(1);
    expect((await f.arm.getState()).connected).toBe(true);
    expect(await b.screenshotBase64()).toBe('aW1hZ2U=');
    await expect(a.connect()).rejects.toThrow('destroyed');
  } finally {
    await f.dispose();
  }
});
it('rejects changed correction after planning without moving the arm', async () => {
  const f = await setup();
  try {
    const device = f.create();
    await device.screenshotBase64();
    f.vision.fingerprint = 'changed';
    await expect(
      device.perform({ type: 'tap', point: { x: 500, y: 250 } }),
    ).rejects.toMatchObject({ code: 'EXECUTION_CONTEXT_CHANGED' });
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    await f.dispose();
  }
});
it('connects an uncalibrated camera but refuses Agent screenshots and actions', async () => {
  const f = await setup();
  try {
    f.vision.fingerprint = 'unmatched';
    const device = f.create();
    await device.connect();
    await expect(device.screenshotBase64()).rejects.toMatchObject({
      code: 'CALIBRATION_REQUIRED',
    });
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    await f.dispose();
  }
});

it('reports failed physical cancellation from destroy instead of silently resolving', async () => {
  const f = await setup();
  try {
    const device = f.create();
    const running = device
      .perform({
        type: 'longPress',
        point: { x: 500, y: 250 },
        durationMs: 1500,
      })
      .catch((error) => error);
    await rstest.waitFor(() =>
      expect(f.adapter.movements.length).toBeGreaterThan(0),
    );
    const stop = rstest
      .spyOn(f.adapter, 'stop')
      .mockRejectedValueOnce(new Error('Stop acknowledgement missing'));
    await expect(device.destroy()).rejects.toThrow(
      'Stop acknowledgement missing',
    );
    await running;
    expect(f.owners.size).toBe(0);
    stop.mockRestore();
  } finally {
    await f.dispose();
  }
});

it('enables from accepted Device geometry only after explicit confirmation', async () => {
  const f = await setup();
  try {
    const device = f.create();
    await controllerRuntime(f.arm).lifecycle('disable');
    const enable = rstest.spyOn(f.adapter, 'enable');
    await expect(device.enable({ confirmed: false })).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
    });
    expect(enable).not.toHaveBeenCalled();
    await device.enable({ confirmed: true });
    expect((await f.arm.getState()).enabled).toBe(true);
    expect(enable).toHaveBeenCalledTimes(1);
    expect(f.adapter.movements).toHaveLength(0);
    await controllerRuntime(f.arm).lifecycle('disable');
    f.vision.fingerprint = 'camera-was-adjusted';
    await expect(device.enable({ confirmed: true })).rejects.toMatchObject({
      code: 'EXECUTION_CONTEXT_CHANGED',
    });
    expect(enable).toHaveBeenCalledTimes(1);
  } finally {
    await f.dispose();
  }
});

it('does not enable after cancellation while waiting for shared arm work', async () => {
  const f = await setup();
  let release!: () => void;
  try {
    const device = f.create();
    const enable = rstest.spyOn(f.adapter, 'enable');
    const reservation = f.arm.calibrateForDevice('other-device', async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return f.calibration;
    });
    await rstest.waitFor(() => expect(release).toBeTypeOf('function'));
    const abort = new AbortController();
    const enabling = device.enable({ confirmed: true, signal: abort.signal });
    const rejected = expect(enabling).rejects.toBeDefined();
    abort.abort();
    await rejected;
    release();
    await reservation;
    expect(enable).not.toHaveBeenCalled();
  } finally {
    release?.();
    await f.dispose();
  }
});
it('updates only screen motion fields, preserves calibration and rejects stale edits', async () => {
  const f = await setup();
  try {
    const d = f.create();
    const before = await d.configuration();
    const saved = await d.updateMotionSettings({
      revision: before.screen.revision,
      contactMs: 80,
    });
    expect(saved.contactMs).toBe(80);
    expect((await d.configuration()).calibration.id).toBe(
      before.calibration.id,
    );
    expect(f.adapter.movements).toHaveLength(0);
    await expect(
      d.updateMotionSettings({
        revision: before.screen.revision,
        contactMs: 90,
      }),
    ).rejects.toThrow('changed');
    await expect(
      d.updateMotionSettings({ revision: saved.revision, pixelWidth: 12 }),
    ).rejects.toThrow('Only screen motion');
    await expect(
      d.updateMotionSettings({ revision: saved.revision, pressDepthMm: 100 }),
    ).rejects.toThrow();
    expect((await d.configuration()).screen.contactMs).toBe(80);
  } finally {
    await f.dispose();
  }
});
it('saves a negative press depth and places the tap target above the screen', async () => {
  const f = await setup();
  try {
    const device = f.create();
    await device.connect();
    const { screen, calibration } = await device.configuration();
    const saved = await device.updateMotionSettings({
      revision: screen.revision,
      pressDepthMm: -0.5,
    });
    await expect(
      device.updateMotionSettings({
        revision: saved.revision,
        safeHeightMm: 0.5,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PROFILE' });
    expect((await device.configuration()).screen.pressDepthMm).toBe(-0.5);
    await device.perform({ type: 'tap', point: { x: 500, y: 250 } });
    const lowestTargetZ = Math.min(
      ...f.adapter.movements.map((target) => target.positionMm.z),
    );
    expect(lowestTargetZ).toBeCloseTo(calibration.origin.z + 0.5);
  } finally {
    await f.dispose();
  }
});
it('safe position requires confirmation and current calibration; record does not move, return uses runtime checks', async () => {
  const f = await setup();
  try {
    const d = f.create();
    const before = await d.configuration();
    const input = {
      mode: 'record' as const,
      revision: before.calibration.revision,
      calibrationId: before.calibration.id,
      confirmed: true,
    };
    await expect(
      d.safePosition({ ...input, confirmed: false }),
    ).rejects.toThrow('Confirm');
    await expect(d.safePosition({ ...input, revision: 0 })).rejects.toThrow(
      'changed',
    );
    f.adapter.setPoseForTesting(before.calibration.observationPose);
    await d.safePosition(input);
    expect(f.adapter.movements).toHaveLength(0);
    const updated = await d.configuration();
    expect(updated.calibration.revision).toBeGreaterThan(
      before.calibration.revision,
    );
    await d.safePosition({
      ...input,
      mode: 'return',
      revision: updated.calibration.revision,
    });
    expect(f.adapter.movements.length).toBeGreaterThan(0);
    expect(() => f.arm.assertSafePositionTarget('another-screen')).toThrow(
      'active screen',
    );
  } finally {
    await f.dispose();
  }
});

it('allows screenshots and queued taps with previously recorded drift while detection is disabled', async () => {
  const f = await setup();
  try {
    const device = f.create();
    await device.screenshotBase64();
    Object.assign(f.vision, {
      validity: {
        state: 'invalid',
        reasonCode: 'SHIFTED',
        confidence: 'high',
        driftRatio: 0.02,
        checkedAt: new Date().toISOString(),
        ageMs: 0,
        expired: false,
      },
    });
    await device.screenshotBase64();
    await device.perform({ type: 'tap', point: { x: 500, y: 250 } });
    expect(f.adapter.movements.length).toBeGreaterThan(0);
    expect(f.vision.fingerprint).toBe('f');
  } finally {
    await f.dispose();
  }
});
