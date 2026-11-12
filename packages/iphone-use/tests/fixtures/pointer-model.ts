import type { PointerMotionModel } from '../../dist/hardware/pointer/motion-model.js';
import type { Point } from '../../dist/hardware/types.js';

/** Synthetic phone response, independent of the production calibration code. */
export function curveModel(
  x = { a: 0.8, b: 0.07 },
  y = { a: 0.95, b: 0.06 },
): PointerMotionModel {
  const reports = [];
  for (let dx = 0; dx <= 8; dx++)
    for (let dy = 0; dy <= 8; dy++) {
      const length = Math.hypot(dx, dy);
      if (!length || length > 8) continue;
      reports.push({
        delta: { x: dx, y: dy },
        displacement: {
          x: dx * (x.a + x.b * length),
          y: dy * (y.a + y.b * length),
        },
      });
    }
  return { reports };
}
export function physicalMovement(
  model: PointerMotionModel,
  delta: Point,
): Point {
  if (!delta.x && !delta.y) return { x: 0, y: 0 };
  const point = model.reports.find(
    (p) => p.delta.x === Math.abs(delta.x) && p.delta.y === Math.abs(delta.y),
  );
  if (!point) throw new Error('Missing simulated phone response');
  return {
    x: Math.sign(delta.x) * point.displacement.x,
    y: Math.sign(delta.y) * point.displacement.y,
  };
}
