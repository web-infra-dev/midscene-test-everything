import { markerNoiseAllowancePx } from '@midscene/arm-kit-shared/marker-contracts';
// Screen-outline detector from midscene-oss/robot-vision.
import jsArUco from 'js-aruco2';
import sharp from 'sharp';
import { RobotVisionError } from './errors.js';
import {
  applyHomography,
  computeHomography,
  polygonArea,
  quadToArray,
  validateQuad,
} from './vision-geometry.js';
import type { ImagePoint, ScreenQuad } from './vision-types.js';
const { AR } = jsArUco;
const MARKER_CALIBRATION_MIN_VISIBLE_MARKERS = 4;
const MARKER_CALIBRATION_DICTIONARY = 'ARUCO_MIP_36h12';
interface MarkerCalibrationMarker {
  id: number;
  center: ImagePoint;
  side: number;
}
interface MarkerCalibrationLayout {
  points: ScreenQuad;
  markers: MarkerCalibrationMarker[];
}
const MIN_MARKER_SIDE_PX = 12;
const MARKER_BLACK_SQUARE_RATIO = 0.8;
interface DetectedArUcoMarker {
  id: number;
  corners: ImagePoint[];
}

interface DecodedMarkerFrame {
  imageWidth: number;
  imageHeight: number;
  markers: DetectedArUcoMarker[];
}

interface VisibleMarker {
  layout: MarkerCalibrationMarker;
  detected: DetectedArUcoMarker;
}

function center(corners: readonly ImagePoint[]): ImagePoint {
  return {
    x: corners.reduce((sum, point) => sum + point.x, 0) / corners.length,
    y: corners.reduce((sum, point) => sum + point.y, 0) / corners.length,
  };
}

/** Diagonal intersection is the image of a square's centre under perspective. */
function markerCenter(corners: ImagePoint[]): ImagePoint {
  return applyHomography(
    computeHomography(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      corners,
    ),
    { x: 0.5, y: 0.5 },
  );
}

function pointDistanceSquared(left: ImagePoint, right: ImagePoint): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}

function markerCornersInScreen(
  centerPoint: ImagePoint,
  side: number,
): ImagePoint[] {
  const half = side / 2;
  return [
    { x: centerPoint.x - half, y: centerPoint.y - half },
    { x: centerPoint.x + half, y: centerPoint.y - half },
    { x: centerPoint.x + half, y: centerPoint.y + half },
    { x: centerPoint.x - half, y: centerPoint.y + half },
  ];
}

function markerSideFromCorners(corners: readonly ImagePoint[]): number {
  if (corners.length !== 4) return 0;
  const sides = corners.map((point, index) =>
    Math.hypot(
      point.x - corners[(index + 1) % 4].x,
      point.y - corners[(index + 1) % 4].y,
    ),
  );
  return sides.reduce((sum, value) => sum + value, 0) / sides.length;
}

function markerResidual(
  projected: readonly ImagePoint[],
  detected: readonly ImagePoint[],
): number {
  let best = Number.POSITIVE_INFINITY;
  for (let shift = 0; shift < 4; shift += 1) {
    let squared = 0;
    for (let index = 0; index < 4; index += 1) {
      squared += pointDistanceSquared(
        projected[index],
        detected[(index + shift) % 4],
      );
    }
    best = Math.min(best, squared);
  }
  return Math.sqrt(best / 4);
}

function flipPixels(
  source: Uint8Array,
  width: number,
  height: number,
  axis: 'horizontal' | 'vertical',
): Uint8Array {
  const flipped = new Uint8Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const targetX = axis === 'horizontal' ? width - 1 - x : x;
      const targetY = axis === 'vertical' ? height - 1 - y : y;
      const sourceOffset = (y * width + x) * 4;
      const targetOffset = (targetY * width + targetX) * 4;
      flipped[targetOffset] = source[sourceOffset];
      flipped[targetOffset + 1] = source[sourceOffset + 1];
      flipped[targetOffset + 2] = source[sourceOffset + 2];
      flipped[targetOffset + 3] = source[sourceOffset + 3];
    }
  }
  return flipped;
}

function unflipMarkers(
  markers: DetectedArUcoMarker[],
  width: number,
  height: number,
  axis: 'horizontal' | 'vertical',
): DetectedArUcoMarker[] {
  return markers.map((marker) => ({
    ...marker,
    corners: marker.corners.map((corner) => ({
      x: axis === 'horizontal' ? width - 1 - corner.x : corner.x,
      y: axis === 'vertical' ? height - 1 - corner.y : corner.y,
    })),
  }));
}

function expectedMarkerCount(
  markers: readonly DetectedArUcoMarker[],
  expectedIds: ReadonlySet<number>,
): number {
  return new Set(
    markers.map((marker) => marker.id).filter((id) => expectedIds.has(id)),
  ).size;
}

function convexArea(points: readonly ImagePoint[]): number {
  const centerPoint = center(points);
  return polygonArea(
    [...points].sort(
      (left, right) =>
        Math.atan2(left.y - centerPoint.y, left.x - centerPoint.x) -
        Math.atan2(right.y - centerPoint.y, right.x - centerPoint.x),
    ),
  );
}

function markerCombinations(
  markers: readonly VisibleMarker[],
): VisibleMarker[][] {
  const combinations: VisibleMarker[][] = [];
  for (let first = 0; first < markers.length - 3; first += 1) {
    for (let second = first + 1; second < markers.length - 2; second += 1) {
      for (let third = second + 1; third < markers.length - 1; third += 1) {
        for (let fourth = third + 1; fourth < markers.length; fourth += 1) {
          combinations.push([
            markers[first],
            markers[second],
            markers[third],
            markers[fourth],
          ]);
        }
      }
    }
  }
  return combinations;
}

export class MarkerCalibrationDetector {
  private readonly detector = new AR.Detector({
    dictionaryName: MARKER_CALIBRATION_DICTIONARY,
    maxHammingDistance: 5,
  });

  async detectFrame(jpeg: Buffer, layout: MarkerCalibrationLayout) {
    const expectedIds = new Set(layout.markers.map((marker) => marker.id));
    const decoded = await this.decodeFrame(jpeg, expectedIds);
    return this.detectDecodedFrame(decoded, layout);
  }

  async decodeFrame(
    jpeg: Buffer,
    expectedIds: ReadonlySet<number>,
    groups: readonly ReadonlySet<number>[] = [expectedIds],
  ): Promise<DecodedMarkerFrame> {
    const prepare = async (enhanced: boolean) => {
      let pipeline = sharp(jpeg, {
        limitInputPixels: 16_777_216,
      }).toColourspace('srgb');
      // A second, contrast-normalised and sharpened pass recovers markers on a
      // dim, glossy or slightly defocused display. It only runs when the plain
      // pass cannot see enough markers, so normal captures are unaffected.
      if (enhanced) pipeline = pipeline.normalise().sharpen();
      const decoded = await pipeline
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return {
        width: decoded.info.width,
        height: decoded.info.height,
        data: new Uint8Array(
          decoded.data.buffer,
          decoded.data.byteOffset,
          decoded.data.byteLength,
        ),
      };
    };
    const detectOn = (image: {
      width: number;
      height: number;
      data: Uint8Array;
    }) =>
      this.detector.detect({
        width: image.width,
        height: image.height,
        data: image.data,
      }) as DetectedArUcoMarker[];
    const merge = (
      left: readonly DetectedArUcoMarker[],
      right: readonly DetectedArUcoMarker[],
    ) => {
      const byId = new Map<number, DetectedArUcoMarker>();
      for (const marker of [...left, ...right]) {
        const existing = byId.get(marker.id);
        // Duplicate IDs are resolved by keeping the largest instance instead
        // of discarding the frame; reflections and false decodes are smaller.
        if (
          !existing ||
          markerSideFromCorners(marker.corners) >
            markerSideFromCorners(existing.corners)
        )
          byId.set(marker.id, marker);
      }
      return [...byId.values()];
    };
    const enough = (markers: readonly DetectedArUcoMarker[]) =>
      groups.every(
        (ids) =>
          expectedMarkerCount(markers, ids) >=
          MARKER_CALIBRATION_MIN_VISIBLE_MARKERS,
      );
    let source = await prepare(false);
    let detected = detectOn(source);
    const baseCount = expectedMarkerCount(detected, expectedIds);
    if (!enough(detected)) {
      const enhanced = await prepare(true);
      const enhancedMarkers = detectOn(enhanced);
      detected = merge(detected, enhancedMarkers);
      if (expectedMarkerCount(enhancedMarkers, expectedIds) > baseCount)
        source = enhanced;
    }
    if (!enough(detected)) {
      for (const axis of ['horizontal', 'vertical'] as const) {
        detected = merge(
          detected,
          unflipMarkers(
            detectOn({
              width: source.width,
              height: source.height,
              data: flipPixels(source.data, source.width, source.height, axis),
            }),
            source.width,
            source.height,
            axis,
          ),
        );
        if (enough(detected)) break;
      }
    }
    return {
      imageWidth: source.width,
      imageHeight: source.height,
      markers: detected,
    };
  }

  detectDecodedFrame(
    decoded: DecodedMarkerFrame,
    layout: MarkerCalibrationLayout,
  ) {
    const expectedIds = new Set(layout.markers.map((marker) => marker.id));
    const byId = new Map<number, DetectedArUcoMarker>();
    for (const marker of decoded.markers) {
      if (!expectedIds.has(marker.id)) continue;
      if (
        !Array.isArray(marker.corners) ||
        marker.corners.length !== 4 ||
        markerSideFromCorners(marker.corners) < MIN_MARKER_SIDE_PX
      )
        continue;
      // A reflection or a duplicate decode of the same ID must not discard the
      // whole frame. Keep the largest instance; the plane fit still validates
      // every kept corner against the four-frame agreement.
      const existing = byId.get(marker.id);
      if (
        !existing ||
        markerSideFromCorners(marker.corners) >
          markerSideFromCorners(existing.corners)
      )
        byId.set(marker.id, marker);
    }
    const expectedMarkerIds = layout.markers.map((marker) => marker.id);
    const missing = expectedMarkerIds.filter((id) => !byId.has(id));
    if (byId.size < MARKER_CALIBRATION_MIN_VISIBLE_MARKERS)
      throw new RobotVisionError(
        'NO_SCREEN_DETECTED',
        `Only ${byId.size} calibration markers were visible; at least ${MARKER_CALIBRATION_MIN_VISIBLE_MARKERS} are required. Missing: ${missing.join(', ')}`,
        undefined,
        { missing, visibleMarkers: byId.size },
      );

    const visibleMarkers: VisibleMarker[] = layout.markers.flatMap(
      (layoutMarker) => {
        const detectedMarker = byId.get(layoutMarker.id);
        return detectedMarker
          ? [{ layout: layoutMarker, detected: detectedMarker }]
          : [];
      },
    );
    const candidates: Array<{
      points: ScreenQuad;
      reprojectionRmsePx: number;
      area: number;
      markerIds: number[];
    }> = [];
    // Lens distortion and corner quantisation grow with capture resolution, so
    // the gate scales with the image diagonal instead of staying at a fixed 2 px.
    const limitPx = markerNoiseAllowancePx(
      decoded.imageWidth,
      decoded.imageHeight,
    );
    let bestRmse = Number.POSITIVE_INFINITY;
    const fitMarkers = (
      markers: readonly VisibleMarker[],
      initial: number[],
    ) => {
      const screenCorners: ImagePoint[] = [];
      const imageCorners: ImagePoint[] = [];
      for (const marker of markers) {
        const source = markerCornersInScreen(
          marker.layout.center,
          marker.layout.side * MARKER_BLACK_SQUARE_RATIO,
        );
        const projected = source.map((point) =>
          applyHomography(initial, point),
        );
        let shift = 0;
        let best = Number.POSITIVE_INFINITY;
        for (let offset = 0; offset < 4; offset++) {
          const squared = projected.reduce(
            (sum, point, index) =>
              sum +
              pointDistanceSquared(
                point,
                marker.detected.corners[(index + offset) % 4],
              ),
            0,
          );
          if (squared < best) {
            best = squared;
            shift = offset;
          }
        }
        screenCorners.push(...source);
        imageCorners.push(
          ...source.map(
            (_, index) => marker.detected.corners[(index + shift) % 4],
          ),
        );
      }
      // Fit every observed corner, rather than making four noisy centres exact.
      const homography = computeHomography(screenCorners, imageCorners);
      const points = {
        topLeft: applyHomography(homography, layout.points.topLeft),
        topRight: applyHomography(homography, layout.points.topRight),
        bottomRight: applyHomography(homography, layout.points.bottomRight),
        bottomLeft: applyHomography(homography, layout.points.bottomLeft),
      };
      const residuals = markers.map((marker) =>
        markerResidual(
          markerCornersInScreen(
            marker.layout.center,
            marker.layout.side * MARKER_BLACK_SQUARE_RATIO,
          ).map((point) => applyHomography(homography, point)),
          marker.detected.corners,
        ),
      );
      return {
        points,
        residuals,
        reprojectionRmsePx: Math.sqrt(
          residuals.reduce((sum, value) => sum + value ** 2, 0) /
            markers.length,
        ),
      };
    };
    for (const combination of markerCombinations(visibleMarkers)) {
      try {
        const imageCenters = combination.map((marker) =>
          markerCenter(marker.detected.corners),
        );
        const initial = computeHomography(
          combination.map((marker) => marker.layout.center),
          imageCenters,
        );
        let used = visibleMarkers;
        let fit = fitMarkers(used, initial);
        if (
          fit.reprojectionRmsePx > limitPx &&
          used.length > MARKER_CALIBRATION_MIN_VISIBLE_MARKERS
        ) {
          // One noisy, reflected or partly occluded marker must not sink the
          // whole frame. Drop the worst marker and refit while four remain.
          const worst = fit.residuals.indexOf(Math.max(...fit.residuals));
          used = used.filter((_, index) => index !== worst);
          fit = fitMarkers(used, initial);
        }
        bestRmse = Math.min(bestRmse, fit.reprojectionRmsePx);
        validateQuad(fit.points);
        if (
          quadToArray(fit.points).some(
            (p) =>
              p.x < 0 ||
              p.y < 0 ||
              p.x >= decoded.imageWidth ||
              p.y >= decoded.imageHeight,
          )
        )
          continue;
        // A transform needs four agreeing markers. An extra noisy marker can
        // raise the aggregate error without invalidating that correspondence.
        if (
          fit.residuals.filter((px) => px <= limitPx).length <
          MARKER_CALIBRATION_MIN_VISIBLE_MARKERS
        )
          continue;
        candidates.push({
          points: fit.points,
          reprojectionRmsePx: fit.reprojectionRmsePx,
          area: convexArea(imageCenters),
          markerIds: used.map((marker) => marker.layout.id),
        });
      } catch {
        // Collinear combinations are expected when a redundant marker is hidden.
      }
    }
    const result = candidates.sort(
      (left, right) =>
        right.area - left.area ||
        left.reprojectionRmsePx - right.reprojectionRmsePx,
    )[0];
    if (!result)
      throw new RobotVisionError(
        'NO_SCREEN_DETECTED',
        `Calibration markers do not form a consistent screen plane (${visibleMarkers.length} visible; four agreeing markers required).`,
        undefined,
        {
          visibleMarkers: visibleMarkers.length,
          bestRmsePx: Number.isFinite(bestRmse) ? bestRmse : null,
          limitPx,
        },
      );
    return {
      points: result.points,
      imageWidth: decoded.imageWidth,
      imageHeight: decoded.imageHeight,
      reprojectionRmsePx: result.reprojectionRmsePx,
      markerIds: result.markerIds,
    };
  }
}
