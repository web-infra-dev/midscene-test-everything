import { useEffect } from 'react';
import {
  GuidedCalibrationWorkspace,
  useCalibrationLanguage,
} from '../calibration';
import { usePreferences } from '../i18n';
export function DeviceCalibration({
  id,
  cameraId = id,
  onClose,
  onScreenChange,
  initialStep,
}: {
  id: string;
  cameraId?: string;
  onClose(screenId?: string): void;
  onScreenChange(id: string): void;
  initialStep?: 0 | 1;
}) {
  const language = usePreferences((state) => state.language);
  useEffect(
    () => useCalibrationLanguage.getState().setLanguage(language),
    [language],
  );
  return (
    <GuidedCalibrationWorkspace
      id={id}
      cameraId={cameraId}
      onClose={onClose}
      onScreenChange={onScreenChange}
      initialStep={initialStep}
    />
  );
}
