import {
  type CartesianPose,
  type MotionSpeed,
  type Quaternion,
  type RobotArmCapabilities,
  RobotArmError,
  type Vector3,
  type Workspace,
} from '../contracts.js';

export const add = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});
export const sub = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
export const scale = (a: Vector3, s: number): Vector3 => ({
  x: a.x * s,
  y: a.y * s,
  z: a.z * s,
});
export const dot = (a: Vector3, b: Vector3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const length = (a: Vector3): number => Math.sqrt(dot(a, a));
export const distance = (a: Vector3, b: Vector3): number => length(sub(a, b));
export function unit(a: Vector3): Vector3 {
  assertVector(a);
  const n = length(a);
  if (n < 1e-9)
    throw new RobotArmError('INVALID_VECTOR', 'Zero direction vector');
  return scale(a, 1 / n);
}
export function assertVector(v: Vector3): void {
  if (!v || ![v.x, v.y, v.z].every(Number.isFinite))
    throw new RobotArmError('INVALID_VECTOR', 'Expected finite XYZ');
}
export function assertPose(p: CartesianPose): void {
  if (!p || p.frame !== 'base')
    throw new RobotArmError('INVALID_POSE', 'Expected Base flange pose');
  assertVector(p.positionMm);
  const q = p.orientation;
  if (
    !q ||
    ![q.x, q.y, q.z, q.w].every(Number.isFinite) ||
    Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) > 1e-5
  )
    throw new RobotArmError(
      'INVALID_POSE',
      'Expected unit Hamilton quaternion',
    );
}
export function assertSpeed(s: MotionSpeed): void {
  if (!s || !['ratio', 'linear', 'angular', 'joints'].includes(s.kind))
    throw new RobotArmError('INVALID_SPEED', 'Unknown speed mode');
  const values =
    s.kind === 'ratio'
      ? [s.value]
      : s.kind === 'linear'
        ? [s.mmPerSecond]
        : s.kind === 'angular'
          ? [s.degreesPerSecond]
          : s.valuesPerSecond;
  if (
    !values.length ||
    values.some((v) => !Number.isFinite(v) || v <= 0) ||
    (s.kind === 'ratio' && s.value > 1)
  )
    throw new RobotArmError(
      'INVALID_SPEED',
      'Expected positive finite speed in declared units',
    );
}
export function assertWorkspace(w: Workspace): void {
  if (!w)
    throw new RobotArmError(
      'INVALID_WORKSPACE',
      'Explicit workspace is required',
    );
  assertVector(w.min);
  assertVector(w.max);
  for (const key of ['x', 'y', 'z'] as const)
    if (w.min[key] >= w.max[key])
      throw new RobotArmError(
        'INVALID_WORKSPACE',
        'Workspace bounds are inverted',
      );
}
export function within(p: Vector3, w: Workspace): boolean {
  return (['x', 'y', 'z'] as const).every(
    (k) => p[k] >= w.min[k] && p[k] <= w.max[k],
  );
}
export function assertTarget(p: CartesianPose, w: Workspace): void {
  assertPose(p);
  if (!within(p.positionMm, w))
    throw new RobotArmError(
      'OUT_OF_RANGE',
      'Flange target lies outside configured workspace',
    );
}
export function rotate(q: Quaternion, v: Vector3): Vector3 {
  const u = { x: q.x, y: q.y, z: q.z };
  return add(v, scale(cross(u, add(cross(u, v), scale(v, q.w))), 2));
}
export function multiply(a: Quaternion, b: Quaternion): Quaternion {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
export function align(from: Vector3, to: Vector3): Quaternion {
  const a = unit(from);
  const b = unit(to);
  const d = dot(a, b);
  if (d < -0.999999) {
    const axis = unit(
      cross(
        a,
        Math.abs(a.x) < 0.8 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 },
      ),
    );
    return { ...axis, w: 0 };
  }
  const c = cross(a, b);
  const n = Math.sqrt(2 * (1 + d));
  return { x: c.x / n, y: c.y / n, z: c.z / n, w: n / 2 };
}
export function contactPoint(p: CartesianPose, offset: Vector3): Vector3 {
  assertPose(p);
  return add(p.positionMm, rotate(p.orientation, offset));
}
export function flangePose(
  contact: Vector3,
  orientation: Quaternion,
  offset: Vector3,
): CartesianPose {
  return {
    frame: 'base',
    positionMm: sub(contact, rotate(orientation, offset)),
    orientation,
  };
}
export const yawQuaternion = (degrees: number): Quaternion => ({
  x: 0,
  y: 0,
  z: Math.sin((degrees * Math.PI) / 360),
  w: Math.cos((degrees * Math.PI) / 360),
});
export function quaternionDistance(a: Quaternion, b: Quaternion): number {
  return (
    2 *
    Math.acos(
      Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)),
    )
  );
}

export function assertOrientation(
  pose: CartesianPose,
  caps: RobotArmCapabilities,
): void {
  assertPose(pose);
  if (caps.orientation === 'full') return;
  const fixed = caps.fixedOrientation ?? { x: 0, y: 0, z: 0, w: 1 };
  if (caps.orientation === 'fixed') {
    if (
      quaternionDistance(pose.orientation, fixed) >
      (caps.orientationToleranceRadians ?? 1e-5)
    )
      throw new RobotArmError(
        'ORIENTATION_UNSUPPORTED',
        'Adapter orientation is fixed',
        422,
      );
    return;
  }
  const relative = multiply(pose.orientation, {
    x: -fixed.x,
    y: -fixed.y,
    z: -fixed.z,
    w: fixed.w,
  });
  if (Math.abs(relative.x) > 1e-5 || Math.abs(relative.y) > 1e-5)
    throw new RobotArmError(
      'ORIENTATION_UNSUPPORTED',
      'Target orientation is outside the Adapter yaw-only capability',
      422,
    );
}
