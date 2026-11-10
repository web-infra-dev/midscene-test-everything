export type CameraView = 'raw' | 'corrected';
export function cameraPreviewUrl(
  id: string,
  view: CameraView = 'raw',
  screenId?: string,
) {
  return `/api/cameras/preview?id=${encodeURIComponent(id)}&view=${view}${
    screenId ? `&screen=${encodeURIComponent(screenId)}` : ''
  }`;
}
