import type { Point } from '../types.js';
export type PointerTurn = 0 | 1 | 2 | 3;
export function pointerToScreen(p: Point, turn: PointerTurn): Point {
  if (turn === 1) return { x: 1 - p.y, y: p.x };
  if (turn === 2) return { x: 1 - p.x, y: 1 - p.y };
  if (turn === 3) return { x: p.y, y: 1 - p.x };
  return p;
}
export function screenToPointer(p: Point, turn: PointerTurn) {
  return pointerToScreen(p, ((4 - turn) % 4) as PointerTurn);
}
export function screenDeltaToPointer(p: Point, turn: PointerTurn): Point {
  if (turn === 1) return { x: p.y, y: -p.x };
  if (turn === 2) return { x: -p.x, y: -p.y };
  if (turn === 3) return { x: -p.y, y: p.x };
  return p;
}

export interface AbsolutePointerCorrection {
  version: 1;
  scale: Point;
  offset: Point;
}

export function validAbsoluteCorrection(
  correction: AbsolutePointerCorrection | undefined,
): correction is AbsolutePointerCorrection {
  return (
    correction?.version === 1 &&
    [correction.scale?.x, correction.scale?.y].every(
      (value) => value >= 0.8 && value <= 1.2,
    ) &&
    [correction.offset?.x, correction.offset?.y].every(
      (value) => Math.abs(value) <= 0.15,
    )
  );
}

export function correctedScreenToPointer(
  point: Point,
  turn: PointerTurn,
  correction?: AbsolutePointerCorrection,
): Point {
  if (!correction) return screenToPointer(point, turn);
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return screenToPointer(
    {
      x: clamp((point.x - correction.offset.x) / correction.scale.x),
      y: clamp((point.y - correction.offset.y) / correction.scale.y),
    },
    turn,
  );
}
