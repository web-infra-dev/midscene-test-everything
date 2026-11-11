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

/** Add Screen calibrates a draft target; it is not mounted until committed. */
export function screensWithoutDraft<T extends { id: string }>(
  screens: readonly T[],
  draftId: string | undefined,
): T[] {
  return draftId
    ? screens.filter((screen) => screen.id !== draftId)
    : [...screens];
}
