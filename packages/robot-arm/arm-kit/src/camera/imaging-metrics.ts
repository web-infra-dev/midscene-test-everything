import sharp from 'sharp';
import type { CameraCorrection } from '../contracts.js';
import { jpegSize } from './jpeg-size.js';
import {
  applyHomography,
  computeHomography,
  quadToArray,
} from './vision-geometry.js';

const EXPOSURE_WIDTH = 128;
const EXPOSURE_HEIGHT = 72;
const ROI_INSET = 0.04;
const FOCUS_WORK_WIDTH = 1280;
const FOCUS_SAMPLE_WIDTH = 180;
const FOCUS_TILE_COLUMNS = 6;
const FOCUS_TILE_ROWS = 12;

export interface NormalizedImageRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Interior of the bottom-left white tile in the calibration pattern. */
export const CALIBRATION_EXPOSURE_REGION: NormalizedImageRegion = {
  left: 0.06,
  top: 0.82,
  right: 0.27,
  bottom: 0.95,
};

export interface ImagingScreen {
  screenId: string;
  correction: CameraCorrection;
}

export interface LumaMetrics {
  mean: number;
  stddev: number;
  brightRatio: number;
  darkRatio: number;
  p95: number;
  p99: number;
  overExposedRatio: number;
  underExposedRatio: number;
  hiTileRatio: number;
  hiComponentCount: number;
  hiComponentLargestShare: number;
}

export interface ExposureReading {
  roiEnabled: boolean;
  full: LumaMetrics;
  auto: LumaMetrics;
  selected: LumaMetrics;
  screenReadings: Array<{ screenId: string; metrics: LumaMetrics }>;
  updatedAt: number;
}

export interface FocusReading {
  score: number;
  anisotropy: number;
  overExposedRatio: number;
  screens: Array<{
    screenId: string;
    score: number;
    lowerQuartile: number;
    anisotropy: number;
    overExposedRatio: number;
  }>;
}

interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function median(values: readonly number[]) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)] ?? 0;
}

function percentile(values: readonly number[], fraction: number) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[
    clamp(Math.floor((ordered.length - 1) * fraction), 0, ordered.length - 1)
  ]!;
}

function percentileHistogram(histogram: Uint32Array, fraction: number) {
  let total = 0;
  for (const count of histogram) total += count;
  if (!total) return 0;
  const target = Math.floor((total - 1) * fraction);
  let seen = 0;
  for (let level = 0; level < histogram.length; level += 1) {
    seen += histogram[level]!;
    if (seen > target) return level;
  }
  return 255;
}

function sampleBilinear(image: GrayImage, x: number, y: number) {
  const left = Math.floor(x);
  const top = Math.floor(y);
  const dx = x - left;
  const dy = y - top;
  const x0 = clamp(left, 0, image.width - 1);
  const y0 = clamp(top, 0, image.height - 1);
  const x1 = clamp(left + 1, 0, image.width - 1);
  const y1 = clamp(top + 1, 0, image.height - 1);
  const a = image.data[y0 * image.width + x0]!;
  const b = image.data[y0 * image.width + x1]!;
  const c = image.data[y1 * image.width + x0]!;
  const d = image.data[y1 * image.width + x1]!;
  return (
    a * (1 - dx) * (1 - dy) +
    b * dx * (1 - dy) +
    c * (1 - dx) * dy +
    d * dx * dy
  );
}

function scaledQuad(correction: CameraCorrection, image: GrayImage) {
  const scaleX = image.width / correction.sourceWidth;
  const scaleY = image.height / correction.sourceHeight;
  return quadToArray(correction.points).map((point) => ({
    x: point.x * scaleX,
    y: point.y * scaleY,
  }));
}

function samplePerspective(
  image: GrayImage,
  correction: CameraCorrection,
  width: number,
  height: number,
  region: NormalizedImageRegion = {
    left: 0,
    top: 0,
    right: 1,
    bottom: 1,
  },
) {
  const quad = scaledQuad(correction, image);
  const transform = computeHomography(
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    quad,
  );
  const output = new Uint8Array(width * height);
  const left = region.left + (region.right - region.left) * ROI_INSET;
  const right = region.right - (region.right - region.left) * ROI_INSET;
  const top = region.top + (region.bottom - region.top) * ROI_INSET;
  const bottom = region.bottom - (region.bottom - region.top) * ROI_INSET;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const point = applyHomography(transform, {
        x: left + ((x + 0.5) / width) * (right - left),
        y: top + ((y + 0.5) / height) * (bottom - top),
      });
      output[y * width + x] = Math.round(
        sampleBilinear(image, point.x, point.y),
      );
    }
  }
  return output;
}

function sampleFrame(image: GrayImage, width: number, height: number) {
  const output = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      output[y * width + x] = Math.round(
        sampleBilinear(
          image,
          ((x + 0.5) / width) * image.width - 0.5,
          ((y + 0.5) / height) * image.height - 0.5,
        ),
      );
    }
  }
  return output;
}

function highlightStructure(data: Uint8Array, width: number, height: number) {
  const saturated = new Uint8Array(data.length);
  const histogram = new Uint32Array(256);
  let saturatedCount = 0;
  for (let index = 0; index < data.length; index += 1) {
    const value = data[index]!;
    histogram[value] = (histogram[value] ?? 0) + 1;
    if (value > 245) {
      saturated[index] = 1;
      saturatedCount++;
    }
  }

  const columns = 8;
  const rows = 6;
  let highlightedTiles = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x0 = Math.floor((column * width) / columns);
      const x1 = Math.floor(((column + 1) * width) / columns);
      const y0 = Math.floor((row * height) / rows);
      const y1 = Math.floor(((row + 1) * height) / rows);
      let count = 0;
      for (let y = y0; y < y1; y += 1)
        for (let x = x0; x < x1; x += 1) count += saturated[y * width + x]!;
      const area = Math.max(1, (x1 - x0) * (y1 - y0));
      if (count / area >= 0.005) highlightedTiles++;
    }
  }

  const visited = new Uint8Array(data.length);
  const components: number[] = [];
  const queue = new Int32Array(data.length);
  for (let start = 0; start < saturated.length; start += 1) {
    if (!saturated[start] || visited[start]) continue;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    visited[start] = 1;
    let area = 0;
    while (head < tail) {
      const index = queue[head++]!;
      area++;
      const x = index % width;
      const y = Math.floor(index / width);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height)
            continue;
          const next = nextY * width + nextX;
          if (!saturated[next] || visited[next]) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (area >= 3) components.push(area);
  }
  const significant = components.reduce((sum, value) => sum + value, 0);
  return {
    histogram,
    hiTileRatio: highlightedTiles / (columns * rows),
    hiComponentCount: components.length,
    hiComponentLargestShare: significant
      ? Math.max(...components) / significant
      : 0,
    saturatedCount,
  };
}

function metricsFromPixels(
  data: Uint8Array,
  width: number,
  height: number,
): LumaMetrics {
  const structure = highlightStructure(data, width, height);
  let sum = 0;
  let sumSquares = 0;
  let bright = 0;
  let dark = 0;
  let under = 0;
  for (const value of data) {
    sum += value;
    sumSquares += value * value;
    if (value > 20) bright++;
    if (value <= 24) dark++;
    if (value <= 12) under++;
  }
  const count = Math.max(1, data.length);
  const mean = sum / count;
  return {
    mean: round(mean),
    stddev: round(Math.sqrt(Math.max(0, sumSquares / count - mean * mean))),
    brightRatio: round(bright / count, 4),
    darkRatio: round(dark / count, 4),
    p95: percentileHistogram(structure.histogram, 0.95),
    p99: percentileHistogram(structure.histogram, 0.99),
    overExposedRatio: round(structure.saturatedCount / count, 4),
    underExposedRatio: round(under / count, 4),
    hiTileRatio: round(structure.hiTileRatio, 4),
    hiComponentCount: structure.hiComponentCount,
    hiComponentLargestShare: round(structure.hiComponentLargestShare, 4),
  };
}

function combineMetrics(
  images: readonly Uint8Array[],
  width: number,
  height: number,
): LumaMetrics {
  if (!images.length)
    return metricsFromPixels(
      new Uint8Array(EXPOSURE_WIDTH * EXPOSURE_HEIGHT),
      EXPOSURE_WIDTH,
      EXPOSURE_HEIGHT,
    );
  const combined = new Uint8Array(width * height * images.length);
  images.forEach((image, index) => combined.set(image, index * width * height));
  return metricsFromPixels(combined, width, height * images.length);
}

export function classifyExposureExtreme(
  metrics: LumaMetrics,
): 'too-bright' | 'too-dark' | undefined {
  const structuredHighlight =
    metrics.hiTileRatio >= 0.4 && metrics.hiComponentLargestShare <= 0.6;
  const darkUiHighlight =
    metrics.mean <= 120 &&
    metrics.p95 >= 235 &&
    metrics.overExposedRatio >= 0.03 &&
    structuredHighlight;
  if (darkUiHighlight) return 'too-bright';
  if (
    metrics.p95 >= 240 &&
    metrics.p99 >= 250 &&
    metrics.overExposedRatio >= 0.25
  )
    return 'too-bright';
  if (metrics.mean >= 205 && metrics.brightRatio >= 0.95) return 'too-bright';
  if (
    metrics.mean <= 65 &&
    metrics.p95 <= 110 &&
    metrics.p99 <= 135 &&
    (metrics.darkRatio >= 0.25 || metrics.underExposedRatio >= 0.18)
  )
    return 'too-dark';
  return undefined;
}

export function isStructuredDarkUiHighlight(metrics: LumaMetrics) {
  return (
    metrics.mean <= 120 &&
    metrics.p95 >= 235 &&
    metrics.overExposedRatio >= 0.03 &&
    metrics.hiTileRatio >= 0.4 &&
    metrics.hiComponentLargestShare <= 0.6
  );
}

export function exposureTargetDirection(
  metrics: LumaMetrics,
  darkModeActive = false,
): 'too-bright' | 'too-dark' | undefined {
  if (metrics.p99 > 235 || metrics.overExposedRatio > 0.05) return 'too-bright';
  if (metrics.mean > 180) return 'too-bright';
  if (metrics.mean < (darkModeActive ? 30 : 90)) return 'too-dark';
  return undefined;
}

export function exposureSeverity(
  metrics: LumaMetrics,
  direction: 'too-bright' | 'too-dark',
) {
  if (direction === 'too-bright') {
    if (
      metrics.mean >= 240 &&
      metrics.overExposedRatio >= 0.9 &&
      metrics.p99 >= 254
    )
      return 3;
    if (
      metrics.mean >= 220 &&
      metrics.overExposedRatio >= 0.75 &&
      metrics.p99 >= 252
    )
      return 2;
    return 1;
  }
  if (
    metrics.mean <= 15 &&
    metrics.p95 <= 30 &&
    metrics.underExposedRatio >= 0.5
  )
    return 3;
  if (
    metrics.mean <= 30 &&
    metrics.p95 <= 55 &&
    metrics.underExposedRatio >= 0.28
  )
    return 2;
  return 1;
}

async function decodeExposureFrame(jpeg: Buffer): Promise<GrayImage> {
  const { data, info } = await sharp(jpeg, { limitInputPixels: 16_777_216 })
    .rotate()
    .greyscale()
    .resize({
      width: 1024,
      withoutEnlargement: true,
      fit: 'inside',
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  };
}

export async function measureExposure(
  jpeg: Buffer,
  screens: readonly ImagingScreen[],
  options: { region?: NormalizedImageRegion } = {},
): Promise<ExposureReading> {
  const source = jpegSize(jpeg);
  const image = await decodeExposureFrame(jpeg);
  const full = metricsFromPixels(
    sampleFrame(image, EXPOSURE_WIDTH, EXPOSURE_HEIGHT),
    EXPOSURE_WIDTH,
    EXPOSURE_HEIGHT,
  );
  const screenReadings = screens.flatMap((screen) => {
    if (
      screen.correction.sourceWidth !== source.width ||
      screen.correction.sourceHeight !== source.height
    )
      return [];
    const pixels = samplePerspective(
      image,
      screen.correction,
      EXPOSURE_WIDTH,
      EXPOSURE_HEIGHT,
      options.region,
    );
    return [
      {
        screenId: screen.screenId,
        metrics: metricsFromPixels(pixels, EXPOSURE_WIDTH, EXPOSURE_HEIGHT),
        pixels,
      },
    ];
  });
  const auto = screenReadings.length
    ? combineMetrics(
        screenReadings.map((screen) => screen.pixels),
        EXPOSURE_WIDTH,
        EXPOSURE_HEIGHT,
      )
    : full;
  return {
    roiEnabled: screenReadings.length > 0,
    full,
    auto,
    selected: auto,
    screenReadings: screenReadings.map(({ screenId, metrics }) => ({
      screenId,
      metrics,
    })),
    updatedAt: Date.now(),
  };
}

async function decodeFocusFrame(jpeg: Buffer): Promise<GrayImage> {
  const { data, info } = await sharp(jpeg, { limitInputPixels: 16_777_216 })
    .rotate()
    .greyscale()
    .resize({
      width: FOCUS_WORK_WIDTH,
      withoutEnlargement: true,
      fit: 'inside',
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  };
}

function focusScreen(image: GrayImage, correction: CameraCorrection) {
  const quad = quadToArray(correction.points);
  const widthPx = Math.hypot(quad[1]!.x - quad[0]!.x, quad[1]!.y - quad[0]!.y);
  const heightPx = Math.hypot(quad[3]!.x - quad[0]!.x, quad[3]!.y - quad[0]!.y);
  const width = FOCUS_SAMPLE_WIDTH;
  const height = clamp(
    Math.round(width * (heightPx / Math.max(1, widthPx))),
    96,
    360,
  );
  const pixels = samplePerspective(image, correction, width, height);
  const tileScores: number[] = [];
  let horizontal = 0;
  let vertical = 0;
  let saturated = 0;
  for (let row = 0; row < FOCUS_TILE_ROWS; row += 1) {
    for (let column = 0; column < FOCUS_TILE_COLUMNS; column += 1) {
      const x0 = Math.floor((column * width) / FOCUS_TILE_COLUMNS);
      const x1 = Math.floor(((column + 1) * width) / FOCUS_TILE_COLUMNS);
      const y0 = Math.floor((row * height) / FOCUS_TILE_ROWS);
      const y1 = Math.floor(((row + 1) * height) / FOCUS_TILE_ROWS);
      let energy = 0;
      let laplacianEnergy = 0;
      let sum = 0;
      let sumSquares = 0;
      let count = 0;
      for (let y = Math.max(1, y0); y < Math.min(height - 1, y1); y += 1) {
        for (let x = Math.max(1, x0); x < Math.min(width - 1, x1); x += 1) {
          const index = y * width + x;
          const value = pixels[index]!;
          const gx = (pixels[index + 1]! - pixels[index - 1]!) / 2;
          const gy = (pixels[index + width]! - pixels[index - width]!) / 2;
          const laplacian =
            4 * value -
            pixels[index - 1]! -
            pixels[index + 1]! -
            pixels[index - width]! -
            pixels[index + width]!;
          energy += gx * gx + gy * gy;
          laplacianEnergy += laplacian * laplacian;
          horizontal += gx * gx;
          vertical += gy * gy;
          sum += value;
          sumSquares += value * value;
          if (value > 245) saturated++;
          count++;
        }
      }
      const localMean = count ? sum / count : 0;
      const localVariance = count
        ? Math.max(0, sumSquares / count - localMean * localMean)
        : 0;
      const localContrast = Math.sqrt(localVariance);
      const tenengrad = count ? Math.sqrt(energy / count) : 0;
      const laplacian = count ? Math.sqrt(laplacianEnergy / count) : 0;
      const contrastWeight = 0.35 + 0.65 * Math.min(1, localContrast / 48);
      tileScores.push((0.7 * tenengrad + 0.3 * laplacian) * contrastWeight);
    }
  }
  const lowerQuartile = percentile(tileScores, 0.25);
  const topBandEnd = FOCUS_TILE_COLUMNS * 3;
  const topBandMean =
    tileScores.slice(0, topBandEnd).reduce((sum, value) => sum + value, 0) /
    Math.max(1, topBandEnd);
  const score =
    0.55 * median(tileScores) + 0.25 * lowerQuartile + 0.2 * topBandMean;
  const anisotropy =
    Math.min(horizontal, vertical) /
    Math.max(1, Math.max(horizontal, vertical));
  return {
    score,
    lowerQuartile,
    anisotropy,
    overExposedRatio: saturated / Math.max(1, width * height),
  };
}

export async function measureFocus(
  jpeg: Buffer,
  screens: readonly ImagingScreen[],
): Promise<FocusReading> {
  const source = jpegSize(jpeg);
  const validScreens = screens.filter(
    (screen) =>
      screen.correction.sourceWidth === source.width &&
      screen.correction.sourceHeight === source.height,
  );
  if (!validScreens.length)
    throw new Error('Focus search requires at least one corrected screen ROI');
  const image = await decodeFocusFrame(jpeg);
  const readings = validScreens.map((screen) => {
    const result = focusScreen(image, screen.correction);
    return {
      screenId: screen.screenId,
      ...result,
      score: result.anisotropy < 0.25 ? result.score * 0.5 : result.score,
    };
  });
  const scores = readings.map((reading) => reading.score);
  const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const combined =
    scores.length > 1 ? 0.6 * Math.min(...scores) + 0.4 * mean : mean;
  return {
    score: round(combined, 6),
    anisotropy: round(
      Math.min(...readings.map((reading) => reading.anisotropy)),
      4,
    ),
    overExposedRatio: round(
      Math.max(...readings.map((reading) => reading.overExposedRatio)),
      4,
    ),
    screens: readings.map((reading) => ({
      ...reading,
      score: round(reading.score, 6),
      lowerQuartile: round(reading.lowerQuartile, 6),
      anisotropy: round(reading.anisotropy, 4),
      overExposedRatio: round(reading.overExposedRatio, 4),
    })),
  };
}
