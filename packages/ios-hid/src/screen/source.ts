import type { AirPlaySetupInfo, ScreenFrame } from '../types.js';
export interface ScreenSession {
  getSetupInfo?(): AirPlaySetupInfo | undefined;
  subscribeSetup?(listener: (info: AirPlaySetupInfo) => void): () => void;
  getFrame(options?: {
    fresh?: boolean;
    /** Permit a cached AirPlay frame only while client heartbeat confirms idle. */
    allowUnchanged?: boolean;
    timeoutMs?: number;
  }): Promise<ScreenFrame>;
  close(): Promise<void>;
}
