/**
 * Plane-to-plane homography between the camera image and the robot bench.
 *
 * When at least one screen is calibrated, its perspective quad (image) and its
 * calibrated corners (robot) form four point correspondences. The resulting
 * homography maps any image point on the bench plane to robot XY, so the next
 * screen can be approached from its saved perspective without a separate
 * hand-eye calibration.
 */

export interface PlanePoint {
  x: number;
  y: number;
}

export type Homography = readonly number[];

const NORMALIZE_EPSILON = 1e-9;

function normalize(points: readonly PlanePoint[]): {
  points: PlanePoint[];
  scale: number;
  offset: PlanePoint;
} {
  const count = points.length || 1;
  const offset = {
    x: points.reduce((sum, point) => sum + point.x, 0) / count,
    y: points.reduce((sum, point) => sum + point.y, 0) / count,
  };
  const spread =
    points.reduce(
      (sum, point) => sum + Math.hypot(point.x - offset.x, point.y - offset.y),
      0,
    ) / count || 1;
  const scale = Math.SQRT2 / Math.max(spread, NORMALIZE_EPSILON);
  return {
    points: points.map((point) => ({
      x: (point.x - offset.x) * scale,
      y: (point.y - offset.y) * scale,
    })),
    scale,
    offset,
  };
}

function solveLinear(
  matrix: number[][],
  values: number[],
): number[] | undefined {
  const size = values.length;
  const rows = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++)
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column]))
        pivot = row;
    if (Math.abs(rows[pivot][column]) < 1e-12) return undefined;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let index = column; index <= size; index++)
      rows[column][index] /= divisor;
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      if (!factor) continue;
      for (let index = column; index <= size; index++)
        rows[row][index] -= factor * rows[column][index];
    }
  }
  return rows.map((row) => row[size]);
}

function multiply(left: Homography, right: Homography): number[] {
  const result = new Array(9).fill(0);
  for (let row = 0; row < 3; row++)
    for (let column = 0; column < 3; column++)
      for (let index = 0; index < 3; index++)
        result[row * 3 + column] +=
          left[row * 3 + index] * right[index * 3 + column];
  return result;
}

/**
 * Solves the homography mapping `source` points to `target` points. Four
 * non-collinear pairs are enough; more pairs are fitted in the least-squares
 * sense.
 */
export function solveHomography(
  pairs: readonly { source: PlanePoint; target: PlanePoint }[],
): Homography | undefined {
  if (pairs.length < 4) return undefined;
  const source = normalize(pairs.map((pair) => pair.source));
  const target = normalize(pairs.map((pair) => pair.target));
  const normal = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const values = new Array(8).fill(0);
  const accumulate = (rowValues: number[], value: number) => {
    for (let row = 0; row < 8; row++) {
      if (!rowValues[row]) continue;
      values[row] += rowValues[row] * value;
      for (let column = 0; column < 8; column++)
        normal[row][column] += rowValues[row] * rowValues[column];
    }
  };
  for (let index = 0; index < pairs.length; index++) {
    const { x, y } = source.points[index];
    const { x: targetX, y: targetY } = target.points[index];
    accumulate([x, y, 1, 0, 0, 0, -targetX * x, -targetX * y], targetX);
    accumulate([0, 0, 0, x, y, 1, -targetY * x, -targetY * y], targetY);
  }
  const solution = solveLinear(normal, values);
  if (!solution) return undefined;
  const normalized: Homography = [...solution, 1];
  // Undo the normalization: H = T_target⁻¹ · H_normalized · T_source.
  const sourceToNormalized = [
    source.scale,
    0,
    -source.offset.x * source.scale,
    0,
    source.scale,
    -source.offset.y * source.scale,
    0,
    0,
    1,
  ];
  const targetFromNormalized = [
    1 / target.scale,
    0,
    target.offset.x,
    0,
    1 / target.scale,
    target.offset.y,
    0,
    0,
    1,
  ];
  return multiply(
    targetFromNormalized,
    multiply(normalized, sourceToNormalized),
  );
}

export function applyHomography(
  matrix: Homography,
  point: PlanePoint,
): PlanePoint | undefined {
  const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  if (Math.abs(denominator) < 1e-12) return undefined;
  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denominator,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denominator,
  };
}
