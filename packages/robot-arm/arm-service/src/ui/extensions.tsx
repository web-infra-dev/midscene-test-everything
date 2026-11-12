import { type ComponentType, createContext, useContext } from 'react';
import type { RobotArmController } from './hooks/useRobotArm';
import type {
  ControllerStateSample,
  RobotFault,
  RobotKinematics,
} from './robot-arm-api';

export interface PlaygroundViews {
  connectionDiagram?: 'ethernet';
  ConnectionForm?: ComponentType<{
    arm: RobotArmController;
    footer: HTMLElement | null;
    onContinue(): void;
  }>;
  JointView?: ComponentType<{
    sample?: ControllerStateSample;
    stale: boolean;
    kinematics?: RobotKinematics;
  }>;
  faultTitle?(fault: RobotFault): string;
  faultText?(fault: RobotFault): { description: string; solution?: string };
}
export const Views = createContext<PlaygroundViews>({});
export const useViews = () => useContext(Views);
