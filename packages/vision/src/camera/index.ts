import { DeviceRegistry } from './device-registry.js';
import { FfmpegCameraBackend } from './ffmpeg-camera-backend.js';
import {
  MacosCameraBackend,
  type MacosCameraBackendOptions,
} from './macos-camera-backend.js';
import type { CameraDevice } from './types.js';

let registry: DeviceRegistry | undefined;
export function cameraBackend(
  options?: MacosCameraBackendOptions,
): DeviceRegistry {
  registry ??= new DeviceRegistry(
    process.platform === 'darwin'
      ? new MacosCameraBackend(options)
      : new FfmpegCameraBackend(),
  );
  return registry;
}
export async function listCameras(
  options: { refresh?: boolean; includeBuiltIn?: boolean } = {},
): Promise<CameraDevice[]> {
  const cameras = await cameraBackend().listDevices({
    refresh: options.refresh,
  });
  return options.includeBuiltIn
    ? cameras
    : cameras.filter(
        (camera) =>
          camera.deviceType !== 'AVCaptureDeviceTypeBuiltInWideAngleCamera' &&
          !/facetime|built.?in|内建/i.test(camera.name),
      );
}
export { CameraStreamManager } from './camera-stream-manager.js';
export type {
  CameraDevice,
  CameraBackend,
  CameraFrame,
  CameraStreamInfo,
} from './types.js';
