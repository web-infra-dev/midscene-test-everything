import {
  type MotionAcceleration,
  type MotionOptions,
  type MotionSpeed,
  RobotArmError,
  SCREEN_PRESS_DEPTH_RANGE_MM,
  type ScreenMotionSettings,
  type ScreenProfile,
} from '../contracts.js';
import { assertSpeed } from '../domain.js';
import type { MotionConstraints } from '../kernel/contracts.js';
import { validateMotionOptions } from '../kernel/motion.js';

export type ContactStage =
  | 'approach'
  | 'entry'
  | 'traverse'
  | 'exit'
  | 'recovery';
export const CONTACT_STAGE_RATIOS: Record<ContactStage, number> = {
  approach: 1,
  entry: 0.2,
  traverse: 0.4,
  exit: 0.4,
  recovery: 0.15,
};
export function scaleSpeed(speed: MotionSpeed, factor: number): MotionSpeed {
  if (speed.kind === 'ratio')
    return { kind: 'ratio', value: speed.value * factor };
  if (speed.kind === 'linear')
    return { kind: 'linear', mmPerSecond: speed.mmPerSecond * factor };
  throw new RobotArmError(
    'UNSUPPORTED_SPEED',
    'Screen contact requires ratio or linear speed',
    422,
  );
}
export function scaleAcceleration(
  a: MotionAcceleration,
  factor: number,
): MotionAcceleration {
  if (a.kind === 'ratio') return { kind: 'ratio', value: a.value * factor };
  if (a.kind === 'linear')
    return {
      kind: 'linear',
      mmPerSecondSquared: a.mmPerSecondSquared * factor,
    };
  throw new RobotArmError(
    'UNSUPPORTED_ACCELERATION',
    'Screen contact requires ratio or linear acceleration',
    422,
  );
}
export function stageOptions(
  screen: ScreenProfile,
  stage: ContactStage,
  constraints: MotionConstraints,
  jointCount: number,
  requestedSpeed?: MotionSpeed,
): MotionOptions {
  const ratio = CONTACT_STAGE_RATIOS[stage];
  return buildStageOptions(screen, constraints, jointCount, requestedSpeed, {
    speed: ratio,
    acceleration: ratio,
  });
}
/**
 * Options for the exit segment, the one that releases the screen. Exit travel is
 * short, so it is acceleration-limited; the profile's release factors are the
 * levers that decide how quickly the tool leaves the glass.
 */
export function releaseStageOptions(
  screen: ScreenProfile,
  constraints: MotionConstraints,
  jointCount: number,
): MotionOptions {
  return buildStageOptions(screen, constraints, jointCount, undefined, {
    speed: screen.releaseSpeedFactor,
    acceleration: screen.releaseAccelerationFactor,
  });
}
/** Contact-stage factors, defaulting to the repository-wide stage table. */
export interface StageFactors {
  speed: number;
  acceleration: number;
}
function buildStageOptions(
  screen: ScreenProfile,
  constraints: MotionConstraints,
  jointCount: number,
  requestedSpeed: MotionSpeed | undefined,
  factors: StageFactors,
): MotionOptions {
  const options = {
    speed: requestedSpeed ?? scaleSpeed(screen.actionSpeed, factors.speed),
    acceleration: scaleAcceleration(
      screen.actionAcceleration,
      factors.acceleration,
    ),
  };
  validateMotionOptions(options, constraints, jointCount);
  return options;
}
export function validateContactPolicy(
  screen: ScreenProfile,
  constraints: MotionConstraints,
  jointCount: number,
) {
  for (const stage of Object.keys(CONTACT_STAGE_RATIOS) as ContactStage[])
    stageOptions(screen, stage, constraints, jointCount);
  // The release factors replace the exit ratio, so they are validated even when
  // the table's own exit entry already passed.
  releaseStageOptions(screen, constraints, jointCount);
}

/** Motion validation is also used before a measured screen exists. */
export function validateScreenMotionSettings(
  s: ScreenMotionSettings & { id?: string },
): void {
  if (
    ![s.safeHeightMm, s.motionTimeoutMs].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    throw new RobotArmError(
      'INVALID_PROFILE',
      'Safe height and motion timeout must be positive',
    );
  if (
    s.motionTimeoutMs > 120000 ||
    s.safeHeightMm > 100 ||
    !Number.isFinite(s.pressDepthMm) ||
    s.pressDepthMm < SCREEN_PRESS_DEPTH_RANGE_MM.min ||
    s.pressDepthMm > SCREEN_PRESS_DEPTH_RANGE_MM.max
  )
    throw new RobotArmError(
      'INVALID_PROFILE',
      'Invalid resolution, depth, clearance or timeout',
    );
  if (s.pressDepthMm <= -s.safeHeightMm)
    throw new RobotArmError(
      'INVALID_PROFILE',
      'Safe height must exceed the magnitude of a negative press depth.',
    );
  assertSpeed(s.actionSpeed);
  if (s.swipeEndpointHoldMs === undefined)
    throw new RobotArmError(
      'INVALID_PROFILE',
      `Screen ${s.id} is missing swipeEndpointHoldMs. Use a new storage path and complete setup again.`,
      409,
    );
  if (
    !Number.isInteger(s.swipeEndpointHoldMs) ||
    (s.swipeEndpointHoldMs !== 0 &&
      (s.swipeEndpointHoldMs < 30 || s.swipeEndpointHoldMs > 1000))
  )
    throw new RobotArmError(
      'INVALID_PROFILE',
      'swipeEndpointHoldMs must be zero or an integer between 30 and 1000',
    );
  if (
    !s.actionAcceleration ||
    !['ratio', 'linear'].includes(s.actionAcceleration.kind) ||
    !['ratio', 'linear'].includes(s.actionSpeed.kind)
  )
    throw new RobotArmError(
      'INVALID_PROFILE',
      'Screen speed and acceleration must use ratio or linear units',
    );
  const acceleration =
    s.actionAcceleration.kind === 'ratio'
      ? s.actionAcceleration.value
      : s.actionAcceleration.kind === 'linear'
        ? s.actionAcceleration.mmPerSecondSquared
        : Number.NaN;
  if (
    !Number.isFinite(acceleration) ||
    acceleration <= 0 ||
    (s.actionAcceleration.kind === 'ratio' && acceleration > 1)
  )
    throw new RobotArmError('INVALID_PROFILE', 'Invalid contact acceleration');
  // Screen timing bounds are enforced here as the hard limit; the Setup draft
  // mirrors them so an operator sees the same refusal before saving.
  for (const [field, min, max, integer] of [
    ['contactMs', 30, 1000, true],
    ['longPressMs', 300, 10000, true],
    ['dragHoldMs', 30, 1000, true],
    ['successorStartLeadMs', 0, 200, true],
    ['releaseSpeedFactor', 0.15, 1, false],
    ['releaseAccelerationFactor', 0.15, 1, false],
  ] as const) {
    const value = s[field];
    if (value === undefined)
      throw new RobotArmError(
        'INVALID_PROFILE',
        `Screen ${s.id} is missing ${field}. Use a new storage path and complete setup again.`,
      );
    if (
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value))
    )
      throw new RobotArmError(
        'INVALID_PROFILE',
        `${field} must be ${integer ? 'an integer ' : ''}between ${min} and ${max}`,
      );
  }
  // A lead that consumes the whole target window would dispatch the successor
  // before the press is complete, which is a silently absent press rather than a
  // shortened one. It is refused instead of clamped.
  const shortestTargetHold = Math.min(
    s.contactMs,
    s.dragHoldMs,
    s.swipeEndpointHoldMs || Number.POSITIVE_INFINITY,
  );
  if (s.successorStartLeadMs >= shortestTargetHold)
    throw new RobotArmError(
      'INVALID_PROFILE',
      `successorStartLeadMs (${s.successorStartLeadMs}) must be smaller than the shortest contact target (${shortestTargetHold})`,
    );
}
