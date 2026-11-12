import type { AirPlaySetupInfo, ScreenFrame } from '../types.js';
export type PreviewFrame = Pick<ScreenFrame, 'jpeg' | 'sequence'>;
export interface PreviewReader {
  getFrame(): Promise<PreviewFrame | undefined>;
  close(): Promise<void>;
}

export interface ScreenSession {
  openPreview?(signal: AbortSignal): PreviewReader;
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
