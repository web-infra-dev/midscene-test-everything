import type { PreviewReader } from '@midscene/robotics-shared/device-protocol';
export type { PreviewReader } from '@midscene/robotics-shared/device-protocol';
import type { AirPlaySetupInfo, ScreenFrame } from '../types.js';
export interface ScreenSession {
  openPreview?(signal: AbortSignal): PreviewReader;
  getSetupInfo?(): AirPlaySetupInfo | undefined;
  subscribeSetup?(listener: (info: AirPlaySetupInfo) => void): () => void;
  getFrame(options?: {
    fresh?: boolean;
    /** A buffered frame newer than this sequence already satisfies fresh. */
    afterSequence?: number;
    /** Permit a cached AirPlay frame only while client heartbeat confirms idle. */
    allowUnchanged?: boolean;
    timeoutMs?: number;
  }): Promise<ScreenFrame>;
  close(): Promise<void>;
}
