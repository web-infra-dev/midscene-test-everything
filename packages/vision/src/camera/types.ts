import type { EventEmitter } from 'node:events';
import type {
  CameraBackendName,
  CameraLabel,
} from '@midscene/robotics-shared/camera/profile';

export type {
  CameraBackendName,
  CameraLabel,
  CameraProfile,
} from '@midscene/robotics-shared/camera/profile';

export interface CameraDevice {
  id: string;
  name: string;
  backend: CameraBackendName;
  /** Live AVFoundation device type; absent when the backend cannot report it. */
  deviceType?: string;
  /** Discovered macOS capture mode, preferring resolutions up to 1080p. */
  defaultCaptureSettings?: { width: number; height: number; fps: number };
}

export interface CameraStreamOptions {
  deviceId: string;
  width?: number;
  height?: number;
  fps?: number;
  /** Mirror top-to-bottom, the reference project's `vertical_flip`. */
  verticalFlip?: boolean;
  /** Mirror left-to-right, the reference project's `horizontal_flip`. */
  horizontalFlip?: boolean;
}

export interface ResolvedCameraStreamOptions {
  deviceId: string;
  width: number;
  height: number;
  fps: number;
  verticalFlip: boolean;
  horizontalFlip: boolean;
}

export interface CameraFrame {
  capture?: ResolvedCameraStreamOptions;
  id: number;
  capturedAt: number;
  jpeg: Buffer;
}

export interface CameraSource extends EventEmitter {
  close(): Promise<void>;
}

export interface CameraBackend {
  listDevices(): Promise<CameraDevice[]>;
  openStream(options: ResolvedCameraStreamOptions): Promise<CameraSource>;
}

export type CameraStreamState = 'starting' | 'running' | 'failed' | 'stopped';

export interface CameraStreamInfo {
  id: string;
  deviceId: string;
  width: number;
  height: number;
  fps: number;
  state: CameraStreamState;
  frameId: number;
  lastFrameAt?: number;
  error?: string;
  /** A frame has been received at least once for this stream. */
  hasFrame: boolean;
  /** Milliseconds since the latest frame was captured. */
  frameAgeMs?: number;
  /** Measured frame rate over the recent frame window. */
  actualFps?: number;
}

export const CAMERA_LABELS: readonly CameraLabel[] = [
  'front',
  'back',
  'left',
  'right',
  'top',
  'bottom',
];
