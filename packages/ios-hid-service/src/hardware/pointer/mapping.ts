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
