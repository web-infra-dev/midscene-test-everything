import sharp from 'sharp';
import type { Point, ScreenFrame } from '../types.js';
import { alignPointerFrame, registrationMargin } from './registration.js';

export interface PointerCandidate extends Point {
  area: number;
  strength: number;
  bounds: { left: number; top: number; right: number; bottom: number };
}

export function pointerNear(
  candidate: PointerCandidate,
  point: Point,
  tolerance: number,
) {
  const { left, top, right, bottom } = candidate.bounds;
  return (
    Math.hypot(
      Math.max(left - point.x, 0, point.x - right),
      Math.max(top - point.y, 0, point.y - bottom),
    ) < tolerance
  );
}

const decodedFrames = new WeakMap<
  ScreenFrame,
  { key: string; buffer: Promise<Buffer> }
>();

function decodeGreyscale(frame: ScreenFrame, width: number, height: number) {
  const key = `${width}x${height}`;
  const cached = decodedFrames.get(frame);
  if (cached?.key === key) return cached.buffer;
  const buffer = sharp(frame.jpeg)
    .resize(width, height)
    .greyscale()
    .raw()
    .toBuffer();
  decodedFrames.set(frame, { key, buffer });
  return buffer;
}

function chromeInsets(width: number, height: number) {
  // Ignore iOS status bar clock/signal ticks and Home indicator bar on phone screens.
  if (Math.max(width, height) < 300)
    return { top: 0, bottom: 0, left: 0, right: 0 };
  if (height >= width * 1.35)
    return {
      top: Math.round(height * 0.055),
      bottom: Math.round(height * 0.035),
      left: 0,
      right: 0,
    };
  if (width >= height * 1.35)
    return {
      top: 0,
      bottom: Math.round(height * 0.05),
      left: Math.round(width * 0.045),
      right: Math.round(width * 0.045),
    };
  return { top: 0, bottom: 0, left: 0, right: 0 };
}

async function frameDifference(before: ScreenFrame, after: ScreenFrame) {
  if (before.width !== after.width || before.height !== after.height)
    throw new Error('Screen geometry changed during pointer measurement');
  const scale = Math.min(1, 720 / Math.max(before.width, before.height));
  const width = Math.round(before.width * scale);
  const height = Math.round(before.height * scale);
  const [a, b] = await Promise.all([
    decodeGreyscale(before, width, height),
    decodeGreyscale(after, width, height),
  ]);
  const chrome = chromeInsets(width, height);
  let { difference, changed } = pixelDifference(a, b, width, height, 0, chrome);
  let compared =
    Math.max(1, width - chrome.left - chrome.right) *
    Math.max(1, height - chrome.top - chrome.bottom);
  // Skip registration when the raw difference is already mostly stationary.
  if (changed > compared * 0.02 && Math.min(width, height) >= 32) {
    const aligned = await alignPointerFrame(a, b, width, height);
    if (aligned) {
      // Compare the same interior on both sides. The warp's outer pixels
      // have no matching observation in the other frame.
      const raw = pixelDifference(
        a,
        b,
        width,
        height,
        registrationMargin,
        chrome,
      );
      const registered = pixelDifference(
        a,
        aligned,
        width,
        height,
        registrationMargin,
        chrome,
      );
      if (registered.changed < raw.changed * 0.5) {
        difference = registered.difference;
        changed = registered.changed;
        compared =
          Math.max(
            1,
            width -
              Math.max(registrationMargin, chrome.left) -
              Math.max(registrationMargin, chrome.right),
          ) *
          Math.max(
            1,
            height -
              Math.max(registrationMargin, chrome.top) -
              Math.max(registrationMargin, chrome.bottom),
          );
      }
    }
  }
  if (changed > compared * 0.12)
    throw new Error(
      'Screen changed during pointer measurement. Keep a static screen visible.',
    );
  return { difference, width, height, scale, chrome };
}

function pixelDifference(
  before: Uint8Array,
  after: Uint8Array,
  width: number,
  height: number,
  margin = 0,
  chrome = { top: 0, bottom: 0, left: 0, right: 0 },
) {
  const difference = new Uint8Array(width * height);
  let changed = 0;
  const minY = Math.max(margin, chrome.top);
  const maxY = height - Math.max(margin, chrome.bottom);
  const minX = Math.max(margin, chrome.left);
  const maxX = width - Math.max(margin, chrome.right);
  for (let y = margin; y < height - margin; y++) {
    const inChromeY = y < minY || y >= maxY;
    for (let x = margin; x < width - margin; x++) {
      const i = y * width + x;
      const delta = Math.abs(before[i] - after[i]);
      difference[i] = delta;
      if (!inChromeY && x >= minX && x < maxX && delta >= 14) changed++;
    }
  }
  return { difference, changed };
}

export interface PointerPositionScore {
  mean: number;
  fraction: number;
}
/** Test known positions directly: iOS may morph a pointer into an entire icon. */
export async function scorePointerPositions(
  before: ScreenFrame,
  after: ScreenFrame,
  positions: Point[],
): Promise<PointerPositionScore[]> {
  const { difference, width, height, scale } = await frameDifference(
    before,
    after,
  );
  const radius = Math.max(
    3,
    Math.round(Math.min(before.width, before.height) * 0.025 * scale),
  );
  return positions.map((position) => {
    const cx = Math.round(position.x * (width - 1));
    const cy = Math.round(position.y * (height - 1));
    let total = 0;
    let count = 0;
    let changed = 0;
    for (
      let y = Math.max(0, cy - radius);
      y <= Math.min(height - 1, cy + radius);
      y++
    )
      for (
        let x = Math.max(0, cx - radius);
        x <= Math.min(width - 1, cx + radius);
        x++
      ) {
        const delta = difference[y * width + x];
        total += delta;
        count++;
        if (delta >= 10) changed++;
      }
    return { mean: total / count, fraction: changed / count };
  });
}

/** Frame differences produce both the old and new pointer locations. */
export async function detectPointerChanges(
  before: ScreenFrame,
  after: ScreenFrame,
): Promise<PointerCandidate[]> {
  const { difference, width, height, scale, chrome } = await frameDifference(
    before,
    after,
  );
  const mask = new Uint8Array(difference.length);
  const minY = chrome.top;
  const maxY = height - chrome.bottom;
  const minX = chrome.left;
  const maxX = width - chrome.right;
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const i = y * width + x;
      if (difference[i] >= 12) mask[i] = 1;
    }
  }
  const candidates: PointerCandidate[] = [];
  const queue = new Int32Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    let start = 0;
    let end = 1;
    queue[0] = i;
    mask[i] = 0;
    let sx = 0;
    let sy = 0;
    let strength = 0;
    let peak = 0;
    let minBX = width;
    let minBY = height;
    let maxBX = 0;
    let maxBY = 0;
    while (start < end) {
      const index = queue[start++];
      const x = index % width;
      const y = Math.floor(index / width);
      const delta = difference[index];
      sx += x;
      sy += y;
      strength += delta;
      if (delta > peak) peak = delta;
      minBX = Math.min(minBX, x);
      maxBX = Math.max(maxBX, x);
      minBY = Math.min(minBY, y);
      maxBY = Math.max(maxBY, y);
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        const next = ny * width + nx;
        if (nx >= minX && nx < maxX && ny >= minY && ny < maxY && mask[next]) {
          mask[next] = 0;
          queue[end++] = next;
        }
      }
    }
    const w = maxBX - minBX + 1;
    const h = maxBY - minBY + 1;
    // Allow iOS icon-highlight morphing (larger bounds) and I-beam cursors (smaller area).
    if (
      end < 4 ||
      peak < 15 ||
      end > width * height * 0.04 ||
      w > width * 0.22 ||
      h > height * 0.22
    )
      continue;
    candidates.push({
      x: sx / end / scale,
      y: sy / end / scale,
      area: end,
      strength: strength / end,
      bounds: {
        left: minBX / scale,
        top: minBY / scale,
        right: (maxBX + 1) / scale,
        bottom: (maxBY + 1) / scale,
      },
    });
  }
  return candidates;
}
