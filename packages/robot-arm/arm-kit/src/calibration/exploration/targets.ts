import type { WebPoint } from '../../assisted-contracts.js';
import { RobotArmError } from '../../contracts.js';

export interface ExplorationTarget {
  point: WebPoint;
  purpose: 'fit' | 'check';
}

/** dev's nine-point partition, or four peripheral fit points plus two holdouts. */
export function explorationTargets(
  layout: { width: number; height: number },
  fast = false,
  inset = 0.1,
): ExplorationTarget[] {
  // screen-calib-client requests inset 0.1; targets.ts returns row-major order.
  const targets: ExplorationTarget[] = [];
  const fractions = [inset, 0.5, 1 - inset];
  for (let row = 0; row < 3; row++)
    for (let column = 0; column < 3; column++)
      targets.push({
        point: {
          x: layout.width * fractions[column],
          y: layout.height * fractions[row],
        },
        purpose:
          (row === 1 && column !== 1) || (row === 2 && column === 1)
            ? 'check'
            : 'fit',
      });
  if (!fast) return targets;
  const cx = layout.width / 2;
  const cy = layout.height / 2;
  const fit = targets
    .filter((t) => t.purpose === 'fit')
    .sort(
      (a, b) =>
        ((b.point.x - cx) / layout.width) ** 2 +
        ((b.point.y - cy) / layout.height) ** 2 -
        ((a.point.x - cx) / layout.width) ** 2 -
        ((a.point.y - cy) / layout.height) ** 2,
    )
    .slice(0, 4);
  const checks = targets.filter((t) => t.purpose === 'check').slice(0, 2);
  const rows = [...new Set([...fit, ...checks].map((t) => t.point.y))].sort(
    (a, b) => a - b,
  );
  return [...fit, ...checks].sort(
    (a, b) =>
      a.point.y - b.point.y ||
      (rows.indexOf(a.point.y) % 2
        ? b.point.x - a.point.x
        : a.point.x - b.point.x),
  );
}

/** Match dev's target generation: fixed inset and mapped screen bounds only. */
export function mappedExplorationTargets(
  layout: { width: number; height: number },
  map: (point: WebPoint) => WebPoint,
  screen: { width: number; height: number },
  fast = false,
) {
  const inset = 0.1;
  const targets = explorationTargets(layout, fast, inset);
  const points = targets.map((t) => map(t.point));
  if (
    points.some(
      (p) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.y < 0 ||
        p.x > screen.width - 1 ||
        p.y > screen.height - 1,
    )
  )
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'The fixed 10% calibration targets are outside the screen. Check the camera mapping before starting.',
      409,
    );
  return { targets, inset };
}
