import type { ScreenFrame } from '../types.js';
export interface PointerSample {
  stage: 'orientation' | 'movement';
  before: ScreenFrame;
  after: ScreenFrame;
  data: Record<string, unknown>;
}
export type PointerDiagnostics = (sample: PointerSample) => Promise<void>;
