import type { ImagePoint } from '@midscene/robotics-shared/camera/vision-types';
import type {
  CalibrationProfile,
  CameraCorrection,
  ScreenProfile,
} from '../contracts.js';
type VisionScreenQuad = CameraCorrection['points'];
export interface WorkstationScreenTarget {
  cameraId: string;
  screenId: string;
  name: string;
  profileKey?: string;
  pixelWidth?: number;
  pixelHeight?: number;
}
import { type ProfileData, calibrationAccepted } from '../contracts.js';
import {
  type Homography,
  type PlanePoint,
  applyHomography,
  solveHomography,
} from './plane-homography.js';
import { surfaceClearanceMm } from './surface.js';

/**
 * Where a screen sits on the bench, and whether the stylus is over the screen
 * the operator selected.
 *
 * Two independent questions are answered here:
 *
 * - a calibrated screen has four corners in robot XY, so its rectangle is
 *   known exactly;
 * - a screen without a calibration can still be placed through the perspective
 *   homography implied by the calibrated screens, because they share the bench
 *   plane.
 *
 * The page-mapping service stores the raw image quad and, separately, the
 * clockwise output rotation (see `locateWorkstation` and the preview
 * projection). The page's top-left corner is therefore image corner
 * `(j - rotation / 90) mod 4`, not always corner `j`. Every robot-side reader
 * must apply the same offset, otherwise a rotated page feeds cyclically shifted
 * correspondences into the homography and the estimated bench position is
 * wrong.
 */

export type ScreenRotation = 0 | 90 | 180 | 270;

/** Screen TL, TR, BR, BL in the page's own orientation. */
export type ScreenQuad = [PlanePoint, PlanePoint, PlanePoint, PlanePoint];

/**
 * A stylus this far outside a calibrated rectangle still counts as "over it".
 * The calibration rectangle is measured from touches, so a placement a few
 * millimetres outside the glass is a real error, not noise.
 */
export const SCREEN_PLACEMENT_TOLERANCE_MM = 10;
/** A screen-to-screen margin: 2 mm inside a neighbour's edge is already over it. */
export const SCREEN_OVERLAP_INSET_MM = 2;
/**
 * The perspective estimate shares the bench plane only when the screens are
 * mounted at the same height, so it is a gross-error detector, not a
 * millimetre measurement.
 */
export const SCREEN_ESTIMATE_TOLERANCE_MM = 25;

/** Conservative XY exclusion area for a screen estimated from camera geometry. */
export function estimatedScreenExclusion(quad: ScreenQuad): ScreenQuad {
  const minX =
    Math.min(...quad.map((point) => point.x)) - SCREEN_ESTIMATE_TOLERANCE_MM;
  const maxX =
    Math.max(...quad.map((point) => point.x)) + SCREEN_ESTIMATE_TOLERANCE_MM;
  const minY =
    Math.min(...quad.map((point) => point.y)) - SCREEN_ESTIMATE_TOLERANCE_MM;
  const maxY =
    Math.max(...quad.map((point) => point.y)) + SCREEN_ESTIMATE_TOLERANCE_MM;
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

export function screenRotationOffset(rotation?: number): number {
  if (rotation === 90) return 1;
  if (rotation === 180) return 2;
  if (rotation === 270) return 3;
  return 0;
}

/** Image corners in page order: page corner `j` is image corner `(j - offset)`. */
export function pageOrderedQuad(
  quad: VisionScreenQuad,
  rotation?: number,
): ScreenQuad {
  const points: readonly ImagePoint[] = [
    quad.topLeft,
    quad.topRight,
    quad.bottomRight,
    quad.bottomLeft,
  ];
  const offset = screenRotationOffset(rotation);
  return [0, 1, 2, 3].map(
    (index) => points[(index - offset + 4) % 4],
  ) as unknown as ScreenQuad;
}

export function calibrationQuad(
  calibration: Pick<CalibrationProfile, 'origin' | 'xAxis' | 'yAxis'>,
  screen: Pick<ScreenProfile, 'physicalWidthMm' | 'physicalHeightMm'>,
): ScreenQuad | undefined {
  const width = screen.physicalWidthMm;
  const height = screen.physicalHeightMm;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    (width as number) <= 0 ||
    (height as number) <= 0
  )
    return undefined;
  const { origin, xAxis, yAxis } = calibration;
  const at = (u: number, v: number): PlanePoint => ({
    x: origin.x + xAxis.x * u + yAxis.x * v,
    y: origin.y + xAxis.y * u + yAxis.y * v,
  });
  return [
    at(0, 0),
    at(width as number, 0),
    at(width as number, height as number),
    at(0, height as number),
  ];
}

export function quadCenter(quad: readonly PlanePoint[]): PlanePoint {
  const count = quad.length || 1;
  return {
    x: quad.reduce((sum, point) => sum + point.x, 0) / count,
    y: quad.reduce((sum, point) => sum + point.y, 0) / count,
  };
}

/**
 * Signed distance from `point` to each edge of a convex quadrilateral, positive
 * inside. An empty array marks a degenerate quad.
 */
function edgeDistances(
  point: PlanePoint,
  quad: readonly PlanePoint[],
): number[] {
  if (quad.length !== 4) return [];
  let area = 0;
  for (let index = 0; index < 4; index++) {
    const from = quad[index];
    const to = quad[(index + 1) % 4];
    area += from.x * to.y - to.x * from.y;
  }
  const orientation = Math.sign(area);
  if (!orientation) return [];
  const distances: number[] = [];
  for (let index = 0; index < 4; index++) {
    const from = quad[index];
    const to = quad[(index + 1) % 4];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length < 1e-9) return [];
    const cross = dx * (point.y - from.y) - dy * (point.x - from.x);
    distances.push((cross * orientation) / length);
  }
  return distances;
}

/** Positive `marginMm` demands the point be that far inside every edge. */
export function insideQuad(
  point: PlanePoint,
  quad: readonly PlanePoint[],
  marginMm = 0,
): boolean {
  const distances = edgeDistances(point, quad);
  return Boolean(distances.length) && distances.every((d) => d >= marginMm);
}

export function distanceToQuad(
  point: PlanePoint,
  quad: readonly PlanePoint[],
): number {
  const distances = edgeDistances(point, quad);
  if (!distances.length) return Number.POSITIVE_INFINITY;
  if (distances.every((value) => value >= 0)) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < 4; index++) {
    const from = quad[index];
    const to = quad[(index + 1) % 4];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared
      ? Math.min(
          1,
          Math.max(
            0,
            ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared,
          ),
        )
      : 0;
    const distance = Math.hypot(
      point.x - (from.x + dx * t),
      point.y - (from.y + dy * t),
    );
    if (distance < best) best = distance;
  }
  return best;
}

export interface ScreenPlaneSource {
  /** Page-ordered image corners of an already calibrated screen. */
  image: ScreenQuad;
  /** Robot XY corners of the same screen from its accepted calibration. */
  robot: ScreenQuad;
}

/** One screen profile with its latest accepted calibration. */
export interface CalibratedScreenEntry {
  screen: ScreenProfile;
  calibration: CalibrationProfile;
}

/**
 * Image corners of every calibrated screen, paired with its robot corners.
 * Screens without a current perspective profile or without measured physical
 * dimensions cannot contribute.
 */
export function screenPlaneSources(input: {
  entries: readonly CalibratedScreenEntry[];
  cameraId: string;
  targets: readonly WorkstationScreenTarget[];
  profiles: ReadonlyMap<
    string,
    { points: VisionScreenQuad; rotation?: number }
  >;
}): ScreenPlaneSource[] {
  const sources: ScreenPlaneSource[] = [];
  for (const { screen, calibration } of input.entries) {
    if (screen.visionTarget?.cameraId !== input.cameraId) continue;
    const target = input.targets.find(
      (item) => item.screenId === screen.visionTarget?.screenId,
    );
    const profile = target?.profileKey
      ? input.profiles.get(target.profileKey)
      : undefined;
    if (!profile) continue;
    const robot = calibrationQuad(calibration, screen);
    if (!robot) continue;
    sources.push({
      image: pageOrderedQuad(profile.points, profile.rotation),
      robot,
    });
  }
  return sources;
}

/** Reject mirrored, self-intersecting or absurdly sized estimates. */
function plausibleQuad(quad: readonly PlanePoint[]): boolean {
  if (
    quad.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))
  )
    return false;
  let area = 0;
  for (let index = 0; index < 4; index++) {
    const from = quad[index];
    const to = quad[(index + 1) % 4];
    const edge = Math.hypot(to.x - from.x, to.y - from.y);
    if (edge < 10 || edge > 2000) return false;
    area += from.x * to.y - to.x * from.y;
  }
  const orientation = Math.sign(area);
  if (!orientation || Math.abs(area) / 2 < 100) return false;
  // Every consecutive turn must agree; a bow-tie or mirrored quad fails.
  for (let index = 0; index < 4; index++) {
    const from = quad[index];
    const to = quad[(index + 1) % 4];
    const next = quad[(index + 2) % 4];
    const turn =
      (to.x - from.x) * (next.y - to.y) - (to.y - from.y) * (next.x - to.x);
    if (turn * orientation <= 0) return false;
  }
  return true;
}

export interface ScreenPlaneEstimate {
  quad: ScreenQuad;
  center: PlanePoint;
  /** Number of calibrated screens the homography was fitted from. */
  sources: number;
}

/**
 * Place an uncalibrated screen on the bench from the calibrated screens' shared
 * image-to-bench homography.
 */
export function estimateScreenPlane(
  sources: readonly ScreenPlaneSource[],
  targetImageQuad: ScreenQuad,
): ScreenPlaneEstimate | undefined {
  if (!sources.length) return undefined;
  const pairs = sources.flatMap(({ image, robot }) =>
    image.map((source, index) => ({ source, target: robot[index] })),
  );
  const homography: Homography | undefined = solveHomography(pairs);
  if (!homography) return undefined;
  const mapped = targetImageQuad.map((point) =>
    applyHomography(homography, point),
  );
  if (mapped.some((point) => !point)) return undefined;
  const quad = mapped as ScreenQuad;
  if (!plausibleQuad(quad)) return undefined;
  return { quad, center: quadCenter(quad), sources: sources.length };
}

export type ScreenPlacementIssue =
  | {
      kind: 'previous-exploration';
      screenId: string;
      screenName: string;
    }
  | {
      kind: 'other-screen';
      screenId: string;
      screenName: string;
      quad: ScreenQuad;
    }
  | {
      kind: 'outside-target';
      screenName: string;
      quad: ScreenQuad;
      distanceMm: number;
    }
  | {
      kind: 'outside-estimate';
      screenName: string;
      quad: ScreenQuad;
      distanceMm: number;
    };

export interface ScreenPlacementInput {
  /** Contact-tip position in the robot base frame. */
  tip: PlanePoint;
  target: { name: string; quad?: ScreenQuad };
  /** Every other screen that has a known rectangle. */
  others: readonly {
    screenId: string;
    screenName: string;
    quad: ScreenQuad;
  }[];
  /** Estimated rectangle of the target when it has no calibration yet. */
  estimate?: ScreenQuad;
  /** Same-batch starts and measured contacts, even from rejected calibrations.
   * These are exclusion areas only, never geometry for automatic movement.
   */
  previousExplorations?: readonly {
    screenId: string;
    screenName: string;
    points: readonly PlanePoint[];
  }[];
}

/** Convex measured region, with a margin for contact repeatability/inset edges. */
function insideExplorationArea(
  tip: PlanePoint,
  points: readonly PlanePoint[],
): boolean {
  const sorted = points
    .filter((p) => [p.x, p.y].every(Number.isFinite))
    .slice()
    .sort((a, b) => a.x - b.x || a.y - b.y);
  if (!sorted.length) return false;
  const cross = (a: PlanePoint, b: PlanePoint, c: PlanePoint) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const chain = (ordered: readonly PlanePoint[]) => {
    const result: PlanePoint[] = [];
    for (const point of ordered) {
      while (
        result.length >= 2 &&
        cross(result[result.length - 2], result[result.length - 1], point) <= 0
      )
        result.pop();
      result.push(point);
    }
    return result;
  };
  const hull = [
    ...chain(sorted).slice(0, -1),
    ...chain([...sorted].reverse()).slice(0, -1),
  ];
  if (!hull.length) hull.push(sorted[0]);
  if (
    hull.length >= 3 &&
    hull.every((p, i) => cross(p, hull[(i + 1) % hull.length], tip) >= 0)
  )
    return true;
  return hull.some((from, i) => {
    const to = hull[(i + 1) % hull.length];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared
      ? Math.max(
          0,
          Math.min(
            1,
            ((tip.x - from.x) * dx + (tip.y - from.y) * dy) / lengthSquared,
          ),
        )
      : 0;
    return (
      Math.hypot(tip.x - from.x - t * dx, tip.y - from.y - t * dy) <=
      SCREEN_PLACEMENT_TOLERANCE_MM
    );
  });
}

/**
 * Reports the first reason the current tip position cannot calibrate the
 * selected screen. An empty result means the placement is acceptable, or that
 * nothing is known yet (a first-ever calibration).
 */
export function screenPlacementIssues(
  input: ScreenPlacementInput,
): ScreenPlacementIssue[] {
  for (const area of input.previousExplorations ?? []) {
    if (insideExplorationArea(input.tip, area.points))
      return [
        {
          kind: 'previous-exploration',
          screenId: area.screenId,
          screenName: area.screenName,
        },
      ];
  }
  for (const other of input.others) {
    if (insideQuad(input.tip, other.quad, SCREEN_OVERLAP_INSET_MM))
      return [
        {
          kind: 'other-screen',
          screenId: other.screenId,
          screenName: other.screenName,
          quad: other.quad,
        },
      ];
  }
  if (input.target.quad) {
    if (
      !insideQuad(input.tip, input.target.quad, -SCREEN_PLACEMENT_TOLERANCE_MM)
    )
      return [
        {
          kind: 'outside-target',
          screenName: input.target.name,
          quad: input.target.quad,
          distanceMm: distanceToQuad(input.tip, input.target.quad),
        },
      ];
    return [];
  }
  if (input.estimate) {
    if (!insideQuad(input.tip, input.estimate, -SCREEN_ESTIMATE_TOLERANCE_MM))
      return [
        {
          kind: 'outside-estimate',
          screenName: input.target.name,
          quad: input.estimate,
          distanceMm: distanceToQuad(input.tip, input.estimate),
        },
      ];
  }
  return [];
}

/** Operator-facing explanation of a rejected placement. */
export function screenPlacementMessage(
  issue: ScreenPlacementIssue,
  targetName: string,
): string {
  if (issue.kind === 'previous-exploration')
    return `The stylus is still in the previous exploration area for "${issue.screenName}"; move it above "${targetName}" before continuing`;
  if (issue.kind === 'other-screen')
    return `The stylus is over "${issue.screenName}" but "${targetName}" is the calibration target; select that screen or place the stylus over "${targetName}"`;
  if (issue.kind === 'outside-target')
    return `The stylus is ${issue.distanceMm.toFixed(1)} mm outside the calibrated screen "${issue.screenName}"; place it over that screen`;
  return `The stylus is ${issue.distanceMm.toFixed(1)} mm outside the estimated position of "${issue.screenName}"; confirm the screen selection or place it over that screen`;
}

/** A free transfer clears every measured screen, not just the two endpoints. */
export function knownScreenTravelHeight(
  data: ProfileData,
  binding: { robotProfileId: string; toolProfileId: string },
): number {
  let height = Number.NEGATIVE_INFINITY;
  for (const device of data.devices ?? []) {
    if (
      device.robotProfileId !== binding.robotProfileId ||
      device.toolProfileId !== binding.toolProfileId
    )
      continue;
    const c = data.calibrations.find(
      (c) => c.id === device.calibrationProfileId,
    );
    const screen = data.screens.find((s) => s.id === device.screenProfileId);
    if (!c || !screen || !calibrationAccepted(c, c.pendingParkingBatchId))
      continue;
    for (const [x, y] of [
      [0, 0],
      [screen.physicalWidthMm, 0],
      [screen.physicalWidthMm, screen.physicalHeightMm],
      [0, screen.physicalHeightMm],
    ])
      height = Math.max(
        height,
        c.origin.z +
          c.xAxis.z * x +
          c.yAxis.z * y +
          screen.safeHeightMm +
          surfaceClearanceMm(c.surface) +
          1,
      );
  }
  return height;
}
