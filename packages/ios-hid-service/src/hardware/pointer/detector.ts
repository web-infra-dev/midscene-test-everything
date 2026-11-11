import sharp from 'sharp';
import type { Point, ScreenFrame } from '../types.js';

export interface PointerCandidate extends Point {
  area: number;
  strength: number;
}

async function frameDifference(before: ScreenFrame, after: ScreenFrame) {
  if (before.width !== after.width || before.height !== after.height)
    throw new Error('Screen geometry changed during pointer measurement');
  const scale = Math.min(1, 720 / Math.max(before.width, before.height));
  const width = Math.round(before.width * scale);
  const height = Math.round(before.height * scale);
  const decode = (frame: ScreenFrame) =>
    sharp(frame.jpeg).resize(width, height).greyscale().raw().toBuffer();
  const [a, b] = await Promise.all([decode(before), decode(after)]);
  const difference = new Uint8Array(width * height);
  let changed = 0;
  for (let i = 0; i < difference.length; i++) {
    difference[i] = Math.abs(a[i] - b[i]);
    if (difference[i] >= 14) changed++;
  }
  if (changed > difference.length * 0.12)
    throw new Error(
      'Screen changed during pointer measurement. Keep a static screen visible.',
    );
  return { difference, width, height, scale };
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
  const { difference, width, height, scale } = await frameDifference(
    before,
    after,
  );
  const mask = Uint8Array.from(difference, (delta) => (delta >= 14 ? 1 : 0));
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
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    while (start < end) {
      const index = queue[start++];
      const x = index % width;
      const y = Math.floor(index / width);
      sx += x;
      sy += y;
      strength += difference[index];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        const next = ny * width + nx;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[next]) {
          mask[next] = 0;
          queue[end++] = next;
        }
      }
    }
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    if (
      end < 5 ||
      end > width * height * 0.015 ||
      w > width * 0.15 ||
      h > height * 0.15
    )
      continue;
    candidates.push({
      x: sx / end / scale,
      y: sy / end / scale,
      area: end,
      strength: strength / end,
    });
  }
  return candidates;
}
