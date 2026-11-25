import { getDebug } from '@midscene/shared/logger';
import type {
  ApplicationContext,
  MotionTarget,
} from '../application/context.js';
import type { CalibrationPageLayout, WebPoint } from '../assisted-contracts.js';
import {
  type CalibrationProfile,
  type CartesianPose,
  type ContactMoveOptions,
  type MotionOptions,
  type MotionResult,
  RobotArmError,
  isRobotArmError,
} from '../contracts.js';
import { distance } from '../domain.js';
import type {
  LinearMotionSequence,
  MotionReceipt,
} from '../kernel/contracts.js';
import {
  releaseStageOptions,
  stageOptions,
} from '../screen-interaction/motion-policy.js';
import type { ScreenMotionHost } from '../screen-interaction/service.js';
import { phonePointMm, screenPoseMm } from './geometry.js';
import { pointDistance } from './phone/geometry.js';
import { surfaceClearanceMm } from './surface.js';
import { atTravelHeight } from './verification/travel-height.js';

// Closed contours sampled from the supplied 24 × 24 logo SVG.
// Preserve separate subpaths so travel between contours never marks the board.
const midsceneContours = [
  [
    [10.47, 5.72],
    [11.74, 6.36],
    [13.1, 6.09],
    [16.66, 2.54],
    [18.49, 3.65],
    [20.53, 5.62],
    [23.26, 10.12],
    [23.92, 12.7],
    [23.97, 15.4],
    [23.71, 16.85],
    [23.01, 18.39],
    [22.02, 19.53],
    [20.67, 20.41],
    [18.37, 21.23],
    [15.93, 22.55],
    [13.75, 23.15],
    [12, 23.29],
    [10.26, 23.15],
    [8.07, 22.55],
    [5.63, 21.23],
    [3.06, 20.27],
    [1.46, 19],
    [0.6, 17.68],
    [0.17, 16.4],
    [0.08, 12.7],
    [0.74, 10.12],
    [1.74, 8.73],
    [3.05, 6.18],
    [4.97, 4.08],
    [7.37, 2.53],
    [10.47, 5.72],
  ],
  [
    [6.4, 8.29],
    [4.93, 8.58],
    [3.24, 9.6],
    [2.43, 10.52],
    [1.89, 11.87],
    [1.65, 14.25],
    [1.89, 16.25],
    [2.64, 17.69],
    [3.91, 18.76],
    [6.6, 19.72],
    [9.48, 19.94],
    [10.18, 19.48],
    [11.66, 16.75],
    [12.07, 16.56],
    [13.97, 19.64],
    [14.73, 19.97],
    [16.07, 19.91],
    [17.93, 19.59],
    [19.64, 19],
    [20.75, 18.3],
    [21.71, 17.18],
    [22.33, 15.11],
    [22.17, 12.15],
    [21.44, 10.33],
    [19.93, 9.03],
    [17.83, 8.3],
    [12.01, 8.77],
    [6.4, 8.29],
  ],
  [
    [7.52, 9.28],
    [12, 9.76],
    [17.77, 9.29],
    [19.26, 9.79],
    [20.54, 10.79],
    [21.14, 12.1],
    [21.34, 15.02],
    [20.85, 16.68],
    [20.12, 17.54],
    [19.03, 18.18],
    [15.73, 18.94],
    [14.63, 18.89],
    [13.07, 16.06],
    [12.24, 15.58],
    [11.53, 15.64],
    [10.94, 16.06],
    [9.23, 18.97],
    [6.81, 18.75],
    [4.41, 17.91],
    [3.28, 16.89],
    [2.76, 15.67],
    [2.66, 13.51],
    [2.97, 11.69],
    [3.65, 10.57],
    [5, 9.64],
    [6, 9.31],
    [7.52, 9.28],
  ],
  [
    [15.68, 0.71],
    [16.2, 0.99],
    [16.21, 1.66],
    [12.84, 5.14],
    [12.1, 5.45],
    [11.19, 5.14],
    [7.74, 1.43],
    [7.91, 0.9],
    [8.36, 0.71],
    [15.68, 0.71],
  ],
] as const;

// Two closed contours traced from the supplied Avatr Robotic artwork.
const avatrContours = [
  [
    [488, 399],
    [519, 404],
    [539, 416],
    [553, 431],
    [809, 836],
    [704, 834],
    [505, 501],
    [495, 494],
    [484, 495],
    [477, 501],
    [267, 835],
    [164, 836],
    [430, 431],
    [458, 407],
    [488, 399],
  ],
  [
    [780, 399],
    [904, 399],
    [930, 402],
    [973, 420],
    [1008, 453],
    [1021, 475],
    [1031, 506],
    [1033, 541],
    [1028, 569],
    [1006, 612],
    [982, 636],
    [952, 654],
    [949, 670],
    [1086, 836],
    [969, 836],
    [826, 670],
    [800, 657],
    [757, 650],
    [742, 643],
    [730, 631],
    [697, 582],
    [906, 580],
    [917, 577],
    [937, 563],
    [949, 537],
    [946, 511],
    [931, 490],
    [907, 479],
    [658, 477],
    [633, 461],
    [594, 402],
    [780, 399],
  ],
] as const;

type Contours = readonly (readonly (readonly [number, number])[])[];

function logoGeometry(contours: Contours) {
  const points = contours.flat();
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const height = Math.max(...ys) - top;
  const aspect = (Math.max(...xs) - left) / height;
  return {
    aspect,
    strokes: contours.map((contour) =>
      contour.map(([x, y]) => ({
        x: (x - left) / height - aspect / 2,
        y: (y - top) / height - 0.5,
      })),
    ),
  };
}

const midscene = logoGeometry(midsceneContours);
const avatr = logoGeometry(avatrContours);
export const CALIBRATION_LOGO_STROKE_COUNT =
  midscene.strokes.length + avatr.strokes.length;

type LogoViewport = Pick<CalibrationPageLayout, 'width' | 'height'>;

function logoStrokes({ width, height }: LogoViewport): WebPoint[][] {
  const landscape = width >= height;
  const gap = width * 0.1;
  const strokeHeight = landscape
    ? Math.min(
        height * 0.38,
        (width * 0.76 - gap) / (midscene.aspect + avatr.aspect),
      )
    : Math.min(height * 0.22, (width * 0.69) / avatr.aspect);
  const midsceneWidth = strokeHeight * midscene.aspect;
  const avatrWidth = strokeHeight * avatr.aspect;
  const start = (width - midsceneWidth - gap - avatrWidth) / 2;
  const first = landscape
    ? { x: start + midsceneWidth / 2, y: height * 0.5 }
    : { x: width / 2, y: height * 0.37 };
  const second = landscape
    ? { x: start + midsceneWidth + gap + avatrWidth / 2, y: first.y }
    : { x: width / 2, y: height * 0.63 };
  const place = (strokes: WebPoint[][], center: WebPoint) =>
    strokes.map((stroke) =>
      stroke.map(({ x, y }) => ({
        x: center.x + x * strokeHeight,
        y: center.y + y * strokeHeight,
      })),
    );
  return [...place(midscene.strokes, first), ...place(avatr.strokes, second)];
}

const debug = getDebug('robot-arm:web-calibration');
const QUEUED_STROKE_MAX_TARGETS = 40;
const QUEUED_STROKE_MAX_LENGTH_MM = 250;
const STROKE_BLEND_PERCENT = 15;
const MIN_STROKE_BLEND_PERCENT = 5;
const DEFAULT_RELEASE_ACCELERATION_FACTOR = 0.4;
const LOGO_RELEASE_ACCELERATION_FACTOR = 0.5;
const MAX_BLEND_TURN_DEGREES = 40;
const FULL_BLEND_TURN_DEGREES = 12;
const NEAR_STRAIGHT_TURN_DEGREES = 5;
const MIN_BLEND_SEGMENT_MM = 0.5;
const MIN_STRAIGHT_BLEND_SEGMENT_MM = 0.25;
const HOVER_ARRIVAL_SAMPLES = 3;
const SHORT_OUTLINE_EDGE_MM = 2;
const MAX_OUTLINE_DEVIATION_MM = 0.2;

function strokeEdge(from: WebPoint, to: WebPoint) {
  const x = to.x - from.x;
  const y = to.y - from.y;
  return { x, y, length: Math.hypot(x, y) };
}

function turnDegrees(
  incoming: ReturnType<typeof strokeEdge>,
  outgoing: ReturnType<typeof strokeEdge>,
) {
  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
  const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
  return (Math.atan2(Math.abs(cross), dot) * 180) / Math.PI;
}

function fitsChord(outline: WebPoint[], from: number, to: number) {
  const chord = strokeEdge(outline[from], outline[to]);
  if (!chord.length) return false;
  let previousAlong = 0;
  return outline.slice(from + 1, to).every((point) => {
    const offset = strokeEdge(outline[from], point);
    const along = offset.x * chord.x + offset.y * chord.y;
    const perpendicular = Math.abs(offset.x * chord.y - offset.y * chord.x);
    if (
      along < previousAlong ||
      along > chord.length ** 2 ||
      perpendicular > MAX_OUTLINE_DEVIATION_MM * chord.length
    )
      return false;
    previousAlong = along;
    return true;
  });
}

function simplifyOutline(outline: WebPoint[]) {
  const points = [outline[0]];
  let anchor = 0;
  for (let index = 1; index < outline.length - 1; index++) {
    const incoming = strokeEdge(outline[index - 1], outline[index]);
    const outgoing = strokeEdge(outline[index], outline[index + 1]);
    const turn = turnDegrees(incoming, outgoing);
    if (
      (turn <= NEAR_STRAIGHT_TURN_DEGREES ||
        (turn <= MAX_BLEND_TURN_DEGREES &&
          Math.min(incoming.length, outgoing.length) <=
            SHORT_OUTLINE_EDGE_MM)) &&
      fitsChord(outline, anchor, index + 1)
    )
      continue;
    points.push(outline[index]);
    anchor = index;
  }
  points.push(outline[outline.length - 1]);
  return points;
}

function startNearAdjacentStrokes(
  outline: WebPoint[],
  previousStart: WebPoint | undefined,
  nextStart: WebPoint | undefined,
) {
  if (!previousStart) return outline;
  const travel = (point: WebPoint) =>
    pointDistance(previousStart, point) +
    (nextStart ? pointDistance(point, nextStart) : 0);
  let bestIndex = 0;
  let bestTravel = travel(outline[0]);
  // A sharp corner would already slow down. It makes a good closure point.
  for (let index = 1; index < outline.length - 1; index++) {
    const point = outline[index];
    const incoming = strokeEdge(outline[index - 1], point);
    const outgoing = strokeEdge(point, outline[index + 1]);
    if (
      Math.min(incoming.length, outgoing.length) < MIN_BLEND_SEGMENT_MM ||
      turnDegrees(incoming, outgoing) <= MAX_BLEND_TURN_DEGREES
    )
      continue;
    const candidate = travel(point);
    if (candidate < bestTravel) {
      bestIndex = index;
      bestTravel = candidate;
    }
  }
  return bestIndex
    ? [...outline.slice(bestIndex, -1), ...outline.slice(0, bestIndex + 1)]
    : outline;
}

function strokeBlendPercentages(points: readonly WebPoint[]) {
  const segments = points
    .slice(1)
    .map((point, index) => strokeEdge(points[index], point));
  if (
    segments.length > QUEUED_STROKE_MAX_TARGETS ||
    segments.reduce((total, segment) => total + segment.length, 0) >
      QUEUED_STROKE_MAX_LENGTH_MM
  )
    return undefined;
  return segments.map((segment, index) => {
    const next = segments[index + 1];
    if (!next) return 0;
    const turn = turnDegrees(segment, next);
    const minLength =
      turn <= NEAR_STRAIGHT_TURN_DEGREES
        ? MIN_STRAIGHT_BLEND_SEGMENT_MM
        : MIN_BLEND_SEGMENT_MM;
    if (
      turn > MAX_BLEND_TURN_DEGREES ||
      Math.min(segment.length, next.length) < minLength
    )
      return 0;
    if (turn <= FULL_BLEND_TURN_DEGREES) return STROKE_BLEND_PERCENT;
    const blend =
      (MAX_BLEND_TURN_DEGREES - turn) /
      (MAX_BLEND_TURN_DEGREES - FULL_BLEND_TURN_DEGREES);
    return Math.round(
      MIN_STROKE_BLEND_PERCENT +
        (STROKE_BLEND_PERCENT - MIN_STROKE_BLEND_PERCENT) * blend,
    );
  });
}

async function observeQueuedStroke(
  sequence: LinearMotionSequence,
  submit: () => Promise<MotionReceipt>,
  checkCanvas: () => void,
) {
  const check = () => {
    checkCanvas();
    sequence.check();
  };
  check();
  let timer: ReturnType<typeof setInterval> | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    timer = setInterval(() => {
      try {
        check();
      } catch (error) {
        reject(error);
      }
    }, 50);
  });
  try {
    const receipt = await Promise.race([submit(), interrupted]);
    await Promise.race([sequence.waitForCurrent(), interrupted]);
    check();
    return receipt;
  } finally {
    clearInterval(timer);
  }
}

export interface LogoCanvasSession {
  viewport: LogoViewport;
  minimumTravelTipZMm?: number;
  prepare(signal: AbortSignal): Promise<void>;
  check(): void;
  retryStroke?(stroke: number, signal: AbortSignal): Promise<void>;
  finish(error?: string): void;
}

export async function drawCalibrationLogo(
  host: ScreenMotionHost,
  calibration: CalibrationProfile,
  ctx: ApplicationContext,
  viewport: LogoViewport,
  checkCanvas: () => void,
  positioning?: {
    start?: CartesianPose;
    returnTo: CartesianPose;
    beforeMotion?: () => Promise<void>;
  },
  recoverStroke?: (
    stroke: number,
    hover: CartesianPose,
    error: RobotArmError,
  ) => Promise<void>,
) {
  const setupStarted = performance.now();
  const { screen, tool } = ctx;
  const constraints =
    host.adapter.resolver.descriptor('motion.linear')?.constraints;
  if (!constraints)
    throw new RobotArmError(
      'UNSUPPORTED_ACTION',
      'Linear motion is required to draw the logo',
      409,
    );
  const jointCount = host.adapter.capabilities.jointCount;
  const approach = stageOptions(screen, 'approach', constraints, jointCount);
  const entry = stageOptions(screen, 'entry', constraints, jointCount);
  const traverse = stageOptions(screen, 'traverse', constraints, jointCount);
  const releaseAccelerationFactor =
    screen.releaseAccelerationFactor === DEFAULT_RELEASE_ACCELERATION_FACTOR
      ? LOGO_RELEASE_ACCELERATION_FACTOR
      : screen.releaseAccelerationFactor;
  const release = releaseStageOptions(
    { ...screen, releaseAccelerationFactor },
    constraints,
    jointCount,
  );
  const recovery = stageOptions(screen, 'recovery', constraints, jointCount);

  const clearance =
    screen.safeHeightMm + surfaceClearanceMm(calibration.surface);
  const outlines = logoStrokes(viewport).map((contour) => {
    const outline = contour.map((point) =>
      phonePointMm(calibration, screen, point),
    );
    if (
      outline.some(
        ({ x, y }) =>
          ![x, y].every(Number.isFinite) ||
          x <= 0 ||
          x >= screen.physicalWidthMm ||
          y <= 0 ||
          y >= screen.physicalHeightMm,
      )
    )
      throw new RobotArmError(
        'INVALID_SCREEN_POINT',
        'The logo does not fit inside the calibrated touchscreen',
        409,
      );
    return outline;
  });
  const starts = outlines.map((outline) => outline[0]);
  const strokes = outlines.map((outline, index) => {
    const simplified = simplifyOutline(outline);
    const ordered = startNearAdjacentStrokes(
      simplified,
      starts[index - 1],
      starts[index + 1],
    );
    starts[index] = ordered[0];
    // Sample long edges too so they follow the fitted surface between corners.
    const points = ordered.flatMap((end, index) => {
      if (!index) return [end];
      const start = ordered[index - 1];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const steps = Math.ceil(Math.hypot(dx, dy) / 12);
      return Array.from({ length: steps }, (_, step) =>
        step + 1 === steps
          ? end
          : {
              x: start.x + (dx * (step + 1)) / steps,
              y: start.y + (dy * (step + 1)) / steps,
            },
      );
    });
    const hover = atTravelHeight(
      screenPoseMm(
        { ...calibration, surface: undefined },
        tool,
        points[0],
        -clearance,
      ),
      ctx,
    );
    const number = index + 1;
    const targets: MotionTarget[] = points.map((point, waypoint) => ({
      name: `Logo stroke ${number} point ${waypoint + 1}`,
      pose: screenPoseMm(calibration, tool, point, screen.pressDepthMm),
      options: waypoint === 0 ? entry : traverse,
    }));
    targets.push({
      name: `Logo stroke ${number} lift`,
      pose: hover,
      options: { ...release, traceCompletion: true },
    });
    return {
      hover,
      number,
      targets,
      outlineVerticesRemoved: outline.length - simplified.length,
      blendPercentages: strokeBlendPercentages(points),
    };
  });
  const initial = positioning?.start ?? (await host.adapter.getPose());
  const parked = host.safeLift(initial, calibration, ctx, false);
  const returnPose = positioning
    ? atTravelHeight(positioning.returnTo, ctx)
    : parked;
  const preflightStarted = performance.now();
  const preflightTiming = await host.preflight(
    [
      { name: 'Logo initial lift', pose: parked, options: recovery },
      ...strokes.flatMap(({ hover, number, targets }) => [
        {
          name: `Logo stroke ${number} approach`,
          pose: hover,
          options: approach,
        },
        ...targets,
      ]),
      { name: 'Logo return', pose: returnPose, options: approach },
    ],
    ctx,
  );
  const preflightFinished = performance.now();

  const move = (
    pose: CartesianPose,
    options: MotionOptions,
    contact?: ContactMoveOptions,
  ) => {
    checkCanvas();
    return host.move(pose, ctx, options.speed, options.acceleration, contact);
  };
  await positioning?.beforeMotion?.();
  if (distance(initial.positionMm, parked.positionMm) > 0.001)
    await move(parked, recovery);
  debug(
    `Logo preparation timing ${JSON.stringify({
      planningAndPoseMs: Math.round(preflightStarted - setupStarted),
      preflightMs: Math.round(preflightFinished - preflightStarted),
      ...(preflightTiming ?? {}),
      positioningMs: Math.round(performance.now() - preflightFinished),
    })}`,
  );
  let previousLiftConfirmedAtMs: number | undefined;
  const drawStroke = async (index: number, retry = false) => {
    const { hover, number, targets, blendPercentages, outlineVerticesRemoved } =
      strokes[index];
    const started = performance.now();
    const approachedMotion = await move(hover, approach, {
      arrivalSamples: HOVER_ARRIVAL_SAMPLES,
      reuseStableArrival: true,
    });
    checkCanvas();
    const approached = performance.now();
    const sequence = await host.beginSequence(targets, ctx);
    const prepared = performance.now();
    const liftIndex = targets.length - 1;
    const submitQueued = sequence?.submitQueued?.bind(sequence);
    let queueAckMs: number | undefined;
    let closureConfirmed: number | undefined;
    let contactConfirmedAtMs: number | undefined;
    let queuedAtMs: number | undefined;
    let liftSubmittedAtMs: number | undefined;
    let liftConfirmedAtMs: number | undefined;
    let liftTrace: MotionResult['completionTrace'];
    if (sequence && submitQueued && blendPercentages?.length) {
      checkCanvas();
      await sequence.submit(0);
      const contact = await sequence.waitForHandoff();
      contactConfirmedAtMs = contact.confirmedAt;
      await host.hold(Math.min(100, screen.contactMs));
      const queued = await observeQueuedStroke(
        sequence,
        () => submitQueued(blendPercentages),
        checkCanvas,
      );
      queuedAtMs = queued.submittedAt;
      queueAckMs = queued.acceptedAt - queued.submittedAt;
      closureConfirmed = performance.now();
      const lift = await sequence.submit(liftIndex);
      liftSubmittedAtMs = lift.submittedAt;
    } else {
      for (let index = 0; index < targets.length; index++) {
        const target = targets[index];
        if (sequence) {
          checkCanvas();
          await sequence.submit(index);
          if (index < liftIndex) await sequence.waitForHandoff();
        } else
          await move(
            target.pose,
            target.options,
            index < liftIndex
              ? { arrivalSamples: 1, skipStable: true }
              : undefined,
          );
        if (index === 0) await host.hold(Math.min(100, screen.contactMs));
      }
    }
    if (sequence) {
      const lifted = await sequence.finish();
      liftConfirmedAtMs = Date.parse(lifted.completedAt);
      liftTrace = lifted.completionTrace;
      sequence.dispose();
    }
    const finished = performance.now();
    debug(
      `Logo stroke timing ${JSON.stringify({
        stroke: number,
        retry: retry || undefined,
        mode: queueAckMs !== undefined ? 'queued' : 'per-target',
        contactTargets: liftIndex,
        outlineVerticesRemoved,
        transferTiming: {
          previousLiftConfirmedAtMs: retry
            ? undefined
            : previousLiftConfirmedAtMs,
          approachSubmittedAtMs: approachedMotion.submittedAt,
          contactConfirmedAtMs,
          queuedAtMs,
          liftSubmittedAtMs,
          liftTargetObservedAtMs: liftTrace?.targetObservedAtMs,
          liftSyncRepliedAtMs: liftTrace?.syncRepliedAtMs,
          liftConfirmedAtMs,
        },
        penUpTravelMm:
          index > 0
            ? Math.round(
                distance(
                  strokes[index - 1].hover.positionMm,
                  hover.positionMm,
                ) * 100,
              ) / 100
            : undefined,
        maxBlendPercent:
          queueAckMs !== undefined && blendPercentages
            ? Math.max(...blendPercentages)
            : undefined,
        releaseAccelerationFactor,
        blendedTargets:
          queueAckMs !== undefined
            ? blendPercentages?.filter((percent) => percent > 0).length
            : undefined,
        unblendedWaypoints:
          queueAckMs !== undefined
            ? blendPercentages?.flatMap((percent, index) =>
                percent === 0 ? [index + 2] : [],
              )
            : undefined,
        approachAndPreparationMs: Math.round(prepared - started),
        approachMs: Math.round(approached - started),
        sequencePreparationMs: Math.round(prepared - approached),
        entryThroughLiftMs: Math.round(finished - prepared),
        liftAndConfirmationMs:
          closureConfirmed === undefined
            ? undefined
            : Math.round(finished - closureConfirmed),
        queueAckMs,
      })}`,
    );
    previousLiftConfirmedAtMs = liftConfirmedAtMs;
  };
  let retried = false;
  for (const [index, { number, hover }] of strokes.entries()) {
    try {
      await drawStroke(index);
    } catch (error) {
      if (
        !recoverStroke ||
        !isRobotArmError(error) ||
        error.code !== 'SEQUENCE_FAULT_STATE_STALE'
      )
        throw error;
      try {
        if (retried) throw error;
        retried = true;
        await recoverStroke(number, hover, error);
        await drawStroke(index, true);
      } catch (cause) {
        throw new RobotArmError(
          'RECOVERY_REQUIRED',
          `Logo stroke ${number} could not resume safely. Confirm recovery before moving.`,
          409,
          {
            logoRetryFailed: true,
            stroke: number,
            original: error.details,
            cause: cause instanceof Error ? cause.message : String(cause),
            causeCode: isRobotArmError(cause) ? cause.code : undefined,
            causeDetails: isRobotArmError(cause) ? cause.details : undefined,
          },
        );
      }
    }
  }
  await move(returnPose, approach);
}
