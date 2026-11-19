import type { ApplicationContext } from '../../application/context.js';
import {
  type CalibrationProfile,
  type CalibrationSession,
  type CartesianPose,
  RobotArmError,
  type Vector3,
} from '../../contracts.js';
import { assertPose, contactPoint, dot } from '../../domain.js';
import { stageOptions } from '../../screen-interaction/motion-policy.js';
import { surfaceClearanceMm } from '../surface.js';
import type { CalibrationHost } from './commands.js';

type PlaneGeometry = Pick<CalibrationProfile, 'plane' | 'inward' | 'surface'>;
export type ScreenParkingClearance = {
  geometry: PlaneGeometry;
  clearanceMm: number;
};
export function screenPlaneHeight(
  geometry: PlaneGeometry,
  pose: CartesianPose,
  offset: Vector3,
): number {
  assertPose(pose);
  const denominator = dot(geometry.plane.normal, geometry.inward);
  const height =
    (dot(geometry.plane.normal, contactPoint(pose, offset)) -
      geometry.plane.offset) /
    denominator;
  if (!Number.isFinite(height) || Math.abs(denominator) < 1e-6)
    throw new RobotArmError(
      'UNSAFE_OBSERVATION',
      'The screen plane does not define a safe return direction',
    );
  return height;
}
export function assertSafeObservation(
  geometry: PlaneGeometry,
  pose: CartesianPose,
  offset: Vector3,
  clearance: number,
): void {
  if (
    screenPlaneHeight(geometry, pose, offset) >
    -clearance - surfaceClearanceMm(geometry.surface)
  )
    throw new RobotArmError(
      'UNSAFE_OBSERVATION',
      'Saved safe position must be at least the safe clearance away from the fitted screen. Record a higher safe position. Collected points are retained.',
    );
}

export function minimumClearanceTipZ(
  { geometry, clearanceMm }: ScreenParkingClearance,
  pose: CartesianPose,
  offset: Vector3,
): number {
  const deficit =
    screenPlaneHeight(geometry, pose, offset) +
    clearanceMm +
    surfaceClearanceMm(geometry.surface);
  if (deficit <= 0) return Number.NEGATIVE_INFINITY;
  const clearancePerMm =
    -geometry.plane.normal.z / dot(geometry.plane.normal, geometry.inward);
  if (clearancePerMm <= 1e-6)
    throw new RobotArmError(
      'UNSAFE_OBSERVATION',
      'Raising the stylus cannot clear the fitted screen plane',
      409,
    );
  // Leave room for measured arrival error at the clearance limit.
  return contactPoint(pose, offset).z + deficit / clearancePerMm + 0.5;
}

/** Return a pending calibration to its saved observation without contacting the screen. */
export async function returnToObservation(
  host: CalibrationHost,
  session: CalibrationSession,
  ctx: ApplicationContext,
): Promise<void> {
  const candidate = session.candidate!;
  await host.ready();
  host.validateCalibration(candidate, session, ctx, false);
  host.validateScreenTargets(candidate, ctx);
  assertSafeObservation(
    candidate,
    candidate.observationPose,
    ctx.tool.offsetMm,
    ctx.screen.safeHeightMm,
  );
  const actual = await host.stationaryPose(ctx);
  const height = screenPlaneHeight(candidate, actual, ctx.tool.offsetMm);
  const lift = host.safeLift(
    actual,
    candidate,
    ctx,
    height > -ctx.screen.safeHeightMm,
  );
  const constraints =
    host.adapter.resolver.descriptor('motion.linear')?.constraints;
  if (!constraints)
    throw new RobotArmError(
      'UNSUPPORTED_CAPABILITY',
      'Linear motion constraints are required',
      422,
    );
  const options = stageOptions(
    ctx.screen,
    'recovery',
    constraints,
    host.adapter.capabilities.jointCount,
  );
  const targets = [lift, candidate.observationPose];
  await host.preflight(
    targets.map((pose) => ({ name: 'Return to safe position', pose, options })),
    ctx,
  );
  for (const pose of targets) {
    host.check();
    await host.move(pose, ctx, options.speed, options.acceleration);
  }
  await host.stable(candidate.observationPose, ctx);
  host.check();
  session.stage = 'verification';
}
