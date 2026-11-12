const PREVIEW_CLIENT_KEY = 'arm-playground-preview-client';

/** Stable id of this browser tab, shared with the Playground camera previews. */
export function previewClientId(): string {
  try {
    const stored = sessionStorage.getItem(PREVIEW_CLIENT_KEY);
    if (stored) return stored;
    const id = crypto.randomUUID();
    sessionStorage.setItem(PREVIEW_CLIENT_KEY, id);
    return id;
  } catch {
    return '';
  }
}

/**
 * One calibration camera preview URL. The viewer names the UI slot so the host
 * can retire that slot's previous MJPEG response on a re-render without
 * touching a live editor, corrected preview or another tab.
 */
export function cameraPreviewUrl(base: string, viewer: string) {
  const client = previewClientId();
  const params = new URLSearchParams();
  if (client) params.set('client', client);
  params.set('viewer', viewer);
  return `${base}/camera/preview?${params.toString()}`;
}

/** The raw image is shared by all screens observed by this camera. */
export function rawCameraPreviewUrl(cameraId: string, viewer: string) {
  const params = new URLSearchParams({ id: cameraId, view: 'raw', viewer });
  const client = previewClientId();
  if (client) params.set('client', client);
  return `/api/cameras/preview?${params}`;
}
