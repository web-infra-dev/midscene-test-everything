import { describe, expect, it } from '@rstest/core';
import {
  type CalibratedScreenEntry,
  type ScreenQuad,
  calibrationQuad,
  distanceToQuad,
  estimateScreenPlane,
  insideQuad,
  pageOrderedQuad,
  quadCenter,
  screenPlacementIssues,
  screenPlaneSources,
} from '../src/calibration/screen-position.js';
import type { WorkstationScreenTarget } from '../src/calibration/screen-position.js';
import type {
  CalibrationProfile,
  CameraCorrection,
  ScreenProfile,
} from '../src/contracts.js';
type VisionScreenQuad = CameraCorrection['points'];

const quad = (
  x: number,
  y: number,
  width: number,
  height: number,
): ScreenQuad => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];

/**
 * The service stores the raw image quad and rotates the corrected image by
 * `rotation`, so the page's corner `j` is image corner `(j - rotation / 90)`.
 * A rotated page's stored quad is therefore the page quad shifted the other way.
 */
function rawQuadFromPage(
  page: ScreenQuad,
  rotation: 0 | 90 | 180 | 270,
): VisionScreenQuad {
  const offset = rotation / 90;
  const points = [0, 1, 2, 3].map((index) => page[(index + offset) % 4]);
  return {
    topLeft: points[0],
    topRight: points[1],
    bottomRight: points[2],
    bottomLeft: points[3],
  };
}

// A bench plane with a known image-to-robot mapping (0.5 mm per px, rotated).
const toRobot = (point: { x: number; y: number }) => ({
  x: 100 + point.x * 0.5,
  y: 50 - point.y * 0.5,
});

function screenEntry(input: {
  id: string;
  page: ScreenQuad;
  width: number;
  height: number;
}): CalibratedScreenEntry {
  const origin = toRobot(input.page[0]);
  const xCorner = toRobot(input.page[1]);
  const yCorner = toRobot(input.page[3]);
  const screen = {
    id: input.id,
    name: input.id,
    visionTarget: { cameraId: 'camera', screenId: input.id },
    physicalWidthMm: input.width,
    physicalHeightMm: input.height,
  } as unknown as ScreenProfile;
  const calibration = {
    id: `${input.id}-calibration`,
    screenProfileId: input.id,
    origin: { ...origin, z: 0 },
    xAxis: {
      x: (xCorner.x - origin.x) / input.width,
      y: (xCorner.y - origin.y) / input.width,
      z: 0,
    },
    yAxis: {
      x: (yCorner.x - origin.x) / input.height,
      y: (yCorner.y - origin.y) / input.height,
      z: 0,
    },
  } as unknown as CalibrationProfile;
  return { screen, calibration };
}

const target = (
  screenId: string,
  profileKey: string,
): WorkstationScreenTarget => ({
  cameraId: 'camera',
  screenId,
  name: screenId,
  pixelWidth: 1000,
  pixelHeight: 500,
  profileKey,
});

describe('screen position geometry', () => {
  it('maps calibration axes to the four screen corners', () => {
    const corners = calibrationQuad(
      {
        origin: { x: 100, y: 200, z: -50 },
        xAxis: { x: 1, y: 0, z: 0 },
        yAxis: { x: 0, y: -1, z: 0 },
      },
      { physicalWidthMm: 70, physicalHeightMm: 150 },
    );
    expect(corners).toEqual([
      { x: 100, y: 200 },
      { x: 170, y: 200 },
      { x: 170, y: 50 },
      { x: 100, y: 50 },
    ]);
    expect(quadCenter(corners!)).toEqual({ x: 135, y: 125 });
    expect(
      calibrationQuad(
        {
          origin: { x: 0, y: 0, z: 0 },
          xAxis: { x: 1, y: 0, z: 0 },
          yAxis: { x: 0, y: 1, z: 0 },
        },
        {},
      ),
    ).toBeUndefined();
  });

  it('reads image corners in page order for every output rotation', () => {
    const page = quad(0, 0, 10, 20);
    for (const rotation of [0, 90, 180, 270] as const) {
      expect(
        pageOrderedQuad(rawQuadFromPage(page, rotation), rotation),
      ).toEqual(page);
    }
    const rotated = rawQuadFromPage(page, 180);
    expect(pageOrderedQuad(rotated, 0)).not.toEqual(page);
    expect(pageOrderedQuad(rotated, 180)).toEqual(page);
  });

  it('measures containment with an inside margin and an outside tolerance', () => {
    const screen = quad(0, 0, 100, 50);
    expect(insideQuad({ x: 50, y: 25 }, screen)).toBe(true);
    expect(insideQuad({ x: 50, y: 25 }, screen, 10)).toBe(true);
    expect(insideQuad({ x: 3, y: 25 }, screen, 10)).toBe(false);
    expect(insideQuad({ x: 106, y: 25 }, screen)).toBe(false);
    expect(insideQuad({ x: 106, y: 25 }, screen, -10)).toBe(true);
    expect(distanceToQuad({ x: 50, y: 25 }, screen)).toBe(0);
    expect(distanceToQuad({ x: -7, y: 25 }, screen)).toBeCloseTo(7, 6);
  });

  it('recovers a screen rectangle from a calibrated neighbour', () => {
    const sourcePage = quad(200, 100, 140, 300);
    const targetPage = quad(700, 120, 140, 300);
    const estimate = estimateScreenPlane(
      [
        {
          image: sourcePage,
          robot: sourcePage.map(toRobot) as unknown as ScreenQuad,
        },
      ],
      targetPage,
    );
    expect(estimate).toBeDefined();
    estimate!.quad.forEach((corner, index) => {
      const truth = toRobot(targetPage[index]);
      expect(corner.x).toBeCloseTo(truth.x, 6);
      expect(corner.y).toBeCloseTo(truth.y, 6);
    });
  });

  it('needs the rotation offset to estimate a rotated neighbour', () => {
    const sourcePage = quad(200, 100, 140, 300);
    const targetPage = quad(700, 120, 140, 300);
    const profiles = new Map([
      ['left', { points: rawQuadFromPage(sourcePage, 90), rotation: 90 }],
      ['right', { points: rawQuadFromPage(targetPage, 0), rotation: 0 }],
    ]);
    const entry = screenEntry({
      id: 'left',
      page: sourcePage,
      width: 140,
      height: 300,
    });
    const targets = [target('left', 'left'), target('right', 'right')];
    const sources = screenPlaneSources({
      entries: [entry],
      cameraId: 'camera',
      targets,
      profiles,
    });
    expect(sources).toHaveLength(1);
    const correct = estimateScreenPlane(
      sources,
      pageOrderedQuad(profiles.get('right')!.points, 0),
    )!;
    correct.quad.forEach((corner, index) => {
      const truth = toRobot(targetPage[index]);
      expect(corner.x).toBeCloseTo(truth.x, 6);
      expect(corner.y).toBeCloseTo(truth.y, 6);
    });
    // The fixed bug: ignoring the source rotation shifts the correspondences and
    // moves the estimate far away.
    const ignored = estimateScreenPlane(
      [
        {
          image: pageOrderedQuad(profiles.get('left')!.points, 0),
          robot: sources[0].robot,
        },
      ],
      pageOrderedQuad(profiles.get('right')!.points, 0),
    )!;
    const worst = Math.max(
      ...ignored.quad.map((corner, index) => {
        const truth = toRobot(targetPage[index]);
        return Math.hypot(corner.x - truth.x, corner.y - truth.y);
      }),
    );
    expect(worst).toBeGreaterThan(5);
  });

  it('rejects the wrong screen, a far placement and an unknown bench', () => {
    const screen = quad(200, 0, 70, 150);
    const other = quad(0, 0, 70, 150);
    const others = [{ screenId: 'other', screenName: '安卓', quad: other }];
    expect(
      screenPlacementIssues({
        tip: { x: 30, y: 40 },
        target: { name: '荣耀', quad: screen },
        others,
      }),
    ).toEqual([
      {
        kind: 'other-screen',
        screenId: 'other',
        screenName: '安卓',
        quad: other,
      },
    ]);
    expect(
      screenPlacementIssues({
        tip: { x: 235, y: 75 },
        target: { name: '荣耀', quad: screen },
        others,
      }),
    ).toEqual([]);
    expect(
      screenPlacementIssues({
        tip: { x: 500, y: 75 },
        target: { name: '荣耀', quad: screen },
        others,
      }),
    ).toMatchObject([
      { kind: 'outside-target', distanceMm: expect.any(Number) },
    ]);
    expect(
      screenPlacementIssues({
        tip: { x: 500, y: 75 },
        target: { name: '荣耀' },
        others: [],
        estimate: screen,
      }),
    ).toMatchObject([{ kind: 'outside-estimate' }]);
    // A first-ever calibration has no geometry to judge; it must not block.
    expect(
      screenPlacementIssues({
        tip: { x: -400, y: 900 },
        target: { name: '荣耀' },
        others: [],
      }),
    ).toEqual([]);
  });
});

describe('same-batch exploration exclusion areas', () => {
  it.each([
    [{ x: 100, y: 50 }, [{ x: 100, y: 50 }], true],
    [
      { x: 100, y: 50 },
      [
        { x: 50, y: 50 },
        { x: 150, y: 50 },
      ],
      true,
    ],
    [
      { x: 100, y: 50 },
      [
        { x: 20, y: 20 },
        { x: 180, y: 20 },
        { x: 180, y: 80 },
        { x: 20, y: 80 },
      ],
      true,
    ],
    // A rotated region must not exclude every point of its bounding box.
    [
      { x: 10, y: 90 },
      [
        { x: 0, y: 0 },
        { x: 100, y: 80 },
        { x: 90, y: 100 },
        { x: 0, y: 20 },
      ],
      false,
    ],
    [{ x: 400, y: 50 }, [{ x: 100, y: 50 }], false],
  ] as const)(
    'blocks only points in or near the previous explored region: %j',
    (tip, points, rejected) => {
      const issues = screenPlacementIssues({
        tip,
        target: { name: 'Samsung' },
        others: [],
        previousExplorations: [
          { screenId: 'iphone', screenName: 'iPhone', points },
        ],
      });
      expect(issues.length).toBe(rejected ? 1 : 0);
      if (rejected) expect(issues[0].kind).toBe('previous-exploration');
    },
  );
});
