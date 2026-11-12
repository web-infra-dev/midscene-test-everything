import {
  type CartesianPose,
  type InstallationTeaching,
  RobotArmError,
  type Vector3,
} from '../contracts.js';
import { contactPoint } from '../domain.js';
import type { ApplicationContext } from './context.js';

export const CAMERA_BOUNDARY_EPSILON_MM = 1e-6;

export function cameraBoundaryExcessMm(
  tip: Vector3,
  teaching: InstallationTeaching,
) {
  const { point, normal } = teaching.cameraBoundary;
  return (tip.x - point.x) * normal.x + (tip.y - point.y) * normal.y;
}
/** The reference side of the taught vertical plane is allowed. */
export function assertCameraBoundary(
  pose: CartesianPose,
  teaching: InstallationTeaching,
  ctx: Pick<ApplicationContext, 'tool'>,
) {
  const tip = contactPoint(pose, ctx.tool.offsetMm);
  const excess = cameraBoundaryExcessMm(tip, teaching);
  if (!Number.isFinite(excess) || excess > CAMERA_BOUNDARY_EPSILON_MM)
    throw new RobotArmError(
      'CAMERA_BOUNDARY_EXCEEDED',
      'Target crosses the taught camera-side boundary',
      409,
    );
}
