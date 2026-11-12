/** Vendor adapter authoring API. Does not expose the Device runtime or profile store. */
export type {
  RobotArmAdapter,
  RobotDriver,
  RobotKinematics,
  MotionConstraints,
  JointDefinition,
  ControllerStateSample,
  JogTarget,
  LinearSequenceOptions,
  LinearSequenceTarget,
  LinearMotionSequence,
  MotionReceipt,
  CartesianHandoff,
  RobotStatus,
  SampleQuality,
  MeasuredPose,
  MeasuredJoints,
  ReadinessPolicy,
} from './kernel/contracts.js';
export type {
  CartesianPose,
  MotionHandle,
  MotionOptions,
  MotionResult,
  RobotArmCapabilities,
  RobotArmFeedbackStatus,
  RobotState,
  ToolPayload,
  RobotFault,
  ControllerMotionSettings,
  ControllerMotionSettingsUpdate,
} from './contracts.js';
export {
  RobotArmError,
  isRobotArmError,
  SCREEN_TILT_LIMIT_DEGREES,
} from './contracts.js';
export type { RobotRemoteControlMode } from './setup-contracts.js';
export {
  assertPose,
  assertSpeed,
  distance,
  quaternionDistance,
  yawQuaternion,
} from './domain/geometry.js';
export {
  createLinearMotionSequence,
  type SequenceFeedback,
} from './driver/linear-sequence.js';
export { createMotionHandle } from './driver/motion-handle.js';
export { PayloadApplicationTracker } from './driver/payload-application.js';
export { validateMotionOptions } from './kernel/motion.js';
export {
  robotSetupDefaults,
  type RobotSetupDefaults,
} from './setup-contracts.js';
