import sharp from 'sharp';
import {
  CALIBRATION_PHONE_POLICY,
  type CalibrationPageLayout,
} from '../assisted-contracts.js';
import { RobotArmError, type ScreenVisibilityEvidence } from '../contracts.js';
import {
  applyHomography,
  computeHomography,
  polygonArea,
} from './vision-geometry.js';

export interface VisibilityScreen {
  id: string;
  /** Full display corners in page order, in the raw camera image. */
  points: Array<{ x: number; y: number }>;
  sourceWidth: number;
  sourceHeight: number;
  layout?: CalibrationPageLayout;
}

function visibilityViewport(
  layout: CalibrationPageLayout | undefined,
  columns: number,
  rows: number,
  response: (point: { x: number; y: number }) => number,
) {
  const width = layout ? Math.min(1, layout.width / layout.screen.width) : 1;
  const height = layout ? Math.min(1, layout.height / layout.screen.height) : 1;
  if (width < 0.75 || height < 0.75)
    throw new RobotArmError(
      'VISIBILITY_UNAVAILABLE',
      'The phone viewport is too small for screen visibility verification.',
      409,
    );
  const offsets = (gap: number) =>
    gap > 0
      ? Array.from({ length: 21 }, (_, index) => (gap * index) / 20)
      : [0];
  const xs = offsets(1 - width);
  const ys =
    layout?.topInset === undefined
      ? offsets(1 - height)
      : [layout.topInset / layout.screen.height];
  let best = { x: xs[0], y: ys[0], width, height };
  if (xs.length === 1 && ys.length === 1) return best;

  // Browser dimensions constrain the crop. Use the signed grid to locate
  // that viewport within the screen when the browser omits its screen origin.
  let bestScore = -1;
  for (const x of xs) {
    for (const y of ys) {
      let score = 0;
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const sign = (row + column) % 2 === 0 ? 1 : -1;
          for (const offset of [0.08, 0.5, 0.92]) {
            if (
              response({
                x: x + ((column + offset) / columns) * width,
                y: y + ((row + offset) / rows) * height,
              }) === sign
            )
              score++;
          }
        }
      }
      if (score > bestScore) {
        best = { x, y, width, height };
        bestScore = score;
      }
    }
  }
  return best;
}

/**
 * Three acknowledged, fresh views show checkerboard, inverse, checkerboard.
 * A stationary foreground object cannot reproduce the signed colour response.
 */
export async function measureScreenVisibility(
  frames: readonly Buffer[],
  screens: readonly VisibilityScreen[],
): Promise<ScreenVisibilityEvidence> {
  if (frames.length !== 3 || !screens.length)
    throw new RobotArmError(
      'VISIBILITY_UNAVAILABLE',
      'Three fresh visibility frames and screen outlines are required.',
    );
  const decoded = await Promise.all(
    frames.map((frame) =>
      sharp(frame)
        .removeAlpha()
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true }),
    ),
  );
  const { width, height, channels } = decoded[0].info;
  if (
    channels !== 3 ||
    decoded.some(
      ({ info }) =>
        info.width !== width || info.height !== height || info.channels !== 3,
    )
  )
    throw new RobotArmError(
      'VISIBILITY_UNAVAILABLE',
      'Camera dimensions changed during screen visibility verification.',
    );
  const { columns, rows } = CALIBRATION_PHONE_POLICY.visibilityPattern;
  const results = screens.map((screen) => {
    if (
      screen.sourceWidth !== width ||
      screen.sourceHeight !== height ||
      screen.points.length !== 4 ||
      Math.abs(polygonArea(screen.points)) < 10000
    )
      throw new RobotArmError(
        'VISIBILITY_UNAVAILABLE',
        'A screen outline is missing, too small or incompatible with the current camera frame.',
      );
    const transform = computeHomography(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      screen.points,
    );
    const response = (sample: { x: number; y: number }) => {
      const point = applyHomography(transform, sample);
      const px = Math.round(point.x);
      const py = Math.round(point.y);
      if (
        !Number.isFinite(px + py) ||
        px < 0 ||
        px >= width ||
        py < 0 ||
        py >= height
      )
        throw new RobotArmError(
          'VISIBILITY_UNAVAILABLE',
          'A screen visibility sample is outside the camera frame.',
        );
      const offset = (py * width + px) * channels;
      const chroma = decoded.map(
        ({ data }) => data[offset + 1] - (data[offset] + data[offset + 2]) / 2,
      );
      const first = chroma[0] - chroma[1];
      const last = chroma[2] - chroma[1];
      if (first >= 36 && last >= 36) return 1;
      if (first <= -36 && last <= -36) return -1;
      return 0;
    };
    const viewport = visibilityViewport(screen.layout, columns, rows, response);
    let visible = 0;
    let interiorVisible = 0;
    let interiorSamples = 0;
    let minimumTileFraction = 1;
    const samplesPerSide = 6;
    const samplesPerTile = samplesPerSide ** 2;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        let tileVisible = 0;
        let tileInteriorVisible = 0;
        let tileInteriorSamples = 0;
        const sign = (row + column) % 2 === 0 ? 1 : -1;
        for (let y = 0; y < samplesPerSide; y++) {
          for (let x = 0; x < samplesPerSide; x++) {
            const sample = {
              x: (column + (x + 0.5) / samplesPerSide) / columns,
              y: (row + (y + 0.5) / samplesPerSide) / rows,
            };
            // The fitted outline can include bezel and rounded corners.
            const interior =
              sample.x >= 0.5 / columns &&
              sample.x <= 1 - 0.5 / columns &&
              sample.y >= 0.5 / rows &&
              sample.y <= 1 - 0.5 / rows;
            if (interior) tileInteriorSamples++;
            const polarity = response({
              x: viewport.x + sample.x * viewport.width,
              y: viewport.y + sample.y * viewport.height,
            });
            // A small outline error can put a sample near a tile boundary
            // into the neighboring tile. Still require the expected checkerboard
            // polarity at tile centers and a repeatable inversion everywhere.
            const center = x >= 2 && x < 4 && y >= 2 && y < 4;
            if (polarity === sign || (!center && polarity === -sign)) {
              tileVisible++;
              if (interior) tileInteriorVisible++;
            }
          }
        }
        visible += tileVisible;
        interiorVisible += tileInteriorVisible;
        interiorSamples += tileInteriorSamples;
        if (tileInteriorSamples)
          minimumTileFraction = Math.min(
            minimumTileFraction,
            tileInteriorVisible / tileInteriorSamples,
          );
      }
    }
    return {
      id: screen.id,
      visibleFraction: visible / (columns * rows * samplesPerTile),
      interiorVisibleFraction: interiorVisible / interiorSamples,
      minimumTileFraction,
    };
  });
  if (results.every((screen) => screen.visibleFraction < 0.35))
    throw new RobotArmError(
      'VISIBILITY_UNAVAILABLE',
      'The screen visibility pattern could not be verified. Check the camera view and paired phone pages.',
      409,
    );
  return {
    clear: results.every(
      (screen) =>
        screen.visibleFraction >= 0.85 &&
        screen.interiorVisibleFraction >= 0.95 &&
        screen.minimumTileFraction >= 0.85,
    ),
    checkedAt: new Date().toISOString(),
    screens: results,
  };
}
