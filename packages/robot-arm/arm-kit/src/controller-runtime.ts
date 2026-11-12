import type { ArmController } from './controller.js';
import type { RobotArmRuntime } from './runtime.js';

// SDK implementation access only; deliberately absent from public exports.
const runtimes = new WeakMap<ArmController, RobotArmRuntime>();
export function registerControllerRuntime(
  arm: ArmController,
  runtime: RobotArmRuntime,
): void {
  if (runtimes.has(arm))
    throw new Error('Controller runtime already registered');
  runtimes.set(arm, runtime);
}
export function controllerRuntime(arm: ArmController): RobotArmRuntime {
  const runtime = runtimes.get(arm);
  if (!runtime) throw new Error('Unknown arm controller');
  return runtime;
}
