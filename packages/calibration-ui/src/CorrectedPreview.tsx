import { CorrectedPreview as VisionCorrectedPreview } from '@midscene/robotics-vision/ui/CorrectedPreview';
import type { ComponentProps } from 'react';
import { t, useCalibrationLanguage } from './i18n';

export function CorrectedPreview(
  props: ComponentProps<typeof VisionCorrectedPreview>,
) {
  useCalibrationLanguage();
  return <VisionCorrectedPreview {...props} translate={t} />;
}
