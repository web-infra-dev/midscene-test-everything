import { RobotArmError } from '../contracts.js';
import type { RobotDriverBoundary } from './driver-boundary.js';
import { evaluateReadiness } from './readiness.js';

/** Recovery resolves physical interruption conditions; it never applies configuration. */
export async function checkRecovery(
  adapter: RobotDriverBoundary,
  softwarePaused: boolean,
  check: () => void,
): Promise<void> {
  let status;
  try {
    status = await adapter.status();
  } catch (error) {
    if (!(error instanceof RobotArmError) || error.code !== 'DISCONNECTED')
      throw error;
    check();
    await adapter.connect();
    check();
    status = await adapter.status();
  }
  if (status.connection === 'disconnected') {
    check();
    await adapter.connect();
    check();
    status = await adapter.status();
  }
  check();
  const reasons = evaluateReadiness(
    status,
    adapter.adapter.readinessPolicy,
  ).reasons.filter((reason) => reason !== 'NOT_ENABLED');
  if (status.enablement === 'unknown') reasons.push('ENABLEMENT_UNKNOWN');
  if (softwarePaused) reasons.push('ROBOT_PAUSED');
  if (reasons.length)
    throw new RobotArmError(
      'RECOVERY_REQUIRED',
      'Resolve stop, faults, Drag and pause before recovery',
      409,
      { reasons: [...new Set(reasons)] },
    );
  if (adapter.resolver.descriptor('state.cartesian')) await adapter.getPose();
  check();
}
