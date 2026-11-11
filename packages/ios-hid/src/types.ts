import type { ImagePoint } from '@midscene/robotics-shared/camera/vision-types';

export type Point = ImagePoint;
export interface ScreenFrame {
  jpeg: Buffer;
  width: number;
  height: number;
  sequence: number;
  receivedAt: number;
}
export type InputAction =
  | { type: 'home' }
  | { type: 'back' }
  | { type: 'clearInput' }
  | { type: 'tap'; point: Point }
  | { type: 'swipe'; from: Point; to: Point; durationMs?: number }
  | { type: 'typeText'; text: string; replace?: boolean }
  | { type: 'key'; key: string };
