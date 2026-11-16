import type { PreviewScreenGeometry } from './preview/projection';

export type CameraView = 'raw' | 'corrected';

const PREVIEW_CLIENT_KEY = 'arm-playground-preview-client';

export function cameraPreviewContext({
  cameraId,
  screenId,
  view,
  revision,
  standalone,
  connected,
  session,
  screens,
}: {
  cameraId: string | null;
  screenId?: string;
  view: CameraView;
  revision: number;
  standalone: boolean;
  connected: boolean;
  session?: string;
  screens: readonly PreviewScreenGeometry[];
}) {
  const previewId = view === 'corrected' ? screenId : cameraId;
  const streamContext = [revision, standalone, connected, session];
  return {
    previewId,
    previewKey: JSON.stringify([previewId, view, ...streamContext]),
    // Both projections control the same physical workspace.
    controlContext: JSON.stringify([
      cameraId,
      screenId,
      ...streamContext,
      screens.map((screen) => [
        screen.id,
        screen.calibrationId,
        screen.correction,
        screen.target,
        screen.pixelWidth,
        screen.pixelHeight,
      ]),
    ]),
  };
}

/**
 * Identity of this browser tab, stable across reloads. The server retires the
 * tab's previous MJPEG responses when a new preview opens, which keeps a page
 * refresh or a raw/corrected swap from leaving sockets in the connection pool.
 */
export function previewClientId(): string {
  try {
    const stored = sessionStorage.getItem(PREVIEW_CLIENT_KEY);
    if (stored) return stored;
    const id = crypto.randomUUID();
    sessionStorage.setItem(PREVIEW_CLIENT_KEY, id);
    return id;
  } catch {
    // Storage or crypto can be unavailable; the preview still works.
    return '';
  }
}

export function cameraPreviewUrl(
  id: string,
  view: CameraView = 'raw',
  viewer = 'stage',
) {
  const client = previewClientId();
  return `/api/cameras/preview?id=${encodeURIComponent(id)}&view=${view}${
    client ? `&client=${encodeURIComponent(client)}` : ''
  }&viewer=${encodeURIComponent(viewer)}`;
}
