interface CalibrationScreenIdentity {
  id: string;
  pageKey?: string;
}

interface CalibrationPageState {
  cameraId?: string;
  mode: 'waiting' | 'markers' | 'mapping';
  pageKey?: string;
  screenId?: string;
  visible: boolean;
}

export function selectOnlineCalibrationScreens<
  T extends CalibrationScreenIdentity,
>(
  screens: readonly T[],
  cameraId: string,
  pages: readonly CalibrationPageState[] | undefined,
) {
  if (!pages) return screens;
  const online = pages.filter(
    (page) =>
      page.visible && page.mode !== 'waiting' && page.cameraId === cameraId,
  );
  return screens.filter((screen) =>
    online.some(
      (page) =>
        page.screenId === screen.id ||
        (Boolean(screen.pageKey) && page.pageKey === screen.pageKey),
    ),
  );
}
