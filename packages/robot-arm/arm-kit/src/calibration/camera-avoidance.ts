import {
  type CalibrationBatchPlan,
  type CalibrationProfile,
  type CameraAvoidanceEstimate,
  type CameraCorrection,
  type CameraImageEdge,
  type CartesianPose,
  type InstallationTeaching,
  RobotArmError,
  type ScreenProfile,
  type ToolProfile,
} from '../contracts.js';
import { surfaceClearanceMm } from './surface.js';
function assertScreenPhysicalSize(screen: ScreenProfile) {
  if (
    ![screen.physicalWidthMm, screen.physicalHeightMm].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    throw new RobotArmError('INVALID_ARGUMENT', 'Invalid measured screen size');
}
import { screenPoseMm } from './geometry.js';
type PlanePoint = { x: number; y: number };
type VisionScreenQuad = CameraCorrection['points'];
import { calibrationQuad } from './screen-position.js';

/** Below this relative edge difference the quad cannot name a camera side. */
export const CAMERA_AVOIDANCE_MIN_SKEW = 0.02;
/** Confidence needed before the automatic avoidance move is allowed. */
export const CAMERA_AVOIDANCE_MIN_CONFIDENCE = 0.25;
/** Extra distance outside the screen edge, as a part of the shorter side. */
export const CAMERA_AVOIDANCE_OUTSIDE_FRACTION = 0.2;
/** Never stop just on the boundary; leave at least this much outside it. */
export const CAMERA_AVOIDANCE_MIN_OUTSIDE_MM = 10;
/** Extra clearance above the configured safe height for the avoidance pose. */
export const CAMERA_AVOIDANCE_EXTRA_HEIGHT_MM = 1;
/** Step used to walk the parking pose clear of another screen. */
const CAMERA_AVOIDANCE_OBSTACLE_STEP_MM = 20;
/** Never walk farther than this to clear another screen. */
const CAMERA_AVOIDANCE_OBSTACLE_LIMIT_MM = 300;
/** Keep the parking pose this far outside the screens' combined footprint. */
const CAMERA_AVOIDANCE_PARKING_MARGIN_MM = 10;

export function insideCameraParkingFootprint(
  tip: PlanePoint,
  points: readonly PlanePoint[],
): boolean {
  const margin = CAMERA_AVOIDANCE_PARKING_MARGIN_MM;
  return (
    tip.x >= Math.min(...points.map((point) => point.x)) - margin &&
    tip.x <= Math.max(...points.map((point) => point.x)) + margin &&
    tip.y >= Math.min(...points.map((point) => point.y)) - margin &&
    tip.y <= Math.max(...points.map((point) => point.y)) + margin
  );
}

export function assertParkingCorridor(
  tip: PlanePoint,
  corridor?: NonNullable<CalibrationBatchPlan['transfer']>['corridor'],
): void {
  if (
    corridor &&
    (tip.x < corridor.minX ||
      tip.x > corridor.maxX ||
      tip.y < corridor.minY ||
      tip.y > corridor.maxY)
  )
    throw new RobotArmError(
      'UNSAFE_OBSERVATION',
      'The route to the shared Safe Position is outside the confirmed corridor.',
      409,
    );
}

const distance = (
  left: { x: number; y: number },
  right: { x: number; y: number },
): number => Math.hypot(left.x - right.x, left.y - right.y);

/**
 * Estimate which side of the screen the screen camera is on.
 *
 * Without an explicit source-image near edge, edge skew is advisory only and
 * has zero motion confidence: optical aim can reverse it. With a confirmed
 * mounting constraint, map the opposite image direction through the inverse
 * local homography at the screen centre. The result uses normalized screen
 * coordinates; cameraAvoidanceTarget converts it to millimetres.
 */
export function estimateCameraSide(
  quad: VisionScreenQuad,
  rotation = 0,
  nearImageEdge?: CameraImageEdge,
): CameraAvoidanceEstimate {
  if (
    nearImageEdge !== undefined &&
    !['top', 'right', 'bottom', 'left'].includes(nearImageEdge)
  )
    throw new RobotArmError(
      'INVALID_ARGUMENT',
      'Invalid camera-near image edge',
      400,
    );
  if (![0, 90, 180, 270].includes(rotation))
    throw new RobotArmError(
      'VISION_BINDING_INVALID',
      'Perspective rotation must be 0, 90, 180 or 270 degrees',
      502,
    );
  // The profile points are in source-image order. The page mapping and the
  // calibrated screen axes use the corrected output orientation, so compare the
  // physical edges after the output rotation, not the raw source labels.
  const source = [
    quad.topLeft,
    quad.topRight,
    quad.bottomRight,
    quad.bottomLeft,
  ];
  // destinationCorners() maps each source corner to a corrected-output corner:
  // at 90 degrees, the source bottom-left lands at the output top-left. Reorder
  // the source points into output order before comparing physical edges or
  // projecting the raw-image retreat.
  const offset = rotation / 90;
  const oriented = {
    topLeft: source[(4 - offset) % 4],
    topRight: source[(5 - offset) % 4],
    bottomRight: source[(6 - offset) % 4],
    bottomLeft: source[(7 - offset) % 4],
  };
  const points = [
    oriented.topLeft,
    oriented.topRight,
    oriented.bottomRight,
    oriented.bottomLeft,
  ];
  if (
    points.some(
      (point) =>
        !point || !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )
  )
    throw new RobotArmError(
      'VISION_BINDING_INVALID',
      'Perspective corners must be finite image points',
      502,
    );
  const left = distance(oriented.topLeft, oriented.bottomLeft);
  const right = distance(oriented.topRight, oriented.bottomRight);
  const top = distance(oriented.topLeft, oriented.topRight);
  const bottom = distance(oriented.bottomLeft, oriented.bottomRight);
  const horizontalTotal = left + right;
  const verticalTotal = top + bottom;
  if (horizontalTotal < 1 || verticalTotal < 1)
    return {
      direction: { x: 0, y: 0 },
      confidence: 0,
      horizontalSkew: 0,
      verticalSkew: 0,
      source: 'perspective-quad',
    };
  const horizontalSkew = (left - right) / horizontalTotal;
  const verticalSkew = (top - bottom) / verticalTotal;
  const magnitude = Math.hypot(horizontalSkew, verticalSkew);
  if (nearImageEdge) {
    const direction = sourceImageRetreat(points, nearImageEdge);
    return {
      direction,
      confidence: 1,
      horizontalSkew,
      verticalSkew,
      source: 'source-image-edge',
      nearImageEdge,
    };
  }
  if (magnitude < CAMERA_AVOIDANCE_MIN_SKEW)
    return {
      direction: { x: 0, y: 0 },
      confidence: 0,
      horizontalSkew,
      verticalSkew,
      source: 'perspective-quad',
    };
  return {
    direction: {
      x: horizontalSkew / magnitude,
      y: verticalSkew / magnitude,
    },
    confidence: 0,
    horizontalSkew,
    verticalSkew,
    source: 'perspective-quad',
  };
}

/** Inverse Jacobian of the unit-screen-to-source-image homography. */
function sourceImageRetreat(
  points: VisionScreenQuad['topLeft'][],
  edge: CameraImageEdge,
) {
  let orientation = 0;
  for (let i = 0; i < 4; i++) {
    const a = points[i];
    const b = points[(i + 1) % 4];
    const c = points[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (i === 0) orientation = Math.sign(cross);
    if (
      !Number.isFinite(cross) ||
      Math.abs(cross) < 1e-6 ||
      Math.sign(cross) !== orientation
    )
      throw new RobotArmError(
        'VISION_BINDING_INVALID',
        'Perspective quad must be convex and nondegenerate',
        502,
      );
  }
  const [p0, p1, p2, p3] = points;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const h = (dx1 * dy3 - dx3 * dy1) / det;
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  const denominator = 1 + (g + h) / 2;
  const x = (p0.x + (a + b) / 2) / denominator;
  const y = (p0.y + (d + e) / 2) / denominator;
  const j00 = (a - x * g) / denominator;
  const j01 = (b - x * h) / denominator;
  const j10 = (d - y * g) / denominator;
  const j11 = (e - y * h) / denominator;
  const determinant = j00 * j11 - j01 * j10;
  const away = { top: [0, 1], right: [-1, 0], bottom: [0, -1], left: [1, 0] }[
    edge
  ];
  const u = (j11 * away[0] - j01 * away[1]) / determinant;
  const v = (-j10 * away[0] + j00 * away[1]) / determinant;
  const norm = Math.hypot(u, v);
  if (!Number.isFinite(norm) || norm < 1e-12)
    throw new RobotArmError(
      'VISION_BINDING_INVALID',
      'Perspective direction is degenerate',
      502,
    );
  return { x: u / norm, y: v / norm };
}

/**
 * Compute the safe-height pose on the side opposite the estimated camera.
 * `obstacles` are the other screens on the bench: a parking pose that still
 * sits over one of them hides that screen from the camera even though it clears
 * the screen just calibrated. Returns undefined without confirmed teaching or a
 * source-image constraint. Reachability is not assumed here; the caller must
 * preflight the target before moving.
 */
export function cameraAvoidanceTarget(
  calibration: CalibrationProfile,
  screen: ScreenProfile,
  tool: ToolProfile,
  estimate: CameraAvoidanceEstimate | undefined,
  obstacles: readonly (readonly PlanePoint[])[] = [],
): CartesianPose | undefined {
  if (
    !estimate ||
    (estimate.source !== 'installation-teaching' &&
      (estimate.source !== 'source-image-edge' ||
        !estimate.nearImageEdge ||
        !['top', 'right', 'bottom', 'left'].includes(
          estimate.nearImageEdge,
        ))) ||
    !Number.isFinite(estimate.confidence) ||
    estimate.confidence < CAMERA_AVOIDANCE_MIN_CONFIDENCE
  )
    return undefined;
  const magnitude = Math.hypot(estimate.direction.x, estimate.direction.y);
  if (!Number.isFinite(magnitude) || magnitude < 1e-6) return undefined;
  assertScreenPhysicalSize(screen);
  const width = screen.physicalWidthMm;
  const height = screen.physicalHeightMm;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const metricMagnitude = Math.hypot(
    estimate.direction.x * width,
    estimate.direction.y * height,
  );
  const directionX = (estimate.direction.x * width) / metricMagnitude;
  const directionY = (estimate.direction.y * height) / metricMagnitude;
  // Distance from the centre to the first screen edge along the avoidance
  // direction, then continue past that edge. The tool must not stop inside the
  // display; it has to be visibly outside the screen rectangle.
  const edgeDistance = Math.min(
    Math.abs(directionX) > 1e-9
      ? halfWidth / Math.abs(directionX)
      : Number.POSITIVE_INFINITY,
    Math.abs(directionY) > 1e-9
      ? halfHeight / Math.abs(directionY)
      : Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(edgeDistance)) return undefined;
  const outsideMargin = Math.max(
    CAMERA_AVOIDANCE_MIN_OUTSIDE_MM,
    Math.min(width, height) * CAMERA_AVOIDANCE_OUTSIDE_FRACTION,
  );
  const baseDistance = edgeDistance + outsideMargin;
  const point = (distance: number): PlanePoint => ({
    x: halfWidth + directionX * distance,
    y: halfHeight + directionY * distance,
  });
  const robotPoint = (value: PlanePoint): PlanePoint => ({
    x:
      calibration.origin.x +
      calibration.xAxis.x * value.x +
      calibration.yAxis.x * value.y,
    y:
      calibration.origin.y +
      calibration.xAxis.y * value.x +
      calibration.yAxis.y * value.y,
  });
  /*
   * A pose in the gap between two screens is still over the bench footprint
   * and lets the arm body hide either display. When other screens are known,
   * walk the same exit until the stylus is outside the combined rectangle of
   * every screen by a visible margin. Without other screens the single-screen
   * target above is unchanged.
   */
  let distance = baseDistance;
  let target = point(distance);
  if (obstacles.length) {
    const ownQuad = calibrationQuad(calibration, screen);
    if (!ownQuad) return undefined;
    const points = [ownQuad, ...obstacles].flat();
    while (insideCameraParkingFootprint(robotPoint(target), points)) {
      if (distance - baseDistance >= CAMERA_AVOIDANCE_OBSTACLE_LIMIT_MM)
        return undefined;
      distance += CAMERA_AVOIDANCE_OBSTACLE_STEP_MM;
      target = point(distance);
    }
  }
  // Outside the display, do not extrapolate its fitted contact correction.
  // Stay above the plane and the complete measured surface envelope instead.
  const clearance =
    screen.safeHeightMm +
    CAMERA_AVOIDANCE_EXTRA_HEIGHT_MM +
    surfaceClearanceMm(calibration.surface);
  return screenPoseMm(
    { ...calibration, surface: undefined },
    tool,
    target,
    -clearance,
  );
}

/** Derive the away direction from validated teaching in robot-base XY. */
export function taughtCameraSide(
  calibration: CalibrationProfile,
  screen: ScreenProfile,
  teaching: InstallationTeaching,
): CameraAvoidanceEstimate {
  assertScreenPhysicalSize(screen);
  const { xAxis: x, yAxis: y } = calibration;
  const { normal } = teaching.cameraBoundary;
  const determinant = x.x * y.y - x.y * y.x;
  const u = (-normal.x * y.y + normal.y * y.x) / determinant;
  const v = (-x.x * normal.y + x.y * normal.x) / determinant;
  const dx = u / screen.physicalWidthMm;
  const dy = v / screen.physicalHeightMm;
  const magnitude = Math.hypot(dx, dy);
  if (!Number.isFinite(magnitude) || magnitude < 1e-12)
    throw new RobotArmError(
      'INVALID_ARGUMENT',
      'Taught camera direction cannot be mapped to the screen',
    );
  return {
    source: 'installation-teaching',
    direction: { x: dx / magnitude, y: dy / magnitude },
    confidence: 1,
    horizontalSkew: 0,
    verticalSkew: 0,
  };
}

/** Try both lateral exits before retreating towards the opposite side. */
export function cameraAvoidanceTargets(
  calibration: CalibrationProfile,
  screen: ScreenProfile,
  tool: ToolProfile,
  estimate: CameraAvoidanceEstimate | undefined,
  obstacles: readonly (readonly PlanePoint[])[] = [],
  retreat = false,
): CartesianPose[] {
  if (!estimate) return [];
  const opposite = cameraAvoidanceTarget(
    calibration,
    screen,
    tool,
    estimate,
    obstacles,
  );
  assertScreenPhysicalSize(screen);
  // Rotate in robot-base XY, not normalized pixels: a rectangular or tilted
  // screen must still produce lateral motion relative to the taught boundary.
  const { xAxis: x, yAxis: y } = calibration;
  const u = estimate.direction.x * screen.physicalWidthMm;
  const v = estimate.direction.y * screen.physicalHeightMm;
  const awayX = x.x * u + y.x * v;
  const awayY = x.y * u + y.y * v;
  const determinant = x.x * y.y - x.y * y.x;
  const sideU = (-awayY * y.y - awayX * y.x) / determinant;
  const sideV = (x.x * awayX + x.y * awayY) / determinant;
  const lateral = [1, -1].map((sign) =>
    cameraAvoidanceTarget(
      calibration,
      screen,
      tool,
      {
        ...estimate,
        direction: {
          x: (sign * sideU + (retreat ? u : 0)) / screen.physicalWidthMm,
          y: (sign * sideV + (retreat ? v : 0)) / screen.physicalHeightMm,
        },
      },
      obstacles,
    ),
  );
  return [
    ...lateral.filter((pose): pose is CartesianPose => Boolean(pose)),
    ...(opposite ? [opposite] : []),
  ];
}
