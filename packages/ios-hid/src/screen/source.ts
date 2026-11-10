import type { ScreenFrame } from '../types.js';
export interface ScreenSession {
  getSetupInfo?(): { name: string; pin: string } | undefined;
  getFrame(options?: {
    fresh?: boolean;
    timeoutMs?: number;
  }): Promise<ScreenFrame>;
  close(): Promise<void>;
}
