import sharp from 'sharp';
import { RobotVisionError } from './errors.js';
import {
  computeHomography,
  destinationCorners,
  quadToArray,
  validateQuad,
} from './vision-geometry.js';
import type {
  PerspectiveRotation,
  PerspectiveTransformOptions,
} from './vision-types.js';

const MAX_OUTPUT_PIXELS = 32_000_000;
const ROTATIONS: PerspectiveRotation[] = [0, 90, 180, 270];

export function resolveRotation(value: unknown): PerspectiveRotation {
  if (value === undefined || value === null) return 0;
  if (!ROTATIONS.includes(value as PerspectiveRotation)) {
    throw new RobotVisionError(
      'INVALID_ARGUMENT',
      `rotation must be one of ${ROTATIONS.join(', ')}, received ${String(value)}`,
    );
  }
  return value as PerspectiveRotation;
}

export { destinationCorners } from './vision-geometry.js';

function resolveDimension(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0 || value > 7680) {
    throw new RobotVisionError(
      'INVALID_ARGUMENT',
      `${name} must be an integer between 1 and 7680`,
    );
  }
  return value;
}

export class PerspectiveTransformer {
  async transform(
    image: Buffer,
    options: PerspectiveTransformOptions,
  ): Promise<Buffer> {
    const targetWidth = resolveDimension(options.targetWidth, 'targetWidth');
    const targetHeight = resolveDimension(options.targetHeight, 'targetHeight');
    if (targetWidth * targetHeight > MAX_OUTPUT_PIXELS) {
      throw new RobotVisionError(
        'INVALID_ARGUMENT',
        `Perspective output cannot exceed ${MAX_OUTPUT_PIXELS} pixels`,
      );
    }
    const rotation = resolveRotation(options.rotation);
    validateQuad(options.points);

    const decoded = await sharp(image)
      .rotate()
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const sourceWidth = decoded.info.width;
    const sourceHeight = decoded.info.height;
    const destinationToSource = computeHomography(
      destinationCorners(targetWidth, targetHeight, rotation),
      quadToArray(options.points),
    );
    const output = Buffer.allocUnsafe(targetWidth * targetHeight * 3);
    const nearest = options.sampling === 'nearest';

    const source = decoded.data;
    // The mapping is projective, so the row-only terms can be stepped and the
    // pixel terms updated incrementally. One reciprocal per pixel is enough;
    // the previous form divided twice and floored with Math.floor for every
    // pixel, which dominated the cost of a preview-sized warp.
    const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = destinationToSource as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const maxX = sourceWidth - 1;
    const maxY = sourceHeight - 1;

    let offset = 0;
    for (let y = 0; y < targetHeight; y += 1) {
      let numeratorX = m1 * y + m2;
      let numeratorY = m4 * y + m5;
      let denominator = m7 * y + m8;
      for (let x = 0; x < targetWidth; x += 1) {
        const inverse = 1 / denominator;
        const sourceX = numeratorX * inverse;
        const sourceY = numeratorY * inverse;
        numeratorX += m0;
        numeratorY += m3;
        denominator += m6;
        // Written so a NaN coordinate also fails the test.
        if (
          !(sourceX >= 0 && sourceY >= 0 && sourceX <= maxX && sourceY <= maxY)
        ) {
          output[offset] = 0;
          output[offset + 1] = 0;
          output[offset + 2] = 0;
          offset += 3;
          continue;
        }
        const x0 = sourceX | 0;
        const y0 = sourceY | 0;
        const topLeft = (y0 * sourceWidth + x0) * 3;
        if (nearest) {
          output[offset] = source[topLeft]!;
          output[offset + 1] = source[topLeft + 1]!;
          output[offset + 2] = source[topLeft + 2]!;
          offset += 3;
          continue;
        }
        const x1 = x0 < maxX ? x0 + 1 : maxX;
        const y1 = y0 < maxY ? y0 + 1 : maxY;
        const fx = sourceX - x0;
        const fy = sourceY - y0;
        const topRight = (y0 * sourceWidth + x1) * 3;
        const bottomLeft = (y1 * sourceWidth + x0) * 3;
        const bottomRight = (y1 * sourceWidth + x1) * 3;
        for (let channel = 0; channel < 3; channel += 1) {
          const top = source[topLeft + channel]!;
          const bottom = source[bottomLeft + channel]!;
          const interpolatedTop =
            top + (source[topRight + channel]! - top) * fx;
          const interpolatedBottom =
            bottom + (source[bottomRight + channel]! - bottom) * fx;
          output[offset + channel] =
            (interpolatedTop +
              (interpolatedBottom - interpolatedTop) * fy +
              0.5) |
            0;
        }
        offset += 3;
      }
    }

    const quality = Math.max(
      1,
      Math.min(100, Math.round(options.jpegQuality ?? 85)),
    );
    return sharp(output, {
      raw: { width: targetWidth, height: targetHeight, channels: 3 },
    })
      .jpeg({ quality })
      .toBuffer();
  }
}
