import {
  type CartesianPose,
  type MotionOptions,
  type MotionResult,
  RobotArmError,
  type Workspace,
} from '../contracts.js';
import type { MotionHandle } from '../contracts.js';
import {
  assertPose,
  assertTarget,
  distance,
  quaternionDistance,
} from '../domain.js';
import type { LinearPreflightScope } from './contracts.js';
import type { RobotDriverBoundary } from './driver-boundary.js';

export interface ExecutionHooks {
  check(): void;
  signal?: AbortSignal;
  preflight?: LinearPreflightScope;
  accepting(promise: Promise<MotionHandle> | undefined): void;
  submitted(): void;
}
/** Completion and fresh-sample stability, independent of application geometry. */
export class MotionExecutor {
  constructor(
    private kernel: Pick<
      RobotDriverBoundary,
      'moveLinear' | 'assertReady' | 'readJoints' | 'status' | 'readPose'
    > & {
      validateCartesian(
        kind: 'linear' | 'ptp',
        pose: CartesianPose,
        options: MotionOptions,
        workspace?: Workspace,
      ): unknown;
    },
  ) {}
  async move(
    target: CartesianPose,
    workspace: Workspace | undefined,
    options: MotionOptions,
    timeoutMs: number,
    hooks: ExecutionHooks,
  ): Promise<MotionResult> {
    hooks.check();
    assertPose(target);
    if (workspace) assertTarget(target, workspace);
    this.kernel.validateCartesian('linear', target, options, workspace);
    hooks.submitted();
    const accepting = hooks.preflight
      ? this.kernel.moveLinear(target, options, workspace, hooks.preflight)
      : this.kernel.moveLinear(target, options, workspace);
    hooks.accepting(accepting);
    let handle: MotionHandle;
    try {
      handle = await accepting;
    } finally {
      hooks.accepting(undefined);
    }
    hooks.check();
    const result = await handle.wait({ timeoutMs, signal: hooks.signal });
    hooks.check();
    if (result.status !== 'completed')
      throw new RobotArmError(
        'MOTION_INTERRUPTED',
        'Motion did not complete',
        409,
        { result },
      );
    return result;
  }
  async stableJoints(
    target: number[],
    timeoutMs: number,
    check: () => void,
    hold: (ms: number) => Promise<void>,
  ): Promise<void> {
    const deadline = Date.now() + Math.min(timeoutMs, 5000);
    let previous: number[] | undefined;
    let previousId: string | undefined;
    let count = 0;
    while (Date.now() < deadline) {
      check();
      await this.kernel.assertReady();
      const sample = await this.kernel.readJoints();
      check();
      if (sample.sampleId !== previousId) {
        const close = sample.values.every(
          (v, i) => Math.abs(v - target[i]) <= 0.5,
        );
        const stationary =
          previous &&
          sample.values.every((v, i) => Math.abs(v - previous![i]) < 0.1);
        count = close && stationary ? count + 1 : 0;
        if (count >= 2) return;
        previous = sample.values;
        previousId = sample.sampleId;
      }
      await hold(50);
    }
    throw new RobotArmError(
      'JOINTS_UNSTABLE',
      'Fresh measured joint target did not stabilize',
      504,
    );
  }
  async stable(
    target: CartesianPose,
    timeoutMs: number,
    check: () => void,
    hold: (ms: number) => Promise<void>,
  ): Promise<CartesianPose> {
    const deadline = Date.now() + Math.min(timeoutMs, 5000);
    let previous: CartesianPose | undefined;
    let previousId: string | undefined;
    let count = 0;
    while (Date.now() < deadline) {
      check();
      const status = await this.kernel.status();
      if (status.connection !== 'connected' || status.faults.length)
        throw new RobotArmError(
          'ROBOT_FAULT',
          'Cannot confirm stable pose',
          409,
        );
      const sample = await this.kernel.readPose();
      check();
      if (sample.sampleId === previousId) {
        await hold(50);
        continue;
      }
      const pose = sample.pose;
      if (
        status.motion === 'idle' &&
        distance(pose.positionMm, target.positionMm) <= 0.5 &&
        quaternionDistance(pose.orientation, target.orientation) <= 0.01 &&
        previous &&
        distance(pose.positionMm, previous.positionMm) < 0.1 &&
        quaternionDistance(pose.orientation, previous.orientation) < 0.005
      )
        count++;
      else count = 0;
      if (count >= 2) return pose;
      previous = pose;
      previousId = sample.sampleId;
      await hold(50);
    }
    throw new RobotArmError(
      'POSE_UNSTABLE',
      'Fresh measured target pose did not stabilize',
      504,
    );
  }
}
