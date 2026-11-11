export interface ScreenSelectionLike {
  id: string;
  cameraId: string;
  hasCorrection?: boolean;
  markerSlot?: number;
}

export interface ScreenPageSelectionLike {
  cameraId?: string;
  screenId?: string;
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

/**
 * The first calibration starts from the phone pages, not a screen target:
 * connect every page for this camera, then create and detect the screens in
 * one pass.
 */
export function needsPhoneConnectionBeforeAddScreen(
  screens: readonly ScreenSelectionLike[],
  cameraId: string,
  pages: readonly ScreenPageSelectionLike[] = [],
): boolean {
  const cameraScreens = selectableScreens(screens, cameraId);
  return (
    !cameraScreens.some((screen) => screen.hasCorrection) ||
    pages.some(
      (page) =>
        page.cameraId === cameraId &&
        (!page.screenId ||
          !cameraScreens.some((screen) => screen.id === page.screenId)),
    )
  );
}
