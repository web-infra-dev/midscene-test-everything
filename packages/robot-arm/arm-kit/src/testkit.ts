import type { Workspace } from './contracts.js';
import {
  type CartesianPose,
  type MotionOptions,
  type RobotArmAdapter,
  RobotArmError,
} from './contracts.js';
import { assertPose, distance, quaternionDistance } from './domain.js';
import { RobotKernel } from './kernel.js';
import {
  FakeAdapter,
  type FakeAdapterOptions,
} from './testkit/fake-adapter.js';
export interface ConformanceOptions {
  allowConnect?: boolean;
  allowMotion?: boolean;
  target?: CartesianPose;
  workspace?: Workspace;
  jointTarget?: number[];
  motionOptions?: Partial<Record<'linear' | 'ptp' | 'joints', MotionOptions>>;
  timeoutMs?: number;
}
export interface AdapterConformanceResult {
  checks: string[];
}
function requireCheck(ok: boolean, message: string): void {
  if (!ok) throw new RobotArmError('CONFORMANCE_FAILED', message, 500);
}
/** No physical connection or motion without explicit opt-in and measured safe targets. */
export async function runAdapterConformance(
  adapter: RobotArmAdapter,
  options: ConformanceOptions = {},
): Promise<AdapterConformanceResult> {
  const kernel = new RobotKernel(adapter);
  if (!options.allowConnect)
    throw new RobotArmError(
      'HARDWARE_OPT_IN_REQUIRED',
      'Conformance never connects hardware by default',
    );
  const checks = ['adapter-contract'];
  let enabledHere = false;
  let submitted = false;
  try {
    await kernel.connect();
    requireCheck(
      (await kernel.status()).connection === 'connected',
      'Connection state',
    );
    checks.push('connection');
    if (kernel.resolver.descriptor('state.cartesian')) {
      assertPose(await kernel.getPose());
      checks.push('actual-pose');
    }
    if (kernel.resolver.descriptor('state.joints')) {
      await kernel.readJoints();
      checks.push('actual-joints');
    }
    if (options.allowMotion) {
      if (!kernel.resolver.descriptor('control.stop'))
        throw new RobotArmError(
          'UNSUPPORTED_CAPABILITY',
          'Conformance motion requires stop',
          422,
        );
      if (!options.target && !options.jointTarget)
        throw new RobotArmError(
          'SAFE_TARGET_REQUIRED',
          'Specify an operator-approved Cartesian or joint target',
        );
      if (!(await kernel.getState()).enabled) {
        await kernel.enable();
        enabledHere = true;
      }
      await kernel.assertReady();
      for (const kind of ['ptp', 'linear', 'joints'] as const) {
        const descriptor = kernel.resolver.descriptor(`motion.${kind}`);
        if (
          !descriptor ||
          (kind === 'joints' ? !options.jointTarget : !options.target)
        )
          continue;
        const ranges = descriptor.constraints!.speed;
        const speed = ranges.ratio
          ? { kind: 'ratio' as const, value: ranges.ratio.min }
          : ranges.linear
            ? { kind: 'linear' as const, mmPerSecond: ranges.linear.min }
            : ranges.angular
              ? {
                  kind: 'angular' as const,
                  degreesPerSecond: ranges.angular.min,
                }
              : {
                  kind: 'joints' as const,
                  valuesPerSecond: Array(adapter.kinematics.jointCount).fill(
                    ranges.joints!.min,
                  ),
                };
        const motionOptions = options.motionOptions?.[kind] ?? { speed };
        const submit = () =>
          kind === 'joints'
            ? kernel.moveJoints(options.jointTarget!, motionOptions)
            : kind === 'linear'
              ? kernel.moveLinear(
                  options.target!,
                  motionOptions,
                  options.workspace,
                )
              : kernel.movePtp(
                  options.target!,
                  motionOptions,
                  options.workspace,
                );
        submitted = true;
        const handle = await submit();
        requireCheck(
          Boolean(handle.id && handle.acceptedAt),
          'Acceptance handle',
        );
        requireCheck(
          (await handle.wait({ timeoutMs: options.timeoutMs ?? 60000 }))
            .status === 'completed',
          'Physical completion',
        );
        if (kind !== 'joints') {
          const measured = await kernel.getPose();
          requireCheck(
            distance(measured.positionMm, options.target!.positionMm) <= 0.5 &&
              quaternionDistance(
                measured.orientation,
                options.target!.orientation,
              ) <= 0.01,
            'Measured target',
          );
        } else
          requireCheck(
            (await kernel.readJoints()).values.every(
              (v, i) => Math.abs(v - options.jointTarget![i]) <= 0.1,
            ),
            'Measured joints',
          );
        checks.push(
          kind === 'linear'
            ? 'moveLinear'
            : kind === 'ptp'
              ? 'movePtp'
              : 'moveJoints',
        );
        const interrupted = await submit();
        await kernel.stop();
        requireCheck(
          (await kernel.status()).motion === 'idle',
          'Confirmed stop',
        );
        requireCheck(
          ['completed', 'stopped', 'cancelled'].includes(
            (await interrupted.wait({ timeoutMs: options.timeoutMs ?? 60000 }))
              .status,
          ),
          'Stopped terminal',
        );
        checks.push('stop');
        await kernel.recover();
      }
      if (kernel.resolver.descriptor('control.drag')) {
        await kernel.enterDragMode();
        requireCheck(
          (await kernel.status()).operationMode === 'backdrive',
          'Drag enabled',
        );
        await kernel.exitDragMode();
        requireCheck(
          (await kernel.status()).operationMode !== 'backdrive',
          'Drag disabled',
        );
        checks.push('drag');
      }
    }
    return { checks };
  } finally {
    try {
      if (submitted) await kernel.stop();
      if (enabledHere) await kernel.disable();
    } finally {
      await kernel.disconnect();
    }
  }
}
export function createFakeAdapter(options: FakeAdapterOptions = {}) {
  return new FakeAdapter(options);
}
export { FakeAdapter };
export { TestRobotAdapter } from './testkit/test-adapter.js';
export { createMotionHandle } from './driver/motion-handle.js';
