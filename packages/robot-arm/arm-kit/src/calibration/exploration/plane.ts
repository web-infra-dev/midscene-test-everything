import { CALIBRATION_RELATIVE_SLACK } from '../../assisted-contracts.js';
// Source: midscene-private dev 710f60809eac3dbe824f91a5cf8b3b0e72386282.
import {
  type CalibrationProfile,
  type PlaneQuality,
  RobotArmError,
  type ScreenProfile,
  type Vector3,
} from '../../contracts.js';
import {
  add,
  assertVector,
  cross,
  distance,
  dot,
  scale,
  sub,
  unit,
} from '../../domain.js';
import { SAMPLED_SURFACE_LIMIT_MM, surfaceOffsetMm } from '../surface.js';
export { screenGeometry } from '../geometry.js';
type Matrix = number[][];
export const SURFACE_COMPENSATION_LIMIT_MM = SAMPLED_SURFACE_LIMIT_MM;

/** Applies to measured surface heights, not to commanded press travel. */
export function assertSurfaceDeviationMm(value: number): void {
  if (
    !Number.isFinite(value) ||
    Math.abs(value) > SURFACE_COMPENSATION_LIMIT_MM
  )
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      `Screen surface varies by ${Math.abs(value).toFixed(2)} mm from the fitted plane; the ${SURFACE_COMPENSATION_LIMIT_MM} mm compensation limit requires a flatter support`,
      409,
    );
}
function eigenSymmetric(input: Matrix): {
  values: number[];
  vectors: Vector3[];
} {
  const a = input.map((r) => [...r]);
  const v: Matrix = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let it = 0; it < 40; it++) {
    let p = 0;
    let q = 1;
    for (const [i, j] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ])
      if (Math.abs(a[i][j]) > Math.abs(a[p][q])) {
        p = i;
        q = j;
      }
    if (Math.abs(a[p][q]) < 1e-12) break;
    const theta = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const app = a[p][p];
    const aqq = a[q][q];
    const apq = a[p][q];
    for (let k = 0; k < 3; k++)
      if (k !== p && k !== q) {
        const kp = a[k][p];
        const kq = a[k][q];
        a[k][p] = a[p][k] = c * kp - s * kq;
        a[k][q] = a[q][k] = s * kp + c * kq;
      }
    a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    a[p][q] = a[q][p] = 0;
    for (let k = 0; k < 3; k++) {
      const kp = v[k][p];
      const kq = v[k][q];
      v[k][p] = c * kp - s * kq;
      v[k][q] = s * kp + c * kq;
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  return {
    values: order.map((i) => a[i][i]),
    vectors: order.map((i) => unit({ x: v[0][i], y: v[1][i], z: v[2][i] })),
  };
}
function pca(points: Vector3[], weights: number[]) {
  const total = weights.reduce((a, b) => a + b, 0);
  const center = scale(
    points.reduce((a, p, i) => add(a, scale(p, weights[i])), {
      x: 0,
      y: 0,
      z: 0,
    }),
    1 / total,
  );
  const covariance: Matrix = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  points.forEach((p, i) => {
    const d = sub(p, center);
    const c = [d.x, d.y, d.z];
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++)
        covariance[j][k] += (c[j] * c[k] * weights[i]) / total;
  });
  return { center, ...eigenSymmetric(covariance) };
}
/** Deterministic bounded RANSAC, followed by Huber-weighted PCA. */
export function fitContactPlane(
  points: Vector3[],
  preferred: Vector3,
  screen: Partial<Pick<ScreenProfile, 'physicalWidthMm' | 'physicalHeightMm'>>,
  weights?: number[],
): { plane: CalibrationProfile['plane']; quality: PlaneQuality } {
  if (points.length < 5 || points.length > 100)
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'Collect 5–100 distributed contact samples',
    );
  points.forEach(assertVector);
  const pointWeights = weights ?? points.map(() => 1);
  if (
    pointWeights.length !== points.length ||
    pointWeights.some((w) => !Number.isFinite(w) || w <= 0)
  )
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'Contact sample weights must be positive and finite',
    );
  unit(preferred);
  for (let i = 0; i < points.length; i++)
    for (let j = 0; j < i; j++)
      if (distance(points[i], points[j]) < 1e-6)
        throw new RobotArmError(
          'DUPLICATE_SAMPLE',
          'Collect distinct contact samples',
        );
  let best: Vector3[] = [];
  let attempts = 0;
  const inlierThresholdMm =
    SAMPLED_SURFACE_LIMIT_MM * 0.25 * (1 + CALIBRATION_RELATIVE_SLACK);
  for (let i = 0; i < points.length - 2; i++)
    for (let j = i + 1; j < points.length - 1; j++)
      for (let k = j + 1; k < points.length; k++) {
        if (++attempts > 1000) break;
        const c = cross(sub(points[j], points[i]), sub(points[k], points[i]));
        if (dot(c, c) < 1e-8) continue;
        const n = unit(c);
        const o = dot(n, points[i]);
        const inliers = points.filter(
          (p) => Math.abs(dot(n, p) - o) <= inlierThresholdMm,
        );
        if (inliers.length > best.length) best = inliers;
      }
  if (best.length < 3)
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'Touch samples do not define a non-collinear contact plane',
      400,
      {
        sampleCount: points.length,
        inliers: best.length,
        inlierThresholdMm,
        zRangeMm:
          Math.max(...points.map((point) => point.z)) -
          Math.min(...points.map((point) => point.z)),
      },
    );
  const bestWeights = best.map((p) => pointWeights[points.indexOf(p)] ?? 1);
  let fit = pca(best, bestWeights);
  for (let iteration = 0; iteration < 5; iteration++) {
    const n = fit.vectors[0];
    const weights = best.map(
      (p, i) =>
        bestWeights[i] *
        Math.min(1, 0.2 / Math.max(1e-9, Math.abs(dot(n, sub(p, fit.center))))),
    );
    fit = pca(best, weights);
  }
  let normal = fit.vectors[0];
  if (dot(normal, preferred) < 0) normal = scale(normal, -1);
  const offset = dot(normal, fit.center);
  const spans = fit.vectors
    .slice(1)
    .map((axis) => {
      const values = best.map((p) => dot(p, axis));
      return Math.max(...values) - Math.min(...values);
    })
    .sort((a, b) => a - b);
  const rmseMm = Math.sqrt(
    best.reduce((s, p) => s + (dot(normal, p) - offset) ** 2, 0) / best.length,
  );
  const quality = {
    rmseMm,
    inliers: best.length,
    total: points.length,
    minorSpanMm: spans[0],
    majorSpanMm: spans[1],
  };
  const scaleMm = Math.max(
    spans[1],
    screen.physicalWidthMm ?? 0,
    screen.physicalHeightMm ?? 0,
    1,
  );
  if (!Number.isFinite(rmseMm) || !(spans[0] > scaleMm * 1e-8))
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'Touch samples do not span a two-dimensional plane',
      400,
      { quality },
    );
  return { plane: { normal, offset }, quality };
}
export function surfaceDepthMm(
  c: Pick<
    CalibrationProfile,
    'plane' | 'inward' | 'surface' | 'origin' | 'xAxis' | 'yAxis'
  >,
  contact: Vector3,
): number {
  const height =
    (dot(c.plane.normal, contact) - c.plane.offset) /
    dot(c.plane.normal, c.inward);
  const relative = sub(sub(contact, scale(c.inward, height)), c.origin);
  return (
    height -
    surfaceOffsetMm(c.surface, {
      x: dot(relative, c.xAxis),
      y: dot(relative, c.yAxis),
    })
  );
}
