import type {
  ApplicationContext,
  MotionTarget,
} from '../../application/context.js';
import { cameraBoundaryExcessMm } from '../../application/teaching-constraints.js';
import type { AutomaticCaptureHost } from '../../assisted-contracts.js';
import {
  type CalibrationSession,
  type CartesianPose,
  RobotArmError,
  type Vector3,
  type Workspace,
  isRobotArmError,
} from '../../contracts.js';
import {
  assertTarget,
  contactPoint,
  distance,
  flangePose,
  quaternionDistance,
  yawQuaternion,
} from '../../domain.js';
import {
  scaleAcceleration,
  scaleSpeed,
} from '../../screen-interaction/motion-policy.js';
import { sampleTransferRoute } from '../../screen-interaction/transfer.js';
import {
  assertParkingCorridor,
  cameraAvoidanceTargets,
  insideCameraParkingFootprint,
  parkingFootprintClearance,
  screenReferenceDistanceSum,
  sharedParkingPoints,
  taughtCameraSide,
} from '../camera-avoidance.js';
import { screenContactMm } from '../geometry.js';
import { calibrationQuad } from '../screen-position.js';
import { sameTravelPose } from '../taught-position.js';
import type { CalibrationHost } from './commands.js';
import type { ParkingRecheck } from './parking-history.js';
import {
  type ScreenParkingClearance,
  assertSafeObservation,
  minimumClearanceTipZ,
} from './safe-position.js';
import { atTravelHeight } from './travel-height.js';

const MAX_SHARED_PARKING_MOVES = 4;
const PARKING_CAMERA_CLEARANCE_MM = 20;
const PARKING_START_CLEARANCE_MM = 10;
const PARKING_INITIAL_RETREAT_MM = 10;
const PARKING_POSITION_TOLERANCE_MM = 0.5;
export const PARKING_ORIENTATION_TOLERANCE_RAD = 0.001;
const MG400_PARKING_YAW_CORRECTION_LIMIT_DEG = 3;

export function hasCoaxialMg400Tool({
  robot,
  tool,
}: Pick<ApplicationContext, 'robot' | 'tool'>) {
  const { offsetMm, contactDirection } = tool;
  return (
    robot.adapterId === 'dobot-mg400' &&
    offsetMm.x === 0 &&
    offsetMm.y === 0 &&
    Math.hypot(contactDirection.x, contactDirection.y) <= 1e-6 &&
    contactDirection.z < 0
  );
}

export interface CameraAvoidanceState {
  candidate?: CalibrationSession['candidate'];
  stage: CalibrationSession['stage'];
  parkingWorkspace?: Workspace;
  parkingRecheck?: ParkingRecheck;
  screenClearances?: readonly ScreenParkingClearance[];
  screenReferences?: readonly Pick<Vector3, 'x' | 'y'>[];
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
  auditParking?(detail: Record<string, unknown>, error?: unknown): void;
  move(
    ...args: [
      ...Parameters<CalibrationHost['move']>,
      sharedParkingTravel?: NonNullable<
        Parameters<AutomaticCaptureHost['move']>[1]
      >['sharedParkingTravel'],
    ]
  ): Promise<unknown>;
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
      'The shared Safe Position must be outside the screen group and meet the minimum parking height.',
      409,
    );
}

export function assertParkingScreenClearances(
  s: CameraAvoidanceState,
  ctx: ApplicationContext,
  pose: CartesianPose,
): void {
  for (const { geometry, clearanceMm } of s.screenClearances ?? [])
    assertSafeObservation(geometry, pose, ctx.tool.offsetMm, clearanceMm);
}

/** A small MG400 R-axis correction keeps a coaxial stylus at the same XYZ. */
async function alignParkingYaw(
  host: AvoidanceHost,
  ctx: ApplicationContext,
  actual: CartesianPose,
  targetOrientation: CartesianPose['orientation'],
  options: MotionTarget['options'],
  constraints: {
    minimumTipZMm: number;
    clearances: readonly ScreenParkingClearance[];
    parking: NonNullable<
      NonNullable<CameraAvoidanceState['auto']>['batchParking']
    >;
  },
): Promise<CartesianPose> {
  const errorRad = quaternionDistance(actual.orientation, targetOrientation);
  if (
    errorRad <= PARKING_ORIENTATION_TOLERANCE_RAD ||
    !hasCoaxialMg400Tool(ctx)
  )
    return actual;

  const teaching = ctx.installationTeaching!;
  const { offsetMm } = ctx.tool;
  const yaw = (q: CartesianPose['orientation']) =>
    (Math.atan2(2 * q.w * q.z, 1 - 2 * q.z * q.z) * 180) / Math.PI;
  const fromYaw = yaw(actual.orientation);
  const toYaw = yaw(targetOrientation);
  const target = { ...actual, orientation: targetOrientation };
  const report = (
    result: string,
    extra?: Record<string, unknown>,
    error?: unknown,
  ) =>
    host.auditParking?.(
      {
        stage: 'shared-parking-alignment',
        result,
        actual,
        target,
        fromYaw,
        toYaw,
        ...extra,
      },
      error,
    );
  if (
    !teaching.corridorConfirmed ||
    [
      actual.orientation.x,
      actual.orientation.y,
      targetOrientation.x,
      targetOrientation.y,
    ].some((value) => Math.abs(value) > 1e-6)
  ) {
    report('setup-does-not-support-in-place-yaw');
    return actual;
  }
  // Compare the angles sent to the controller so a wrap at ±180° cannot
  // turn a small requested correction into a long rotation.
  if (Math.abs(toYaw - fromYaw) > MG400_PARKING_YAW_CORRECTION_LIMIT_DEG) {
    report('yaw-correction-limit', {
      limitDeg: MG400_PARKING_YAW_CORRECTION_LIMIT_DEG,
    });
    return actual;
  }

  const tip = contactPoint(actual, offsetMm);
  const cameraLimit =
    -PARKING_CAMERA_CLEARANCE_MM - PARKING_POSITION_TOLERANCE_MM;
  if (
    tip.z < constraints.minimumTipZMm ||
    cameraBoundaryExcessMm(actual.positionMm, teaching) > cameraLimit ||
    cameraBoundaryExcessMm(tip, teaching) > cameraLimit ||
    constraints.parking.estimatedObstacles?.some((quad) =>
      crossesEstimatedScreen(tip, tip, quad),
    )
  ) {
    report('rotation-start-outside-safe-envelope', {
      tip,
      minimumTipZMm: constraints.minimumTipZMm,
      cameraLimit,
    });
    return actual;
  }

  try {
    assertParkingCorridor(tip, constraints.parking.corridor);
    for (const { geometry, clearanceMm } of constraints.clearances)
      assertSafeObservation(geometry, actual, offsetMm, clearanceMm);
    await host.preflight(
      [
        { ...actual, orientation: yawQuaternion((fromYaw + toYaw) / 2) },
        target,
      ].map((pose) => ({
        name: 'Shared parking yaw alignment',
        pose,
        options,
      })),
      ctx,
    );
    host.check();
  } catch (error) {
    report('alignment-preflight-rejected', undefined, error);
    host.check();
    return actual;
  }

  try {
    await host.move(target, ctx, options.speed, options.acceleration);
    await host.stable(target, ctx);
    const measured = await host.stationaryPose(ctx);
    if (
      distance(actual.positionMm, measured.positionMm) >
        PARKING_POSITION_TOLERANCE_MM ||
      distance(tip, contactPoint(measured, offsetMm)) >
        PARKING_POSITION_TOLERANCE_MM
    )
      throw new RobotArmError(
        'PARKING_ALIGNMENT_POSITION_CHANGED',
        'The tool position changed during shared parking orientation alignment.',
        409,
        { actual, target, measured },
      );
    const remainingErrorRad = quaternionDistance(
      measured.orientation,
      targetOrientation,
    );
    report(
      remainingErrorRad <= PARKING_ORIENTATION_TOLERANCE_RAD
        ? 'aligned'
        : 'alignment-readback-outside-tolerance',
      { measured, remainingErrorRad },
    );
    return measured;
  } catch (error) {
    report('alignment-move-failed', undefined, error);
    throw error;
  }
}

/** Search fixed parking poses, then check each route from the measured arm pose. */
async function parkShared(
  host: AvoidanceHost,
  s: CameraAvoidanceState,
  ctx: ApplicationContext,
  candidate: NonNullable<CameraAvoidanceState['candidate']>,
  parking: NonNullable<
    NonNullable<CameraAvoidanceState['auto']>['batchParking']
  >,
  otherFootprints: readonly (readonly Pick<Vector3, 'x' | 'y'>[])[],
  progress?: () => void,
): Promise<boolean> {
  const teaching = ctx.installationTeaching!;
  const auto = s.auto!;
  if (!host.verifyCameraVisibility)
    throw new RobotArmError(
      'VISIBILITY_UNAVAILABLE',
      'A camera visibility check is required before recording the shared Safe Position.',
      409,
    );

  const quad = calibrationQuad(candidate, ctx.screen);
  if (!parking.complete || !quad) {
    host.auditParking?.({
      stage: 'shared-parking-result',
      result: 'incomplete-screen-geometry',
      obstaclesComplete: parking.complete,
      sourceCalibrationId: candidate.id,
    });
    return false;
  }

  const footprint = [
    ...quad,
    ...otherFootprints.flat(),
    ...parking.obstacles.flat(),
  ];
  const ownClearance = {
    geometry: candidate,
    clearanceMm: ctx.screen.safeHeightMm,
  };
  const screenClearances = [ownClearance, ...(s.screenClearances ?? [])];
  const references = s.screenReferences?.length
    ? s.screenReferences
    : [
        {
          source: 'screen-center',
          ...screenContactMm(candidate, {
            x: ctx.screen.physicalWidthMm / 2,
            y: ctx.screen.physicalHeightMm / 2,
          }),
        },
      ];
  const tipOf = (pose: CartesianPose) => contactPoint(pose, ctx.tool.offsetMm);
  const orientation = teaching.referencePose.orientation;
  const baseTipZMm =
    Math.max(
      tipOf(teaching.referencePose).z,
      ctx.minimumTravelTipZMm ?? Number.NEGATIVE_INFINITY,
    ) + 0.5;
  // The corridor floor applies during the crossing. A vertical settle outside
  // the screen group can land at the independently checked parking height.
  const minimumTraverseTipZMm = Math.max(
    baseTipZMm,
    (parking.corridorTravelTipZMm ?? Number.NEGATIVE_INFINITY) + 0.5,
  );
  const poseAt = (point: Pick<Vector3, 'x' | 'y'>) =>
    flangePose({ ...point, z: baseTipZMm }, orientation, ctx.tool.offsetMm);
  const cameraSide = (pose: CartesianPose) => [
    cameraBoundaryExcessMm(pose.positionMm, teaching),
    cameraBoundaryExcessMm(tipOf(pose), teaching),
  ];
  const cameraMargin = (pose: CartesianPose) => -Math.max(...cameraSide(pose));
  const options = {
    speed: scaleSpeed(ctx.screen.actionSpeed, 0.1),
    acceleration: scaleAcceleration(ctx.screen.actionAcceleration, 0.1),
  };
  const corridor = parking.corridor;
  const recheck = s.parkingRecheck;
  const poses = recheck
    ? [recheck.pose]
    : sharedParkingPoints(
        footprint,
        references,
        corridor,
        (point) =>
          PARKING_CAMERA_CLEARANCE_MM +
          PARKING_POSITION_TOLERANCE_MM -
          cameraMargin(poseAt(point)),
      ).map((point) => {
        const pose = poseAt(point);
        const tip = tipOf(pose);
        const z = Math.max(
          tip.z,
          ...screenClearances.map((screen) =>
            minimumClearanceTipZ(screen, pose, ctx.tool.offsetMm),
          ),
        );
        return flangePose({ ...tip, z }, orientation, ctx.tool.offsetMm);
      });
  const rejectedCandidates: {
    tipXYMm: Pick<Vector3, 'x' | 'y'>;
    reason: string;
  }[] = [];
  const attempts = poses
    .flatMap((target) => {
      const { x, y } = tipOf(target);
      const point = { x, y };
      if (recheck) {
        try {
          assertBatchParking(s, ctx, target);
          assertParkingScreenClearances(s, ctx, target);
          if (
            cameraMargin(target) < PARKING_CAMERA_CLEARANCE_MM ||
            insideCameraParkingFootprint(point, footprint)
          )
            throw new RobotArmError(
              'UNSAFE_OBSERVATION',
              'Historical pose is outside the current parking envelope.',
            );
        } catch (error) {
          rejectedCandidates.push({
            tipXYMm: point,
            reason: error instanceof Error ? error.message : String(error),
          });
          return [];
        }
      }
      if (s.parkingWorkspace) {
        try {
          assertTarget(target, s.parkingWorkspace);
        } catch (error) {
          if (
            !(error instanceof RobotArmError) ||
            error.code !== 'OUT_OF_RANGE'
          )
            throw error;
          rejectedCandidates.push({
            tipXYMm: point,
            reason: 'outside-workspace',
          });
          return [];
        }
      }
      return [
        {
          target,
          tipXYMm: point,
          distanceSumMm: Number(
            screenReferenceDistanceSum(point, references).toFixed(6),
          ),
          marginMm: Math.min(
            cameraMargin(target) - PARKING_CAMERA_CLEARANCE_MM,
            parkingFootprintClearance(point, footprint),
            ...(corridor
              ? [
                  point.x - corridor.minX,
                  corridor.maxX - point.x,
                  point.y - corridor.minY,
                  corridor.maxY - point.y,
                ]
              : []),
          ),
        },
      ];
    })
    .sort(
      (a, b) =>
        a.distanceSumMm - b.distanceSumMm ||
        b.marginMm - a.marginMm ||
        a.tipXYMm.x - b.tipXYMm.x ||
        a.tipXYMm.y - b.tipXYMm.y,
    )
    .map((attempt, index) => ({ ...attempt, rank: index + 1 }));

  const start = await host.stationaryPose(ctx);
  const startSide = cameraSide(start);
  // A pure yaw never changes the XYZ of a coaxial tool. Retain the measured
  // yaw for ordinary searches; a historical recheck deliberately tests its
  // recorded orientation as part of the original pose.
  const preserveYaw =
    !recheck &&
    hasCoaxialMg400Tool(ctx) &&
    [
      start.orientation.x,
      start.orientation.y,
      orientation.x,
      orientation.y,
    ].every((value) => value === 0);
  const expectedOrientation = preserveYaw
    ? start.orientation
    : (recheck?.pose.orientation ?? orientation);
  host.auditParking?.({
    stage: 'shared-parking-candidates',
    references,
    candidates: attempts,
    rejectedCandidates,
    recheck,
    start,
    startSideMm: startSide,
    cameraSideOrder: ['flange', 'tip'],
    sourceCalibrationId: candidate.id,
    cameraBoundary: teaching.cameraBoundary,
    footprint,
    corridor,
    estimatedObstacles: parking.estimatedObstacles,
    baseTipZMm,
    minimumTraverseTipZMm,
    orientation,
    orientationPolicy: preserveYaw
      ? 'preserve-current-yaw'
      : recheck
        ? 'historical'
        : 'taught',
    expectedOrientation,
    cameraClearanceMm: PARKING_CAMERA_CLEARANCE_MM,
    startClearanceMm: PARKING_START_CLEARANCE_MM,
    initialRetreatMm: PARKING_INITIAL_RETREAT_MM,
    maxMoves: MAX_SHARED_PARKING_MOVES,
  });

  let moves = 0;
  let inPlaceChecks = 0;
  let considered = 0;
  let result = 'candidates-exhausted';
  let selectedRank: number | undefined;
  const requireOrientation = (actual: CartesianPose) => {
    const orientationErrorRad = quaternionDistance(
      actual.orientation,
      expectedOrientation,
    );
    if (orientationErrorRad <= PARKING_ORIENTATION_TOLERANCE_RAD) return;
    result = preserveYaw
      ? 'parking-orientation-changed'
      : 'parking-orientation-required';
    const degrees = (radians: number) => ((radians * 180) / Math.PI).toFixed(3);
    const detail = {
      actual,
      expectedOrientation,
      orientationErrorRad,
      toleranceRad: PARKING_ORIENTATION_TOLERANCE_RAD,
    };
    const error = new RobotArmError(
      preserveYaw
        ? 'PARKING_ORIENTATION_CHANGED'
        : 'PARKING_ORIENTATION_REQUIRED',
      preserveYaw
        ? 'The tool orientation changed during the shared parking search. Retry from a stable position.'
        : `Shared parking needs the taught tool orientation. The tool is off by ${degrees(orientationErrorRad)}° (allowed ${degrees(PARKING_ORIENTATION_TOLERANCE_RAD)}°). Align it at a confirmed safe position and retry.`,
      409,
      detail,
    );
    host.auditParking?.(
      { stage: 'shared-parking-preparation', result, ...detail },
      error,
    );
    throw error;
  };
  try {
    if (recheck && !attempts.length) {
      result = 'historical-pose-outside-current-envelope';
      throw new RobotArmError(
        'HISTORICAL_PARKING_UNSAFE',
        'The historical Safe Position is outside the current parking envelope.',
        409,
        { rejectedCandidates },
      );
    }
    if (startSide.some((distance) => distance > -PARKING_START_CLEARANCE_MM)) {
      result = 'start-too-close-to-camera';
      throw new RobotArmError(
        'CAMERA_CLEARANCE_REQUIRED',
        'The robot is too close to the taught camera boundary for automatic parking. Check the camera installation and teaching.',
        409,
      );
    }
    const prepared =
      recheck && attempts.length
        ? await alignParkingYaw(
            host,
            ctx,
            start,
            expectedOrientation,
            options,
            {
              minimumTipZMm: minimumTraverseTipZMm,
              clearances: screenClearances,
              parking,
            },
          )
        : start;
    requireOrientation(prepared);
    for (const attempt of attempts) {
      host.check();
      const { rank } = attempt;
      const actual = await host.stationaryPose(ctx);
      requireOrientation(actual);
      const target = preserveYaw
        ? { ...attempt.target, orientation: actual.orientation }
        : attempt.target;
      const actualTip = tipOf(actual);
      const targetTip = tipOf(target);
      const orientationErrorRad = quaternionDistance(
        actual.orientation,
        target.orientation,
      );
      const atTarget =
        distance(actual.positionMm, target.positionMm) <=
          PARKING_POSITION_TOLERANCE_MM &&
        distance(actualTip, targetTip) <= PARKING_POSITION_TOLERANCE_MM &&
        orientationErrorRad <= PARKING_ORIENTATION_TOLERANCE_RAD;
      if (!atTarget && moves >= MAX_SHARED_PARKING_MOVES) {
        result = 'move-budget-exhausted';
        break;
      }

      considered++;
      let phase = 'preflight';
      let preflightLeg: string | undefined;
      let cameraRoutePolicy:
        | 'confirmed-corridor-fixed-margin'
        | 'retreat-from-start'
        | undefined;
      const route: MotionTarget[] = [];
      const skippedLegs: string[] = [];
      const report = (
        outcome: string,
        details?: Record<string, unknown>,
        error?: unknown,
      ) =>
        host.auditParking?.(
          {
            stage: 'shared-parking-candidate',
            ...attempt,
            executedTarget: target,
            result: outcome,
            actual,
            orientationErrorRad,
            route: route.map(({ name, pose }) => ({ name, pose })),
            skippedLegs,
            cameraRoutePolicy,
            ...details,
          },
          error,
        );
      try {
        if (atTarget) {
          assertBatchParking(s, ctx, actual);
          assertParkingScreenClearances(s, ctx, actual);
          if (cameraMargin(actual) < PARKING_CAMERA_CLEARANCE_MM) {
            report('in-place-camera-clearance', {
              actualSideMm: cameraSide(actual),
            });
            continue;
          }
        } else {
          if (
            Math.hypot(
              target.positionMm.x - start.positionMm.x,
              target.positionMm.y - start.positionMm.y,
            ) > 500
          ) {
            report('travel-limit', { limitMm: 500 });
            continue;
          }
          const originalLift = atTravelHeight(
            host.safeLift(actual, candidate, ctx, false),
            ctx,
          );
          const originalLiftTip = tipOf(originalLift);
          const travelZ = Math.max(
            minimumTraverseTipZMm,
            actualTip.z,
            originalLiftTip.z,
            targetTip.z,
            ...screenClearances.map((screen) =>
              minimumClearanceTipZ(screen, originalLift, ctx.tool.offsetMm),
            ),
          );
          const lift = flangePose(
            { ...originalLiftTip, z: travelZ },
            actual.orientation,
            ctx.tool.offsetMm,
          );
          const traverse = flangePose(
            { ...targetTip, z: travelZ },
            target.orientation,
            ctx.tool.offsetMm,
          );
          for (const leg of [
            { name: 'Shared parking lift', pose: lift, options },
            { name: 'Shared parking traverse', pose: traverse, options },
            { name: 'Shared parking settle', pose: target, options },
          ]) {
            if (sameTravelPose(route.at(-1)?.pose ?? actual, leg.pose))
              skippedLegs.push(leg.name);
            else route.push(leg);
          }

          if (
            quaternionDistance(actual.orientation, originalLift.orientation) >
            PARKING_ORIENTATION_TOLERANCE_RAD
          ) {
            report('lift-orientation-changed', { originalLift });
            continue;
          }
          const actualSide = cameraSide(actual);
          const liftSide = cameraSide(lift);
          const targetSide = cameraSide(target);
          // A fixed-orientation linear leg stays on the safe side if both
          // endpoints do. Within the confirmed corridor it may approach the
          // boundary, with the full clearance maintained throughout the route.
          const useFixedMargin =
            corridor !== undefined &&
            quaternionDistance(actual.orientation, target.orientation) <=
              1e-6 &&
            actualSide.every((side) => side <= -PARKING_CAMERA_CLEARANCE_MM);
          cameraRoutePolicy = useFixedMargin
            ? 'confirmed-corridor-fixed-margin'
            : 'retreat-from-start';
          const escaping =
            insideCameraParkingFootprint(actualTip, footprint) ||
            actualSide.some((side) => side > -PARKING_CAMERA_CLEARANCE_MM);
          const liftLimitMm = actualSide.map((side) =>
            useFixedMargin
              ? -PARKING_CAMERA_CLEARANCE_MM
              : Math.min(-PARKING_START_CLEARANCE_MM, side + 0.001),
          );
          const targetLimitMm = liftSide.map((side, index) =>
            useFixedMargin
              ? -PARKING_CAMERA_CLEARANCE_MM
              : Math.min(
                  -PARKING_CAMERA_CLEARANCE_MM,
                  side + 0.001,
                  escaping
                    ? actualSide[index] - PARKING_INITIAL_RETREAT_MM
                    : Number.POSITIVE_INFINITY,
                ),
          );
          if (liftSide.some((side, index) => side > liftLimitMm[index])) {
            report('lift-camera-boundary', {
              actualSideMm: actualSide,
              liftSideMm: liftSide,
              limitMm: liftLimitMm,
            });
            continue;
          }
          if (targetSide.some((side, index) => side > targetLimitMm[index])) {
            report(
              useFixedMargin
                ? 'target-camera-clearance'
                : escaping
                  ? 'initial-camera-retreat'
                  : 'route-approaches-camera',
              {
                actualSideMm: actualSide,
                liftSideMm: liftSide,
                targetSideMm: targetSide,
                limitMm: targetLimitMm,
              },
            );
            continue;
          }

          const liftTip = tipOf(lift);
          const obstacleIndex = parking.estimatedObstacles?.findIndex(
            (quad) =>
              crossesEstimatedScreen(actualTip, liftTip, quad) ||
              crossesEstimatedScreen(liftTip, targetTip, quad),
          );
          if (obstacleIndex !== undefined && obstacleIndex >= 0) {
            report('path-crosses-estimated-screen', { obstacleIndex });
            continue;
          }
          assertBatchParking(s, ctx, target);
          assertParkingScreenClearances(s, ctx, target);
          assertParkingScreenClearances(s, ctx, lift);
          assertSafeObservation(
            candidate,
            lift,
            ctx.tool.offsetMm,
            ctx.screen.safeHeightMm,
          );
          assertParkingCorridor(actualTip, corridor);
          assertParkingCorridor(liftTip, corridor);
          let from = actual;
          for (const leg of route) {
            preflightLeg = leg.name;
            const samples = sampleTransferRoute([from, leg.pose]);
            await host.preflight(
              [...samples.slice(0, -1).map((pose) => ({ ...leg, pose })), leg],
              ctx,
            );
            from = leg.pose;
          }
        }

        if (!atTarget) {
          auto.avoidingCamera = true;
          progress?.();
          moves++;
          for (const [index, { name, pose }] of route.entries()) {
            phase = name;
            await host.move(
              pose,
              ctx,
              options.speed,
              options.acceleration,
              moves === 1 && index === 0 ? { rank, leg: name } : undefined,
            );
            await host.stable(pose, ctx);
          }
        } else {
          inPlaceChecks++;
          phase = 'stability';
          await host.stable(actual, ctx);
        }
        host.check();
        phase = 'arrival';
        const measured = await host.stationaryPose(ctx);
        assertBatchParking(s, ctx, measured);
        assertParkingScreenClearances(s, ctx, measured);
        const measuredTip = tipOf(measured);
        const measuredErrorMm = distance(measuredTip, targetTip);
        const measuredFlangeErrorMm = distance(
          measured.positionMm,
          target.positionMm,
        );
        const measuredOrientationErrorRad = quaternionDistance(
          measured.orientation,
          target.orientation,
        );
        if (
          measuredErrorMm > PARKING_POSITION_TOLERANCE_MM ||
          measuredFlangeErrorMm > PARKING_POSITION_TOLERANCE_MM ||
          measuredOrientationErrorRad > PARKING_ORIENTATION_TOLERANCE_RAD ||
          cameraMargin(measured) < PARKING_CAMERA_CLEARANCE_MM
        ) {
          report('arrival-outside-tolerance', {
            measured,
            measuredErrorMm,
            measuredFlangeErrorMm,
            measuredOrientationErrorRad,
            measuredSideMm: cameraSide(measured),
            inPlace: atTarget,
          });
          continue;
        }
        phase = 'visibility';
        auto.checkingVisibility = true;
        progress?.();
        const visibility = await host.verifyCameraVisibility(measured);
        await host.stable(measured, ctx);
        host.check();
        auto.cameraVisibility = visibility;
        const inconclusive = visibility.screens.some(
          (screen) => screen.assessment === 'insufficient-evidence',
        );
        report(
          visibility.clear
            ? 'selected'
            : inconclusive
              ? 'visibility-insufficient-evidence'
              : 'visibility-rejected',
          {
            measured,
            measuredTripMm: distance(actualTip, measuredTip),
            measuredDistanceSumMm: screenReferenceDistanceSum(
              measuredTip,
              references,
            ),
            inPlace: atTarget,
            screens: visibility.screens,
            unclearScreenIds: visibility.screens
              .filter((screen) => screen.clear !== true)
              .map((screen) => screen.id),
          },
        );
        if (!visibility.clear && inconclusive) {
          result = 'visibility-insufficient-evidence';
          return false;
        }
        if (!visibility.clear) continue;
        candidate.observationPose = measured;
        auto.observationRecorded = true;
        auto.cameraAvoidanceRecorded = true;
        s.stage = 'verification';
        selectedRank = rank;
        result = 'selected';
        return true;
      } catch (error) {
        const motionNotStarted =
          isRobotArmError(error) &&
          error.code === 'CALIBRATION_MOTION_NOT_STARTED';
        if (motionNotStarted) result = 'motion-not-started';
        report(
          phase === 'preflight'
            ? 'preflight-rejected'
            : motionNotStarted
              ? 'motion-not-started'
              : 'attempt-failed',
          {
            phase,
            preflightLeg: phase === 'preflight' ? preflightLeg : undefined,
          },
          error,
        );
        if (phase !== 'preflight' || host.interrupted()) throw error;
        host.check();
      } finally {
        auto.avoidingCamera = false;
        auto.checkingVisibility = false;
        progress?.();
      }
    }
    return false;
  } catch (error) {
    if (result === 'candidates-exhausted')
      result = host.interrupted() ? 'interrupted' : 'failed';
    throw error;
  } finally {
    host.auditParking?.({
      stage: 'shared-parking-result',
      result,
      selectedRank,
      considered,
      candidateCount: attempts.length,
      moves,
      inPlaceChecks,
    });
  }
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
  const auto = s.auto;
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
  if (auto.batchParking)
    return parkShared(
      host,
      s,
      ctx,
      candidate,
      auto.batchParking,
      obstacles,
      progress,
    );
  const targets = cameraAvoidanceTargets(
    candidate,
    ctx.screen,
    ctx.tool,
    taughtCameraSide(candidate, ctx.screen, ctx.installationTeaching),
    obstacles,
  );
  const options = {
    speed: scaleSpeed(ctx.screen.actionSpeed, 0.1),
    acceleration: scaleAcceleration(ctx.screen.actionAcceleration, 0.1),
  };
  const start = await host.stationaryPose(ctx);
  for (const proposed of targets) {
    host.check();
    const actual = await host.stationaryPose(ctx);
    const lift = atTravelHeight(
      host.safeLift(actual, candidate, ctx, false),
      ctx,
    );
    const target = atTravelHeight(proposed, ctx);
    if (
      Math.hypot(
        target.positionMm.x - start.positionMm.x,
        target.positionMm.y - start.positionMm.y,
      ) > 500
    )
      continue;
    try {
      assertSafeObservation(
        candidate,
        target,
        ctx.tool.offsetMm,
        ctx.screen.safeHeightMm,
      );
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
    auto.avoidingCamera = true;
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
      if (host.verifyCameraVisibility) {
        auto.checkingVisibility = true;
        progress?.();
        const visibility = await host.verifyCameraVisibility(measured);
        await host.stable(measured, ctx);
        host.check();
        auto.cameraVisibility = visibility;
        auto.checkingVisibility = false;
        progress?.();
        if (!visibility.clear) continue;
      }
      candidate.observationPose = measured;
      auto.observationRecorded = true;
      auto.cameraAvoidanceRecorded = true;
      s.stage = 'verification';
      return true;
    } finally {
      auto.avoidingCamera = false;
      auto.checkingVisibility = false;
      progress?.();
    }
  }
  return false;
}
