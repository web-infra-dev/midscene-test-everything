import type { CameraFrame } from '@midscene/robotics-vision/camera/types';
import type { CalibrationPageLayout } from '../assisted-contracts.js';

export * from '@midscene/robotics-vision/camera/types';

export interface PerspectiveReferenceFrame extends CameraFrame {
  pageLayout?: CalibrationPageLayout;
}
