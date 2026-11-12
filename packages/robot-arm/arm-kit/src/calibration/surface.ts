import {
  type CalibrationProfile,
  RobotArmError,
  type ScreenSurfaceCompensation,
} from '../contracts.js';
import { dot, scale, sub } from '../domain.js';

// Absolute bound from the frozen plane; repeated repairs cannot deepen it.
export const SURFACE_LIMIT_MM = 5;
export const SAMPLED_SURFACE_LIMIT_MM = 2;
export function assertSurface(
  surface: ScreenSurfaceCompensation | undefined,
): void {
  if (surface === undefined) return;
  if (
    !surface ||
    !['local', 'sampled'].includes(surface.kind) ||
    !Array.isArray(surface.patches) ||
    surface.patches.length > 100 ||
    surface.patches.some(
      (p) =>
        !p ||
        ![p.x, p.y, p.depthMm, p.radiusMm].every(Number.isFinite) ||
        Math.abs(p.depthMm) > SURFACE_LIMIT_MM ||
        p.radiusMm <= 0 ||
        p.radiusMm > 50,
    )
  )
    throw new RobotArmError(
      'CALIBRATION_INVALID',
      'Local height compensation must be finite and within 5mm of the original plane',
    );
  if (
    surface.kind === 'sampled' &&
    (![surface.widthMm, surface.heightMm, surface.limitMm].every(
      (n) => Number.isFinite(n) && n > 0,
    ) ||
      surface.limitMm > SAMPLED_SURFACE_LIMIT_MM ||
      !Array.isArray(surface.samples) ||
      surface.samples.length < 5 ||
      surface.samples.length > 100 ||
      surface.samples.some(
        (s) =>
          !s ||
          ![s.x, s.y, s.depthMm, s.weight].every(Number.isFinite) ||
          s.x < 0 ||
          s.x > surface.widthMm ||
          s.y < 0 ||
          s.y > surface.heightMm ||
          Math.abs(s.depthMm) > surface.limitMm ||
          s.weight <= 0,
      ))
  )
    throw new RobotArmError(
      'CALIBRATION_INVALID',
      'Invalid measured regional height compensation',
      409,
    );
}
/** Ported from midscene-private dev: convex local interpolation, no edge extrapolation. */
function sampledOffset(
  surface: Extract<ScreenSurfaceCompensation, { kind: 'sampled' }>,
  point: { x: number; y: number },
) {
  const neighbours = surface.samples
    .map((sample) => ({
      ...sample,
      distance: Math.hypot(point.x - sample.x, point.y - sample.y),
    }))
    .sort((a, b) => a.distance - b.distance);
  if (neighbours[0].distance < 1e-8) return neighbours[0].depthMm;
  const radius = Math.max(neighbours[3].distance, 2 * neighbours[0].distance);
  let total = 0;
  let depth = 0;
  for (const sample of neighbours) {
    if (sample.distance >= radius) break;
    const weight = sample.weight * (1 / sample.distance - 1 / radius) ** 2;
    total += weight;
    depth += weight * sample.depthMm;
  }
  const value = depth / total;
  if (!Number.isFinite(value))
    throw new RobotArmError(
      'CALIBRATION_INVALID',
      'Surface correction must be finite',
    );
  return Math.max(-surface.limitMm, Math.min(surface.limitMm, value));
}
/** Latest measurements override older ones smoothly, only inside their radius. */
export function surfaceOffsetMm(
  surface: ScreenSurfaceCompensation | undefined,
  point: { x: number; y: number },
): number {
  if (!surface) return 0;
  assertSurface(surface);
  if (![point.x, point.y].every(Number.isFinite))
    throw new RobotArmError(
      'INVALID_SCREEN_POINT',
      'Screen millimeters must be finite',
    );
  let depth = surface.kind === 'sampled' ? sampledOffset(surface, point) : 0;
  for (const patch of surface.patches) {
    const r = Math.hypot(point.x - patch.x, point.y - patch.y) / patch.radiusMm;
    if (r >= 1) continue;
    const weight = (1 - r * r) ** 2;
    depth = depth * (1 - weight) + patch.depthMm * weight;
  }
  return depth;
}
/** Highest possible surface relative to the frozen plane, for clearance moves. */
export function surfaceClearanceMm(
  surface: ScreenSurfaceCompensation | undefined,
): number {
  assertSurface(surface);
  return Math.max(
    0,
    ...(surface?.patches.map((p) => -p.depthMm) ?? []),
    ...(surface?.kind === 'sampled'
      ? surface.samples.map((s) => -s.depthMm)
      : []),
  );
}
export function contactDepthMm(
  c: CalibrationProfile,
  point: { x: number; y: number; z: number },
): number {
  const height =
    (dot(c.plane.normal, point) - c.plane.offset) /
    dot(c.plane.normal, c.inward);
  const relative = sub(sub(point, scale(c.inward, height)), c.origin);
  return (
    height -
    surfaceOffsetMm(c.surface, {
      x: dot(relative, c.xAxis),
      y: dot(relative, c.yAxis),
    })
  );
}
