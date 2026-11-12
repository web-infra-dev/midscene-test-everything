import type { CameraScreenSettings } from '@midscene/robotics-vision';
import type { PointerMotionProfile } from './pointer/motion-profile.js';
export type { InputAction, Point, ScreenFrame } from '@midscene/open-device';

export type ScreenOptions =
  | { source: 'usb'; deviceId?: string }
  | { source: 'airplay' }
  | { source: 'camera'; cameraId?: string };
export interface IPhoneDeviceOptions {
  /** Set false to repeat setup instead of reusing saved calibration. */
  reuseConfiguration?: boolean;
  bluetoothPeerId?: string;
  id?: string;
  name?: string;
  screen?: ScreenOptions;
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
export interface ConnectionState {
  id: string;
  phase: 'connecting' | 'setup-required' | 'ready' | 'failed' | 'closed';
  device?: { id: string; name: string; modelName?: string };
  setupId?: string;
  setupKind?: 'device' | 'camera' | 'selection';
  message?: string;
  error?: string;
}
/** Receiver readiness and picture availability are separate states. */
export interface AirPlaySetupInfo {
  name: string;
  pin: string;
  state: 'waiting' | 'streaming' | 'interrupted' | 'failed';
  error?: string;
}
