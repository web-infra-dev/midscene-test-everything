import type {
  CartesianPose,
  MotionOptions,
  RobotArmProfile,
  ScreenProfile,
  ToolProfile,
} from '../contracts.js';
export interface ApplicationContext {
  installationTeaching?: import('../contracts.js').InstallationTeaching;
  minimumTravelTipZMm?: number;
  robot: RobotArmProfile;
  tool: ToolProfile;
  screen: ScreenProfile;
}
export interface MotionTarget {
  name: string;
  pose: CartesianPose;
  options: MotionOptions;
}
