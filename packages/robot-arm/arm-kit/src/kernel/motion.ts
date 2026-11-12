import { type MotionOptions, RobotArmError } from '../contracts.js';
import type { MotionConstraints, RobotKinematics } from './contracts.js';

export function validateMotionOptions(
  options: MotionOptions,
  constraints: MotionConstraints,
  jointCount: number,
): void {
  if (!options || typeof options !== 'object')
    throw new RobotArmError(
      'INVALID_MOTION_OPTIONS',
      'Motion options are required',
    );
  if (options.arrivalSamples !== undefined) {
    // Bounded rather than clamped: a caller asking for zero samples is asking to
    // skip arrival evidence, and one asking for many is asking to stretch a
    // contact window. Both are refusals, not silent corrections.
    if (
      !Number.isInteger(options.arrivalSamples) ||
      options.arrivalSamples < 1 ||
      options.arrivalSamples > 5
    )
      throw new RobotArmError(
        'INVALID_MOTION_OPTIONS',
        'arrivalSamples must be an integer between 1 and 5',
        422,
      );
  }
  for (const [field, value, ranges] of [
    ['speed', options.speed, constraints.speed],
    ['acceleration', options.acceleration, constraints.acceleration],
  ] as const) {
    if (!value) {
      if (field === 'speed')
        throw new RobotArmError(
          'INVALID_SPEED',
          'Explicit motion speed is required',
        );
      continue;
    }
    if (
      typeof value !== 'object' ||
      !['ratio', 'linear', 'angular', 'joints'].includes(value.kind)
    )
      throw new RobotArmError(
        'INVALID_MOTION_OPTIONS',
        `Invalid ${field} unit`,
      );
    const range = ranges[value.kind];
    if (!range)
      throw new RobotArmError(
        'UNSUPPORTED_MOTION_PARAMETER',
        `${field} mode ${value.kind} is unsupported`,
        422,
      );
    const numbers =
      value.kind === 'ratio'
        ? [value.value]
        : 'mmPerSecond' in value
          ? [value.mmPerSecond]
          : 'mmPerSecondSquared' in value
            ? [value.mmPerSecondSquared]
            : 'degreesPerSecond' in value
              ? [value.degreesPerSecond]
              : 'degreesPerSecondSquared' in value
                ? [value.degreesPerSecondSquared]
                : 'valuesPerSecond' in value
                  ? value.valuesPerSecond
                  : value.valuesPerSecondSquared;
    if (!Array.isArray(numbers))
      throw new RobotArmError(
        'INVALID_MOTION_OPTIONS',
        'Expected a joint parameter vector',
      );
    if (
      (value.kind === 'joints' && numbers.length !== jointCount) ||
      numbers.some((n) => !Number.isFinite(n) || n < range.min || n > range.max)
    )
      throw new RobotArmError(
        'MOTION_PARAMETER_LIMIT',
        `${field} is outside declared constraints`,
        422,
        { kind: value.kind, range },
      );
  }
}
export function validateJoints(
  values: number[],
  kinematics: RobotKinematics,
  bounds?: { min: number; max: number }[],
): void {
  if (
    !Array.isArray(values) ||
    values.length !== kinematics.jointCount ||
    values.some((v) => !Number.isFinite(v))
  )
    throw new RobotArmError(
      'INVALID_JOINTS',
      'Expected one finite value per joint',
    );
  if (bounds && bounds.length !== values.length)
    throw new RobotArmError(
      'INVALID_JOINT_BOUNDS',
      'Expected one operation bound per joint',
    );
  values.forEach((v, i) => {
    const limits = kinematics.joints[i].limits;
    const operation = bounds?.[i];
    if (!limits && !operation)
      throw new RobotArmError(
        'JOINT_BOUNDS_REQUIRED',
        `Unknown limits for joint ${i}; configure operation bounds`,
        422,
      );
    for (const r of [limits, operation])
      if (
        r &&
        (!Number.isFinite(r.min) ||
          !Number.isFinite(r.max) ||
          r.min >= r.max ||
          v < r.min ||
          v > r.max)
      )
        throw new RobotArmError(
          'JOINT_LIMIT',
          `Joint ${i} exceeds limits`,
          422,
        );
  });
}
