import { CALIBRATION_RELATIVE_SLACK } from './calibration-quality.js';
import type { ImagePoint, ScreenQuad } from './camera/vision-types.js';
export const MARKER_CALIBRATION_PROTOCOL = 'marker-v4' as const;
export const MAX_MARKER_CALIBRATION_TARGETS = 9;
export type PerspectiveRotation = 0 | 90 | 180 | 270;
export interface CameraStreamInfo {
  id: string;
  deviceId: string;
  width?: number;
  height?: number;
}
export interface DetectionFrame {
  id: number;
  capturedAt: number;
  jpegBase64?: string;
}
export type MarkerCalibrationState =
  | 'created'
  | 'display-ready'
  | 'detecting'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface MarkerCalibrationResult {
  method?: 'temporal';
  protocol: typeof MARKER_CALIBRATION_PROTOCOL;
  points: ScreenQuad;
  screenWidthPx: number;
  screenHeightPx: number;
  rotation: PerspectiveRotation;
  imageWidth: number;
  imageHeight: number;
  frameCount: number;
  validFrames: number;
  cornerJitterPx: number;
  reprojectionRmsePx: number;
  markerIds: number[];
  durationMs: number;
}

/** Corner quantisation sets a pixel floor; optical noise scales with capture resolution. */
export function markerNoiseAllowancePx(width: number, height: number) {
  return (
    Math.max(2.5, Math.hypot(width, height) * 0.002) *
    (1 + CALIBRATION_RELATIVE_SLACK)
  );
}

export function markerCaptureRecommended(
  result: Pick<
    MarkerCalibrationResult,
    | 'frameCount'
    | 'validFrames'
    | 'imageWidth'
    | 'imageHeight'
    | 'cornerJitterPx'
    | 'reprojectionRmsePx'
  >,
) {
  const allowance = markerNoiseAllowancePx(
    result.imageWidth,
    result.imageHeight,
  );
  return (
    Number.isFinite(allowance) &&
    result.imageWidth > 0 &&
    result.imageHeight > 0 &&
    Number.isInteger(result.frameCount) &&
    result.frameCount > 0 &&
    Number.isInteger(result.validFrames) &&
    result.validFrames <= result.frameCount &&
    result.validFrames / result.frameCount >= 0.5 &&
    [result.cornerJitterPx, result.reprojectionRmsePx].every(
      (px) => px >= 0 && px <= allowance,
    )
  );
}

export interface MarkerCalibrationSession {
  id: string;
  state: MarkerCalibrationState | 'partially-succeeded';
  streamId: string;
  createdAt: number;
  expiresAt: number;
  targets: MarkerCalibrationTarget[];
  /** Pages released by removing a target remain available for manual pairing. */
  excludedPageIds?: string[];
}

export interface MarkerCalibrationTarget {
  id: string;
  name: string;
  state: MarkerCalibrationState;
  display?: {
    widthPx: number;
    heightPx: number;
    cssWidthPx: number;
    cssHeightPx: number;
    devicePixelRatio: number;
    rotation: PerspectiveRotation;
    fullscreen: boolean;
  };
  layout?: {
    method?: 'temporal';
    protocol: typeof MARKER_CALIBRATION_PROTOCOL;
    dictionary: 'ARUCO_MIP_36h12';
    screenWidthPx: number;
    screenHeightPx: number;
    rotation: PerspectiveRotation;
    points: ScreenQuad;
    markers: Array<{
      id: number;
      center: ImagePoint;
      side: number;
      svg: string;
    }>;
  };
  result?: MarkerCalibrationResult;
  error?: string;
}

export interface MarkerCalibrationTargetCreateResult
  extends MarkerCalibrationTarget {
  token: string;
}

export interface MarkerCalibrationCreateResult
  extends MarkerCalibrationSession {
  token: string;
  targets: MarkerCalibrationTargetCreateResult[];
}

export interface MarkerCalibrationAddTargetResult {
  session: MarkerCalibrationSession;
  target: MarkerCalibrationTargetCreateResult;
}

export interface MarkerCalibrationDetectionResponse {
  session: MarkerCalibrationSession;
  frames: Partial<Record<string, DetectionFrame>>;
}

export interface ScreenDeviceSummary {
  awaitingOriginTap?: boolean;
  markersReady?: boolean;
  pageInstanceId?: string;
  /** Robot Vision camera that observes this page, when the console bound it. */
  cameraId?: string;
  id: string;
  label: string;
  /** Name the operator gave this page; kept by the page across reloads. */
  name?: string;
  /** Stable page identity, kept by the page across reloads and restarts. */
  pageKey?: string;
  mode: 'waiting' | 'markers' | 'mapping';
  language: string;
  width: number;
  height: number;
  visible: boolean;
  fullscreen?: boolean;
  targetDisplayId?: string;
  sessionId?: string;
  /** Screen this page calibrated, while its marker session still knows it. */
  screenId?: string;
}
export interface LanAddress {
  address: string;
  name: string;
  recommended: boolean;
}

export interface TargetDisplaySession {
  id: string;
  code: string;
  language: 'en' | 'zh';
  state: string;
  visionSessionId: string;
  visionTargetId: string;
  publicUrl: string;
  publicUrlConfigured?: boolean;
  addresses: LanAddress[];
  error?: string;
  expiresAt: number;
}

export interface TargetDisplayCreateInput {
  visionSessionId: string;
  targetId: string;
  visionToken: string;
  language?: string;
}
