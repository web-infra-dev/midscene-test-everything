export type RobotVisionErrorCode =
  | 'ACCESS_DENIED'
  | 'CAMERA_NOT_FOUND'
  | 'CAMERA_PROFILE_CONFLICT'
  | 'CAMERA_NAME_CONFLICT'
  | 'CALIBRATION_MISMATCH'
  | 'CAPTURE_FAILED'
  | 'DEVICE_NOT_FOUND'
  | 'FFMPEG_NOT_FOUND'
  | 'INVALID_ARGUMENT'
  | 'NO_FRAME_AVAILABLE'
  | 'NO_SCREEN_DETECTED'
  | 'PHOTO_NOT_FOUND'
  | 'PHOTO_WRITE_FAILED'
  | 'PROFILE_NOT_FOUND'
  | 'REPORT_NOT_FOUND'
  | 'STATE_CORRUPT'
  | 'STATE_WRITE_FAILED'
  | 'STREAM_ALREADY_EXISTS'
  | 'STREAM_FAILED'
  | 'STREAM_NOT_FOUND'
  | 'UNSUPPORTED_PLATFORM';

export class RobotVisionError extends Error {
  constructor(
    public readonly code: RobotVisionErrorCode,
    message: string,
    public readonly cause?: unknown,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RobotVisionError';
  }
}
