export interface ScreenSelectionLike {
  id: string;
  cameraId: string;
  hasCorrection?: boolean;
  hasSavedPerspective?: boolean;
  markerSlot?: number;
}

export interface ScreenPageSelectionLike {
  cameraId?: string;
  screenId?: string;
  visible?: boolean;
}

/** Released phones wait for Add Screen or manual pairing when detection reopens. */
export function automaticMarkerPages<
  T extends { id: string; screenId?: string; cameraId?: string; mode?: string },
>(
  pages: readonly T[],
  targetIds: ReadonlySet<string>,
  excludedPageIds: readonly string[] = [],
  pairWaitingPages = false,
): T[] {
  return pages.filter((page) => {
    if (page.screenId && targetIds.has(page.screenId)) return true;
    if (excludedPageIds.includes(page.id)) return false;
    const waitingForAssignment =
      page.cameraId && !page.screenId && page.mode === 'waiting';
    return pairWaitingPages || !waitingForAssignment;
  });
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
        page.visible !== false &&
        (!page.screenId ||
          !cameraScreens.some((screen) => screen.id === page.screenId)),
    )
  );
}

/** QR pairing may have allocated a real target while the dialog was open. */
export function calibrationTargetsAfterPairing(
  screens: readonly ScreenSelectionLike[],
  cameraId: string,
  pages: readonly ScreenPageSelectionLike[],
  previouslyClaimed: ReadonlySet<string>,
) {
  const cameraScreens = selectableScreens(screens, cameraId);
  const knownIds = new Set(cameraScreens.map((screen) => screen.id));
  const visiblePages = pages.filter(
    (page) => page.cameraId === cameraId && page.visible !== false,
  );
  const boundIds = new Set(
    visiblePages.flatMap((page) =>
      page.screenId && knownIds.has(page.screenId) ? [page.screenId] : [],
    ),
  );
  const hasUnboundPage = visiblePages.some(
    (page) => !page.screenId || !knownIds.has(page.screenId),
  );
  const first =
    !cameraScreens.some(
      (screen) => screen.hasCorrection || screen.hasSavedPerspective,
    ) &&
    (previouslyClaimed.size === 0 || (boundIds.size > 0 && !hasUnboundPage));
  return {
    first,
    screenIds: [...boundIds].filter(
      (id) => first || !previouslyClaimed.has(id),
    ),
  };
}
