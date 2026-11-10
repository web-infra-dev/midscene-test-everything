import type { PerspectiveTarget } from '@midscene/arm-kit-shared/camera/vision-types';
import type { CameraCorrection } from '@midscene/arm-kit-shared/contracts';

export const BASE_SCREEN_ID = 'base';
export const MAX_CAMERA_SCREENS = 8;

export interface CameraScreenEntry {
  id: string;
  name: string;
  base: boolean;
  hasCorrection: boolean;
  correction?: CameraCorrection;
  perspectiveTarget?: PerspectiveTarget;
}

async function screenRequest(
  url: string,
  options?: RequestInit,
): Promise<unknown> {
  const response = await fetch(url, options);
  const value = (await response.json()) as {
    error?: string | { message?: string };
  };
  if (!response.ok) {
    const message =
      typeof value.error === 'string' ? value.error : value.error?.message;
    throw new Error(message ?? 'Screen request failed');
  }
  return value;
}

export async function fetchCameraScreens(
  cameraId: string,
  signal?: AbortSignal,
): Promise<CameraScreenEntry[]> {
  const value = (await screenRequest(
    `/api/cameras/screens?id=${encodeURIComponent(cameraId)}`,
    { signal },
  )) as { screens?: CameraScreenEntry[] };
  return Array.isArray(value.screens) ? value.screens : [];
}

export async function addCameraScreen(
  cameraId: string,
): Promise<CameraScreenEntry> {
  const value = (await screenRequest('/api/cameras/screens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: cameraId }),
    signal: AbortSignal.timeout(10000),
  })) as { screen: CameraScreenEntry };
  return value.screen;
}

export async function removeCameraScreen(
  cameraId: string,
  screenId: string,
): Promise<void> {
  await screenRequest(
    `/api/cameras/screens?id=${encodeURIComponent(cameraId)}&screen=${encodeURIComponent(screenId)}`,
    { method: 'DELETE', signal: AbortSignal.timeout(10000) },
  );
}

/** Stored names are neutral; translate the default numbered names in the UI. */
export function cameraScreenName(screen: CameraScreenEntry, zh: boolean) {
  const match = /^Screen (\d+)$/.exec(screen.name);
  return match && zh ? `屏幕 ${match[1]}` : screen.name;
}
