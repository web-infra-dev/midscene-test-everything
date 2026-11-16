import type { CameraCorrection } from '@midscene/robotics-shared/camera/profile';
import { expect, test } from '@rstest/core';
import {
  type TwinCameraScreenSample,
  estimateCameraPose,
} from '../src/server/twin-camera';

type Vec3 = [number, number, number];

const FOCAL = 1500;
const SOURCE_WIDTH = 1920;
const SOURCE_HEIGHT = 1080;

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
function normalize(a: Vec3): Vec3 {
  const size = Math.hypot(...a);
  return scale(a, 1 / size);
}

function rotate(
  quaternion: { x: number; y: number; z: number; w: number },
  point: Vec3,
): Vec3 {
  const vector: Vec3 = [quaternion.x, quaternion.y, quaternion.z];
  const twice = scale(cross(vector, point), 2);
  return add(add(point, scale(twice, quaternion.w)), cross(vector, twice));
}

const camera: Vec3 = [260, 160, -45];
const target: Vec3 = [260, 20, -211];
const forward = normalize(subtract(target, camera));
const right = normalize(cross([0, 0, 1], forward));
const down = normalize(cross(forward, right));
const rows = [right, down, forward] as const;

function project(point: Vec3) {
  const relative = subtract(point, camera);
  const x = dot(rows[0], relative);
  const y = dot(rows[1], relative);
  const z = dot(rows[2], relative);
  return {
    x: (FOCAL * x) / z + SOURCE_WIDTH / 2,
    y: (FOCAL * y) / z + SOURCE_HEIGHT / 2,
  };
}

function sample(
  origin: Vec3,
  width: number,
  height: number,
  rotation: 0 | 90 = 0,
): TwinCameraScreenSample {
  const corners: Vec3[] = [
    origin,
    add(origin, [width, 0, 0]),
    add(origin, [width, -height, 0]),
    add(origin, [0, -height, 0]),
  ];
  const image = corners.map(project);
  const page = {
    topLeft: image[0],
    topRight: image[1],
    bottomRight: image[2],
    bottomLeft: image[3],
  };
  const source =
    rotation === 90
      ? [page.topRight, page.bottomRight, page.bottomLeft, page.topLeft]
      : [page.topLeft, page.topRight, page.bottomRight, page.bottomLeft];
  const correction: CameraCorrection = {
    points: {
      topLeft: source[0],
      topRight: source[1],
      bottomRight: source[2],
      bottomLeft: source[3],
    },
    sourceWidth: SOURCE_WIDTH,
    sourceHeight: SOURCE_HEIGHT,
    rotation,
  };
  return {
    calibration: {
      origin: { x: origin[0], y: origin[1], z: origin[2] },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: -1, z: 0 },
    },
    screen: { physicalWidthMm: width, physicalHeightMm: height },
    correction,
  };
}

test('recovers a camera pose from two full-screen quads', () => {
  const pose = estimateCameraPose(
    [sample([200, 100, -211], 66, 148), sample([280, 100, -211], 70, 155)],
    { focalPxAt1920: FOCAL },
  );
  expect(pose).toBeDefined();
  expect(pose!.positionMm.x).toBeCloseTo(camera[0], 1);
  expect(pose!.positionMm.y).toBeCloseTo(camera[1], 1);
  expect(pose!.positionMm.z).toBeCloseTo(camera[2], 1);
  expect(pose!.samples).toBe(2);
  expect(pose!.residualPx).toBeLessThan(0.05);
  const recoveredForward = rotate(pose!.quaternion, [0, 1, 0]);
  const recoveredUp = rotate(pose!.quaternion, [0, 0, 1]);
  const recoveredRight = rotate(pose!.quaternion, [1, 0, 0]);
  expect(dot(recoveredForward, forward)).toBeGreaterThan(0.999);
  expect(dot(recoveredUp, scale(down, -1))).toBeGreaterThan(0.999);
  expect(dot(recoveredRight, right)).toBeGreaterThan(0.999);
});

test('honours the correction rotation when ordering the page corners', () => {
  const pose = estimateCameraPose(
    [sample([200, 100, -211], 66, 148, 90), sample([280, 100, -211], 70, 155)],
    { focalPxAt1920: FOCAL },
  );
  expect(pose).toBeDefined();
  expect(pose!.positionMm.x).toBeCloseTo(camera[0], 1);
  expect(pose!.positionMm.y).toBeCloseTo(camera[1], 1);
  expect(pose!.positionMm.z).toBeCloseTo(camera[2], 1);
});

test('the footprint on the screen plane projects to the four raw frame corners', () => {
  const screenZ = -211;
  const pose = estimateCameraPose([sample([200, 100, screenZ], 66, 148, 90)])!;
  const expected = [
    [0, 0],
    [SOURCE_WIDTH, 0],
    [SOURCE_WIDTH, SOURCE_HEIGHT],
    [0, SOURCE_HEIGHT],
  ];
  for (const [i, corner] of pose.frameCornersMm.entries()) {
    const offset = rotate(pose.quaternion, [corner.x, corner.y, corner.z]);
    const point = add(
      [pose.positionMm.x, pose.positionMm.y, pose.positionMm.z],
      offset,
    );
    expect(point[2]).toBeCloseTo(screenZ, 4);
    const pixel = project(point);
    expect(pixel.x).toBeCloseTo(expected[i][0], 3);
    expect(pixel.y).toBeCloseTo(expected[i][1], 3);
  }
});

test('omits a camera when there are no usable screen quads', () => {
  expect(estimateCameraPose([])).toBeUndefined();
  const bad = sample([200, 100, -211], 66, 148);
  bad.screen.physicalWidthMm = 0;
  expect(estimateCameraPose([bad])).toBeUndefined();
});
