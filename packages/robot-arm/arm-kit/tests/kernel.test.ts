import { describe, expect, it, rstest } from '@rstest/core';
import {
  MotionExecutor,
  OperationCoordinator,
  type RobotArmAdapter,
  RobotKernel,
  validateMotionOptions,
} from '../src/kernel.js';
import { ProfileStore, RobotArmRuntime } from '../src/runtime.js';
import {
  stageOptions,
  validateContactPolicy,
} from '../src/screen-interaction/motion-policy.js';
import { planAction } from '../src/screen-interaction/planner.js';
import { createFakeAdapter, runAdapterConformance } from '../src/testkit.js';
import { fixture, pose } from './fixtures.js';

describe('versioned vendor-neutral kernel', () => {
  it('rejects malformed native diagnostics instead of returning an empty state', async () => {
    const fake = createFakeAdapter();
    const adapter: RobotArmAdapter = {
      ...fake,
      driver: {
        ...fake.driver,
        readControllerState: async () => ({
          vendor: 'sample',
          receivedAt: 'invalid',
          raw: {},
        }),
      },
    };
    await expect(
      new RobotKernel(adapter).controllerState(),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
  it('recovers on healthy channels without connecting again', async () => {
    const fake = createFakeAdapter({ jointOnly: true });
    const connect = rstest.spyOn(fake.driver, 'connect');
    const kernel = new RobotKernel(fake);
    await kernel.connect();
    await kernel.enable();
    await kernel.stop();
    await kernel.recover();
    expect(connect).toHaveBeenCalledTimes(1);
    expect((await kernel.readiness()).ready).toBe(true);
  });
  it('does not recover unknown enablement by filtering NOT_ENABLED', async () => {
    const fake = createFakeAdapter({ jointOnly: true });
    const kernel = new RobotKernel(fake);
    await kernel.connect();
    const read = fake.driver.getState.bind(fake.driver);
    rstest
      .spyOn(fake.driver, 'getState')
      .mockImplementation(async (options) => ({
        ...(await read(options)),
        enablement: 'unknown',
      }));
    await expect(kernel.recover()).rejects.toMatchObject({
      code: 'RECOVERY_REQUIRED',
      details: { reasons: expect.arrayContaining(['ENABLEMENT_UNKNOWN']) },
    });
  });
  for (const jointCount of [3, 4, 6, 7])
    it(`uses capabilities rather than ${jointCount} joints to select screen support`, async () => {
      const fake = createFakeAdapter({
        jointCount,
        orientation: jointCount === 3 ? 'fixed' : 'full',
        drag: false,
      });
      const runtime = new RobotArmRuntime({ adapter: fake });
      expect(runtime.describeCapabilities().screenActions).toContain('tap');
      expect(runtime.describeCapabilities().jointCount).toBe(jointCount);
      expect(runtime.describeCapabilities().dragMode).toBe(false);
    });
  it('connects a joint-only adapter without requiring Cartesian or Drag capabilities', async () => {
    const fake = createFakeAdapter({ jointOnly: true });
    const runtime = new RobotArmRuntime({ adapter: fake });
    expect(runtime.describeCapabilities().screenActions).toEqual([]);
    const report = await runAdapterConformance(fake, {
      allowConnect: true,
      allowMotion: true,
      jointTarget: Array(7).fill(1),
    });
    expect(report.checks).toContain('moveJoints');
    expect(report.checks).not.toContain('moveLinear');
  });
  it('conformance supports physical speed only and skips unadvertised PTP', async () => {
    const fake = createFakeAdapter({
      physicalSpeedOnly: true,
      linearOnly: true,
    });
    const report = await runAdapterConformance(fake, {
      allowConnect: true,
      allowMotion: true,
      target: pose(1, 2, 100),
    });
    expect(report.checks).toContain('moveLinear');
    expect(report.checks).not.toContain('movePtp');
  });
  it('rejects incomplete paired driver methods and motion without limits', () => {
    const fake = createFakeAdapter();
    expect(
      () =>
        new RobotKernel({
          ...fake,
          driver: { ...fake.driver, resume: undefined },
        }),
    ).toThrow(/Missing driver methods/);
    expect(() => new RobotKernel({ ...fake, motionLimits: {} })).toThrow(
      /motion constraints/,
    );
    expect(
      () =>
        new RobotKernel({
          ...fake,
          contractVersion: 999,
        } as unknown as RobotArmAdapter),
    ).toThrow(/contractVersion/);
  });
  it('blocks unknown mandatory safety, stale samples and unsupported speed units', async () => {
    const fake = createFakeAdapter({ physicalSpeedOnly: true });
    const kernel = new RobotKernel(fake);
    await kernel.connect();
    await kernel.enable();
    fake.unknownRequiredSafety = true;
    expect((await kernel.readiness()).ready).toBe(false);
    fake.unknownRequiredSafety = false;
    fake.staleSamples = true;
    await expect(kernel.getPose()).rejects.toMatchObject({
      code: 'STATE_STALE',
    });
    fake.staleSamples = false;
    await expect(
      kernel.moveLinear(pose(), { speed: { kind: 'ratio', value: 0.1 } }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_MOTION_PARAMETER' });
    expect(fake.submissions).toHaveLength(0);
    await kernel.disconnect();
  });
  it('never counts repeated pose frames toward stationary arrival', async () => {
    const fake = createFakeAdapter();
    const kernel = new RobotKernel(fake);
    await kernel.connect();
    await kernel.enable();
    fake.repeatedSamples = true;
    const executor = new MotionExecutor(kernel);
    await expect(
      executor.stable(
        pose(0, 0, 100),
        120,
        () => {},
        (ms) => new Promise((r) => setTimeout(r, ms)),
      ),
    ).rejects.toMatchObject({ code: 'POSE_UNSTABLE' });
    await kernel.disconnect();
  });
  it('validates arbitrary joint vectors, units and explicit bounds', () => {
    const constraints = {
      speed: { joints: { min: 0.1, max: 10 } },
      acceleration: { joints: { min: 0.1, max: 20 } },
    };
    expect(() =>
      validateMotionOptions(
        { speed: { kind: 'joints', valuesPerSecond: Array(7).fill(1) } },
        constraints,
        7,
      ),
    ).not.toThrow();
    expect(() =>
      validateMotionOptions(
        { speed: { kind: 'joints', valuesPerSecond: [1, 2] } },
        constraints,
        7,
      ),
    ).toThrow();
  });
  it('bounds the arrival samples a contact move may ask for', () => {
    const constraints = {
      speed: { ratio: { min: 0.001, max: 1 } },
      acceleration: { ratio: { min: 0.001, max: 1 } },
    };
    const options = (arrivalSamples: number) => ({
      speed: { kind: 'ratio' as const, value: 0.1 },
      acceleration: { kind: 'ratio' as const, value: 0.1 },
      arrivalSamples,
    });
    for (const accepted of [1, 2, 5])
      expect(() =>
        validateMotionOptions(options(accepted), constraints, 4),
      ).not.toThrow();
    // Zero samples is a request to skip arrival evidence and a large count is a
    // request to stretch a press, so both are refusals rather than clamps.
    for (const refused of [0, 6, 1.5])
      expect(() =>
        validateMotionOptions(options(refused), constraints, 4),
      ).toThrow(/arrivalSamples/);
  });
});

describe('operation safety arbitration', () => {
  class Coordinator extends OperationCoordinator {
    run(kind: 'stop' | 'pause' | 'emergencyStop', send: () => Promise<void>) {
      return this.safetyControl(kind, send);
    }
  }
  for (const kind of ['stop', 'pause'] as const)
    it(`dispatches emergency stop while ${kind} is pending`, async () => {
      const coordinator = new Coordinator();
      const calls: string[] = [];
      let finish!: () => void;
      const lower = coordinator.run(kind, () => {
        calls.push(kind);
        return new Promise<void>((r) => {
          finish = r;
        });
      });
      const emergency = coordinator.run('emergencyStop', async () => {
        calls.push('emergencyStop');
      });
      const duplicate = coordinator.run('emergencyStop', async () => {
        calls.push('duplicate');
      });
      expect(calls).toEqual([kind, 'emergencyStop']);
      finish();
      await Promise.all([lower, emergency, duplicate]);
    });
});

describe('SDK motion and application share one lease', () => {
  it('rejects SDK motion during calibration and stops a paused action without replay', async () => {
    const f = await fixture(7, 100);
    try {
      const session = await f.runtime.startCalibration(
        f.binding,
        f.calibration.id,
      );
      await expect(
        f.runtime.motion({
          requestId: 'busy',
          robotProfileId: f.robot.id,
          kind: 'linear',
          target: pose(100, -50, 100),
          options: { speed: { kind: 'ratio', value: 0.1 } },
          timeoutMs: 2000,
        }),
      ).rejects.toMatchObject({ code: 'BUSY' });
      await f.runtime.calibrationCommand(session.id, {
        commandId: 'cancel',
        expectedRevision: session.revision,
        type: 'cancel',
      });
      const moving = f.runtime.motion({
        requestId: 'moving',
        robotProfileId: f.robot.id,
        kind: 'linear',
        target: pose(150, -50, 100),
        options: { speed: { kind: 'ratio', value: 0.1 } },
        timeoutMs: 2000,
      });
      const rejected = expect(moving).rejects.toMatchObject({
        code: 'ACTION_STOPPED',
      });
      await new Promise((r) => setTimeout(r, 20));
      await f.runtime.pause();
      await rejected;
      const count = f.adapter.movements.length;
      await f.runtime.resume();
      expect(f.adapter.movements).toHaveLength(count);
      expect((await f.runtime.state()).recoveryRequired).toBe(false);
    } finally {
      await f.cleanup();
    }
  });
  it('single-step joint jog uses measured joints and honours limits', async () => {
    const f = await fixture(7);
    try {
      await f.runtime.motion({
        requestId: 'jog',
        robotProfileId: f.robot.id,
        kind: 'joint-jog',
        joint: 6,
        delta: 2,
        options: {
          speed: { kind: 'joints', valuesPerSecond: Array(7).fill(1) },
        },
        timeoutMs: 1000,
      });
      expect((await f.runtime.readJoints()).values[6]).toBe(2);
      await expect(
        f.runtime.motion({
          requestId: 'limit',
          robotProfileId: f.robot.id,
          kind: 'joint-jog',
          joint: 6,
          delta: 500,
          options: {
            speed: { kind: 'joints', valuesPerSecond: Array(7).fill(1) },
          },
          timeoutMs: 1000,
        }),
      ).rejects.toMatchObject({ code: 'JOINT_LIMIT' });
    } finally {
      await f.cleanup();
    }
  });
});

describe('restart and human verification gates', () => {
  it.each(['stop', 'emergencyStop'] as const)(
    'preserves the saved installation when %s precedes initialization',
    async (control) => {
      const f = await fixture();
      try {
        const restarted = new RobotArmRuntime({
          adapter: f.adapter,
          profileStore: new ProfileStore(f.store.filePath),
        });
        await restarted[control]();
        await restarted.initialize();
        expect(restarted.profileStore.getCalibration(f.calibration.id)).toEqual(
          f.calibration,
        );
        expect(restarted.profileStore.list().operatorStop).toBe(
          control === 'stop' ? 'manual-stop' : 'emergency-stop',
        );
      } finally {
        await f.cleanup();
      }
    },
  );

  it('checks a persisted unfinished operation before admitting new SDK motion', async () => {
    const f = await fixture();
    try {
      await f.store.markOperation('unfinished', 'motion');
      const restarted = new RobotArmRuntime({
        adapter: f.adapter,
        profileStore: f.store,
        auditStore: f.auditStore,
      });
      await restarted.initialize();
      expect(restarted.recoveryReason).toBeUndefined();
      expect(f.store.list().pendingOperation).toBeUndefined();
      await restarted.motion({
        requestId: 'restart',
        robotProfileId: f.robot.id,
        kind: 'linear',
        target: pose(),
        options: { speed: { kind: 'ratio', value: 0.1 } },
        timeoutMs: 2000,
      });
      expect(restarted.recoveryReason).toBeUndefined();
      expect(f.store.list().pendingOperation).toBeUndefined();
    } finally {
      await f.cleanup();
    }
  });
  it('checks fresh feedback on the next command after a fault clears without status polling', async () => {
    const f = await fixture();
    try {
      await f.adapter.faultForTesting();
      expect((await f.runtime.state()).recoveryReason).toBe('fault');
      await expect(f.runtime.enterDragMode()).rejects.toMatchObject({
        code: 'RECOVERY_REQUIRED',
      });
      await f.adapter.clearFaults();
      await f.runtime.enterDragMode();
      expect((await f.adapter.getState()).dragMode).toBe(true);
      await f.runtime.exitDragMode();
      expect(f.runtime.recoveryReason).toBeUndefined();
    } finally {
      await f.cleanup();
    }
  });

  it('retains an operator stop across restart and a healthy status refresh', async () => {
    const f = await fixture();
    try {
      await f.runtime.stop();
      const restarted = new RobotArmRuntime({
        adapter: f.adapter,
        profileStore: f.store,
      });
      await restarted.initialize();
      expect((await restarted.state()).recoveryReason).toBe('manual-stop');
      await expect(restarted.enterDragMode()).rejects.toMatchObject({
        code: 'RECOVERY_REQUIRED',
      });
      await restarted.recover();
      expect(f.store.list().operatorStop).toBeUndefined();
      expect((await restarted.state()).recoveryRequired).toBe(false);
      expect(f.adapter.movements).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  });

  it('requires explicit recovery after observing a hardware emergency stop, even across restart', async () => {
    const f = await fixture();
    try {
      const persist = rstest.spyOn(f.store, 'setOperatorStop');
      await f.adapter.emergencyStop();
      expect((await f.runtime.state()).requiresOperatorRecovery).toBe(true);
      await f.runtime.state();
      expect(persist).toHaveBeenCalledTimes(1);
      await f.adapter.clearFaults();
      expect((await f.runtime.state()).recoveryReason).toBe('emergency-stop');
      const restarted = new RobotArmRuntime({
        adapter: f.adapter,
        profileStore: new ProfileStore(f.store.filePath),
      });
      await restarted.initialize();
      await expect(restarted.enterDragMode()).rejects.toMatchObject({
        code: 'RECOVERY_REQUIRED',
      });
      expect((await restarted.state()).requiresOperatorRecovery).toBe(true);
      await restarted.recover();
      expect((await restarted.state()).recoveryRequired).toBe(false);
    } finally {
      await f.cleanup();
    }
  });

  it('a manual stop during automatic pose verification supersedes both the check and the waiting action', async () => {
    const f = await fixture();
    let finish!: () => void;
    try {
      await f.adapter.faultForTesting();
      expect((await f.runtime.state()).recoveryReason).toBe('fault');
      await expect(f.runtime.enterDragMode()).rejects.toMatchObject({
        code: 'RECOVERY_REQUIRED',
        details: { reasons: expect.arrayContaining(['ROBOT_FAULT']) },
      });
      await f.adapter.clearFaults();
      const read = f.adapter.getPose.bind(f.adapter);
      const posePending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const poseRead = rstest
        .spyOn(f.adapter, 'getPose')
        .mockImplementationOnce(async () => {
          await posePending;
          return read();
        });
      const polling = f.runtime.state();
      await rstest.waitFor(() => expect(poseRead).toHaveBeenCalledTimes(1));
      const action = expect(f.runtime.enterDragMode()).rejects.toMatchObject({
        code: 'RECOVERY_REQUIRED',
      });
      await f.runtime.stop();
      finish();
      await action;
      expect((await polling).recoveryReason).toBe('manual-stop');
      expect(f.store.list().operatorStop).toBe('manual-stop');
      expect((await f.adapter.getState()).dragMode).toBe(false);
      expect(f.adapter.movements).toHaveLength(0);
    } finally {
      finish?.();
      await f.cleanup();
    }
  });

  it('human rejection prevents activating an otherwise valid calibration', async () => {
    const f = await fixture();
    try {
      let session = await f.runtime.startCalibration(
        f.binding,
        f.calibration.id,
      );
      session = await f.runtime.calibrationCommand(session.id, {
        type: 'return-observation',
        accepted: true,
        commandId: crypto.randomUUID(),
        expectedRevision: session.revision,
      });
      session = await f.runtime.calibrationCommand(session.id, {
        commandId: 'hover',
        expectedRevision: session.revision,
        type: 'verify-hover-boundary',
      });
      expect(session.boundary.hoverCorners).toBe(true);
      session = await f.runtime.calibrationCommand(session.id, {
        commandId: 'reject',
        expectedRevision: session.revision,
        type: 'confirm-hover-boundary',
        accepted: false,
      });
      expect(session.boundary.hoverHuman).toBe(false);
      expect(session.boundary.hoverCorners).toBe(false);
      await expect(
        f.runtime.calibrationCommand(session.id, {
          commandId: 'activate',
          expectedRevision: session.revision,
          type: 'verify-web-target',
          point: { x: 100, y: 200 },
          accepted: true,
        }),
      ).rejects.toMatchObject({ code: 'HOVER_NOT_VERIFIED' });
    } finally {
      await f.cleanup();
    }
  });
});

describe('contact policy', () => {
  it('rejects below-minimum recovery instead of silently raising speed', async () => {
    const f = await fixture();
    try {
      const limits = {
        speed: { ratio: { min: 0.01, max: 1 } },
        acceleration: { ratio: { min: 0.01, max: 1 } },
      };
      const entry = stageOptions(f.screen, 'entry', limits, 4).speed!;
      expect(entry.kind).toBe('ratio');
      if (entry.kind === 'ratio') expect(entry.value).toBeCloseTo(0.02);
      expect(() =>
        validateContactPolicy(
          { ...f.screen, actionSpeed: { kind: 'ratio', value: 0.05 } },
          limits,
          4,
        ),
      ).toThrow();
      expect(
        planAction(
          { type: 'tap', point: { x: 500, y: 250 } },
          f.calibration,
          f.screen,
          f.tool,
          f.runtime.capabilities,
        ).holdMs,
      ).toBe(60);
      expect(
        planAction(
          { type: 'longPress', point: { x: 500, y: 250 } },
          f.calibration,
          f.screen,
          f.tool,
          f.runtime.capabilities,
        ).holdMs,
      ).toBe(800);
    } finally {
      await f.cleanup();
    }
  });
});

describe('public kernel owns its operation lease', () => {
  it('rejects another direct movement until the physical terminal sample is confirmed', async () => {
    const fake = createFakeAdapter({ motionDurationMs: 200 });
    const kernel = new RobotKernel(fake);
    try {
      await kernel.connect();
      await kernel.enable();
      const first = await kernel.moveLinear(pose(1, 2, 100), {
        speed: { kind: 'ratio', value: 0.1 },
      });
      await expect(
        kernel.moveJoints(Array(7).fill(1), {
          speed: { kind: 'ratio', value: 0.1 },
        }),
      ).rejects.toMatchObject({ code: 'BUSY' });
      await expect(first.wait({ timeoutMs: 1 })).rejects.toMatchObject({
        code: 'MOTION_TIMEOUT',
      });
      expect(fake.controls).not.toContain('stop');
      await first.wait({ timeoutMs: 1500 });
    } finally {
      await kernel.disconnect();
    }
  });
  it('direct Runtime kernel calls share the calibration lease', async () => {
    const f = await fixture();
    try {
      await f.runtime.startCalibration(f.binding, f.calibration.id);
      await expect(
        f.runtime.moveLinear(
          pose(),
          { speed: { kind: 'ratio', value: 0.1 } },
          f.robot.workspace,
        ),
      ).rejects.toMatchObject({ code: 'BUSY' });
    } finally {
      await f.cleanup();
    }
  });
  it('single-step Cartesian and joint jog use a fresh sampled origin', async () => {
    const fake = createFakeAdapter();
    const kernel = new RobotKernel(fake);
    try {
      await kernel.connect();
      await kernel.enable();
      await (
        await kernel.jog(
          'x',
          2,
          { speed: { kind: 'ratio', value: 0.1 } },
          fake.kinematics.workspace!,
        )
      ).wait({ timeoutMs: 1500 });
      expect((await kernel.readPose()).pose.positionMm.x).toBe(2);
      await (
        await kernel.jointJog(6, 3, { speed: { kind: 'ratio', value: 0.1 } })
      ).wait({ timeoutMs: 1500 });
      expect((await kernel.readJoints()).values[6]).toBe(3);
    } finally {
      await kernel.disconnect();
    }
  });
});

it('invalid single-step targets fail before submitting or issuing a physical stop', async () => {
  const fake = createFakeAdapter();
  const kernel = new RobotKernel(fake);
  try {
    await kernel.connect();
    await kernel.enable();
    await expect(
      kernel.jog(
        'x',
        2000,
        { speed: { kind: 'ratio', value: 0.1 } },
        fake.kinematics.workspace!,
      ),
    ).rejects.toMatchObject({ code: 'OUT_OF_RANGE' });
    expect(fake.submissions).toHaveLength(0);
    expect(fake.controls).not.toContain('stop');
  } finally {
    await kernel.disconnect();
  }
});
