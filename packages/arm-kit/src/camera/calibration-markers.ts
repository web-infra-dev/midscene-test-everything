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
import type { ScreenQuad } from './vision-types.js';

const dictionaryName = 'ARUCO_MIP_36h12';
const dictionary = new aruco.AR.Dictionary(dictionaryName);
export const markerSvg = (id: number) => dictionary.generateSVG(id);
type Markers = CalibrationPageLayout['markers'];
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
    const found = detector.detect({
      data,
      width: info.width,
      height: info.height,
    });
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
  let observed = await decode(false);
  const counts = markers.map(
    ({ code }) => observed.filter((m) => m.id === code).length,
  );
  // Enhance only an incomplete read. A duplicate ID is already ambiguous.
  if (counts.includes(0) && counts.every((count) => count <= 1))
    observed = await decode(true);
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
  const quads: ScreenQuad[] = [];
  let reference: Awaited<ReturnType<typeof detector.detectFrame>> | undefined;
  let best:
    | {
        detection: Awaited<ReturnType<typeof detector.detectFrame>>;
        frame: Buffer;
      }
    | undefined;
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
      if (
        reference &&
        (reference.imageWidth !== detection.imageWidth ||
          reference.imageHeight !== detection.imageHeight)
      )
        throw new RobotVisionError(
          'CALIBRATION_MISMATCH',
          'Camera dimensions changed during detection',
        );
      quads.push(detection.points);
      reference = detection;
      if (
        !best ||
        detection.markerIds.length > best.detection.markerIds.length ||
        (detection.markerIds.length === best.detection.markerIds.length &&
          detection.reprojectionRmsePx < best.detection.reprojectionRmsePx)
      )
        best = { detection, frame: jpeg };
    } catch (error) {
      if (
        !(error instanceof RobotVisionError) ||
        error.code !== 'NO_SCREEN_DETECTED'
      )
        throw error;
      lastFailure = error;
    }
  }
  if (!reference || !best || quads.length < 4)
    throw new RobotVisionError(
      'NO_SCREEN_DETECTED',
      `Only ${quads.length} of 8 frames passed. ${lastFailure instanceof Error ? lastFailure.message : ''}`,
    );
  const points = quadMedian(quads);
  const jitterPx = Math.max(
    ...quads.flatMap((q) =>
      quadToArray(q).map((p, i) => pointDistance(p, quadToArray(points)[i])),
    ),
  );
  if (
    !shared &&
    jitterPx >
      Math.max(
        3,
        Math.hypot(reference.imageWidth, reference.imageHeight) * 0.002,
      )
  )
    throw new RobotVisionError(
      'CALIBRATION_MISMATCH',
      'Screen moved between frames. Keep the phone and camera fixed.',
    );
  return {
    correction: {
      points,
      sourceWidth: best.detection.imageWidth,
      sourceHeight: best.detection.imageHeight,
      rotation: 0 as const,
    },
    jpeg: best.frame.toString('base64'),
    markerIds: best.detection.markerIds,
    validFrames: quads.length,
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
