import type { CameraCorrection } from '@midscene/arm-kit-shared/camera/profile';
import {
  applyHomography,
  computeHomography,
  destinationCorners,
  validateQuad,
} from '@midscene/arm-kit-shared/camera/vision-geometry';
import type {
  PerspectiveRotation,
  PerspectiveTarget,
} from '@midscene/arm-kit-shared/camera/vision-types';
import type { ScreenPoint } from '@midscene/arm-kit-shared/contracts';

export interface PreviewPoint {
  x: number;
  y: number;
}

/** One calibrated screen as it appears on the camera stage. */
export interface PreviewScreenGeometry {
  id: string;
  name?: string;
  correction: CameraCorrection;
  target?: PerspectiveTarget;
  /** Screen pixels used by the robot action contract. */
  pixelWidth: number;
  pixelHeight: number;
  calibrationId?: string;
  active?: boolean;
  ready?: boolean;
}

export interface ClippedPreviewSegment {
  from: PreviewPoint;
  to: PreviewPoint;
  screenFrom: ScreenPoint;
  screenTo: ScreenPoint;
}

export interface PreviewProjection {
  width: number;
  height: number;
  /** Point-in-quad test in preview-image pixels. */
  contains(point: PreviewPoint): boolean;
  /** Convert a preview-image point to screen pixels. */
  toScreen(point: PreviewPoint): ScreenPoint;
  /** Convert screen pixels back to preview-image pixels for feedback drawing. */
  toImage(point: PreviewPoint): PreviewPoint;
  /** Clip a drag to the screen and return both image and screen points. */
  clipSegment(
    from: PreviewPoint,
    to: PreviewPoint,
  ): ClippedPreviewSegment | undefined;
}

function assertDimensions(width: number, height: number): void {
  if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0)
    throw new Error('Preview dimensions must be positive and finite');
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 2 ||
    height < 2
  )
    throw new Error('Preview dimensions must be integers of at least 2 pixels');
}

function assertScreenDimensions(
  screen: Pick<PreviewScreenGeometry, 'pixelWidth' | 'pixelHeight'>,
): void {
  if (
    !Number.isInteger(screen.pixelWidth) ||
    !Number.isInteger(screen.pixelHeight) ||
    screen.pixelWidth < 2 ||
    screen.pixelHeight < 2
  )
    throw new Error('Screen pixels must be integers of at least 2 × 2');
}

function assertRotation(
  rotation: number,
): asserts rotation is PerspectiveRotation {
  if (![0, 90, 180, 270].includes(rotation))
    throw new Error('Preview mapping requires a valid output rotation');
}

const cross = (a: PreviewPoint, b: PreviewPoint, point: PreviewPoint) =>
  (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);

function scaledQuad(
  correction: CameraCorrection,
  width: number,
  height: number,
): PreviewPoint[] {
  if (
    !Number.isFinite(correction.sourceWidth) ||
    !Number.isFinite(correction.sourceHeight) ||
    correction.sourceWidth < 2 ||
    correction.sourceHeight < 2
  )
    throw new Error('Perspective source dimensions are invalid');
  const points = validateQuad(correction.points);
  const scaleX = width / correction.sourceWidth;
  const scaleY = height / correction.sourceHeight;
  return points.map((point) => ({
    x: point.x * scaleX,
    y: point.y * scaleY,
  }));
}

function screenPixel(
  point: PreviewPoint,
  width: number,
  height: number,
): ScreenPoint {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
    throw new Error('Preview point maps outside the screen');
  return {
    x: Math.max(0, Math.min(width - 1, Math.floor(point.x + 1e-7))),
    y: Math.max(0, Math.min(height - 1, Math.floor(point.y + 1e-7))),
  };
}

/** Camera view: the screen is a quadrilateral inside the raw frame. */
export function createRawProjection(
  screen: PreviewScreenGeometry,
  width: number,
  height: number,
): PreviewProjection {
  assertDimensions(width, height);
  assertScreenDimensions(screen);
  assertRotation(screen.correction.rotation);
  if (screen.target && screen.target.rotation !== screen.correction.rotation)
    throw new Error('Correction rotation and perspective target disagree');
  const points = scaledQuad(screen.correction, width, height);
  const turns = points.map((point, index) =>
    cross(point, points[(index + 1) % 4], points[(index + 2) % 4]),
  );
  const orientation = Math.sign(turns[0]);
  if (orientation === 0 || turns.some((turn) => orientation * turn <= 1e-6))
    throw new Error('Preview mapping requires a convex screen quadrilateral');
  const destination = destinationCorners(
    screen.pixelWidth,
    screen.pixelHeight,
    screen.correction.rotation,
  );
  const toScreenMatrix = computeHomography(points, destination);
  const toImageMatrix = computeHomography(destination, points);
  const contains = (point: PreviewPoint) =>
    points.every(
      (corner, index) =>
        orientation * cross(corner, points[(index + 1) % 4], point) >= -1e-7,
    );
  const toScreen = (point: PreviewPoint) =>
    screenPixel(
      applyHomography(toScreenMatrix, point),
      screen.pixelWidth,
      screen.pixelHeight,
    );
  return {
    width,
    height,
    contains,
    toScreen,
    toImage: (point) => applyHomography(toImageMatrix, point),
    clipSegment(from, to) {
      let enter = 0;
      let exit = 1;
      // Clip in the camera plane first: outside points may lie across the
      // homography's horizon and must never become a false screen crossing.
      for (let index = 0; index < 4; index += 1) {
        const a = points[index];
        const b = points[(index + 1) % 4];
        const start = orientation * cross(a, b, from);
        const end = orientation * cross(a, b, to);
        if (start < 0 && end < 0) return;
        if (start < 0) enter = Math.max(enter, start / (start - end));
        if (end < 0) exit = Math.min(exit, start / (start - end));
        if (enter > exit) return;
      }
      const at = (fraction: number) => ({
        x: from.x + (to.x - from.x) * fraction,
        y: from.y + (to.y - from.y) * fraction,
      });
      const clippedFrom = at(enter);
      const clippedTo = at(exit);
      return {
        from: clippedFrom,
        to: clippedTo,
        screenFrom: toScreen(clippedFrom),
        screenTo: toScreen(clippedTo),
      };
    },
  };
}

/**
 * Corrected view: the image is already rectified to the screen, possibly at a
 * smaller preview resolution. Normalized coordinates are what matter, never
 * the JPEG's natural pixel size.
 */
export function createRectifiedProjection(
  screen: PreviewScreenGeometry,
  width: number,
  height: number,
): PreviewProjection {
  assertDimensions(width, height);
  assertScreenDimensions(screen);
  const toScreenPoint = (point: PreviewPoint): ScreenPoint =>
    screenPixel(
      {
        x: (point.x / width) * screen.pixelWidth,
        y: (point.y / height) * screen.pixelHeight,
      },
      screen.pixelWidth,
      screen.pixelHeight,
    );
  const toImagePoint = (point: ScreenPoint): PreviewPoint => ({
    x: ((point.x + 0.5) / screen.pixelWidth) * width,
    y: ((point.y + 0.5) / screen.pixelHeight) * height,
  });
  return {
    width,
    height,
    contains: (point) =>
      point.x >= 0 &&
      point.y >= 0 &&
      point.x <= width - 1 &&
      point.y <= height - 1,
    toScreen: toScreenPoint,
    toImage: toImagePoint,
    clipSegment(from, to) {
      const clamp = (value: number, max: number) =>
        Math.max(0, Math.min(max - 1, value));
      return {
        from: { x: clamp(from.x, width), y: clamp(from.y, height) },
        to: { x: clamp(to.x, width), y: clamp(to.y, height) },
        screenFrom: toScreenPoint({
          x: clamp(from.x, width),
          y: clamp(from.y, height),
        }),
        screenTo: toScreenPoint({
          x: clamp(to.x, width),
          y: clamp(to.y, height),
        }),
      };
    },
  };
}

export interface PreviewScreenProjection extends PreviewProjection {
  screen: PreviewScreenGeometry;
}

export function createScreenProjections(
  screens: readonly PreviewScreenGeometry[],
  width: number,
  height: number,
): PreviewScreenProjection[] {
  // One stale or malformed outline must not take down the whole camera stage.
  const projections: PreviewScreenProjection[] = [];
  for (const screen of screens) {
    try {
      projections.push({
        ...createRawProjection(screen, width, height),
        screen,
      });
    } catch {
      // The per-screen control metadata normally prevents this; skip defensively.
    }
  }
  return projections;
}

export type PreviewHit =
  | { kind: 'outside' }
  | { kind: 'screen'; hit: PreviewScreenProjection }
  | {
      kind: 'ambiguous';
      hits: PreviewScreenProjection[];
      preferred?: PreviewScreenProjection;
    };

const hitArea = (projection: PreviewScreenProjection) => {
  const points = scaledQuad(
    projection.screen.correction,
    projection.width,
    projection.height,
  );
  let area = 0;
  for (let index = 0; index < 4; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % 4];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area) / 2;
};

/** Resolve which calibrated screen is under a raw-preview point. */
export function hitTestScreens(
  point: PreviewPoint,
  projections: readonly PreviewScreenProjection[],
  activeId?: string,
): PreviewHit {
  const hits = projections.filter((projection) => projection.contains(point));
  if (!hits.length) return { kind: 'outside' };
  if (hits.length === 1) return { kind: 'screen', hit: hits[0] };
  const preferred = hits.find((hit) => hit.screen.id === activeId);
  // A front-most / smaller screen is the least surprising default when the
  // outlines overlap; the UI still offers an explicit choice.
  const ordered = [...hits].sort(
    (left, right) => hitArea(left) - hitArea(right),
  );
  return {
    kind: 'ambiguous',
    hits: ordered,
    preferred: preferred ?? ordered[0],
  };
}
