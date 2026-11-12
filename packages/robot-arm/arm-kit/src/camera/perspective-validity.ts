import sharp from 'sharp';
import {
  CALIBRATION_RELATIVE_SLACK,
  type CalibrationPageLayout,
} from '../assisted-contracts.js';
import { RobotVisionError } from './errors.js';
import {
  applyHomography,
  computeHomography,
  destinationCorners,
  quadFromArray,
  quadToArray,
  validateQuad,
} from './vision-geometry.js';
import type {
  ImagePoint,
  PerspectiveRotation,
  ScreenQuad,
} from './vision-types.js';

/**
 * How much of a saved Perspective Preset is still on the phone screen.
 *
 * Two independent measurements decide it. The edge scan fits one coherent
 * similarity, which finds a scale, rotation or tilt error; the rectified border
 * band finds a translation, and the "quad is larger than the glass" case where
 * the edge scan sees no boundary at all. Neither measurement is trusted alone,
 * and a scene with no usable boundary is reported as `uncertain`, never as an
 * error.
 */
import type {
  PerspectiveEdgeClass,
  PerspectiveEdgeReport,
  PerspectiveEdgeSide,
  PerspectiveValidityBand,
  PerspectiveValidityResult,
} from '../contracts.js';
export type { PerspectiveValidityResult } from '../contracts.js';

export interface PerspectiveValidityInput {
  jpeg: Buffer;
  /** Corners in the frame's own (post-rotation) coordinate space. */
  points: ScreenQuad;
  sourceWidth: number;
  sourceHeight: number;
  rotation?: PerspectiveRotation;
  pageLayout?: CalibrationPageLayout;
}

/** Width the frame is reduced to before measuring. */
export const VALIDITY_WORK_WIDTH = 1024;
/** Width the rectified image is rendered at for the border-band test. */
export const VALIDITY_BAND_WIDTH = 512;
export const VALIDITY_SAMPLES_PER_EDGE = 48;
/** Minimum edge gradient, 8-bit levels per 2 px. */
export const VALIDITY_MIN_CONTRAST = 8;
/** Below this a saved edge still counts as on the glass. */
export const VALIDITY_ALIGN_TOLERANCE_RATIO = 0.003;
export const VALIDITY_ALIGN_TOLERANCE_MIN_PX = 2;
export const VALIDITY_ALIGN_MAX_DRIFT_RATIO = 0.003;
export const VALIDITY_ALIGN_MAX_SCALE = 0.005;
export const VALIDITY_ALIGN_MAX_ROTATION_DEG = 0.3;
/** At or above this the parameters are wrong, matching Page Mapping. */
export const VALIDITY_MISMATCH_MIN_DRIFT_RATIO = 0.01;
/**
 * A bezel shifts the outline outward evenly; it never rotates the glass
 * boundary. A coherent fit rotated this far is proof that the saved quad no
 * longer covers the display area, even when every edge still finds a gradient.
 */
export const VALIDITY_MISMATCH_MIN_ROTATION_DEG = 0.5;
export const VALIDITY_MIN_CORRESPONDENCES = 24;
export const VALIDITY_TEXTURE_INSIDE_MIN = 5;
export const VALIDITY_TEXTURE_RATIO_MIN = 2.5;
export const VALIDITY_BAND_MIN_RATIO = 0.01;
/** A band must differ from the interior level this much to count as foreign. */
export const VALIDITY_BAND_LEVEL_DELTA = 12;

/** One decoded, downscaled working frame shared by every measurement. */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** A decoded frame plus the saved quad expressed in its working coordinates. */
export interface PreparedValidityFrame {
  image: GrayImage;
  quad: ScreenQuad;
}

interface EdgeSample {
  point: ImagePoint;
  normal: ImagePoint;
  offset: number;
}

interface EdgeMeasurement {
  side: PerspectiveEdgeSide;
  report: PerspectiveEdgeReport;
  usable: EdgeSample[];
}

interface SimilarityFit {
  tx: number;
  ty: number;
  scale: number;
  rotation: number;
  residual: number;
  driftPx: number;
  driftRatio: number;
}

const SIDES: PerspectiveEdgeSide[] = ['top', 'right', 'bottom', 'left'];

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Median of 8-bit levels without sorting the whole row: a 256-bin histogram is
 * what makes a deep border scan cheap even when the band covers a quarter of
 * the rectified image. Values are rounded to the nearest level; the band test
 * only compares against a 12-level threshold.
 */
function medianLevel(values: readonly number[]): number {
  if (!values.length) return 0;
  const counts = new Uint32Array(256);
  for (const value of values) {
    const level = Math.min(255, Math.max(0, Math.round(value)));
    counts[level] = (counts[level] ?? 0) + 1;
  }
  const target = Math.floor(values.length / 2);
  let seen = 0;
  for (let level = 0; level < 256; level += 1) {
    seen += counts[level]!;
    if (seen > target) return level;
  }
  return 255;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Bilinear sample, clamped at the frame border. */
function sampleBilinear(image: GrayImage, x: number, y: number): number {
  const left = Math.floor(x);
  const top = Math.floor(y);
  const dx = x - left;
  const dy = y - top;
  const x0 = clamp(left, 0, image.width - 1);
  const y0 = clamp(top, 0, image.height - 1);
  const x1 = clamp(left + 1, 0, image.width - 1);
  const y1 = clamp(top + 1, 0, image.height - 1);
  const data = image.data;
  const a = data[y0 * image.width + x0]!;
  const b = data[y0 * image.width + x1]!;
  const c = data[y1 * image.width + x0]!;
  const d = data[y1 * image.width + x1]!;
  return (
    a * (1 - dx) * (1 - dy) +
    b * dx * (1 - dy) +
    c * (1 - dx) * dy +
    d * dx * dy
  );
}

function inBounds(image: GrayImage, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x <= image.width - 1 && y <= image.height - 1;
}

/** Central-difference gradient magnitude, 8-bit levels per pixel. */
function gradientAt(image: GrayImage, x: number, y: number): number {
  const gx = sampleBilinear(image, x + 1, y) - sampleBilinear(image, x - 1, y);
  const gy = sampleBilinear(image, x, y + 1) - sampleBilinear(image, x, y - 1);
  return (Math.abs(gx) + Math.abs(gy)) / 2;
}

function scaleQuad(
  points: ScreenQuad,
  scaleX: number,
  scaleY: number,
): ScreenQuad {
  const scale = (point: ImagePoint): ImagePoint => ({
    x: point.x * scaleX,
    y: point.y * scaleY,
  });
  return {
    topLeft: scale(points.topLeft),
    topRight: scale(points.topRight),
    bottomRight: scale(points.bottomRight),
    bottomLeft: scale(points.bottomLeft),
  };
}

function quadEdges(points: ScreenQuad): Array<[ImagePoint, ImagePoint]> {
  const corners = quadToArray(points);
  return corners.map((corner, index) => [corner, corners[(index + 1) % 4]!]);
}

function screenWidthOf(points: ScreenQuad): number {
  const corners = quadToArray(points);
  const top = Math.hypot(
    corners[1]!.x - corners[0]!.x,
    corners[1]!.y - corners[0]!.y,
  );
  const bottom = Math.hypot(
    corners[2]!.x - corners[3]!.x,
    corners[2]!.y - corners[3]!.y,
  );
  return (top + bottom) / 2;
}

function signedArea(points: ScreenQuad): number {
  const corners = quadToArray(points);
  let area = 0;
  for (let index = 0; index < corners.length; index += 1) {
    const current = corners[index]!;
    const next = corners[(index + 1) % corners.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return area;
}

/**
 * Outward normal of each edge. `validateQuad` guarantees a convex quadrilateral
 * but not a winding order, so a mirrored capture flips them back.
 */
function outwardNormals(
  points: ScreenQuad,
): Array<{ start: ImagePoint; end: ImagePoint; normal: ImagePoint }> {
  const flip = signedArea(points) >= 0 ? 1 : -1;
  return quadEdges(points).map(([start, end]) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
      start,
      end,
      normal: { x: (flip * dy) / length, y: (flip * -dx) / length },
    };
  });
}

async function decodeWorkingFrame(
  input: PerspectiveValidityInput,
): Promise<PreparedValidityFrame> {
  if (
    !Number.isFinite(input.sourceWidth) ||
    !Number.isFinite(input.sourceHeight) ||
    input.sourceWidth <= 0 ||
    input.sourceHeight <= 0
  )
    throw new RobotVisionError(
      'INVALID_ARGUMENT',
      'sourceWidth and sourceHeight must be positive frame dimensions',
    );
  validateQuad(input.points);
  const { data, info } = await sharp(input.jpeg)
    .rotate()
    // No sharpening: the peak position, not the contrast, decides geometry, and
    // sharpening moves edges.
    .greyscale()
    .resize({
      width: VALIDITY_WORK_WIDTH,
      withoutEnlargement: true,
      fit: 'inside',
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const image: GrayImage = {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  };
  return {
    image,
    quad: scaleQuad(
      input.points,
      image.width / input.sourceWidth,
      image.height / input.sourceHeight,
    ),
  };
}

/**
 * Decode the frame once so the drift check, the stylus check and the event
 * thumbnail can share it. Both measurements already use the same working width,
 * so a second decode would return identical pixels.
 */
export async function prepareValidityFrame(
  input: PerspectiveValidityInput,
): Promise<PreparedValidityFrame> {
  return decodeWorkingFrame(input);
}

function measureEdges(
  image: GrayImage,
  quad: ScreenQuad,
  screenWidth: number,
): EdgeMeasurement[] {
  const search = Math.round(clamp(screenWidth * 0.04, 6, 60));
  const tolerance = Math.max(
    VALIDITY_ALIGN_TOLERANCE_MIN_PX,
    screenWidth * VALIDITY_ALIGN_TOLERANCE_RATIO,
  );
  return outwardNormals(quad).map((edge, index) => {
    const magnitudes: number[] = [];
    const usable: EdgeSample[] = [];
    for (let sample = 0; sample < VALIDITY_SAMPLES_PER_EDGE; sample += 1) {
      const t = (sample + 0.5) / VALIDITY_SAMPLES_PER_EDGE;
      const point = {
        x: edge.start.x + (edge.end.x - edge.start.x) * t,
        y: edge.start.y + (edge.end.y - edge.start.y) * t,
      };
      const profile: number[] = [];
      for (let d = -search; d <= search; d += 1) {
        profile.push(
          sampleBilinear(
            image,
            point.x + edge.normal.x * d,
            point.y + edge.normal.y * d,
          ),
        );
      }
      // Central difference at profile index k represents d = k - search.
      const gradients = profile.map((_, k) => {
        if (k === 0 || k === profile.length - 1) return 0;
        return profile[k + 1]! - profile[k - 1]!;
      });
      let maxMagnitude = 0;
      for (const gradient of gradients) {
        maxMagnitude = Math.max(maxMagnitude, Math.abs(gradient));
      }
      let chosen = -1;
      if (maxMagnitude >= VALIDITY_MIN_CONTRAST) {
        const candidates: number[] = [];
        for (let k = 1; k < gradients.length - 1; k += 1) {
          const magnitude = Math.abs(gradients[k]!);
          if (magnitude < VALIDITY_MIN_CONTRAST) continue;
          if (
            magnitude < Math.abs(gradients[k - 1]!) ||
            magnitude < Math.abs(gradients[k + 1]!)
          )
            continue;
          candidates.push(k);
        }
        // The saved edge is a prior: a real boundary near it wins even when the
        // body edge a bezel width outside is much stronger. Only when the glass
        // edge itself is invisible does the stronger neighbouring peak win, and
        // the verdict rules then treat a uniform outward offset as ambiguous.
        const nearest = (pool: readonly number[]) =>
          pool.reduce((best, k) =>
            Math.abs(k - search) < Math.abs(best - search) ? k : best,
          );
        const near = candidates.filter(
          (k) => Math.abs(k - search) <= Math.max(3, screenWidth * 0.008),
        );
        if (near.length) chosen = nearest(near);
        else {
          const strong = candidates.filter(
            (k) => Math.abs(gradients[k]!) >= maxMagnitude * 0.5,
          );
          if (strong.length) chosen = nearest(strong);
        }
      }
      let magnitude = 0;
      if (chosen > 0) {
        const offset = chosen - search;
        if (Math.abs(offset) <= search - 2) {
          magnitude = Math.abs(gradients[chosen]!);
          usable.push({ point, normal: edge.normal, offset });
        }
      }
      magnitudes.push(magnitude);
    }
    const contrast = median(magnitudes);
    const offsets = usable.map((sample) => sample.offset);
    const offset = median(offsets);
    const inliers = offsets.filter(
      (value) => Math.abs(value - offset) <= 2,
    ).length;
    const inlierRatio = usable.length ? inliers / usable.length : 0;
    const edgeClass: PerspectiveEdgeClass =
      contrast < VALIDITY_MIN_CONTRAST || !usable.length
        ? 'no-edge'
        : Math.abs(offset) <= tolerance
          ? 'on-edge'
          : 'off-edge';
    return {
      side: SIDES[index]!,
      usable: edgeClass === 'no-edge' ? [] : usable,
      report: {
        side: SIDES[index]!,
        class: edgeClass,
        contrast: round(contrast, 1),
        offsetPx: round(offset, 1),
        inlierRatio: round(inlierRatio, 2),
        samples: usable.length,
      },
    };
  });
}

/** Gaussian elimination for the 4x4 similarity normal equations. */
function solve4(
  rows: number[][],
  values: number[],
): [number, number, number, number] | undefined {
  const size = 4;
  const matrix = Array.from({ length: size }, (_, row) => [
    ...rows[row]!,
    values[row]!,
  ]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(matrix[row]![column]!) > Math.abs(matrix[pivot]![column]!))
        pivot = row;
    }
    if (Math.abs(matrix[pivot]![column]!) < 1e-9) return undefined;
    [matrix[column], matrix[pivot]] = [matrix[pivot]!, matrix[column]!];
    const divisor = matrix[column]![column]!;
    for (let item = column; item <= size; item += 1)
      matrix[column]![item]! /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = matrix[row]![column]!;
      for (let item = column; item <= size; item += 1)
        matrix[row]![item]! -= factor * matrix[column]![item]!;
    }
  }
  return matrix.map((row) => row[size]!) as [number, number, number, number];
}

function similarityEquation(sample: EdgeSample): [number[], number] {
  const { x: nx, y: ny } = sample.normal;
  return [
    [
      nx,
      ny,
      nx * sample.point.x + ny * sample.point.y,
      ny * sample.point.x - nx * sample.point.y,
    ],
    sample.offset,
  ];
}

function fitSimilarity(
  samples: readonly EdgeSample[],
  quad: ScreenQuad,
  screenWidth: number,
  residualAllowancePx: number,
): SimilarityFit | undefined {
  if (samples.length < VALIDITY_MIN_CORRESPONDENCES) return undefined;
  const fit = (subset: readonly EdgeSample[]): SimilarityFit | undefined => {
    const normal = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
    const rhs = [0, 0, 0, 0];
    for (const sample of subset) {
      const [row, offset] = similarityEquation(sample);
      for (let i = 0; i < 4; i += 1) {
        rhs[i]! += row[i]! * offset;
        for (let j = 0; j < 4; j += 1) normal[i]![j]! += row[i]! * row[j]!;
      }
    }
    const solution = solve4(normal, rhs);
    if (!solution) return undefined;
    const [tx, ty, scale, rotation] = solution;
    const residual = Math.sqrt(
      subset.reduce((sum, sample) => {
        const [row, offset] = similarityEquation(sample);
        const predicted =
          row[0]! * tx + row[1]! * ty + row[2]! * scale + row[3]! * rotation;
        return sum + (predicted - offset) ** 2;
      }, 0) / subset.length,
    );
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const project = (point: ImagePoint): ImagePoint => ({
      x: (1 + scale) * (cos * point.x - sin * point.y) + tx,
      y: (1 + scale) * (sin * point.x + cos * point.y) + ty,
    });
    const driftPx = Math.max(
      ...quadToArray(quad).map((corner) => {
        const moved = project(corner);
        return Math.hypot(moved.x - corner.x, moved.y - corner.y);
      }),
    );
    return {
      tx,
      ty,
      scale,
      rotation,
      residual,
      driftPx,
      driftRatio: driftPx / screenWidth,
    };
  };
  const first = fit(samples);
  if (!first) return undefined;
  const kept = samples.filter((sample) => {
    const [row, offset] = similarityEquation(sample);
    const predicted =
      row[0]! * first.tx +
      row[1]! * first.ty +
      row[2]! * first.scale +
      row[3]! * first.rotation;
    return Math.abs(predicted - offset) <= residualAllowancePx;
  });
  // After rejecting outliers only parallel edges may remain.
  return kept.length >= VALIDITY_MIN_CORRESPONDENCES
    ? (fit(kept) ?? first)
    : first;
}

function measureTexture(
  image: GrayImage,
  quad: ScreenQuad,
  screenWidth: number,
): { inside: number; outside: number; ratio: number } {
  const corners = quadToArray(quad);
  const interpolate = (u: number, v: number): ImagePoint => ({
    x:
      (1 - v) * ((1 - u) * corners[0]!.x + u * corners[1]!.x) +
      v * ((1 - u) * corners[3]!.x + u * corners[2]!.x),
    y:
      (1 - v) * ((1 - u) * corners[0]!.y + u * corners[1]!.y) +
      v * ((1 - u) * corners[3]!.y + u * corners[2]!.y),
  });
  const inside: number[] = [];
  const grid = 32;
  for (let row = 0; row < grid; row += 1) {
    for (let column = 0; column < grid; column += 1) {
      const u = 0.05 + (0.9 * (column + 0.5)) / grid;
      const v = 0.05 + (0.9 * (row + 0.5)) / grid;
      const point = interpolate(u, v);
      inside.push(gradientAt(image, point.x, point.y));
    }
  }
  const outside: number[] = [];
  outwardNormals(quad).forEach((edge) => {
    for (const fraction of [0.06, 0.12, 0.18, 0.22]) {
      for (let sample = 0; sample < 16; sample += 1) {
        const t = (sample + 0.5) / 16;
        const x =
          edge.start.x +
          (edge.end.x - edge.start.x) * t +
          edge.normal.x * screenWidth * fraction;
        const y =
          edge.start.y +
          (edge.end.y - edge.start.y) * t +
          edge.normal.y * screenWidth * fraction;
        outside.push(gradientAt(image, x, y));
      }
    }
  });
  const insideMean =
    inside.reduce((sum, value) => sum + value, 0) / inside.length;
  const outsideMean =
    outside.reduce((sum, value) => sum + value, 0) / outside.length;
  return {
    inside: round(insideMean, 1),
    outside: round(outsideMean, 1),
    ratio: round(insideMean / Math.max(outsideMean, 0.5), 2),
  };
}

/**
 * Renders the quad into a rectangle and measures a band along each border.
 * A band matters only when it is flat, differs in level from the interior, and
 * the saved edge on that side is not on the glass — the last condition is what
 * keeps a letterbox bar or a status bar from counting as a wrong parameter.
 */
async function measureBand(
  image: GrayImage,
  quad: ScreenQuad,
): Promise<{ band: PerspectiveValidityBand; bandsBySide: number[] }> {
  const corners = quadToArray(quad);
  const topLength = Math.hypot(
    corners[1]!.x - corners[0]!.x,
    corners[1]!.y - corners[0]!.y,
  );
  const leftLength = Math.hypot(
    corners[3]!.x - corners[0]!.x,
    corners[3]!.y - corners[0]!.y,
  );
  if (!(topLength > 6) || !(leftLength > 6))
    return {
      band: { widthsPx: [0, 0, 0, 0], foreignSides: [], maxRatio: 0 },
      bandsBySide: [0, 0, 0, 0],
    };
  const width = VALIDITY_BAND_WIDTH;
  const height = Math.max(8, Math.round((width * leftLength) / topLength));
  const destinationToSource = computeHomography(
    destinationCorners(width, height, 0),
    corners,
  );
  const rendered = new Float32Array(width * height);
  const known = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const denominator =
        destinationToSource[6]! * x + destinationToSource[7]! * y + 1;
      const sourceX =
        (destinationToSource[0]! * x +
          destinationToSource[1]! * y +
          destinationToSource[2]!) /
        denominator;
      const sourceY =
        (destinationToSource[3]! * x +
          destinationToSource[4]! * y +
          destinationToSource[5]!) /
        denominator;
      if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) continue;
      if (!inBounds(image, sourceX, sourceY)) continue;
      const index = y * width + x;
      rendered[index] = sampleBilinear(image, sourceX, sourceY);
      known[index] = 1;
    }
  }
  const rowLevel = (y: number) => {
    const levels: number[] = [];
    for (let x = 2; x < width - 2; x += 1) {
      const index = y * width + x;
      levels.push(known[index] ? rendered[index]! : 0);
    }
    return medianLevel(levels);
  };
  const columnLevel = (x: number) => {
    const levels: number[] = [];
    for (let y = 2; y < height - 2; y += 1) {
      const index = y * width + x;
      levels.push(known[index] ? rendered[index]! : 0);
    }
    return medianLevel(levels);
  };
  const interior: number[] = [];
  for (let row = 0; row < 24; row += 1) {
    for (let column = 0; column < 24; column += 1) {
      const x = Math.round(width * (0.38 + (0.24 * column) / 24));
      const y = Math.round(height * (0.38 + (0.24 * row) / 24));
      interior.push(rendered[y * width + x] ?? 0);
    }
  }
  const interiorLevel = median(interior);
  // A foreign band is a flat or structured region whose level differs from the
  // screen interior. A content bar is filtered out later by the edge class, so
  // this test does not need to reason about texture; the desk-to-bezel
  // transition inside the band would break any texture-based stop rule.
  const isForeign = (level: number) =>
    Math.abs(level - interiorLevel) >= VALIDITY_BAND_LEVEL_DELTA;
  const scan = (levelAt: (offset: number) => number, limit: number) => {
    let measured = 0;
    let misses = 0;
    for (let offset = 2; offset < limit; offset += 1) {
      if (isForeign(levelAt(offset))) {
        measured = offset;
        misses = 0;
      } else {
        misses += 1;
        // Two quiet rows are allowed inside a band: JPEG blur and the
        // desk-to-bezel step both read as the interior level for a pixel.
        if (misses > 2) break;
      }
    }
    return measured;
  };
  const widths: [number, number, number, number] = [
    scan((offset) => rowLevel(offset), Math.round(height / 4)),
    scan((offset) => columnLevel(width - 1 - offset), Math.round(width / 4)),
    scan((offset) => rowLevel(height - 1 - offset), Math.round(height / 4)),
    scan((offset) => columnLevel(offset), Math.round(width / 4)),
  ];
  const ratios = widths.map((value) => value / width);
  return {
    band: {
      widthsPx: widths,
      foreignSides: [],
      maxRatio: round(Math.max(...ratios), 4),
    },
    bandsBySide: ratios,
  };
}

function applySimilarity(fit: SimilarityFit, quad: ScreenQuad): ScreenQuad {
  const cos = Math.cos(fit.rotation);
  const sin = Math.sin(fit.rotation);
  const project = (point: ImagePoint): ImagePoint => ({
    x: round((1 + fit.scale) * (cos * point.x - sin * point.y) + fit.tx, 1),
    y: round((1 + fit.scale) * (sin * point.x + cos * point.y) + fit.ty, 1),
  });
  return {
    topLeft: project(quad.topLeft),
    topRight: project(quad.topRight),
    bottomRight: project(quad.bottomRight),
    bottomLeft: project(quad.bottomLeft),
  };
}

/**
 * Measure how far the saved quadrilateral has drifted from the phone screen in
 * one frame. `prepared` lets a caller that already decoded the frame (for the
 * stylus or the event thumbnail) reuse those pixels instead of decoding again.
 */
export async function checkPerspectiveValidity(
  input: PerspectiveValidityInput,
  prepared?: PreparedValidityFrame,
): Promise<PerspectiveValidityResult> {
  const frame = prepared ?? (await decodeWorkingFrame(input));
  const glass = await measureOutline(input, frame, frame.quad);
  const layout = input.pageLayout;
  if (glass.state === 'valid' || !layout?.topInset) return glass;
  const inset = layout.topInset / layout.screen.height;
  if (
    !(
      inset > 0 &&
      inset < 1 &&
      layout.topInset <= layout.screen.height - layout.height
    )
  )
    return glass;

  // A dark status bar can blend into the bezel. Only substitute the page
  // boundary when the other three sides independently agree with the glass.
  const corners = destinationCorners(2, 2, input.rotation ?? 0); // unit square
  const top = corners.findIndex(
    (p, i) => p.y === 0 && corners[(i + 1) % 4]!.y === 0,
  );
  const missing = glass.edges.filter((edge) => edge.class !== 'on-edge');
  if (missing.length !== 1 || missing[0]!.side !== SIDES[top]) return glass;
  const toCamera = computeHomography(corners, quadToArray(frame.quad));
  const page = quadFromArray(
    corners.map((p) =>
      applyHomography(toCamera, { x: p.x, y: p.y === 0 ? inset : p.y }),
    ),
  );
  const visible = await measureOutline(input, frame, page);
  return visible.state === 'valid' &&
    visible.edges.every((edge) => edge.class === 'on-edge')
    ? visible
    : glass;
}

async function measureOutline(
  input: PerspectiveValidityInput,
  { image, quad }: PreparedValidityFrame,
  outline: ScreenQuad,
): Promise<PerspectiveValidityResult> {
  // Fit on the observed outline, but always report drift and corners for the full glass.
  const screenWidth = screenWidthOf(quad);
  const edges = measureEdges(image, outline, screenWidth);
  // Edge offsets are measured on the working frame, with a subpixel-fitting noise floor.
  const residualAllowancePx =
    Math.max(2.5, screenWidth * VALIDITY_ALIGN_TOLERANCE_RATIO) *
    (1 + CALIBRATION_RELATIVE_SLACK);
  const texture = measureTexture(image, outline, screenWidth);
  const { band, bandsBySide } = await measureBand(image, outline);
  const usable = edges.flatMap((edge) => edge.usable);
  const observedEdges = edges.filter((edge) => edge.usable.length > 0).length;
  const onEdge = edges.filter((edge) => edge.report.class === 'on-edge');
  const offEdge = edges.filter((edge) => edge.report.class === 'off-edge');
  const noEdge = edges.filter((edge) => edge.report.class === 'no-edge');
  const fit =
    usable.length >= VALIDITY_MIN_CORRESPONDENCES && observedEdges >= 3
      ? fitSimilarity(usable, quad, screenWidth, residualAllowancePx)
      : undefined;
  const foreignSides = edges
    .filter(
      (edge, index) =>
        bandsBySide[index]! >= VALIDITY_BAND_MIN_RATIO &&
        edge.report.class !== 'on-edge',
    )
    .map((edge) => edge.side);
  const foreignRatio = edges.reduce((worst, edge, index) => {
    const ratio = bandsBySide[index]!;
    return ratio >= VALIDITY_BAND_MIN_RATIO && foreignSides.includes(edge.side)
      ? Math.max(worst, ratio)
      : worst;
  }, 0);
  const resultBand: PerspectiveValidityBand = {
    ...band,
    foreignSides,
    maxRatio: round(foreignRatio, 4),
  };
  const drift = fit
    ? { driftPx: round(fit.driftPx, 1), driftRatio: round(fit.driftRatio, 4) }
    : {
        driftPx: round(foreignRatio * screenWidth, 1),
        driftRatio: round(foreignRatio, 4),
      };
  const fitMetrics = fit
    ? {
        scaleDelta: round(fit.scale, 4),
        rotationDeg: round((fit.rotation * 180) / Math.PI, 2),
        fitResidualPx: round(fit.residual, 2),
      }
    : { scaleDelta: 0, rotationDeg: 0, fitResidualPx: 0 };
  const base = {
    ...(fit ? { currentPoints: applySimilarity(fit, quad) } : {}),
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    screenWidthPx: round(screenWidth, 1),
    edges: edges.map((edge) => edge.report),
    texture,
    band: resultBand,
    ...drift,
    ...fitMetrics,
  };
  const proposal =
    fit && observedEdges >= 3
      ? { proposedPoints: applySimilarity(fit, quad) }
      : {};

  const alignedGeometry =
    Boolean(fit) &&
    onEdge.length >= 3 &&
    fit!.driftPx <=
      Math.max(
        VALIDITY_ALIGN_TOLERANCE_MIN_PX,
        screenWidth * VALIDITY_ALIGN_MAX_DRIFT_RATIO,
      ) &&
    Math.abs(fit!.scale) <= VALIDITY_ALIGN_MAX_SCALE &&
    Math.abs((fit!.rotation * 180) / Math.PI) <=
      VALIDITY_ALIGN_MAX_ROTATION_DEG &&
    fit!.residual <= residualAllowancePx;
  /*
   * A band is a strip inside the saved outline whose level differs from the
   * screen interior. It is what a bezel looks like when the outline is too
   * large, but a phone that cannot hide its status bar also keeps a strip like
   * that inside the glass. So one band is not proof: when the geometry already
   * agrees with the glass on three sides, the band is reported but does not
   * make the outline a mismatch; two bands, or one band without aligned
   * geometry, still do.
   */
  const bandMismatch =
    foreignSides.length >= 2 || (foreignSides.length === 1 && !alignedGeometry);
  const alignedByFit = alignedGeometry && !bandMismatch;
  if (alignedByFit)
    return {
      ...base,
      ...proposal,
      state: 'valid',
      verdict: 'aligned',
      confidence: 'high',
      reasonCode: 'ALIGNED',
    };

  if (bandMismatch)
    return {
      ...base,
      ...proposal,
      state: 'invalid',
      verdict: 'mismatch',
      confidence: foreignSides.length >= 2 ? 'high' : 'medium',
      reasonCode: foreignSides.length >= 2 ? 'OFF_SCREEN_BOUNDARY' : 'SHIFTED',
    };

  const coherentFit =
    Boolean(fit) && observedEdges >= 3 && fit!.residual <= residualAllowancePx;
  const rotationDeg = fit ? Math.abs((fit.rotation * 180) / Math.PI) : 0;
  // A pure translation only moves the two edges parallel to it; requiring
  // three would miss the most common failure entirely.
  const displacedEdges =
    offEdge.length >= 2 &&
    // A uniform outward offset is what the phone body edge looks like when the
    // glass edge is invisible. Only an inward offset, or a band that the
    // geometry cannot explain, proves the glass is not where the saved edge is.
    (bandMismatch || offEdge.some((edge) => edge.report.offsetPx < 0));
  const rotatedOutline =
    coherentFit && rotationDeg >= VALIDITY_MISMATCH_MIN_ROTATION_DEG;
  if (
    fit &&
    fit.driftRatio >= VALIDITY_MISMATCH_MIN_DRIFT_RATIO &&
    coherentFit &&
    (displacedEdges || rotatedOutline)
  )
    return {
      ...base,
      ...proposal,
      state: 'invalid',
      verdict: 'mismatch',
      confidence: 'high',
      reasonCode:
        Math.abs(fit.scale) >= VALIDITY_ALIGN_MAX_SCALE
          ? 'SCALED'
          : rotationDeg >= VALIDITY_ALIGN_MAX_ROTATION_DEG
            ? 'ROTATED'
            : 'SHIFTED',
    };

  return {
    ...base,
    state: 'unverified',
    verdict: 'uncertain',
    confidence: 'low',
    reasonCode:
      usable.length === 0 || noEdge.length >= 3
        ? 'INSUFFICIENT_CONTRAST'
        : 'INSUFFICIENT_EVIDENCE',
  };
}
