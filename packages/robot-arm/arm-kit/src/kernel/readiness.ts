import { RobotArmError } from '../contracts.js';
import type {
  ReadinessPolicy,
  ReadinessResult,
  RobotStatus,
  SampleQuality,
} from './contracts.js';

export function assertFresh(sample: SampleQuality, maxAgeMs: number): void {
  const age = Date.now() - Date.parse(sample.receivedAt);
  if (
    !sample.sampleId ||
    sample.stale ||
    !Number.isFinite(age) ||
    age < -100 ||
    age > maxAgeMs
  )
    throw new RobotArmError(
      'STATE_STALE',
      'Measured state is stale or has no sampling identity',
      409,
    );
}
export function evaluateReadiness(
  s: RobotStatus,
  policy: ReadinessPolicy,
): ReadinessResult {
  const reasons: string[] = [];
  try {
    assertFresh(s.quality, policy.maxStateAgeMs);
  } catch {
    reasons.push('STATE_STALE');
  }
  if (s.connection !== 'connected') reasons.push('DISCONNECTED');
  if (s.enablement !== 'enabled') reasons.push('NOT_ENABLED');
  if (s.motion !== 'idle')
    reasons.push(
      s.motion === 'paused'
        ? 'ROBOT_PAUSED'
        : `MOTION_${s.motion.toUpperCase()}`,
    );
  if (s.operationMode === 'backdrive') reasons.push('DRAG_ACTIVE');
  if (s.faults.length) reasons.push('ROBOT_FAULT');
  for (const signal of [
    'authority',
    'power',
    'operationMode',
    'emergencyStop',
    'protectiveStop',
  ] as const) {
    const value = s[signal];
    if (
      (value === 'unknown' && policy.required.includes(signal)) ||
      value === 'not-owned' ||
      value === 'off' ||
      value === 'active' ||
      value === 'teach' ||
      value === 'manual'
    )
      reasons.push(`SIGNAL_${signal.toUpperCase()}_${value.toUpperCase()}`);
  }
  return { ready: reasons.length === 0, reasons };
}
