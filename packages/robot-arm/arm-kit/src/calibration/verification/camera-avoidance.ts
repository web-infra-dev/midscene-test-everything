import type { ApplicationContext } from '../../application/context.js';
import { cameraBoundaryExcessMm } from '../../application/teaching-constraints.js';
import {
  type CalibrationSession,
  type CartesianPose,
  RobotArmError,
} from '../../contracts.js';
import { contactPoint, flangePose, quaternionDistance } from '../../domain.js';
import {
  scaleAcceleration,
  scaleSpeed,
} from '../../screen-interaction/motion-policy.js';
import {
  assertParkingCorridor,
  cameraAvoidanceTargets,
  insideCameraParkingFootprint,
  taughtCameraSide,
} from '../camera-avoidance.js';
import { calibrationQuad } from '../screen-position.js';
import type { CalibrationHost } from './commands.js';
import { assertSafeObservation } from './safe-position.js';
import { atTravelHeight } from './travel-height.js';

export interface CameraAvoidanceState {
  candidate?: CalibrationSession['candidate'];
  stage: CalibrationSession['stage'];
  requireTravel?: boolean;
  auto?: Pick<
    NonNullable<CalibrationSession['auto']>,
    | 'batchParking'
    | 'checkingVisibility'
    | 'cameraVisibility'
    | 'avoidingCamera'
    | 'observationRecorded'
    | 'cameraAvoidanceRecorded'
  >;
}
type AvoidanceHost = Omit<
  Pick<
    CalibrationHost,
    | 'profileStore'
    | 'check'
    | 'interrupted'
    | 'stationaryPose'
    | 'safeLift'
    | 'preflight'
    | 'move'
    | 'stable'
    | 'verifyCameraVisibility'
  >,
  'move'
> & {
  move(...args: Parameters<CalibrationHost['move']>): Promise<unknown>;
};

/** Unknown screen heights cannot be cleared by assuming they share the fitted plane. */
function crossesEstimatedScreen(
  from: { x: number; y: number },
  to: { x: number; y: number },
  points: ReadonlyArray<{ x: number; y: number }>,
): boolean {
  let entry = 0;
  let exit = 1;
  for (const axis of ['x', 'y'] as const) {
    const min = Math.min(...points.map((point) => point[axis]));
    const max = Math.max(...points.map((point) => point[axis]));
    const delta = to[axis] - from[axis];
    if (Math.abs(delta) < 1e-6) {
      if (from[axis] < min || from[axis] > max) return false;
      continue;
    }
    const a = (min - from[axis]) / delta;
    const b = (max - from[axis]) / delta;
    entry = Math.max(entry, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (entry > exit) return false;
  }
  return true;
}

export function assertBatchParking(
  s: CameraAvoidanceState,
  ctx: ApplicationContext,
  pose: CartesianPose,
): void {
  const parking = s.auto?.batchParking;
  if (!parking || !s.candidate) return;
  const quad = calibrationQuad(s.candidate, ctx.screen);
  const tip = contactPoint(pose, ctx.tool.offsetMm);
  assertParkingCorridor(tip, parking.corridor);
  assertSafeObservation(
    s.candidate,
    pose,
    ctx.tool.offsetMm,
    ctx.screen.safeHeightMm,
  );
  if (
    !quad ||
    insideCameraParkingFootprint(tip, [...quad, ...parking.obstacles.flat()]) ||
    tip.z < (ctx.minimumTravelTipZMm ?? Number.NEGATIVE_INFINITY) - 1e-6
  )
    throw new RobotArmError(
      'UNSAFE_OBSERVATION',
      'The shared Safe Position must clear the entire screen group at the confirmed travel height.',
      409,
    );
}

/** Only a complete preflight may fall back. A failed submitted move propagates. */
export async function avoidCamera(
  host: AvoidanceHost,
  s: CameraAvoidanceState,
  ctx: ApplicationContext,
  progress?: () => void,
): Promise<boolean> {
  if (!ctx.installationTeaching || !s.candidate || !s.auto) return false;
  const candidate = s.candidate;
  const parking = s.auto.batchParking;
  if (parking && !parking.complete) return false;
  if (parking && !host.verifyCameraVisibility)
    throw new RobotArmError(
      'VISIBILITY_UNAVAILABLE',
      'A camera visibility check is required before recording the shared Safe Position.',
      409,
    );
  const data = host.profileStore.list();
  const obstacles = (data.devices ?? [])
    .filter(
      (d) =>
        d.robotProfileId === ctx.robot.id &&
        d.toolProfileId === ctx.tool.id &&
        d.screenProfileId !== ctx.screen.id,
    )
    .flatMap((d) => {
      const c = data.calibrations.find((c) => c.id === d.calibrationProfileId);
      const screen = data.screens.find((p) => p.id === d.screenProfileId);
      const quad = c && screen && calibrationQuad(c, screen);
      return quad ? [quad] : [];
    });
  const generated = cameraAvoidanceTargets(
    candidate,
    ctx.screen,
    ctx.tool,
    taughtCameraSide(candidate, ctx.screen, ctx.installationTeaching),
    [...obstacles, ...(parking?.obstacles ?? [])],
    Boolean(parking),
  );
  // A saved position is checked first. At most three new candidates are explored.
  const targets = parking?.pose ? [parking.pose, ...generated] : generated;
  const options = {
    speed: scaleSpeed(ctx.screen.actionSpeed, 0.1),
    acceleration: scaleAcceleration(ctx.screen.actionAcceleration, 0.1),
  };
  const start = await host.stationaryPose(ctx);
  const teaching = ctx.installationTeaching;
  const cameraSide = (pose: CartesianPose) => [
    cameraBoundaryExcessMm(pose.positionMm, teaching),
    cameraBoundaryExcessMm(contactPoint(pose, ctx.tool.offsetMm), teaching),
  ];
  const startSide = cameraSide(start);
  if (
    parking &&
    !s.requireTravel &&
    startSide.every((distance) => distance <= -20)
  ) {
    let canVerifyHere = false;
    try {
      assertBatchParking(s, ctx, start);
      canVerifyHere = true;
    } catch {
      host.check();
    }
    if (canVerifyHere && host.verifyCameraVisibility) {
      const visibility = await host.verifyCameraVisibility(start);
      await host.stable(start, ctx);
      host.check();
      s.auto.cameraVisibility = visibility;
      if (visibility.clear) {
        candidate.observationPose = start;
        s.auto.observationRecorded = true;
        s.auto.cameraAvoidanceRecorded = true;
        s.stage = 'verification';
        return true;
      }
    }
  }
  if (parking && startSide.some((distance) => distance > -10))
    throw new RobotArmError(
      'CAMERA_CLEARANCE_REQUIRED',
      'The robot is too close to the taught camera boundary for automatic parking. Check the camera installation and teaching.',
      409,
    );
  for (const proposed of targets.slice(0, 4)) {
    host.check();
    const actual = await host.stationaryPose(ctx);
    const lift = atTravelHeight(
      host.safeLift(actual, candidate, ctx, false),
      ctx,
    );
    const target = atTravelHeight(
      parking
        ? flangePose(
            contactPoint(proposed, ctx.tool.offsetMm),
            actual.orientation,
            ctx.tool.offsetMm,
          )
        : proposed,
      parking && ctx.minimumTravelTipZMm !== undefined
        ? { ...ctx, minimumTravelTipZMm: ctx.minimumTravelTipZMm + 0.5 }
        : ctx,
    );
    if (parking) {
      const actualSide = cameraSide(actual);
      const liftSide = cameraSide(lift);
      const targetSide = cameraSide(target);
      if (
        targetSide.some(
          (distance, index) =>
            distance >
              Math.min(-20, startSide[index] - 10, liftSide[index] + 0.001) ||
            liftSide[index] > Math.min(-10, actualSide[index] + 0.001),
        ) ||
        quaternionDistance(actual.orientation, lift.orientation) > 0.001
      )
        continue;
    }
    // Bound the whole search relative to its measured start, including retries.
    if (
      Math.hypot(
        target.positionMm.x - start.positionMm.x,
        target.positionMm.y - start.positionMm.y,
      ) > 500
    )
      continue;
    try {
      const actualTip = contactPoint(actual, ctx.tool.offsetMm);
      const liftTip = contactPoint(lift, ctx.tool.offsetMm);
      const targetTip = contactPoint(target, ctx.tool.offsetMm);
      if (
        parking?.estimatedObstacles?.some(
          (quad) =>
            crossesEstimatedScreen(actualTip, liftTip, quad) ||
            crossesEstimatedScreen(liftTip, targetTip, quad),
        )
      )
        continue;
      assertSafeObservation(
        candidate,
        target,
        ctx.tool.offsetMm,
        ctx.screen.safeHeightMm,
      );
      assertBatchParking(s, ctx, target);
      assertParkingCorridor(actualTip, parking?.corridor);
      assertParkingCorridor(liftTip, parking?.corridor);
      await host.preflight(
        [
          { name: 'Camera avoidance lift', pose: lift, options },
          { name: 'Camera avoidance exit', pose: target, options },
        ],
        ctx,
      );
    } catch (error) {
      host.check();
      if (host.interrupted()) throw error;
      continue;
    }
    s.auto.avoidingCamera = true;
    progress?.();
    try {
      await host.move(lift, ctx, options.speed, options.acceleration);
      await host.stable(lift, ctx);
      await host.move(target, ctx, options.speed, options.acceleration);
      await host.stable(target, ctx);
      host.check();
      const measured = await host.stationaryPose(ctx);
      assertSafeObservation(
        candidate,
        measured,
        ctx.tool.offsetMm,
        ctx.screen.safeHeightMm,
      );
      assertBatchParking(s, ctx, measured);
      if (host.verifyCameraVisibility) {
        s.auto.checkingVisibility = true;
        progress?.();
        const visibility = await host.verifyCameraVisibility(measured);
        await host.stable(measured, ctx);
        host.check();
        s.auto.cameraVisibility = visibility;
        s.auto.checkingVisibility = false;
        progress?.();
        if (!visibility.clear) continue;
      }
      candidate.observationPose = measured;
      s.auto.observationRecorded = true;
      s.auto.cameraAvoidanceRecorded = true;
      s.stage = 'verification';
      return true;
    } finally {
      s.auto.avoidingCamera = false;
      s.auto.checkingVisibility = false;
      progress?.();
    }
  }
  return false;
}
