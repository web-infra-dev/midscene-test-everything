import { expect, test } from '@rstest/core';
import sharp from 'sharp';
import {
  calibrationPageMarkers,
  mappingQualityWarnings,
} from '../src/assisted-contracts.js';
import {
  captureScreenMarkers,
  detectCalibrationMarkers,
  detectScreenFromMarkers,
  markerSvg,
  recognizeScreenMarkers,
  screenBoundsProblem,
} from '../src/camera/calibration-markers.js';
import { applyHomography } from '../src/camera/vision-geometry.js';

const layout = {
  revision: 1,
  width: 400,
  height: 800,
  screen: { width: 400, height: 800, devicePixelRatio: 2 },
  markers: calibrationPageMarkers(400, 800),
};

async function photograph(
  shiftCheck = false,
  visible = layout.markers,
  offsetX = 0,
) {
  const markers = visible
    .map((m) =>
      markerSvg(m.code).replace(
        '<svg ',
        `<svg x="${m.x - m.size / 2 + (shiftCheck && m.purpose === 'check' ? 10 : 0)}" y="${m.y - m.size / 2}" width="${m.size}" height="${m.size}" `,
      ),
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="580" height="800"><rect width="100%" height="100%" fill="#ccc"/><g transform="matrix(1,-.12,-.08,.84,${95 + offsetX},70)"><rect width="400" height="800" fill="white"/>${markers}</g></svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

test('scores fit and independent marker errors against viewport size with measurement slack', () => {
  const fit = { count: 4, meanErrorCssPx: 3.01, maxErrorCssPx: 4.01 };
  const validation = { ...fit, count: 2 };
  const accuracy = { fit, validation, points: [] };
  expect(mappingQualityWarnings(accuracy, layout)).toEqual([]);
  validation.maxErrorCssPx = 6;
  expect(mappingQualityWarnings(accuracy, layout)).toEqual([
    { label: 'Check marker maximum error', percent: 1.5, targetPercent: 1 },
  ]);
  expect(
    mappingQualityWarnings(accuracy, { width: 1600, height: 800 }),
  ).toEqual([]);
});

test.each(layout.markers)(
  'maps the page with marker $code occluded',
  async (hidden) => {
    const visible = layout.markers.filter((m) => m.code !== hidden.code);
    const frame = await photograph(false, visible);
    const { accuracy, webToImage } = await detectCalibrationMarkers(
      frame,
      layout.markers,
    );
    expect(accuracy.points.map((p) => p.code)).toEqual(
      visible.map((m) => m.code),
    );
    expect(accuracy.fit.count).toBe(hidden.purpose === 'fit' ? 3 : 4);
    expect(accuracy.validation.count).toBe(hidden.purpose === 'check' ? 1 : 2);
    for (const x of [0, layout.width]) {
      for (const y of [0, layout.height]) {
        const projected = applyHomography(webToImage, { x, y });
        expect(
          Math.hypot(
            projected.x - (x - 0.08 * y + 95),
            projected.y - (-0.12 * x + 0.84 * y + 70),
          ),
        ).toBeLessThan(4);
      }
    }
  },
);

test('requires four visible markers', async () => {
  const three = await photograph(false, layout.markers.slice(1, 4));
  await expect(detectCalibrationMarkers(three, layout.markers)).rejects.toThrow(
    'at least four',
  );
});

const occludedPairs = layout.markers.flatMap((first, index) =>
  layout.markers
    .slice(index + 1)
    .map((second) => [first.code, second.code] as const),
);
test.each(occludedPairs)(
  'maps with markers %i and %i occluded',
  async (first, second) => {
    const visible = layout.markers.filter(
      (marker) => marker.code !== first && marker.code !== second,
    );
    const { accuracy, webToImage } = await detectCalibrationMarkers(
      await photograph(false, visible),
      layout.markers,
    );
    expect(accuracy.points.map((point) => point.code).sort()).toEqual(
      visible.map((marker) => marker.code).sort(),
    );
    for (const x of [0, layout.width]) {
      for (const y of [0, layout.height]) {
        const projected = applyHomography(webToImage, { x, y });
        expect(
          Math.hypot(
            projected.x - (x - 0.08 * y + 95),
            projected.y - (-0.12 * x + 0.84 * y + 70),
          ),
        ).toBeLessThan(4);
      }
    }
  },
);

test('reports a displaced remaining check marker', async () => {
  const shifted = await photograph(true, layout.markers.slice(0, 5));
  const { accuracy } = await detectCalibrationMarkers(shifted, layout.markers);
  expect(mappingQualityWarnings(accuracy, layout).map((w) => w.label)).toEqual([
    'Check marker mean error',
    'Check marker maximum error',
  ]);
});

test('uses the outer contour when a sharp front-facing marker decodes twice', async () => {
  const markers = calibrationPageMarkers(400, 800);
  const tags = markers
    .map((m) =>
      markerSvg(m.code).replace(
        '<svg ',
        `<svg x="${m.x - m.size / 2}" y="${m.y - m.size / 2}" width="${m.size}" height="${m.size}" `,
      ),
    )
    .join('');
  const image = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800"><rect width="400" height="800" fill="white"/>${tags}</svg>`,
    ),
  )
    .extend({ top: 50, bottom: 50, left: 50, right: 50, background: '#888' })
    .jpeg()
    .toBuffer();
  const result = await detectCalibrationMarkers(image, markers);
  expect(result.accuracy.validation.count).toBe(2);
});

test('rejects a duplicate marker even when another one is missing', async () => {
  const visible = layout.markers.map((marker) =>
    marker.code === 15 ? { ...marker, code: 10 } : marker,
  );
  const frame = await photograph(false, visible);
  await expect(detectCalibrationMarkers(frame, layout.markers)).rejects.toThrow(
    'Calibration marker 10 could not be decoded uniquely (2 matches)',
  );
});

test('recovers dim markers and still checks the independent marker positions', async () => {
  const dim = async (shiftCheck: boolean) =>
    sharp(await photograph(shiftCheck))
      .linear(0.12, 90)
      .jpeg({ quality: 90 })
      .toBuffer();
  const { accuracy } = await detectCalibrationMarkers(
    await dim(false),
    layout.markers,
  );
  expect(accuracy.fit.count).toBe(4);
  expect(accuracy.validation.count).toBe(2);
  expect(accuracy.validation.maxErrorCssPx).toBeLessThanOrEqual(3);
  const shifted = await detectCalibrationMarkers(
    await dim(true),
    layout.markers,
  );
  expect(mappingQualityWarnings(shifted.accuracy, layout)).toContainEqual(
    expect.objectContaining({ label: 'Check marker maximum error' }),
  );
});
test('recovers the outer screen from a slanted six-marker phone over eight frames', async () => {
  const frame = await photograph();
  let captures = 0;
  const correction = await detectScreenFromMarkers(async () => {
    captures++;
    return frame;
  }, layout);
  expect(captures).toBe(8);
  expect(
    Math.hypot(
      correction.points.topLeft.x - 95,
      correction.points.topLeft.y - 70,
    ),
  ).toBeLessThan(3);
  expect(
    Math.hypot(
      correction.points.bottomRight.x - 431,
      correction.points.bottomRight.y - 694,
    ),
  ).toBeLessThan(3);
});
test('independently displaced markers prevent a correction', async () => {
  const frame = await photograph(true);
  await expect(
    detectScreenFromMarkers(async () => frame, layout),
  ).rejects.toThrow(/Only 0 of 8 frames passed.*consistent screen plane/);
});

test('detects a landscape phone page without forcing or swapping its axes', async () => {
  const landscape = {
    revision: 1,
    width: 800,
    height: 400,
    screen: { width: 800, height: 400, devicePixelRatio: 2 },
    markers: calibrationPageMarkers(800, 400),
  };
  expect(screenBoundsProblem(landscape)).toBeUndefined();
  const markers = landscape.markers
    .map((m) =>
      markerSvg(m.code).replace(
        '<svg ',
        `<svg x="${m.x - m.size / 2}" y="${m.y - m.size / 2}" width="${m.size}" height="${m.size}" `,
      ),
    )
    .join('');
  const frame = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600"><rect width="1000" height="600" fill="#ccc"/><g transform="matrix(1,0,0,1,100,100)"><rect width="800" height="400" fill="white"/>${markers}</g></svg>`,
    ),
  )
    .jpeg()
    .toBuffer();
  const correction = await detectScreenFromMarkers(
    async () => frame,
    landscape,
  );
  expect(correction.sourceWidth).toBe(1000);
  expect(correction.sourceHeight).toBe(600);
  expect(
    Math.hypot(
      correction.points.topLeft.x - 100,
      correction.points.topLeft.y - 100,
    ),
  ).toBeLessThan(3);
  expect(
    Math.hypot(
      correction.points.bottomRight.x - 900,
      correction.points.bottomRight.y - 500,
    ),
  ).toBeLessThan(3);
});

test('locates one trial disk without a target coordinate and rejects ambiguous frames', async () => {
  const { findTrialTarget } = await import('../src/camera/trial-target.js');
  const render = (xs: number[]) =>
    sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800"><rect width="400" height="800" fill="white"/>${xs.map((x) => `<circle cx="${x}" cy="180" r="13" fill="#cf29b6"/>`).join('')}</svg>`,
      ),
    )
      .jpeg()
      .toBuffer();
  const point = await findTrialTarget(await render([92]));
  expect(Math.hypot(point.x - 92, point.y - 180)).toBeLessThan(1.5);
  await expect(findTrialTarget(await render([92, 155]))).rejects.toThrow(
    'exactly one',
  );
  await expect(findTrialTarget(await render([]))).rejects.toThrow(
    'exactly one',
  );
});

// Same observed markers, but browser chrome occupies both ends of the display.
// The complete screen must extend above AND below the page, not shift upward.
test('extrapolates split browser chrome to both physical screen edges', async () => {
  const frame = await sharp(await photograph())
    .extend({ top: 100, bottom: 100, left: 0, right: 0, background: '#ccc' })
    .jpeg()
    .toBuffer();
  const correction = await detectScreenFromMarkers(async () => frame, {
    ...layout,
    screen: { ...layout.screen, height: 900 },
    topInset: 30,
  });
  expect(
    Math.hypot(
      correction.points.topLeft.x - 97.4,
      correction.points.topLeft.y - 144.8,
    ),
  ).toBeLessThan(3);
  expect(
    Math.hypot(
      correction.points.bottomRight.x - 425.4,
      correction.points.bottomRight.y - 852.8,
    ),
  ).toBeLessThan(3);
});

test('does not extrapolate the observed iPhone chrome gap without an origin', async () => {
  let captures = 0;
  await expect(
    detectScreenFromMarkers(
      async () => {
        captures++;
        return Buffer.alloc(0);
      },
      {
        ...layout,
        width: 390,
        height: 699,
        screen: { width: 390, height: 844, devicePixelRatio: 3 },
        markers: calibrationPageMarkers(390, 699),
      },
    ),
  ).rejects.toThrow('Automatic screen boundary detection is unavailable');
  expect(captures).toBe(0);
});

test('preview finds the screen with two obscured markers and four good frames, and rejects three good frames', async () => {
  const visible = await photograph(false, layout.markers.slice(0, 4));
  const obscured = await photograph(false, layout.markers.slice(0, 3));
  for (const validFrames of [4, 3]) {
    let i = 0;
    const read = () => Promise.resolve(i++ < validFrames ? visible : obscured);
    const result = recognizeScreenMarkers(read, layout);
    if (validFrames === 4) {
      const value = await result;
      expect(value.validFrames).toBe(4);
      expect(value.markerIds).toEqual([10, 11, 12, 13]);
      expect(value.jpeg).toBe(visible.toString('base64'));
      expect(value.correction.points.topLeft.x).toBeCloseTo(95, -1);
    } else await expect(result).rejects.toThrow('Only 3 of 8 frames passed');
    expect(i).toBe(8);
  }
}, 20000);

test('returns the strongest complete frame after later frames lose a marker', async () => {
  const complete = await photograph();
  const partial = await photograph(false, layout.markers.slice(0, 4));
  let index = 0;
  const result = await recognizeScreenMarkers(
    async () => (index++ < 4 ? complete : partial),
    layout,
  );
  expect(result.markerIds).toEqual([10, 11, 12, 13, 14, 15]);
  await expect(
    detectCalibrationMarkers(
      Buffer.from(result.jpeg, 'base64'),
      layout.markers,
    ),
  ).resolves.toBeDefined();
}, 20000);

test('uses a frame aligned with the median screen even if a displaced frame has more markers', async () => {
  const displaced = await photograph(false, layout.markers, 15);
  const stable = await photograph(false, layout.markers.slice(0, 5));
  let index = 0;
  const result = await recognizeScreenMarkers(
    async () => (index++ === 0 ? displaced : stable),
    layout,
  );
  expect(result.validFrames).toBe(8);
  expect(result.jitterPx).toBeGreaterThan(10);
  expect(result.jpeg).toBe(stable.toString('base64'));
  expect(result.correction.points.topLeft.x).toBeCloseTo(95, -1);
}, 20000);

test('maps each of two simultaneously visible screens using its own marker IDs', async () => {
  const second = layout.markers.map((m) => ({ ...m, code: m.code + 10 }));
  const screen = (markers: typeof layout.markers, x: number) =>
    `<g transform="translate(${x},50)"><rect width="400" height="800" fill="white"/>${markers.map((m) => markerSvg(m.code).replace('<svg ', `<svg x="${m.x - m.size / 2}" y="${m.y - m.size / 2}" width="${m.size}" height="${m.size}" `)).join('')}</g>`;
  const image = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="950" height="900"><rect width="100%" height="100%" fill="#888"/>${screen(layout.markers, 50)}${screen(second, 500)}</svg>`,
    ),
  )
    .jpeg()
    .toBuffer();
  const left = await detectCalibrationMarkers(image, layout.markers);
  const right = await detectCalibrationMarkers(image, second);
  const center = (m: number[]) => ({
    x: (m[0] * 200 + m[1] * 400 + m[2]) / (m[6] * 200 + m[7] * 400 + m[8]),
    y: (m[3] * 200 + m[4] * 400 + m[5]) / (m[6] * 200 + m[7] * 400 + m[8]),
  });
  expect(Math.abs(center(left.webToImage).x - 250)).toBeLessThan(1);
  expect(Math.abs(center(right.webToImage).x - 700)).toBeLessThan(1);
  expect(center(right.webToImage).x - center(left.webToImage).x).toBeCloseTo(
    450,
    2,
  );
  expect(left.accuracy.validation.maxErrorCssPx).toBeLessThanOrEqual(3);
  expect(right.accuracy.validation.maxErrorCssPx).toBeLessThanOrEqual(3);
});

test('recaptures transient marker failures and stops after three failed batches', async () => {
  const good = await photograph();
  const blank = await sharp({
    create: { width: 160, height: 160, channels: 3, background: 'white' },
  })
    .jpeg()
    .toBuffer();
  let count = 0;
  const recovered = await captureScreenMarkers(
    async () => (++count <= 8 ? blank : good),
    layout,
  );
  expect(count).toBe(16);
  expect(recovered.validFrames).toBe(8);
  count = 0;
  await expect(
    captureScreenMarkers(async () => {
      count++;
      return blank;
    }, layout),
  ).rejects.toThrow('Only 0 of 8 frames passed');
  expect(count).toBe(24);
}, 20000);
