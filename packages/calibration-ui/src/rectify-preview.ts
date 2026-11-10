import {
  computeHomography,
  destinationCorners,
  quadToArray,
  validateQuad,
} from '@midscene/arm-kit-shared/camera/vision-geometry';
import type { PerspectiveRotation } from '@midscene/arm-kit-shared/camera/vision-types';
import type { CameraCorrection } from '@midscene/arm-kit-shared/contracts';

export interface PreviewPixels {
  width: number;
  height: number;
  /** RGBA, row-major, exactly width * height * 4 bytes. */
  data: Uint8ClampedArray;
}

/**
 * Rectify decoded camera pixels into the saved phone-screen rectangle. This is
 * the same homography the server transformer applies, kept here so the editor
 * shows the accepted result instead of relying on a CSS 3D approximation.
 */
export function rectifyPreview(
  source: PreviewPixels,
  correction: CameraCorrection,
  width: number,
  height: number,
  rotation: PerspectiveRotation = 0,
): PreviewPixels {
  validateQuad(correction.points);
  const inverse = computeHomography(
    destinationCorners(width, height, rotation),
    quadToArray(correction.points),
  );
  const data = new Uint8ClampedArray(width * height * 4);
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  const pixels = source.data;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const denominator = inverse[6] * x + inverse[7] * y + inverse[8];
      if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) {
        data[offset + 3] = 255;
        continue;
      }
      const sourceX =
        (inverse[0] * x + inverse[1] * y + inverse[2]) / denominator;
      const sourceY =
        (inverse[3] * x + inverse[4] * y + inverse[5]) / denominator;
      if (
        !Number.isFinite(sourceX) ||
        !Number.isFinite(sourceY) ||
        sourceX < 0 ||
        sourceY < 0 ||
        sourceX > sourceWidth - 1 ||
        sourceY > sourceHeight - 1
      ) {
        data[offset + 3] = 255;
        continue;
      }
      const x0 = Math.floor(sourceX);
      const y0 = Math.floor(sourceY);
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
      const y1 = Math.min(sourceHeight - 1, y0 + 1);
      const dx = sourceX - x0;
      const dy = sourceY - y0;
      const topLeft = (y0 * sourceWidth + x0) * 4;
      const topRight = (y0 * sourceWidth + x1) * 4;
      const bottomLeft = (y1 * sourceWidth + x0) * 4;
      const bottomRight = (y1 * sourceWidth + x1) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const top =
          pixels[topLeft + channel] * (1 - dx) +
          pixels[topRight + channel] * dx;
        const bottom =
          pixels[bottomLeft + channel] * (1 - dx) +
          pixels[bottomRight + channel] * dx;
        data[offset + channel] = Math.round(top * (1 - dy) + bottom * dy);
      }
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}
