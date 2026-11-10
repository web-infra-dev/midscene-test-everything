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

    const source = decoded.data;
    for (let y = 0; y < targetHeight; y += 1) {
      let numeratorX = destinationToSource[1] * y + destinationToSource[2];
      let numeratorY = destinationToSource[4] * y + destinationToSource[5];
      let denominator = destinationToSource[7] * y + destinationToSource[8];
      for (let x = 0; x < targetWidth; x += 1) {
        const sourceX = numeratorX / denominator;
        const sourceY = numeratorY / denominator;
        const offset = (y * targetWidth + x) * 3;
        numeratorX += destinationToSource[0];
        numeratorY += destinationToSource[3];
        denominator += destinationToSource[6];
        if (
          !Number.isFinite(sourceX) ||
          !Number.isFinite(sourceY) ||
          sourceX < 0 ||
          sourceY < 0 ||
          sourceX > sourceWidth - 1 ||
          sourceY > sourceHeight - 1
        ) {
          output[offset] = 0;
          output[offset + 1] = 0;
          output[offset + 2] = 0;
          continue;
        }
        const x0 = Math.floor(sourceX);
        const y0 = Math.floor(sourceY);
        const x1 = Math.min(sourceWidth - 1, x0 + 1);
        const y1 = Math.min(sourceHeight - 1, y0 + 1);
        const dx = sourceX - x0;
        const dy = sourceY - y0;
        const topLeft = (y0 * sourceWidth + x0) * 3;
        const topRight = (y0 * sourceWidth + x1) * 3;
        const bottomLeft = (y1 * sourceWidth + x0) * 3;
        const bottomRight = (y1 * sourceWidth + x1) * 3;
        for (let channel = 0; channel < 3; channel += 1) {
          const top =
            source[topLeft + channel] * (1 - dx) +
            source[topRight + channel] * dx;
          const bottom =
            source[bottomLeft + channel] * (1 - dx) +
            source[bottomRight + channel] * dx;
          output[offset + channel] = Math.round(top * (1 - dy) + bottom * dy);
        }
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
