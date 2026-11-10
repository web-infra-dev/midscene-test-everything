import type { ImagePoint } from '@midscene/robotics-shared/camera/vision-types';
import type { CameraScreenSettings } from '@midscene/robotics-vision';
import type { PointerMotionProfile } from './pointer/motion-profile.js';

export const HOST_PROTOCOL_VERSION = 1;
export type ScreenOptions =
  | { source: 'usb'; deviceId?: string }
  | { source: 'airplay' }
  | { source: 'camera'; cameraId?: string };
export interface IOSHIDDeviceOptions {
  /** Set false to repeat setup instead of reusing saved calibration. */
  reuseConfiguration?: boolean;
  bluetoothPeerId?: string;
  id?: string;
  name?: string;
  screen?: ScreenOptions;
  host?: { url: string; token: string };
}
export interface DeviceConfig {
  id: string;
  name: string;
  modelName?: string;
  screen: ScreenOptions;
  camera?: CameraScreenSettings;
  bluetoothPeerId?: string;
  pointerMotion?: PointerMotionProfile;
}
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
export interface ConnectionState {
  id: string;
  phase: 'connecting' | 'setup-required' | 'ready' | 'failed' | 'closed';
  device?: { id: string; name: string; modelName?: string };
  setupUrl?: string;
  setupKind?: 'device' | 'camera' | 'selection';
  message?: string;
  error?: string;
}
export interface ConnectOptions {
  interactive?: boolean;
  timeoutMs?: number;
  /** Present connection progress in the caller's UI, without opening a browser. */
  onState?: (state: ConnectionState) => void;
}
export interface HostAddress {
  url: string;
  token: string;
  pid: number;
  protocol: number;
}

export interface TaskRequest {
  requestId: string;
  deviceId: string;
  instruction: string;
}
export interface TaskState {
  id: string;
  deviceId: string;
  phase:
    | 'queued'
    | 'connecting'
    | 'setup-required'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'cancelled';
  setupUrl?: string;
  setupKind?: ConnectionState['setupKind'];
  result?: string;
  error?: string;
}

/** Receiver readiness and picture availability are separate states. */
export interface AirPlaySetupInfo {
  name: string;
  pin: string;
  state: 'waiting' | 'streaming' | 'interrupted' | 'failed';
  error?: string;
}
