export interface ImagePoint {
  x: number;
  y: number;
}

export interface ScreenQuad {
  topLeft: ImagePoint;
  topRight: ImagePoint;
  bottomRight: ImagePoint;
  bottomLeft: ImagePoint;
}

export type ScreenDetectionMethod = 'polygon' | 'line-fit';

/**
 * Which mask a detected region came from. `background` compares the frame with
 * its outer ring; `local-contrast` compares every pixel with its own
 * neighbourhood, which is what finds a screen on a bright, textured surface.
 */
export type ScreenMaskSource = 'background' | 'local-contrast';

export interface ScreenDetectionOptions {
  maxDimension?: number;
  minAreaRatio?: number;
  maxAreaRatio?: number;
  targetAspectRatio?: number;
  backgroundLumaDelta?: number;
  backgroundColorDelta?: number;
  morphologyRadius?: number;
  /**
   * How much brighter than its own neighbourhood a pixel has to be to belong to
   * the `local-contrast` mask. Lower finds a dimmer screen, higher is stricter
   * about a textured surface. Valid from 1 to 255, defaults to 18.
   *
   * This is the threshold of the first pass. When that pass finds no candidate
   * at all the detector asks the local-contrast mask again at half this value
   * and then a quarter of it, and `meta.localContrast` reports which one the
   * accepted region came from. A detection that already works is unaffected,
   * because the retries only run when nothing passed.
   */
  localContrastDelta?: number;
  /** Neighbourhood of that comparison, as a share of the shorter side. */
  localContrastRadiusRatio?: number;
  /**
   * `polygon` takes the extreme points of the screen mask. `line-fit` then
   * snaps every edge to the strongest luma gradient and intersects robust line
   * fits, which is slower and noticeably more precise on soft edges.
   */
  method?: ScreenDetectionMethod;
  /** How far an edge may snap, in working-resolution pixels. */
  lineFitBandWidth?: number;
  /** Fraction of each edge excluded at both ends to avoid corner rounding. */
  lineFitCornerExclusion?: number;
  /** Snapped points a fitted line needs before it replaces the edge. */
  lineFitMinPoints?: number;
  /**
   * Re-snap the four edges at the source resolution and fit them sub-pixel,
   * after the working-resolution quad has been chosen. The working image caps
   * corner precision: at 720px of long side a 1280px frame is sampled at 0.56,
   * so a corner that is exactly right on the working grid is already a pixel
   * and a half off in the frame the operator sees. This stage decodes only the
   * quad's bounding box at full resolution and repeats the normal-gradient snap
   * there, which takes the corner error past that ceiling. It never fails a
   * detection: anything that does not add up keeps the quad it was given and
   * reports why in `meta.subpixel`. Defaults to true.
   */
  subpixelRefine?: boolean;
  /** Prefer a candidate close to this quad, for example the previous frame. */
  priorPoints?: ScreenQuad;
  /**
   * A screen region fills its own quadrilateral. A circle, a stripe pattern, or
   * a gradient leaves that ratio far from 1 and is rejected. Defaults to 0.85.
   */
  minSolidity?: number;
  /** Upper bound for the same ratio. Defaults to 1.12. */
  maxSolidity?: number;
  /**
   * Fraction of the region outline that has to follow the quadrilateral, so a
   * blob with four extreme points is not mistaken for a screen. Defaults 0.85.
   */
  minQuadFidelity?: number;
  /**
   * Accept a region that reaches the edge of the frame. Off by default: a
   * screen cut off by the frame cannot be calibrated, and a region that runs to
   * the frame edge is usually just the scene in front of the camera.
   */
  allowBorderContact?: boolean;
  /**
   * Wall-clock budget for one detection, in milliseconds. Detection never
   * fails because of it: once the budget is spent the detector degrades instead
   * of throwing, by working on a smaller resolution and, in `detectMulti`, by
   * dropping the frames it has not read yet. `meta.budget` reports both.
   */
  timeBudgetMs?: number;
}

export interface LineFitMeta {
  bandWidth: number;
  cornerExclusion: number;
  samples: number;
  snapped: number;
  /** Snapped points divided by samples, averaged over the four edges. */
  edgeSupport: number;
  edgeSupportPerEdge: [number, number, number, number];
  refined: boolean;
  /** Why the refinement kept the polygon quad. */
  fallback?: string;
}

export interface PriorMeta {
  used: boolean;
  distancePx: number;
}

/**
 * The local-contrast threshold the accepted region came from. Detection retries
 * with a lower one when the first pass finds no candidate at all, which is what
 * a screen that is only slightly brighter than its surround needs: the mask
 * holds such a screen by a band along its edge, and a low-contrast scene thins
 * that band until the ring no longer closes. A retry can only turn a failure
 * into a detection, because it never runs once the first pass found something.
 * In a multi-frame detection this describes the frame whose result was
 * reported, not the aggregate, because the retries run per frame.
 */
export interface LocalContrastMeta {
  /** The threshold the accepted mask used, in grey levels. */
  delta: number;
  /** The threshold the caller asked for; the first pass used it. */
  requestedDelta: number;
  /** True when `delta` is lower than `requestedDelta`. */
  relaxed: boolean;
  /** 1 for the first pass, 2 and up for the retries. */
  attempt: number;
}

/**
 * What the full-resolution sub-pixel stage did. `applied` is false when the
 * quad it was given did not pass its own checks; `fallback` then names the
 * reason and the corners stay where the working resolution put them. In a
 * multi-frame detection this describes the frame whose result was reported,
 * not the aggregate of every frame.
 */
export interface SubpixelMeta {
  /** False when the caller disabled the stage. */
  enabled: boolean;
  applied: boolean;
  /** Search band along each edge normal, in source pixels. */
  bandWidth: number;
  samples: number;
  snapped: number;
  /** Snapped points divided by samples, averaged over the four edges. */
  edgeSupport: number;
  /** Mean corner movement the stage made, in source pixels. */
  meanShiftPx: number;
  /** Why the stage kept the quad it was given. */
  fallback?: string;
}

export interface MultiFrameMeta {
  frameCount: number;
  validFrames: number;
  validFrameRatio: number;
  /** Mean per-corner deviation from the aggregate quad, in image pixels. */
  cornerJitterPx: number;
  /** `1 - cornerJitterPx / (2% of the shorter image side)`, clamped to 0..1. */
  temporalStability: number;
}

/**
 * How the detector traded precision for time. Present whenever the caller set
 * `timeBudgetMs`, so an operator can tell a clean detection from a degraded one.
 */
export interface DetectionBudgetMeta {
  /** The budget the caller asked for, in milliseconds. */
  timeBudgetMs: number;
  /** Milliseconds the detection actually took. */
  elapsedMs: number;
  /**
   * True when the budget ran out before the detector could do all the work it
   * would otherwise have done.
   */
  timeBudgetExceeded: boolean;
  /** The long side the detector actually worked at, after any degradation. */
  effectiveMaxDimension: number;
  /**
   * The long side the caller asked for, before degradation. Equal to
   * `effectiveMaxDimension` when nothing was given up.
   */
  requestedMaxDimension: number;
  /**
   * Working pixels divided by source pixels on the longer side. Below 1 means
   * the frame was downscaled; a value under the requested one means the budget
   * forced additional downscaling.
   */
  scale: number;
  /** Frames `detectMulti` skipped because the budget ran out. */
  droppedFrames: number;
}

export interface ScreenDetectionMeta {
  method: ScreenDetectionMethod;
  /** Which mask the accepted region came from. */
  maskSource: ScreenMaskSource;
  areaRatio: number;
  /** Mean edge width divided by mean edge height. */
  aspectRatio: number;
  /** Largest deviation from a right angle across the four corners, degrees. */
  angleDeviation: number;
  /** Region area divided by quad area, clamped to 1 for display. */
  maskCoverage: number;
  /** Region area divided by quad area, unclamped. 1 means the region fills it. */
  solidity: number;
  /** Fraction of the region outline that follows the quadrilateral. */
  quadFidelity: number;
  /** The corners came from fitted outline lines instead of the extreme points. */
  boundaryRefined: boolean;
  edgeSupport: number;
  score: number;
  quality: number;
  durationMs: number;
  lineFit?: LineFitMeta;
  subpixel?: SubpixelMeta;
  prior?: PriorMeta;
  localContrast: LocalContrastMeta;
  frames?: MultiFrameMeta;
  /** Present only when the caller set `timeBudgetMs`. */
  budget?: DetectionBudgetMeta;
}

export interface ScreenDetectionResult {
  points: ScreenQuad;
  imageWidth: number;
  imageHeight: number;
  areaRatio: number;
  maskCoverage: number;
  confidence: number;
  durationMs: number;
  meta: ScreenDetectionMeta;
}

/** Clockwise rotation applied to a rectified image. */
export type PerspectiveRotation = 0 | 90 | 180 | 270;

export const PERSPECTIVE_ROTATIONS: PerspectiveRotation[] = [0, 90, 180, 270];

/**
 * Size a rectified frame is stretched to, and how far it is turned. A phone
 * screen has nothing to do with the aspect of the camera frame, so the operator
 * sets the real one instead of accepting the frame's.
 */
export interface PerspectiveTarget {
  width: number;
  height: number;
  rotation: PerspectiveRotation;
}

export interface PerspectiveTransformOptions {
  points: ScreenQuad;
  targetWidth: number;
  targetHeight: number;
  jpegQuality?: number;
  /**
   * Turns the rectified result clockwise inside the target rectangle, so a
   * screen that lies on its side comes out upright. The source `topLeft` corner
   * lands in the output's top-right corner at 90 degrees. Defaults to 0.
   */
  rotation?: PerspectiveRotation;
  /**
   * Pixel interpolation. Bilinear is the default for saved screenshots;
   * nearest-neighbour is much cheaper for a live preview stream, where the
   * output is shown far smaller than the target.
   */
  sampling?: 'bilinear' | 'nearest';
}
