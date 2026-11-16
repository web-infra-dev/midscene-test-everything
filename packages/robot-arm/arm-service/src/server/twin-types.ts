import type {
  JointDefinition,
  Quaternion,
  RobotVisualModel,
  Vector3,
} from '@midscene/robotics-shared/contracts';

/** Why a 3D twin cannot be built yet. Kept as a closed set for the UI. */
export type TwinBlockedReason =
  | 'arm-disconnected'
  | 'visual-model-missing'
  | 'camera-not-running'
  | 'calibration-required'
  | 'screen-mapping-required'
  | 'perspective-required';

/** One calibrated screen as the 3D scene must place and texture it. */
export interface TwinScreenSnapshot {
  /** Screen target id; for a single-screen camera this equals the camera id. */
  id: string;
  name: string;
  cameraId: string;
  calibrationId: string;
  /** A valid but not yet accepted calibration is still drawn, with a badge. */
  accepted: boolean;
  physicalWidthMm: number;
  physicalHeightMm: number;
  pixelWidth: number;
  pixelHeight: number;
  originMm: Vector3;
  xAxis: Vector3;
  yAxis: Vector3;
  inward: Vector3;
  /** Corrected MJPEG for this screen; the client appends its own client id. */
  previewUrl: string;
  cameraLive: boolean;
}

export interface TwinCameraSnapshot {
  id: string;
  name: string;
  /** Body-only mesh; the source STL's folded stand is not part of the twin. */
  modelUrl: string;
  assetUnits: 'mm';
  /** Lens centre in the model's own coordinates, millimetres. */
  lensOffsetMm: Vector3;
  /** Lens centre in the robot base frame, millimetres. */
  positionMm: Vector3;
  /** Maps the model's local axes to the robot base frame. */
  quaternion: Quaternion;
  source: 'estimated';
  residualPx: number;
  samples: number;
}

export interface TwinSceneSnapshot {
  ready: boolean;
  blockedReasons: TwinBlockedReason[];
  robot?: {
    visual: RobotVisualModel;
    joints: JointDefinition[];
  };
  tool?: {
    offsetMm: Vector3;
    contactDirection: Vector3;
  };
  /**
   * Optional static camera prop. Omitted when the camera cannot be identified
   * as the modelled C922 or when the screen quads do not support a stable fit.
   */
  camera?: TwinCameraSnapshot;
  screens: TwinScreenSnapshot[];
  /** Targets that exist but cannot be drawn, with the first blocking reason. */
  skippedScreens: { id: string; name: string; reason: TwinBlockedReason }[];
  generatedAt: string;
}

export interface TwinHello {
  type: 'hello';
  intervalMs: number;
  generatedAt: string;
}

export interface TwinMotionMessage {
  type: 'sample';
  seq: number;
  t: number;
  joints: number[];
  source: 'push' | 'poll';
  stale: boolean;
}

export interface TwinStateMessage {
  type: 'state';
  connected: boolean;
  enabled: boolean;
  moving: boolean;
  paused: boolean;
  dragMode: boolean;
  faults: number;
  stale: boolean;
  pose?: {
    positionMm: Vector3;
    quaternion: { x: number; y: number; z: number; w: number };
  };
}
