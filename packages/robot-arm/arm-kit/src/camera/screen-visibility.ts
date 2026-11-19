import sharp from 'sharp';
import {
  CALIBRATION_PHONE_POLICY,
  type CalibrationPageLayout,
} from '../assisted-contracts.js';
import {
  RobotArmError,
  type ScreenVisibilityEvidence,
  type ScreenVisibilityProbePattern,
} from '../contracts.js';
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
  firstRowHeight?: number;
}

function visibilityViewport(
  layout: CalibrationPageLayout | undefined,
  columns: number,
  rows: number,
  rowPosition: (row: number) => number,
  response: (point: { x: number; y: number }) => number,
  offsetPattern: boolean,
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
  const probes = offsetPattern
    ? [
        [0.25, 0.25],
        [0.25, 0.75],
        [0.75, 0.25],
        [0.75, 0.75],
      ]
    : [
        [0.08, 0.08],
        [0.5, 0.5],
        [0.92, 0.92],
      ];
  let bestScore = -1;
  for (const x of xs) {
    for (const y of ys) {
      let score = 0;
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const baseSign = (row + column) % 2 === 0 ? 1 : -1;
          for (const [dx, dy] of probes) {
            const sign = dx < 0.5 === dy < 0.5 ? baseSign : -baseSign;
            if (
              response({
                x: x + ((column + dx) / columns) * width,
                y: y + rowPosition(row + dy) * height,
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

/** Count connected misses so isolated noise does not add up to an obstruction. */
function largestUnresponsiveRegion(mask: Uint8Array, columns: number) {
  const rows = mask.length / columns;
  let largest = 0;
  for (let index = 0; index < mask.length; index++) {
    if (!mask[index]) continue;
    const region = [index];
    mask[index] = 0;
    for (let next = 0; next < region.length; next++) {
      const x = region[next] % columns;
      const y = Math.floor(region[next] / columns);
      for (
        let row = Math.max(0, y - 1);
        row <= Math.min(rows - 1, y + 1);
        row++
      ) {
        for (
          let column = Math.max(0, x - 1);
          column <= Math.min(columns - 1, x + 1);
          column++
        ) {
          const neighbor = row * columns + column;
          if (!mask[neighbor]) continue;
          mask[neighbor] = 0;
          region.push(neighbor);
        }
      }
    }
    largest = Math.max(largest, region.length);
  }
  return largest;
}

/**
 * Three acknowledged, fresh views show checkerboard, inverse, checkerboard.
 * A stationary foreground object cannot reproduce the signed colour response.
 */
export async function measureScreenVisibility(
  frames: readonly Buffer[],
  screens: readonly VisibilityScreen[],
  options?: {
    includeUndetected?: boolean;
    pattern?: ScreenVisibilityProbePattern;
    sharedParking?: boolean;
  },
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
  const pattern = options?.pattern ?? 'checkerboard';
  const offsetPattern = pattern === 'offset-contrast';
  // The shared parking fallback can lose scattered samples to glare or
  // alignment. Still require the expected pattern and a clear connected mask.
  const minimumInteriorFraction =
    offsetPattern && options?.sharedParking ? 0.9 : 0.95;
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
      // The blue tile has a greater blue-to-red difference than the other tile.
      // Compare chroma across phases to reject brightness-only changes.
      const blueMinusRed = decoded.map(
        ({ data }) => data[offset + 2] - data[offset],
      );
      const first = blueMinusRed[0] - blueMinusRed[1];
      const last = blueMinusRed[2] - blueMinusRed[1];
      // The outer frames display the same color. A weaker reversal can still
      // count if both transitions exceed the drift between those frames.
      const threshold = Math.max(12, Math.abs(first - last));
      if (first >= threshold && last >= threshold) return 1;
      if (first <= -threshold && last <= -threshold) return -1;
      return 0;
    };
    const viewportHeight = screen.layout?.height;
    const firstRow =
      screen.firstRowHeight === undefined
        ? 1 / rows
        : screen.firstRowHeight / (viewportHeight ?? 0);
    // Allow subpixel grid rounding, but reject a collapsed or oversized row.
    if (
      !Number.isFinite(firstRow) ||
      firstRow < 1 / rows - 0.001 ||
      firstRow > 3 / rows
    )
      throw new RobotArmError(
        'VISIBILITY_UNAVAILABLE',
        'Invalid visibility pattern row height.',
      );
    const rowPosition = (row: number) =>
      row <= 1
        ? row * firstRow
        : firstRow + ((row - 1) / (rows - 1)) * (1 - firstRow);
    const viewport = visibilityViewport(
      screen.layout,
      columns,
      rows,
      rowPosition,
      response,
      offsetPattern,
    );
    let visible = 0;
    let matchedCenters = 0;
    let sampledCenters = 0;
    const samplesPerSide = 6;
    const isCenter = (sample: number) =>
      offsetPattern
        ? sample === 1 || sample === 4
        : sample === 2 || sample === 3;
    const samplesPerTile = samplesPerSide ** 2;
    const sampleColumns = columns * samplesPerSide;
    const sampleRows = rows * samplesPerSide;
    const detected = new Uint8Array(sampleColumns * sampleRows);
    const unresponsive = new Uint8Array(detected.length);
    // Exclude the outline and its rounded corners from the occlusion mask.
    const margin = samplesPerSide / 2;
    const right = sampleColumns - margin;
    const bottom = sampleRows - margin;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const baseSign = (row + column) % 2 === 0 ? 1 : -1;
        for (let y = 0; y < samplesPerSide; y++) {
          for (let x = 0; x < samplesPerSide; x++) {
            const sign =
              offsetPattern && x < samplesPerSide / 2 !== y < samplesPerSide / 2
                ? -baseSign
                : baseSign;
            const sampleColumn = column * samplesPerSide + x;
            const sampleRow = row * samplesPerSide + y;
            const polarity = response({
              x:
                viewport.x +
                ((sampleColumn + 0.5) / sampleColumns) * viewport.width,
              y:
                viewport.y +
                rowPosition((sampleRow + 0.5) / samplesPerSide) *
                  viewport.height,
            });
            // A small outline error can put a sample near a tile boundary
            // into the neighboring tile. Still require the expected checkerboard
            // polarity at tile centers and a repeatable inversion everywhere.
            const center = isCenter(x) && isCenter(y);
            if (center) {
              sampledCenters++;
              if (polarity === sign) matchedCenters++;
            }
            const index = sampleRow * sampleColumns + sampleColumn;
            if (polarity === sign || (!center && polarity === -sign)) {
              detected[index] = 1;
              visible++;
            }
            // Wrong polarity still means this pixel followed the colour change.
            // Use polarity to validate the pattern, and absence of a response
            // to identify the silhouette of a stationary object.
            if (
              polarity === 0 &&
              sampleColumn >= margin &&
              sampleColumn < right &&
              sampleRow >= margin &&
              sampleRow < bottom
            )
              unresponsive[index] = 1;
          }
        }
      }
    }
    let interiorVisible = 0;
    for (let y = margin; y < bottom; y++) {
      for (let x = margin; x < right; x++) {
        interiorVisible += detected[y * sampleColumns + x];
      }
    }
    let minimumTileFraction = 1;
    for (let y = margin; y + samplesPerSide <= bottom; y += margin) {
      for (let x = margin; x + samplesPerSide <= right; x += margin) {
        let windowVisible = 0;
        for (let dy = 0; dy < samplesPerSide; dy++) {
          for (let dx = 0; dx < samplesPerSide; dx++) {
            windowVisible += detected[(y + dy) * sampleColumns + x + dx];
          }
        }
        minimumTileFraction = Math.min(
          minimumTileFraction,
          windowVisible / samplesPerTile,
        );
      }
    }
    const visibleFraction = visible / detected.length;
    const interiorVisibleFraction =
      interiorVisible / ((right - margin) * (bottom - margin));
    const largestRegion = largestUnresponsiveRegion(
      unresponsive,
      sampleColumns,
    );
    // A small spot can be a display artefact. A connected gap can also be a
    // narrow pen spanning several tiles, even with high coverage in each tile.
    const clear =
      visibleFraction >= 0.85 &&
      interiorVisibleFraction >= minimumInteriorFraction &&
      largestRegion < 8 &&
      // A cached page or a broad camera-wide color shift cannot confirm this pattern.
      (!offsetPattern || matchedCenters / sampledCenters >= 0.8);
    return {
      id: screen.id,
      visibleFraction,
      interiorVisibleFraction,
      minimumTileFraction,
      largestUnresponsiveRegion: largestRegion,
      clear,
    };
  });
  if (
    !options?.includeUndetected &&
    results.every((screen) => screen.visibleFraction < 0.35)
  )
    throw new RobotArmError(
      'VISIBILITY_UNAVAILABLE',
      'The screen visibility pattern could not be verified. Check the camera view and paired phone pages.',
      409,
    );
  return {
    clear: results.every((screen) => screen.clear),
    checkedAt: new Date().toISOString(),
    pattern,
    screens: results,
  };
}
