import type {
  PerspectiveRotation,
  PerspectiveTarget,
  ScreenQuad,
} from './vision-types.js';

export type CameraBackendName = 'avfoundation' | 'dshow' | 'v4l2';

/**
 * Where a camera is mounted. Deliberately neutral: a camera can also stay
 * unlabelled, and the name is what a user reads in the console.
 */
export type CameraLabel =
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom';

/**
 * A camera as reported by `/cameras`: the live hardware identity merged with
 * the persisted profile.
 */
export interface CameraProfile {
  id: string;
  name: string;
  /** Live AVFoundation device type; not inferred from a user-editable name. */
  deviceType?: string;
  /** Live hardware name, present while the device is enumerated. */
  deviceName?: string;
  backend?: CameraBackendName;
  lastSeenAt?: string;
  label?: CameraLabel;
  width?: number;
  height?: number;
  fps?: number;
  /**
   * Perspective profile that should be applied to this camera. It is stored
   * with the camera because a stream id is a fresh UUID on every start, so the
   * binding only survives a console reload or a service restart if it hangs off
   * the device. A key whose profile was deleted is dropped when read.
   */
  profileKey?: string;
  /**
   * Size a rectified frame is stretched to, and how far it is turned. Stored
   * with the camera for the same reason as `profileKey`: the screen of a phone
   * has nothing to do with the aspect of the camera frame.
   */
  perspectiveTarget?: PerspectiveTarget;
  /** Mirror the picture top-to-bottom, for a camera mounted upside down. */
  verticalFlip?: boolean;
  /** Mirror the picture left-to-right, for a camera facing a mirror. */
  horizontalFlip?: boolean;
  online: boolean;
}

export interface CameraCorrection {
  points: ScreenQuad;
  sourceWidth: number;
  sourceHeight: number;
  rotation: PerspectiveRotation;
}
