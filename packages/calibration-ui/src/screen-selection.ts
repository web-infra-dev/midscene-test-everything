export interface ScreenSelectionLike {
  cameraId: string;
  hasCorrection?: boolean;
  markerSlot?: number;
}

/**
 * Screens the camera-mapping step may select. A target exists as soon as Add
 * Screen persists it; it only gains `hasCorrection`/`markerSlot` after a
 * calibration pass, so both lists must start from the persisted target set.
 */
export function selectableScreens<T extends ScreenSelectionLike>(
  screens: readonly T[],
  cameraId: string,
): T[] {
  return screens.filter((screen) => screen.cameraId === cameraId);
}
