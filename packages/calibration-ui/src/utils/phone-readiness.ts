import type { ScreenDeviceSummary } from '@midscene/robotics-shared/marker-contracts';
/** A page for a different screen cannot satisfy this camera's saved bindings. */
export function isRequiredPhonePage(
  device: ScreenDeviceSummary,
  cameraId: string | undefined,
  screens: readonly { id: string; pageKey?: string }[] = [],
): boolean {
  if (!cameraId || (device.cameraId && device.cameraId !== cameraId))
    return false;
  if (!screens.length) return device.cameraId === cameraId;
  return screens.some((screen) =>
    device.screenId
      ? device.screenId === screen.id
      : Boolean(screen.pageKey && device.pageKey === screen.pageKey),
  );
}
