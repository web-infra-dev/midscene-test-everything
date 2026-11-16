// Source: midscene-private dev 710f60809eac3dbe824f91a5cf8b3b0e72386282.
// Adaptations: imports and empty Arm Kit repair patches on sampled surfaces.
import type {
  CalibrationProfile,
  CartesianPose,
  PlaneQuality,
  RobotArmCapabilities,
  ScreenProfile,
  ScreenSurfaceCompensation,
  ToolProfile,
  Vector3,
} from '../../contracts.js';
import { RobotArmError, assertScreenMapping } from '../../contracts.js';
import { distance, dot, rotate, sub, unit } from '../../domain.js';
import {
  assertSurfaceDeviationMm,
  fitContactPlane,
  screenGeometry,
  surfaceDepthMm,
} from './plane.js';

/** Ignore fits smaller than touch repeatability; they only add noise. */
const MIN_SURFACE_COMPENSATION_MM = 0.05;

export interface ScreenPoint2 {
  x: number;
  y: number;
}
/** x' = m0*x + m1*y + m2; y' = m3*x + m4*y + m5. */
export type Affine = [number, number, number, number, number, number];

function solve3(matrix: number[][], values: number[]): number[] {
  const rows = matrix.map((row, i) => [...row, values[i]]);
  for (let column = 0; column < 3; column++) {
    let pivot = column;
    for (let row = column + 1; row < 3; row++)
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column]))
        pivot = row;
    if (Math.abs(rows[pivot][column]) < 1e-9)
      throw new RobotArmError(
        'CALIBRATION_QUALITY',
        'Touch samples are collinear; move to a different screen area',
      );
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let i = column; i <= 3; i++) rows[column][i] /= divisor;
    for (let row = 0; row < 3; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let i = column; i <= 3; i++)
        rows[row][i] -= factor * rows[column][i];
    }
  }
  return rows.map((row) => row[3]);
}

export function fitAffine(
  from: ScreenPoint2[],
  to: ScreenPoint2[],
  weights?: number[],
): Affine {
  if (from.length < 3 || from.length !== to.length)
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'At least three touch samples are required',
    );
  const pointWeights = weights ?? from.map(() => 1);
  if (
    pointWeights.length !== from.length ||
    pointWeights.some((w) => !Number.isFinite(w) || w <= 0)
  )
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'Affine sample weights must be positive and finite',
    );
  let sxx = 0;
  let sxy = 0;
  let sx = 0;
  let syy = 0;
  let sy = 0;
  let n = 0;
  let rxx = 0;
  let rxy = 0;
  let rx = 0;
  let ryx = 0;
  let ryy = 0;
  let ry = 0;
  for (let i = 0; i < from.length; i++) {
    const x = from[i].x;
    const y = from[i].y;
    const weight = pointWeights[i];
    sxx += weight * x * x;
    sxy += weight * x * y;
    sx += weight * x;
    syy += weight * y * y;
    sy += weight * y;
    n += weight;
    rxx += weight * to[i].x * x;
    rxy += weight * to[i].x * y;
    rx += weight * to[i].x;
    ryx += weight * to[i].y * x;
    ryy += weight * to[i].y * y;
    ry += weight * to[i].y;
  }
  const matrix = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const [a, b, c] = solve3(matrix, [rxx, rxy, rx]);
  const [d, e, f] = solve3(matrix, [ryx, ryy, ry]);
  return [a, b, c, d, e, f];
}

export interface ScreenFrame {
  affine: Affine;
  inverse: Affine;
  pixelWidth: number;
  pixelHeight: number;
  physicalWidthMm: number;
  physicalHeightMm: number;
  /** Robot XY of screen pixel (0,0), (pixelWidth-1,0) and (0,pixelHeight-1). */
  origin: ScreenPoint2;
  uCorner: ScreenPoint2;
  vCorner: ScreenPoint2;
  /** Unit robot-XY direction of increasing u/v. */
  uAxis: ScreenPoint2;
  vAxis: ScreenPoint2;
}

export function affinePoint(affine: Affine, point: ScreenPoint2): ScreenPoint2 {
  return {
    x: affine[0] * point.x + affine[1] * point.y + affine[2],
    y: affine[3] * point.x + affine[4] * point.y + affine[5],
  };
}

/** Pixel position expressed in the orthogonal geometry used by screen actions. */
export function measuredScreenPixel(
  geometry: Pick<CalibrationProfile, 'origin' | 'xAxis' | 'yAxis'>,
  screen: Pick<
    ScreenFrame,
    'physicalWidthMm' | 'physicalHeightMm' | 'pixelWidth' | 'pixelHeight'
  >,
  point: Vector3,
): ScreenPoint2 {
  const relative = sub(point, geometry.origin);
  return {
    x:
      (dot(relative, geometry.xAxis) / screen.physicalWidthMm) *
      (screen.pixelWidth - 1),
    y:
      (dot(relative, geometry.yAxis) / screen.physicalHeightMm) *
      (screen.pixelHeight - 1),
  };
}

/**
 * Physical scale of each pixel axis. `measuredScreenPixel` spans
 * `pixelWidth - 1` / `pixelHeight - 1`, so the same span is used here.
 */
export function screenMillimetresPerPixel(
  screen: Pick<
    ScreenFrame,
    'physicalWidthMm' | 'physicalHeightMm' | 'pixelWidth' | 'pixelHeight'
  >,
): ScreenPoint2 {
  return {
    x: screen.physicalWidthMm / Math.max(1, screen.pixelWidth - 1),
    y: screen.physicalHeightMm / Math.max(1, screen.pixelHeight - 1),
  };
}

/** Convert a screen-pixel residual into millimetres on the measured axes. */
export function screenResidualMm(
  screen: Pick<
    ScreenFrame,
    'physicalWidthMm' | 'physicalHeightMm' | 'pixelWidth' | 'pixelHeight'
  >,
  residual: ScreenPoint2,
): number {
  const scale = screenMillimetresPerPixel(screen);
  return Math.hypot(residual.x * scale.x, residual.y * scale.y);
}

export function invertAffine(affine: Affine): Affine {
  const [a, b, c, d, e, f] = affine;
  const determinant = a * e - b * d;
  if (Math.abs(determinant) < 1e-9)
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'Touch samples do not define an invertible screen mapping',
    );
  const ia = e / determinant;
  const ib = -b / determinant;
  const id = -d / determinant;
  const ie = a / determinant;
  return [ia, ib, -(ia * c + ib * f), id, ie, -(id * c + ie * f)];
}

/** Convert a pixel-space affine into a screen frame in robot XY. */
export function screenFrame(
  robotToPixel: Affine,
  screen: Pick<
    ScreenProfile,
    'pixelWidth' | 'pixelHeight' | 'physicalWidthMm' | 'physicalHeightMm'
  >,
): ScreenFrame {
  const pixelWidth = screen.pixelWidth;
  const pixelHeight = screen.pixelHeight;
  if (!pixelWidth || !pixelHeight)
    throw new RobotArmError(
      'INVALID_SCREEN_PROFILE',
      'Screen pixel dimensions are required',
    );
  const inverse = invertAffine(robotToPixel);
  const origin = affinePoint(inverse, { x: 0, y: 0 });
  const uCorner = affinePoint(inverse, { x: pixelWidth - 1, y: 0 });
  const vCorner = affinePoint(inverse, { x: 0, y: pixelHeight - 1 });
  const uVector = sub(
    { x: uCorner.x, y: uCorner.y, z: 0 },
    { x: origin.x, y: origin.y, z: 0 },
  );
  const vVector = sub(
    { x: vCorner.x, y: vCorner.y, z: 0 },
    { x: origin.x, y: origin.y, z: 0 },
  );
  const uLength = Math.hypot(uVector.x, uVector.y);
  const vLength = Math.hypot(vVector.x, vVector.y);
  if (
    !Number.isFinite(uLength) ||
    !Number.isFinite(vLength) ||
    uLength < 1 ||
    vLength < 1
  )
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'Touch samples produce a degenerate screen frame',
    );
  return {
    affine: robotToPixel,
    inverse,
    pixelWidth,
    pixelHeight,
    physicalWidthMm: uLength,
    physicalHeightMm: vLength,
    origin,
    uCorner,
    vCorner,
    uAxis: { x: uVector.x / uLength, y: uVector.y / uLength },
    vAxis: { x: vVector.x / vLength, y: vVector.y / vLength },
  };
}

export function coverage(
  points: ScreenPoint2[],
  frame: Pick<ScreenFrame, 'pixelWidth' | 'pixelHeight'>,
): number {
  if (!points.length) return 0;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  return (
    (width / Math.max(1, frame.pixelWidth - 1)) *
    (height / Math.max(1, frame.pixelHeight - 1))
  );
}

export interface AutoCalibrationSample {
  /** Tool contact point in the robot base frame. */
  robot: Vector3;
  /** Page-reported full-screen pixel. */
  screen: ScreenPoint2;
  /** Relative confidence; late/retried contacts carry less weight. */
  weight?: number;
}

export interface AutoCalibrationGeometry {
  frame: ScreenFrame;
  plane: CalibrationProfile['plane'];
  quality: PlaneQuality;
  candidate: Omit<CalibrationProfile, 'phoneFrame' | 'observationPose'>;
  measuredSize: { physicalWidthMm: number; physicalHeightMm: number };
  coverage: number;
  gridRmsPx: number;
  /** The same residual on the display, using the measured physical size. */
  gridRmsMm: number;
  /** Largest absolute local height correction stored on the candidate. */
  surfaceMaxMm: number;
  axisSkewRatio: number;
}

/**
 * Preserve measured regional heights instead of extrapolating a global
 * polynomial to unsampled screen edges. Runtime interpolation is a convex
 * combination of nearby samples, so it cannot invent a larger correction.
 */
function surfaceCompensation(
  samples: readonly AutoCalibrationSample[],
  weights: readonly number[],
  geometry: Pick<CalibrationProfile, 'plane' | 'inward'>,
  screen: ScreenProfile,
  measuredSize: { physicalWidthMm: number; physicalHeightMm: number },
): { surface?: ScreenSurfaceCompensation; maxAbsMm: number } {
  assertScreenMapping(screen);
  const widthMm = measuredSize.physicalWidthMm;
  const heightMm = measuredSize.physicalHeightMm;
  const localSamples = samples.map((sample, index) => ({
    x:
      Math.min(1, Math.max(0, sample.screen.x / (screen.pixelWidth - 1))) *
      widthMm,
    y:
      Math.min(1, Math.max(0, sample.screen.y / (screen.pixelHeight - 1))) *
      heightMm,
    depthMm:
      (dot(geometry.plane.normal, sample.robot) - geometry.plane.offset) /
      dot(geometry.plane.normal, geometry.inward),
    weight: weights[index],
  }));
  const maxAbsMm = Math.max(
    ...localSamples.map((sample) => Math.abs(sample.depthMm)),
  );
  assertSurfaceDeviationMm(maxAbsMm);
  if (maxAbsMm < MIN_SURFACE_COMPENSATION_MM) return { maxAbsMm };
  return {
    surface: {
      kind: 'sampled',
      patches: [],
      widthMm,
      heightMm,
      samples: localSamples,
      limitMm: maxAbsMm,
    },
    maxAbsMm,
  };
}

/** Measure independent Z error while enforcing the physical compensation range. */
export function maxSurfaceResidualMm(
  candidate: Pick<
    CalibrationProfile,
    'plane' | 'inward' | 'surface' | 'origin' | 'xAxis' | 'yAxis'
  >,
  contacts: readonly Vector3[],
): number {
  const residuals = contacts.map((contact) => {
    const height =
      (dot(candidate.plane.normal, contact) - candidate.plane.offset) /
      dot(candidate.plane.normal, candidate.inward);
    assertSurfaceDeviationMm(height);
    return Math.abs(surfaceDepthMm(candidate, contact));
  });
  return Math.max(...residuals);
}

export function autoCalibrationGeometry(input: {
  startPose: CartesianPose;
  samples: AutoCalibrationSample[];
  screen: ScreenProfile;
  tool: ToolProfile;
  capabilities: RobotArmCapabilities;
  binding: Pick<
    CalibrationProfile,
    | 'id'
    | 'robotProfileId'
    | 'toolProfileId'
    | 'screenProfileId'
    | 'robotGeometryRevision'
    | 'toolGeometryRevision'
    | 'screenGeometryRevision'
  >;
}): AutoCalibrationGeometry {
  const deduped = input.samples.filter(
    (sample, index, all) =>
      all.findIndex((other) => distance(other.robot, sample.robot) < 1) ===
      index,
  );
  const samples = deduped.length >= 5 ? deduped : input.samples;
  const sampleWeights = samples.map((sample) => sample.weight ?? 1);
  const { plane, quality } = fitContactPlane(
    samples.map((sample) => sample.robot),
    rotate(input.startPose.orientation, input.tool.contactDirection),
    {},
    sampleWeights,
  );
  const robotXY = samples.map((sample) => ({
    x: sample.robot.x,
    y: sample.robot.y,
  }));
  const screenXY = samples.map((sample) => sample.screen);
  let robotToPixel = fitAffine(robotXY, screenXY, sampleWeights);
  // IRLS on the affine: a late or retried contact should not pull the
  // page-to-robot mapping away from the rest of the grid.
  for (let iteration = 0; iteration < 3; iteration++) {
    const residuals = samples.map((sample, i) => {
      const predicted = affinePoint(robotToPixel, robotXY[i]);
      return Math.hypot(
        predicted.x - sample.screen.x,
        predicted.y - sample.screen.y,
      );
    });
    const sorted = [...residuals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 1;
    const scale = Math.max(1, median);
    const robust = sampleWeights.map(
      (weight, i) => weight / (1 + (residuals[i] / scale) ** 2),
    );
    robotToPixel = fitAffine(robotXY, screenXY, robust);
  }
  const frame = screenFrame(robotToPixel, input.screen);
  if (Math.abs(plane.normal.z) < 1e-6)
    throw new RobotArmError(
      'SCREEN_TILT_UNSUPPORTED',
      'Screen plane is vertical; automatic exploration requires a mostly horizontal screen',
      422,
    );
  const planeZ = (x: number, y: number) =>
    (plane.offset - plane.normal.x * x - plane.normal.y * y) / plane.normal.z;
  const origin: Vector3 = {
    x: frame.origin.x,
    y: frame.origin.y,
    z: planeZ(frame.origin.x, frame.origin.y),
  };
  const p2: Vector3 = {
    ...frame.uCorner,
    z: planeZ(frame.uCorner.x, frame.uCorner.y),
  };
  const p3: Vector3 = {
    ...frame.vCorner,
    z: planeZ(frame.vCorner.x, frame.vCorner.y),
  };
  const uVector = sub(p2, origin);
  const vVector = sub(p3, origin);
  const measuredSize = {
    physicalWidthMm: distance(p2, origin),
    physicalHeightMm: distance(p3, origin),
  };
  // Score the orthogonal frame that screen actions actually execute.
  const axisSkewRatio = Math.abs(dot(unit(uVector), unit(vVector)));
  frame.physicalWidthMm = measuredSize.physicalWidthMm;
  frame.physicalHeightMm = measuredSize.physicalHeightMm;
  const geometry = screenGeometry(
    plane,
    origin,
    p2,
    input.startPose.orientation,
    input.tool,
    input.capabilities,
  );
  if (dot(geometry.yAxis, unit(vVector)) <= 0)
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'Measured screen orientation is inconsistent with the contact plane',
      409,
    );
  const gridResiduals = samples.map((sample) => {
    const predicted = measuredScreenPixel(geometry, frame, sample.robot);
    return {
      x: predicted.x - sample.screen.x,
      y: predicted.y - sample.screen.y,
    };
  });
  const gridRmsPx = Math.sqrt(
    gridResiduals.reduce(
      (sum, residual) => sum + residual.x ** 2 + residual.y ** 2,
      0,
    ) / samples.length,
  );
  const gridRmsMm = Math.sqrt(
    gridResiduals.reduce(
      (sum, residual) => sum + screenResidualMm(frame, residual) ** 2,
      0,
    ) / samples.length,
  );
  const { surface, maxAbsMm: surfaceMaxMm } = surfaceCompensation(
    samples,
    sampleWeights,
    geometry,
    input.screen,
    measuredSize,
  );
  const candidate: AutoCalibrationGeometry['candidate'] = {
    ...input.binding,
    kind: geometry.kind,
    geometryStatus: 'valid',
    acceptanceStatus: 'pending',
    screenRevision: input.screen.revision,
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    origin: geometry.origin,
    xAxis: geometry.xAxis,
    yAxis: geometry.yAxis,
    inward: geometry.inward,
    orientation: geometry.orientation,
    plane: geometry.plane,
    ...(surface ? { surface } : {}),
    quality,
  };
  return {
    frame,
    measuredSize,
    plane: geometry.plane,
    quality,
    candidate,
    coverage: coverage(
      samples.map((sample) => sample.screen),
      frame,
    ),
    gridRmsPx,
    gridRmsMm,
    surfaceMaxMm,
    axisSkewRatio,
  };
}
