import { CALIBRATION_CLICK_COUNT } from '../../assisted-contracts.js';
import type { WebPoint } from '../../assisted-contracts.js';

export const pointDistance = (a: WebPoint, b: WebPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y);

export { project, invertMapping } from '../../domain/homography.js';

/** Each region gets an independent, inset target; never reuse recorded anchors. */
export function webVerificationTargets(
  layout: { width: number; height: number },
  random = Math.random,
): WebPoint[] {
  return Array.from({ length: CALIBRATION_CLICK_COUNT }, (_, i) => ({
    x: layout.width * (0.16 + (i % 3) * 0.32 + (random() - 0.5) * 0.1),
    y:
      layout.height *
      (0.12 + Math.floor(i / 3) * 0.19 + (random() - 0.5) * 0.08),
  }));
}
