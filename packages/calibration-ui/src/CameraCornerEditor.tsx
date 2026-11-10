import { CameraCornerEditor as VisionCameraCornerEditor } from '@midscene/robotics-vision/ui/CameraCornerEditor';
import type { ComponentProps } from 'react';
import { t, useCalibrationLanguage } from './i18n';

export function CameraCornerEditor(
  props: ComponentProps<typeof VisionCameraCornerEditor>,
) {
  useCalibrationLanguage();
  return <VisionCameraCornerEditor {...props} translate={t} />;
}
