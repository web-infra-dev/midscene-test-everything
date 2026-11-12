import sharp from 'sharp';
import { RobotArmError } from '../contracts.js';

/** Locate the single magenta disk on a rectified helper-page image, in image pixels. */
export async function findTrialTarget(jpeg: Buffer) {
  const {
    data,
    info: { width, height, channels },
  } = await sharp(jpeg)
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const [r, g, b] = [
      data[i * channels],
      data[i * channels + 1],
      data[i * channels + 2],
    ];
    mask[i] = Number(
      r > 105 && b > 85 && r > g * 1.7 && b > g * 1.6 && Math.abs(r - b) < 100,
    );
  }
  const centers = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const queue = [i];
    mask[i] = 0;
    let sx = 0;
    let sy = 0;
    let x0 = width;
    let y0 = height;
    let x1 = 0;
    let y1 = 0;
    for (let n = 0; n < queue.length; n++) {
      const pixel = queue[n];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      sx += x;
      sy += y;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (const neighbor of [
        x > 0 ? pixel - 1 : -1,
        x < width - 1 ? pixel + 1 : -1,
        pixel - width,
        pixel + width,
      ]) {
        if (mask[neighbor]) {
          mask[neighbor] = 0;
          queue.push(neighbor);
        }
      }
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const fill = queue.length / (w * h);
    if (
      w >= 6 &&
      h >= 6 &&
      w <= width * 0.16 &&
      h <= height * 0.16 &&
      w / h > 0.7 &&
      w / h < 1.4 &&
      fill > 0.63 &&
      fill < 0.9
    )
      centers.push({ x: sx / queue.length, y: sy / queue.length });
  }
  if (centers.length !== 1)
    throw new RobotArmError(
      'INVALID_MAPPING',
      'Expected exactly one trial circle in the corrected image',
      409,
    );
  return centers[0];
}
