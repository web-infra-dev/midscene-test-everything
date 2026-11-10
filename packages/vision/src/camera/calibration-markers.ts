import type { CalibrationPageLayout } from '@midscene/robotics-shared/assisted-contracts';
import aruco from 'js-aruco2';
import sharp from 'sharp';
import { RobotVisionError } from './errors.js';
import {
  applyHomography,
  computeHomography,
  invertHomography,
  pointDistance,
  quadFromArray,
  quadMedian,
  quadToArray,
  validateQuad,
} from './vision-geometry.js';
import type { ScreenQuad } from './vision-types.js';

const dictionaryName = 'ARUCO_MIP_36h12';
const dictionary = new aruco.AR.Dictionary(dictionaryName);
export const markerSvg = (id: number) => dictionary.generateSVG(id);
type Markers = CalibrationPageLayout['markers'];
export async function detectCalibrationMarkers(jpeg: Buffer, markers: Markers) {
  const { data, info } = await sharp(jpeg, { limitInputPixels: 16_777_216 })
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const detector = new aruco.AR.Detector({
    dictionaryName,
    maxHammingDistance: 5,
  });
  const observed = detector.detect({
    data,
    width: info.width,
    height: info.height,
  });
  const pairs = markers.map((m) => {
    const matches = observed.filter((o) => o.id === m.code);
    if (matches.length !== 1)
      throw new RobotVisionError(
        'NO_SCREEN_DETECTED',
        `Calibration marker ${m.code} could not be decoded uniquely (${matches.length} matches). Keep all calibration markers visible and in focus.`,
      );
    // The generated SVG has a one-cell quiet zone around its 8 × 8 black square.
    const r = m.size * 0.4;
    const page = [
      [-r, -r],
      [r, -r],
      [r, r],
      [-r, r],
    ].map(([dx, dy]) => ({ x: m.x + dx, y: m.y + dy }));
    return { m, page, image: matches[0].corners };
  });
  const fit = pairs.filter((p) => p.m.purpose === 'fit');
  const webToImage = computeHomography(
    fit.flatMap((p) => p.page),
    fit.flatMap((p) => p.image),
  );
  const inverse = invertHomography(webToImage);
  const points = pairs.map(({ m, page, image }) => ({
    code: m.code,
    purpose: m.purpose,
    errorCssPx: Math.max(
      ...page.map((p, i) =>
        pointDistance(p, applyHomography(inverse, image[i])),
      ),
    ),
  }));
  function quality(purpose: 'fit' | 'check') {
    const errors = points
      .filter((p) => p.purpose === purpose)
      .map((p) => p.errorCssPx);
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    const max = Math.max(...errors);
    if (!errors.length || !Number.isFinite(mean) || mean > 2 || max > 3)
      throw new RobotVisionError(
        'CALIBRATION_MISMATCH',
        `${purpose === 'fit' ? 'Fit' : 'Independent check'} error: mean ${mean.toFixed(2)}, maximum ${max.toFixed(2)} CSS px (limits: mean 2, maximum 3).`,
      );
    return { count: errors.length, meanErrorCssPx: mean, maxErrorCssPx: max };
  }
  const squared = pairs.flatMap(({ page, image }) =>
    page.map(
      (p, i) => pointDistance(applyHomography(webToImage, p), image[i]) ** 2,
    ),
  );
  return {
    webToImage,
    markerErrorPx: Math.sqrt(
      squared.reduce((a, b) => a + b, 0) / squared.length,
    ),
    accuracy: { fit: quality('fit'), validation: quality('check'), points },
  };
}

export async function detectScreenFromMarkers(
  rawFrame: () => Promise<Buffer>,
  layout: CalibrationPageLayout,
) {
  const { screen, width, height } = layout;
  const gap = screen.height - height;
  if (
    Math.abs(width - screen.width) > 3 ||
    gap < -3 ||
    gap > screen.height * 0.25
  )
    throw new RobotVisionError(
      'CALIBRATION_MISMATCH',
      'Open the phone helper at normal zoom with the entire screen visible.',
    );
  // Screen minus viewport gives only the total chrome, not its distribution.
  // Real iOS captures can report zero safe areas and identical screen/client
  // touch coordinates. Never turn that missing evidence into a top-only inset.
  if (gap > 3 && layout.topInset === undefined)
    throw new RobotVisionError(
      'CALIBRATION_MISMATCH',
      'The browser did not report the page position within the screen. Automatic screen boundary detection is unavailable.',
    );
  const top = -(layout.topInset ?? 0);
  const bottom = top + Math.max(screen.height, height);
  const bounds = [
    { x: 0, y: top },
    { x: width, y: top },
    { x: width, y: bottom },
    { x: 0, y: bottom },
  ];
  const quads: ScreenQuad[] = [];
  let sourceWidth = 0;
  let sourceHeight = 0;
  let lastError: unknown;
  for (let i = 0; i < 8; i++) {
    const jpeg = await rawFrame();
    const meta = await sharp(jpeg).metadata();
    if (i && (sourceWidth !== meta.width || sourceHeight !== meta.height))
      throw new RobotVisionError(
        'CALIBRATION_MISMATCH',
        'Camera dimensions changed during detection',
      );
    sourceWidth = meta.width!;
    sourceHeight = meta.height!;
    try {
      const result = await detectCalibrationMarkers(jpeg, layout.markers);
      const quad = quadFromArray(
        bounds.map((p) => applyHomography(result.webToImage, p)),
      );
      validateQuad(quad);
      if (
        quadToArray(quad).some(
          (p) =>
            p.x < 0 || p.x >= sourceWidth || p.y < 0 || p.y >= sourceHeight,
        )
      )
        throw new RobotVisionError(
          'NO_SCREEN_DETECTED',
          'Full screen extends beyond the camera frame',
        );
      quads.push(quad);
    } catch (error) {
      if (!(error instanceof RobotVisionError)) throw error;
      lastError = error;
    }
  }
  if (quads.length < 4)
    throw (
      lastError ??
      new RobotVisionError('NO_SCREEN_DETECTED', 'Insufficient valid frames')
    );
  const points = quadMedian(quads);
  if (
    quads.some((q) =>
      quadToArray(q).some(
        (p, i) =>
          pointDistance(p, quadToArray(points)[i]) >
          Math.max(3, Math.hypot(sourceWidth, sourceHeight) * 0.002),
      ),
    )
  )
    throw new RobotVisionError(
      'CALIBRATION_MISMATCH',
      'Screen moved between frames. Keep the phone and camera fixed.',
    );
  return { points, sourceWidth, sourceHeight, rotation: 0 as const };
}
