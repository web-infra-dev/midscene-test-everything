import { setTimeout as delay } from 'node:timers/promises';
import type { CalibrationPageLayout } from '@midscene/robotics-shared/assisted-contracts';
import { markerNoiseAllowancePx } from '@midscene/robotics-shared/marker-contracts';
import sharp from 'sharp';
import { decodeArucoMarkers } from './aruco-markers.js';
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

export { markerSvg } from './aruco-markers.js';
type Markers = CalibrationPageLayout['markers'];

export function hasMappingMarkerCoverage(fit: number, check: number) {
  return (
    Number.isInteger(fit) &&
    fit >= 0 &&
    fit <= 4 &&
    Number.isInteger(check) &&
    check >= 0 &&
    check <= 2 &&
    fit + check >= 4
  );
}

export async function detectCalibrationMarkers(jpeg: Buffer, markers: Markers) {
  function uniqueContours(
    found: Awaited<ReturnType<typeof decodeArucoMarkers>>,
  ) {
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
  let observed = uniqueContours(await decodeArucoMarkers(jpeg));
  const counts = markers.map(
    ({ code }) => observed.filter((m) => m.id === code).length,
  );
  // Enhance only an incomplete read. A duplicate ID is already ambiguous.
  if (counts.includes(0) && counts.every((count) => count <= 1))
    observed = uniqueContours([
      ...observed,
      ...(await decodeArucoMarkers(jpeg, true)),
    ]);
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
      'Keep at least four of the six calibration markers visible and in focus.',
    );
  const transform = (observations: typeof pairs) =>
    computeHomography(
      observations.flatMap((p) => p.page),
      observations.flatMap((p) => p.image),
    );
  const webToImage = transform(pairs);
  // Score the inner markers against a fit that has never seen their corners.
  // The published mapping can still use all uniquely observed corners.
  const fitInverse = invertHomography(
    fit.length === pairs.length ? webToImage : transform(fit),
  );
  const points = pairs.map(({ m, page, image }) => ({
    code: m.code,
    purpose: m.purpose,
    errorCssPx: Math.max(
      ...page.map((p, i) =>
        pointDistance(p, applyHomography(fitInverse, image[i])),
      ),
    ),
  }));
  function quality(purpose: 'fit' | 'check') {
    const errors = points
      .filter((p) => p.purpose === purpose)
      .map((p) => p.errorCssPx);
    if (!errors.length)
      return { count: 0, meanErrorCssPx: 0, maxErrorCssPx: 0 };
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
