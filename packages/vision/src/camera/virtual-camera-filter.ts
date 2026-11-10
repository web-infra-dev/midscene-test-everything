import type { CameraBackendName } from './types.js';

/**
 * Identity of an enumerated capture device, including the extra Linux sysfs
 * metadata that lets us tell loopback devices from real hardware.
 */
export interface CameraDeviceIdentity {
  name: string;
  backend: CameraBackendName;
  /** Linux sysfs driver name, for example `uvcvideo` or `v4l2loopback`. */
  driver?: string;
  /** Linux sysfs device path, for example `/sys/devices/virtual/video4linux/video0`. */
  sysfsPath?: string;
}

/**
 * Kernel drivers that only publish synthetic capture devices. `vivid` and
 * `vimc` are the V4L2 test drivers, `v4l2loopback` and `akvcam` power most
 * Linux virtual cameras.
 */
const VIRTUAL_CAMERA_DRIVER_NAMES = new Set([
  'akvcam',
  'v4l2loopback',
  'v4l2loopback_video',
  'vicam',
  'vimc',
  'vivid',
]);

/**
 * Name fragments published by virtual camera software. Device names are
 * lowercased and their `-`, `_`, and repeated whitespace collapsed before
 * matching, so `OBS-Camera`, `OBS_Camera`, and `OBS  Camera` all match
 * `obs camera`.
 */
const VIRTUAL_CAMERA_NAME_KEYWORDS: readonly string[] = [
  // Generic wording, for example "Virtual Camera" or "NDI Virtual Input".
  'virtual camera',
  'virtual webcam',
  'virtual video',
  'virtual input',
  'virtual device',
  'virtual source',
  // OBS publishes "OBS Virtual Camera" and the legacy "OBS-Camera". OBSBOT
  // hardware names ("OBSBOT Tiny 4K") contain none of these fragments.
  'obs camera',
  'obs virtual camera',
  'obs virtualcam',
  // Screen sharing pseudo cameras: macOS "Capture screen 0", Windows
  // "Screen Capture Recorder".
  'capture screen',
  'screen capture',
  'screen recorder',
  'screen camera',
  // Third-party virtual camera applications.
  'avk cam',
  'camo',
  'chromacam',
  'droidcam',
  'e2esoft',
  'epoccam',
  'iriun',
  'logi capture',
  'logitech capture',
  'manycam',
  'mmhmm',
  'ndi video',
  'ndi webcam',
  'ndi camera',
  'ndi input',
  'ndi virtual',
  'nvidia broadcast',
  'prism live',
  'snap camera',
  'unity video capture',
  'vcam',
  'vtube studio',
  'webcamoid',
  'xpression',
  'youcam',
  // Chinese product wording, for example "虚拟摄像头".
  '虚拟摄像头',
  '虚拟相机',
  '虚拟摄像机',
  '虚拟视频设备',
  // Linux loopback devices that keep the kernel default label.
  'dummy video device',
  'v4l2 loopback',
];

const normalizeDeviceName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[\s_-]+/gu, ' ')
    .trim();

/** Returns true when the camera name belongs to virtual camera software. */
export function isVirtualCameraName(name: string): boolean {
  const normalized = normalizeDeviceName(name);
  if (!normalized) return false;
  return VIRTUAL_CAMERA_NAME_KEYWORDS.some((keyword) =>
    normalized.includes(keyword),
  );
}

/**
 * Returns true when an enumerated device is a virtual camera rather than
 * physical hardware. Unknown devices are treated as physical so that a custom
 * backend or an unusual driver never loses a real camera.
 */
export function isVirtualCamera(device: CameraDeviceIdentity): boolean {
  const driver = device.driver?.trim().toLowerCase();
  if (driver && VIRTUAL_CAMERA_DRIVER_NAMES.has(driver)) return true;
  if (device.sysfsPath?.includes('/devices/virtual/')) return true;
  return isVirtualCameraName(device.name);
}

/**
 * Keeps only physical cameras unless `includeVirtual` is set. The service uses
 * this so that `/devices` never exposes software cameras.
 */
export function filterPhysicalCameras<T extends CameraDeviceIdentity>(
  devices: readonly T[],
  options: { includeVirtual?: boolean } = {},
): T[] {
  if (options.includeVirtual) return [...devices];
  return devices.filter((device) => !isVirtualCamera(device));
}
