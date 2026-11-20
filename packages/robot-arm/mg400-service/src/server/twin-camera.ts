import type { CameraCorrection } from '@midscene/robotics-shared/camera/profile';
import { computeHomography } from '@midscene/robotics-shared/camera/vision-geometry';
import type { Quaternion, Vector3 } from '@midscene/robotics-shared/contracts';
import type { TwinCameraSnapshot } from './twin-types.js';

/**
 * Effective focal length for a 1920×1080 C922 frame. The C922's nominal 78°
 * diagonal field of view implies roughly 1360 px, but the two measured screen
 * quads agree noticeably better around 1500 px. This is a visual estimate, not
 * a calibrated intrinsic; a proper checkerboard calibration belongs in the
 * camera profile before this value is used for anything but a prop.
 */
export const C922_FOCAL_PX_AT_1920 = 1500;

/** Reject a fit that cannot explain the measured quads. */
const MAX_RESIDUAL_PX = 12;

type Vec3 = [number, number, number];
type Mat3 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface TwinCameraScreenSample {
  /** Screen corners are the full screen, not the page viewport. */
  calibration: { origin: Vector3; xAxis: Vector3; yAxis: Vector3 };
  screen: { physicalWidthMm: number; physicalHeightMm: number };
  correction: CameraCorrection;
}

export interface TwinCameraPose {
  /** Lens centre in the robot base frame, millimetres. */
  positionMm: Vector3;
  /**
   * Maps the C922 body model's local axes (forward +Y, up +Z, right +X) to the
   * robot base frame. The renderer composes this with its Z-up → Y-up root.
   */
  quaternion: Quaternion;
  frameCornersMm: TwinCameraSnapshot['frameCornersMm'];
  residualPx: number;
  samples: number;
}

interface PreparedSample {
  plane: Vec3[];
  image: { x: number; y: number }[];
  focal: number;
  principalX: number;
  principalY: number;
}

interface Pose {
  R: Mat3;
  t: Vec3;
}

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function scale(a: Vec3, factor: number): Vec3 {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
function normalize(a: Vec3): Vec3 {
  const size = length(a);
  return size > 1e-12 ? scale(a, 1 / size) : [0, 0, 0];
}
function finiteVec(a: Vec3): boolean {
  return a.every(Number.isFinite);
}

function matVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function matMul(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

function column(m: Mat3, index: 0 | 1 | 2): Vec3 {
  return [m[index], m[3 + index], m[6 + index]];
}

function fromColumns(a: Vec3, b: Vec3, c: Vec3): Mat3 {
  return [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]];
}

function intrinsic(focal: number, cx: number, cy: number): Mat3 {
  return [focal, 0, cx, 0, focal, cy, 0, 0, 1];
}

function inverseIntrinsic(focal: number, cx: number, cy: number): Mat3 {
  return [1 / focal, 0, -cx / focal, 0, 1 / focal, -cy / focal, 0, 0, 1];
}

/** Page-order corners from the source-image order stored with a correction. */
function pageOrderedQuad(correction: CameraCorrection) {
  const source = [
    correction.points.topLeft,
    correction.points.topRight,
    correction.points.bottomRight,
    correction.points.bottomLeft,
  ];
  const offset = Math.round(correction.rotation / 90) % 4;
  return [0, 1, 2, 3].map((index) => source[(index - offset + 4) % 4]);
}

function screenCorners(
  origin: Vector3,
  xAxis: Vector3,
  yAxis: Vector3,
  width: number,
  height: number,
): Vec3[] {
  const at = (u: number, v: number): Vec3 => [
    origin.x + xAxis.x * u + yAxis.x * v,
    origin.y + xAxis.y * u + yAxis.y * v,
    origin.z + xAxis.z * u + yAxis.z * v,
  ];
  return [at(0, 0), at(width, 0), at(width, height), at(0, height)];
}

function prepareSample(
  sample: TwinCameraScreenSample,
  focalPxAt1920: number,
): PreparedSample | undefined {
  const { screen, correction, calibration } = sample;
  const width = screen.physicalWidthMm;
  const height = screen.physicalHeightMm;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(correction.sourceWidth) ||
    !Number.isFinite(correction.sourceHeight) ||
    correction.sourceWidth < 2 ||
    correction.sourceHeight < 2 ||
    ![0, 90, 180, 270].includes(correction.rotation)
  )
    return undefined;
  const image = pageOrderedQuad(correction);
  if (
    image.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )
  )
    return undefined;
  return {
    plane: screenCorners(
      calibration.origin,
      calibration.xAxis,
      calibration.yAxis,
      width,
      height,
    ),
    image,
    focal: focalPxAt1920 * (correction.sourceWidth / 1920),
    principalX: correction.sourceWidth / 2,
    principalY: correction.sourceHeight / 2,
  };
}

function project(
  sample: PreparedSample,
  pose: Pose,
  point: Vec3,
): { x: number; y: number } | undefined {
  const camera = add(matVec(pose.R, point), pose.t);
  if (!finiteVec(camera) || camera[2] <= 1e-9) return undefined;
  return {
    x: (sample.focal * camera[0]) / camera[2] + sample.principalX,
    y: (sample.focal * camera[1]) / camera[2] + sample.principalY,
  };
}

function residuals(
  samples: PreparedSample[],
  pose: Pose,
): { values: number[]; valid: boolean } {
  const values: number[] = [];
  let valid = true;
  for (const sample of samples) {
    for (let index = 0; index < sample.plane.length; index += 1) {
      const projected = project(sample, pose, sample.plane[index]);
      if (!projected) valid = false;
      values.push(
        projected ? projected.x - sample.image[index].x : 1e6,
        projected ? projected.y - sample.image[index].y : 1e6,
      );
    }
  }
  return { values, valid };
}

function initialPose(sample: PreparedSample): Pose | undefined {
  let homography: number[];
  try {
    homography = computeHomography(
      sample.plane.map((point) => ({ x: point[0], y: point[1] })),
      sample.image,
    );
  } catch {
    return undefined;
  }
  const inverse = inverseIntrinsic(
    sample.focal,
    sample.principalX,
    sample.principalY,
  );
  const normalized = matMul(inverse, homography as unknown as Mat3);
  const first = column(normalized, 0);
  const second = column(normalized, 1);
  const third = column(normalized, 2);
  const firstLength = length(first);
  const secondLength = length(second);
  if (
    !Number.isFinite(firstLength) ||
    !Number.isFinite(secondLength) ||
    firstLength < 1e-12 ||
    secondLength < 1e-12
  )
    return undefined;
  const lambda = 2 / (firstLength + secondLength);
  let right = normalize(first);
  let up = normalize(subtract(second, scale(right, dot(right, second))));
  if (length(up) < 1e-12) return undefined;
  const forward = cross(right, up);
  if (length(forward) < 1e-12) return undefined;
  let rotation = fromColumns(right, up, forward);
  let translation = scale(third, lambda);
  const depths = sample.plane.map(
    (point) => add(matVec(rotation, point), translation)[2],
  );
  if (depths.some((depth) => depth <= 0)) {
    right = scale(right, -1);
    up = scale(up, -1);
    rotation = fromColumns(right, up, forward);
    translation = scale(translation, -1);
  }
  const flippedDepths = sample.plane.map(
    (point) => add(matVec(rotation, point), translation)[2],
  );
  if (flippedDepths.every((depth) => depth <= 0)) return undefined;
  if (!translation.every(Number.isFinite)) return undefined;
  return { R: rotation, t: translation };
}

function rodrigues(vector: Vec3): Mat3 {
  const angle = length(vector);
  if (angle < 1e-12) return [...IDENTITY] as Mat3;
  const axis = scale(vector, 1 / angle);
  const x = axis[0];
  const y = axis[1];
  const z = axis[2];
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const one = 1 - cosine;
  return [
    cosine + x * x * one,
    x * y * one - z * sine,
    x * z * one + y * sine,
    y * x * one + z * sine,
    cosine + y * y * one,
    y * z * one - x * sine,
    z * x * one - y * sine,
    z * y * one + x * sine,
    cosine + z * z * one,
  ];
}

function quaternionFromMatrix(m: Mat3): Quaternion {
  const trace = m[0] + m[4] + m[8];
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (m[7] - m[5]) * s;
    y = (m[2] - m[6]) * s;
    z = (m[3] - m[1]) * s;
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[0] - m[4] - m[8]);
    w = (m[7] - m[5]) / s;
    x = 0.25 * s;
    y = (m[1] + m[3]) / s;
    z = (m[2] + m[6]) / s;
  } else if (m[4] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[4] - m[0] - m[8]);
    w = (m[2] - m[6]) / s;
    x = (m[1] + m[3]) / s;
    y = 0.25 * s;
    z = (m[5] + m[7]) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m[8] - m[0] - m[4]);
    w = (m[3] - m[1]) / s;
    x = (m[2] + m[6]) / s;
    y = (m[5] + m[7]) / s;
    z = 0.25 * s;
  }
  const size = Math.hypot(x, y, z, w) || 1;
  return { x: x / size, y: y / size, z: z / size, w: w / size };
}

function rotationVector(m: Mat3): Vec3 {
  const q = quaternionFromMatrix(m);
  const signed = q.w < 0 ? { x: -q.x, y: -q.y, z: -q.z, w: -q.w } : q;
  const sine = Math.hypot(signed.x, signed.y, signed.z);
  if (sine < 1e-12) return [0, 0, 0];
  const angle = 2 * Math.atan2(sine, signed.w);
  return [
    (signed.x / sine) * angle,
    (signed.y / sine) * angle,
    (signed.z / sine) * angle,
  ];
}

function solveLinear(
  matrix: number[][],
  values: number[],
): number[] | undefined {
  const size = values.length;
  const rows = matrix.map((row, index) => [...row, values[index]]);
  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(rows[row][pivot]) > Math.abs(rows[best][pivot])) best = row;
    }
    if (Math.abs(rows[best][pivot]) < 1e-12) return undefined;
    if (best !== pivot) [rows[pivot], rows[best]] = [rows[best], rows[pivot]];
    const divisor = rows[pivot][pivot];
    for (let column = pivot; column <= size; column += 1)
      rows[pivot][column] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = rows[row][pivot];
      if (!factor) continue;
      for (let column = pivot; column <= size; column += 1)
        rows[row][column] -= factor * rows[pivot][column];
    }
  }
  return rows.map((row) => row[size]);
}

function optimize(
  samples: PreparedSample[],
  initial: Pose,
): (Pose & { residual: number }) | undefined {
  const parameters = [
    ...rotationVector(initial.R),
    initial.t[0],
    initial.t[1],
    initial.t[2],
  ];
  let previous = Number.POSITIVE_INFINITY;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const rotation = rodrigues([parameters[0], parameters[1], parameters[2]]);
    const translation: Vec3 = [parameters[3], parameters[4], parameters[5]];
    const current = residuals(samples, { R: rotation, t: translation });
    if (!current.valid) return undefined;
    const error = current.values.reduce((sum, value) => sum + value * value, 0);
    if (!Number.isFinite(error)) return undefined;
    if (Math.abs(previous - error) < 1e-12 && iteration > 0) break;
    previous = error;
    const jacobian: number[][] = current.values.map(() => new Array(6).fill(0));
    const step = 1e-6;
    for (let parameter = 0; parameter < 6; parameter += 1) {
      const shifted = [...parameters];
      shifted[parameter] += step;
      const changed = residuals(samples, {
        R: rodrigues([shifted[0], shifted[1], shifted[2]]),
        t: [shifted[3], shifted[4], shifted[5]],
      });
      if (!changed.valid) return undefined;
      for (let index = 0; index < current.values.length; index += 1)
        jacobian[index][parameter] =
          (changed.values[index] - current.values[index]) / step;
    }
    const normal = Array.from({ length: 6 }, () => new Array(6).fill(0));
    const rhs = new Array(6).fill(0);
    for (let row = 0; row < current.values.length; row += 1) {
      for (let left = 0; left < 6; left += 1) {
        rhs[left] -= jacobian[row][left] * current.values[row];
        for (let right = 0; right < 6; right += 1)
          normal[left][right] += jacobian[row][left] * jacobian[row][right];
      }
    }
    for (let index = 0; index < 6; index += 1) normal[index][index] += 1e-9;
    const delta = solveLinear(normal, rhs);
    if (!delta) return undefined;
    let magnitude = Math.hypot(...delta);
    if (!Number.isFinite(magnitude)) return undefined;
    const limit = 20;
    if (magnitude > limit) {
      const factor = limit / magnitude;
      for (let index = 0; index < 6; index += 1) delta[index] *= factor;
      magnitude = limit;
    }
    for (let index = 0; index < 6; index += 1)
      parameters[index] += delta[index];
    if (magnitude < 1e-8) break;
  }
  const rotation = rodrigues([parameters[0], parameters[1], parameters[2]]);
  const translation: Vec3 = [parameters[3], parameters[4], parameters[5]];
  const final = residuals(samples, { R: rotation, t: translation });
  if (!final.valid) return undefined;
  return {
    R: rotation,
    t: translation,
    residual: Math.sqrt(
      final.values.reduce((sum, value) => sum + value * value, 0) /
        final.values.length,
    ),
  };
}

function cameraCentre(pose: Pose): Vec3 {
  return [
    -(pose.R[0] * pose.t[0] + pose.R[3] * pose.t[1] + pose.R[6] * pose.t[2]),
    -(pose.R[1] * pose.t[0] + pose.R[4] * pose.t[1] + pose.R[7] * pose.t[2]),
    -(pose.R[2] * pose.t[0] + pose.R[5] * pose.t[1] + pose.R[8] * pose.t[2]),
  ];
}

/**
 * Model axes in the base frame. The C922 body STL looks along +Y and up +Z, so
 * its local +X is also the image right axis.
 */
function modelQuaternion(pose: Pose): Quaternion {
  const cameraX: Vec3 = [pose.R[0], pose.R[1], pose.R[2]];
  const cameraY: Vec3 = [pose.R[3], pose.R[4], pose.R[5]];
  const cameraZ: Vec3 = [pose.R[6], pose.R[7], pose.R[8]];
  const modelX = cameraX;
  const modelY = cameraZ;
  const modelZ = scale(cameraY, -1);
  return quaternionFromMatrix(fromColumns(modelX, modelY, modelZ));
}

function frameCornersMm(
  sample: PreparedSample,
  pose: Pose,
): TwinCameraSnapshot['frameCornersMm'] {
  // Work in optical coordinates (+Z forward, +Y down) until the final
  // conversion to the model axes. All four rays come from the uncropped frame.
  const plane = sample.plane.map((p) => add(matVec(pose.R, p), pose.t));
  const normal = cross(
    subtract(plane[1], plane[0]),
    subtract(plane[3], plane[0]),
  );
  const distance = dot(normal, plane[0]);
  const x = sample.principalX / sample.focal;
  const y = sample.principalY / sample.focal;
  const rays: Vec3[] = [
    [-x, -y, 1],
    [x, -y, 1],
    [x, y, 1],
    [-x, y, 1],
  ];
  const depths = rays.map((ray) => distance / dot(normal, ray));
  // A frame crossing the plane's horizon has no finite footprint. In that
  // case show a cross-section at screen depth so the twin stays in view.
  const screenDepth = Math.max(...plane.map((p) => p[2]));
  const usePlane = depths.every((d) => d > 0 && d <= 4 * screenDepth);
  const corner = (i: number): Vector3 => {
    const depth = usePlane ? depths[i] : screenDepth;
    return { x: rays[i][0] * depth, y: depth, z: -rays[i][1] * depth };
  };
  return [corner(0), corner(1), corner(2), corner(3)];
}

/**
 * Recover a camera pose from the screen rectangles the robot already measured
 * and the four page corners the camera saw. The screens must be described in
 * the full-screen frame (`geometryFrame: 'screen'`); a page viewport smaller
 * than the display would bias the result. This is a presentation estimate, not
 * a validated extrinsic: lens distortion, an inset quad or a wrong focal
 * length all move the camera by centimetres.
 */
export function estimateCameraPose(
  samples: TwinCameraScreenSample[],
  options: { focalPxAt1920?: number; maxResidualPx?: number } = {},
): TwinCameraPose | undefined {
  const focalPxAt1920 = options.focalPxAt1920 ?? C922_FOCAL_PX_AT_1920;
  const maxResidualPx = options.maxResidualPx ?? MAX_RESIDUAL_PX;
  const prepared = samples
    .map((sample) => prepareSample(sample, focalPxAt1920))
    .filter((sample): sample is PreparedSample => Boolean(sample));
  if (!prepared.length) return undefined;
  const initial = initialPose(prepared[0]);
  if (!initial) return undefined;
  const pose = optimize(prepared, initial);
  if (!pose || !Number.isFinite(pose.residual) || pose.residual > maxResidualPx)
    return undefined;
  const centre = cameraCentre(pose);
  if (!finiteVec(centre)) return undefined;
  return {
    positionMm: { x: centre[0], y: centre[1], z: centre[2] },
    quaternion: modelQuaternion(pose),
    frameCornersMm: frameCornersMm(prepared[0], pose),
    residualPx: pose.residual,
    samples: prepared.length,
  };
}
