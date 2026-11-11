import { RobotVisionError } from './errors.js';
import type {
  ImagePoint,
  PerspectiveRotation,
  ScreenQuad,
} from './vision-types.js';

export function quadToArray(quad: ScreenQuad): ImagePoint[] {
  return [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
}

export function polygonArea(points: ImagePoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area) / 2;
}

/**
 * True when the four points, in order, form a convex quadrilateral. A repeated
 * corner or a crossed (bow-tie) order fails here even though the shoelace area
 * can still be non-zero.
 */
export function isConvexQuad(points: ImagePoint[]): boolean {
  if (points.length !== 4) return false;
  let sign = 0;
  for (let index = 0; index < 4; index += 1) {
    const previous = points[index];
    const current = points[(index + 1) % 4];
    const next = points[(index + 2) % 4];
    const turns = cross2D(previous, current, next);
    if (Math.abs(turns) < 1e-6) return false;
    const currentSign = Math.sign(turns);
    if (sign === 0) {
      sign = currentSign;
    } else if (sign !== currentSign) {
      return false;
    }
  }
  return true;
}

function cross2D(origin: ImagePoint, a: ImagePoint, b: ImagePoint): number {
  return (
    (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)
  );
}

export function validateQuad(quad: ScreenQuad): ImagePoint[] {
  const points = quadToArray(quad);
  if (
    points.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )
  ) {
    throw new RobotVisionError(
      'INVALID_ARGUMENT',
      'Perspective points must contain finite x and y coordinates',
    );
  }
  if (polygonArea(points) < 1) {
    throw new RobotVisionError(
      'INVALID_ARGUMENT',
      'Perspective points must describe a non-degenerate quadrilateral',
    );
  }
  if (!isConvexQuad(points)) {
    throw new RobotVisionError(
      'INVALID_ARGUMENT',
      'Perspective points must describe a convex quadrilateral with four distinct corners',
    );
  }
  return points;
}

export function solveLinearSystem(
  coefficients: number[][],
  values: number[],
): number[] {
  const size = values.length;
  const matrix = coefficients.map((row, index) => [...row, values[index]]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) {
        pivot = row;
      }
    }
    if (Math.abs(matrix[pivot][column]) < 1e-10) {
      throw new RobotVisionError(
        'INVALID_ARGUMENT',
        'Unable to compute perspective matrix from the supplied points',
      );
    }
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];

    const divisor = matrix[column][column];
    for (let item = column; item <= size; item += 1) {
      matrix[column][item] /= divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = matrix[row][column];
      for (let item = column; item <= size; item += 1) {
        matrix[row][item] -= factor * matrix[column][item];
      }
    }
  }

  return matrix.map((row) => row[size]);
}

export function computeHomography(
  from: ImagePoint[],
  to: ImagePoint[],
): number[] {
  if (
    from.length !== to.length ||
    from.length < 4 ||
    from.length > 64 ||
    [...from, ...to].some((p) => ![p.x, p.y].every(Number.isFinite))
  )
    throw new RobotVisionError(
      'INVALID_ARGUMENT',
      'Provide 4–64 finite point pairs',
    );
  const normalize = (points: ImagePoint[]) => {
    const x = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const y = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    const rms = Math.sqrt(
      points.reduce((sum, p) => sum + (p.x - x) ** 2 + (p.y - y) ** 2, 0) /
        points.length,
    );
    if (rms < 1e-9)
      throw new RobotVisionError(
        'INVALID_ARGUMENT',
        'Coincident mapping points',
      );
    const scale = Math.SQRT2 / rms;
    return {
      x,
      y,
      scale,
      points: points.map((p) => ({
        x: (p.x - x) * scale,
        y: (p.y - y) * scale,
      })),
    };
  };
  const source = normalize(from);
  const target = normalize(to);
  const coefficients: number[][] = [];
  const values: number[] = [];
  source.points.forEach((p, index) => {
    const q = target.points[index];
    coefficients.push([p.x, p.y, 1, 0, 0, 0, -q.x * p.x, -q.x * p.y]);
    values.push(q.x);
    coefficients.push([0, 0, 0, p.x, p.y, 1, -q.y * p.x, -q.y * p.y]);
    values.push(q.y);
  });
  // Normalize before least squares so megapixel coordinates do not dominate
  // the normal equations. All fit points contribute; none are silently dropped.
  const normal = Array.from({ length: 8 }, (_, i) =>
    Array.from({ length: 8 }, (_, j) =>
      coefficients.reduce((sum, r) => sum + r[i] * r[j], 0),
    ),
  );
  const rhs = Array.from({ length: 8 }, (_, i) =>
    coefficients.reduce((sum, r, k) => sum + r[i] * values[k], 0),
  );
  const h = [...solveLinearSystem(normal, rhs), 1];
  const multiply = (a: number[], b: number[]) =>
    Array.from({ length: 9 }, (_, i) =>
      [0, 1, 2].reduce(
        (sum, k) => sum + a[Math.floor(i / 3) * 3 + k] * b[k * 3 + (i % 3)],
        0,
      ),
    );
  const result = multiply(
    [1 / target.scale, 0, target.x, 0, 1 / target.scale, target.y, 0, 0, 1],
    multiply(h, [
      source.scale,
      0,
      -source.x * source.scale,
      0,
      source.scale,
      -source.y * source.scale,
      0,
      0,
      1,
    ]),
  );
  if (Math.abs(result[8]) < 1e-12 || !result.every(Number.isFinite))
    throw new RobotVisionError(
      'INVALID_ARGUMENT',
      'Invalid perspective matrix',
    );
  return result.map((v) => v / result[8]);
}

export function invertHomography(h: number[]): number[] {
  const [a, b, c, d, e, f, g, j, i] = h;
  const inverse = [
    e * i - f * j,
    c * j - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * j - e * g,
    b * g - a * j,
    a * e - b * d,
  ];
  const determinant = a * inverse[0] + b * inverse[3] + c * inverse[6];
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12)
    throw new RobotVisionError(
      'INVALID_ARGUMENT',
      'Singular perspective matrix',
    );
  return inverse.map((v) => v / determinant);
}

/** A line through `point` with a unit `direction`. */
export interface FittedLine {
  point: ImagePoint;
  direction: ImagePoint;
}

export function quadFromArray(points: ImagePoint[]): ScreenQuad {
  const [topLeft, topRight, bottomRight, bottomLeft] = points;
  return { topLeft, topRight, bottomRight, bottomLeft };
}

export function applyHomography(
  matrix: number[],
  point: ImagePoint,
): ImagePoint {
  const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) {
    throw new RobotVisionError(
      'INVALID_ARGUMENT',
      'The perspective matrix maps the point to infinity',
    );
  }
  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denominator,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denominator,
  };
}

export function pointDistance(left: ImagePoint, right: ImagePoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

export function meanPointDistance(
  left: ImagePoint[],
  right: ImagePoint[],
): number {
  if (left.length === 0 || left.length !== right.length) {
    throw new RobotVisionError(
      'INVALID_ARGUMENT',
      'Both point lists must have the same non-zero length',
    );
  }
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += pointDistance(left[index], right[index]);
  }
  return total / left.length;
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Weighted total least squares: the line through the weighted centroid in the
 * principal direction of the weighted covariance.
 */
function totalLeastSquares(
  points: ImagePoint[],
  weights: number[],
): FittedLine | undefined {
  let weightSum = 0;
  let centerX = 0;
  let centerY = 0;
  for (let index = 0; index < points.length; index += 1) {
    const weight = weights[index];
    weightSum += weight;
    centerX += points[index].x * weight;
    centerY += points[index].y * weight;
  }
  if (weightSum <= 0) return undefined;
  centerX /= weightSum;
  centerY /= weightSum;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let index = 0; index < points.length; index += 1) {
    const weight = weights[index];
    const dx = points[index].x - centerX;
    const dy = points[index].y - centerY;
    sxx += weight * dx * dx;
    syy += weight * dy * dy;
    sxy += weight * dx * dy;
  }
  if (sxx + syy <= 1e-12) return undefined;
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return {
    point: { x: centerX, y: centerY },
    direction: { x: Math.cos(angle), y: Math.sin(angle) },
  };
}

function perpendicularDistance(line: FittedLine, point: ImagePoint): number {
  return Math.abs(
    (point.x - line.point.x) * line.direction.y -
      (point.y - line.point.y) * line.direction.x,
  );
}

/**
 * Robust line fit. The first pass is ordinary total least squares; later passes
 * reweight points by their residual against the current line, so a few snapped
 * edge points that landed on a reflection or an icon cannot drag the edge away.
 */
export function fitLineHuber(
  points: ImagePoint[],
  options: { iterations?: number; delta?: number } = {},
): FittedLine | undefined {
  if (points.length < 2) return undefined;
  const iterations = options.iterations ?? 8;
  const initial = totalLeastSquares(
    points,
    points.map(() => 1),
  );
  if (!initial) return undefined;
  let line = initial;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const residuals = points.map((point) => perpendicularDistance(line, point));
    const scale = options.delta ?? Math.max(0.5, 1.4826 * medianOf(residuals));
    const limit = options.delta ?? 1.5 * scale;
    const weights = residuals.map((residual) =>
      residual <= limit ? 1 : limit / residual,
    );
    const updated = totalLeastSquares(points, weights);
    if (!updated) return line;
    line = updated;
  }
  return line;
}

export function intersectLines(
  first: FittedLine,
  second: FittedLine,
  epsilon = 1e-9,
): ImagePoint | undefined {
  const determinant =
    first.direction.x * second.direction.y -
    first.direction.y * second.direction.x;
  if (Math.abs(determinant) < epsilon) return undefined;
  const dx = second.point.x - first.point.x;
  const dy = second.point.y - first.point.y;
  const distance =
    (dx * second.direction.y - dy * second.direction.x) / determinant;
  return {
    x: first.point.x + first.direction.x * distance,
    y: first.point.y + first.direction.y * distance,
  };
}

/** Per-corner median of several detections of the same quad. */
export function quadMedian(quads: ScreenQuad[]): ScreenQuad {
  if (quads.length === 0) {
    throw new RobotVisionError('INVALID_ARGUMENT', 'No quads to aggregate');
  }
  const corners = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;
  const aggregated = {} as ScreenQuad;
  for (const corner of corners) {
    aggregated[corner] = {
      x: medianOf(quads.map((quad) => quad[corner].x)),
      y: medianOf(quads.map((quad) => quad[corner].y)),
    };
  }
  return aggregated;
}

/**
 * Mean distance between matching corners of `quads` and `reference`, in pixels.
 * A stable rig reports a fraction of a pixel; a shaking one reports several.
 */
export function quadCornerJitter(
  quads: ScreenQuad[],
  reference: ScreenQuad,
): number {
  if (quads.length === 0) return 0;
  let total = 0;
  for (const quad of quads) {
    total += meanPointDistance(quadToArray(quad), quadToArray(reference));
  }
  return total / quads.length;
}

export function quadAspectRatio(points: ImagePoint[]): number {
  const [topLeft, topRight, bottomRight, bottomLeft] = points;
  const meanWidth =
    (pointDistance(topLeft, topRight) +
      pointDistance(bottomLeft, bottomRight)) /
    2;
  const meanHeight =
    (pointDistance(topLeft, bottomLeft) +
      pointDistance(topRight, bottomRight)) /
    2;
  return meanHeight > 0 ? meanWidth / meanHeight : 0;
}

/** Largest deviation from a right angle across the four corners, in degrees. */
export function quadAngleDeviation(points: ImagePoint[]): number {
  let worst = 0;
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index + points.length - 1) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const firstX = previous.x - current.x;
    const firstY = previous.y - current.y;
    const secondX = next.x - current.x;
    const secondY = next.y - current.y;
    const firstLength = Math.hypot(firstX, firstY);
    const secondLength = Math.hypot(secondX, secondY);
    if (firstLength < 1e-9 || secondLength < 1e-9) continue;
    const cosine = Math.min(
      1,
      Math.max(
        -1,
        (firstX * secondX + firstY * secondY) / (firstLength * secondLength),
      ),
    );
    const degrees = (Math.acos(cosine) * 180) / Math.PI;
    worst = Math.max(worst, Math.abs(90 - degrees));
  }
  return worst;
}

/**
 * Largest corner deviation, in degrees, at which the aspect prior still counts
 * in full. Past it the quad is too foreshortened for its outline to say much
 * about the panel, so the prior fades out instead of demoting the real screen.
 */
export const ASPECT_PRIOR_ANGLE_LIMIT_DEGREES = 20;

/**
 * Score multiplier a quad earns for matching the panel the operator expects.
 *
 * The cost of a mismatch grows with how rectangular the quad is, because
 * perspective is what moves a screen's outline away from its panel's ratio: a
 * screen seen at an angle can be far off and still be the screen, while a
 * near-frontal quad that misses the ratio is usually a different rectangle
 * (a whiteboard, a sheet of paper, a monitor bezel). `1` means "no opinion",
 * which is what a caller without a target, or a quad past the angle limit,
 * gets.
 */
export function aspectPriorScore(
  aspectRatio: number,
  targetAspectRatio: number | undefined,
  angleDeviationDegrees: number,
): number {
  if (
    targetAspectRatio === undefined ||
    !Number.isFinite(targetAspectRatio) ||
    targetAspectRatio <= 0 ||
    !Number.isFinite(aspectRatio) ||
    aspectRatio <= 0
  ) {
    return 1;
  }
  // An angle the caller could not measure is not evidence of a frontal view:
  // the prior stays out of the way instead of demoting a screen.
  if (!Number.isFinite(angleDeviationDegrees)) return 1;
  const deviation = Math.max(0, angleDeviationDegrees);
  const frontality = Math.max(
    0,
    Math.min(1, 1 - deviation / ASPECT_PRIOR_ANGLE_LIMIT_DEGREES),
  );
  if (frontality === 0) return 1;
  return Math.exp(
    -2 * Math.abs(Math.log(aspectRatio / targetAspectRatio)) * frontality,
  );
}

/**
 * Output corners in the same topLeft, topRight, bottomRight, bottomLeft order
 * as the source quad, turned clockwise inside the target rectangle. At 90
 * degrees the source top-left corner lands in the output's top-right corner,
 * which is what makes a screen lying on its side come out upright.
 */
export function destinationCorners(
  targetWidth: number,
  targetHeight: number,
  rotation: PerspectiveRotation,
): ImagePoint[] {
  const topLeft = { x: 0, y: 0 };
  const topRight = { x: targetWidth - 1, y: 0 };
  const bottomRight = { x: targetWidth - 1, y: targetHeight - 1 };
  const bottomLeft = { x: 0, y: targetHeight - 1 };
  switch (rotation) {
    case 90:
      return [topRight, bottomRight, bottomLeft, topLeft];
    case 180:
      return [bottomRight, bottomLeft, topLeft, topRight];
    case 270:
      return [bottomLeft, topLeft, topRight, bottomRight];
    default:
      return [topLeft, topRight, bottomRight, bottomLeft];
  }
}

function distance(a: ImagePoint, b: ImagePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Natural output rectangle for a measured screen quad, used when no operator
 * output size is saved. Opposite edges are averaged and swapped for sideways
 * rotations, so the corrected image keeps the glass's aspect ratio instead of
 * the camera frame's. Both the SDK preview and the UI editor use this.
 */
export function measuredPerspectiveTarget(
  quad: ScreenQuad,
  rotation: PerspectiveRotation,
): { width: number; height: number } {
  const width =
    (distance(quad.topLeft, quad.topRight) +
      distance(quad.bottomLeft, quad.bottomRight)) /
    2;
  const height =
    (distance(quad.topLeft, quad.bottomLeft) +
      distance(quad.topRight, quad.bottomRight)) /
    2;
  const sideways = rotation === 90 || rotation === 270;
  const bounded = (size: number) =>
    Math.min(4096, Math.max(2, Math.round(size)));
  return {
    width: bounded(sideways ? height : width),
    height: bounded(sideways ? width : height),
  };
}
