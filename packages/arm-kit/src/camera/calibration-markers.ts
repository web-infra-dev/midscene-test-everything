import { setTimeout as delay } from 'node:timers/promises';
import { markerNoiseAllowancePx } from '@midscene/arm-kit-shared/marker-contracts';
import aruco from 'js-aruco2';
import sharp from 'sharp';
import type { CalibrationPageLayout } from '../assisted-contracts.js';
import { RobotVisionError } from './errors.js';
import { MarkerCalibrationDetector } from './screen-marker-detector.js';
import {
  applyHomography,
  computeHomography,
  invertHomography,
  pointDistance,
  quadFromArray,
  quadMedian,
  quadToArray,
} from './vision-geometry.js';

const dictionaryName = 'ARUCO_MIP_36h12';
const dictionary = new aruco.AR.Dictionary(dictionaryName);
export const markerSvg = (id: number) => dictionary.generateSVG(id);
type Markers = CalibrationPageLayout['markers'];

export function hasMappingMarkerCoverage(fit: number, check: number) {
  return (
    (fit === 4 && (check === 1 || check === 2)) || (fit === 3 && check === 2)
  );
}

export async function detectCalibrationMarkers(jpeg: Buffer, markers: Markers) {
  const detector = new aruco.AR.Detector({
    dictionaryName,
    maxHammingDistance: 5,
  });
  async function decode(enhanced: boolean) {
    const image = sharp(jpeg, { limitInputPixels: 16_777_216 }).toColourspace(
      'srgb',
    );
    if (enhanced) image.normalise().sharpen();
    const { data, info } = await image
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return detector.detect({
      data,
      width: info.width,
      height: info.height,
    });
  }
  function uniqueContours(found: Awaited<ReturnType<typeof decode>>) {
    // A sharp, front-facing border can decode twice, from its outer and inner contours.
    // Use the outside corners for fitting and keep spatially distinct copies ambiguous.
    const diagonal = (m: (typeof found)[number]) =>
      pointDistance(m.corners[0], m.corners[2]);
    const unique: typeof found = [];
    for (const marker of found.sort((a, b) => diagonal(b) - diagonal(a))) {
      if (
        !unique.some(
          (other) =>
            other.id === marker.id &&
            marker.corners.every(
              (p, i) =>
                pointDistance(p, other.corners[i]) <= 0.08 * diagonal(other),
            ),
        )
      )
        unique.push(marker);
    }
    return unique;
  }
  let observed = uniqueContours(await decode(false));
  const counts = markers.map(
    ({ code }) => observed.filter((m) => m.id === code).length,
  );
  // Enhance only an incomplete read. A duplicate ID is already ambiguous.
  if (counts.includes(0) && counts.every((count) => count <= 1))
    observed = uniqueContours([...observed, ...(await decode(true))]);
  const pairs = markers.flatMap((m) => {
    const matches = observed.filter((o) => o.id === m.code);
    if (!matches.length) return [];
    if (matches.length > 1)
      throw new RobotVisionError(
        'NO_SCREEN_DETECTED',
        `Calibration marker ${m.code} could not be decoded uniquely (${matches.length} matches).`,
      );
    // The generated SVG has a one-cell quiet zone around its 8 × 8 black square.
    const r = m.size * 0.4;
    const page = [
      [-r, -r],
      [r, -r],
      [r, r],
      [-r, r],
    ].map(([dx, dy]) => ({ x: m.x + dx, y: m.y + dy }));
    return [{ m, page, image: matches[0].corners }];
  });
  const fit = pairs.filter((p) => p.m.purpose === 'fit');
  if (!hasMappingMarkerCoverage(fit.length, pairs.length - fit.length))
    throw new RobotVisionError(
      'NO_SCREEN_DETECTED',
      'Keep at least five of the six calibration markers visible and in focus.',
    );
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
    if (!Number.isFinite(mean) || !Number.isFinite(max))
      throw new RobotVisionError(
        'CALIBRATION_MISMATCH',
        'Page markers did not produce finite corner measurements.',
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

/** Also serialized into the phone page; use only the supplied layout. */
export function screenBoundsProblem(
  layout: CalibrationPageLayout,
): string | undefined {
  const { screen, width, height } = layout;
  const gap = screen.height - height;
  const horizontalGap = screen.width - width;
  if (
    horizontalGap < -3 ||
    horizontalGap > screen.width * 0.25 ||
    gap < -3 ||
    gap > screen.height * 0.25
  )
    return 'Open the phone helper at normal zoom with the entire screen visible.';
  // A toolbar gap alone cannot tell us how much chrome lies above the page.
  if (gap > 3 && layout.topInset === undefined)
    return 'The browser did not report the page position within the screen. Automatic screen boundary detection is unavailable.';
}
function screenCorners(width: number, top: number, bottom: number) {
  return [
    { x: 0, y: top },
    { x: width, y: top },
    { x: width, y: bottom },
    { x: 0, y: bottom },
  ];
}
export const MARKER_CAPTURE_ATTEMPTS = 3;
class UnstableMarkerCapture extends RobotVisionError {}

export async function captureScreenMarkers(
  rawFrame: () => Promise<Buffer>,
  layout: CalibrationPageLayout,
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await recognizeScreenMarkers(rawFrame, layout);
    } catch (error) {
      if (
        !(error instanceof UnstableMarkerCapture) ||
        attempt >= MARKER_CAPTURE_ATTEMPTS
      )
        throw error;
      await delay(300);
    }
  }
}

/** Optical preview uses the old workstation's four-visible-marker fit on eight fresh frames. */
export async function recognizeScreenMarkers(
  rawFrame: () => Promise<Buffer>,
  layout: CalibrationPageLayout,
  shared?: {
    detector: MarkerCalibrationDetector;
    frames: readonly (
      | Awaited<ReturnType<MarkerCalibrationDetector['decodeFrame']>>
      | undefined
    )[];
  },
) {
  const problem = screenBoundsProblem(layout);
  if (problem) throw new RobotVisionError('CALIBRATION_MISMATCH', problem);
  const top = -(layout.topInset ?? 0);
  const bottom = top + Math.max(layout.screen.height, layout.height);
  const target = {
    points: quadFromArray(
      screenCorners(Math.max(layout.width, layout.screen.width), top, bottom),
    ),
    markers: layout.markers.map((m) => ({
      id: m.code,
      center: { x: m.x, y: m.y },
      side: m.size,
    })),
  };
  const detector = shared?.detector ?? new MarkerCalibrationDetector();
  const frames: Array<{
    detection: Awaited<ReturnType<typeof detector.detectFrame>>;
    frame: Buffer;
  }> = [];
  let lastFailure: unknown;
  const frameCount = 8;
  for (let i = 0; i < frameCount; i++) {
    const jpeg = await rawFrame();
    try {
      const decoded = shared?.frames[i];
      if (shared && !decoded) continue;
      const detection = decoded
        ? detector.detectDecodedFrame(decoded, target)
        : await detector.detectFrame(jpeg, target);
      const reference = frames[0]?.detection;
      if (
        reference &&
        (reference.imageWidth !== detection.imageWidth ||
          reference.imageHeight !== detection.imageHeight)
      )
        throw new RobotVisionError(
          'CALIBRATION_MISMATCH',
          'Camera dimensions changed during detection',
        );
      frames.push({ detection, frame: jpeg });
    } catch (error) {
      if (
        !(error instanceof RobotVisionError) ||
        error.code !== 'NO_SCREEN_DETECTED'
      )
        throw error;
      lastFailure = error;
    }
  }
  if (frames.length < frameCount / 2)
    throw new UnstableMarkerCapture(
      'NO_SCREEN_DETECTED',
      `Only ${frames.length} of ${frameCount} frames passed. ${lastFailure instanceof Error ? lastFailure.message : ''}`,
    );
  const points = quadMedian(frames.map(({ detection }) => detection.points));
  const corners = quadToArray(points);
  const deviations = frames.map(({ detection }) =>
    Math.max(
      ...quadToArray(detection.points).map((p, i) =>
        pointDistance(p, corners[i]),
      ),
    ),
  );
  const jitterPx = Math.max(...deviations);
  const allowance = markerNoiseAllowancePx(
    frames[0].detection.imageWidth,
    frames[0].detection.imageHeight,
  );
  const stable = frames.filter((_, i) => deviations[i] <= allowance);
  if (!shared && stable.length < frameCount / 2)
    throw new UnstableMarkerCapture(
      'CALIBRATION_MISMATCH',
      'Screen moved between frames. Keep the phone and camera fixed.',
    );
  const best = (stable.length ? stable : frames).reduce((best, next) => {
    const markerGain =
      next.detection.markerIds.length - best.detection.markerIds.length;
    return markerGain > 0 ||
      (markerGain === 0 &&
        next.detection.reprojectionRmsePx < best.detection.reprojectionRmsePx)
      ? next
      : best;
  });
  return {
    correction: {
      points,
      sourceWidth: best.detection.imageWidth,
      sourceHeight: best.detection.imageHeight,
      rotation: 0 as const,
    },
    jpeg: best.frame.toString('base64'),
    markerIds: best.detection.markerIds,
    validFrames: frames.length,
    frameCount,
    jitterPx,
    errorPx: best.detection.reprojectionRmsePx,
  };
}

export async function detectScreenFromMarkers(
  rawFrame: () => Promise<Buffer>,
  layout: CalibrationPageLayout,
) {
  return (await recognizeScreenMarkers(rawFrame, layout)).correction;
}
