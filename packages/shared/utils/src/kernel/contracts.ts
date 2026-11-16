import type {
  AppliedToolPayload,
  CartesianPose,
  ControllerMotionSettings,
  ControllerMotionSettingsUpdate,
  MotionHandle,
  MotionOptions,
  MotionResult,
  PayloadApplicationSnapshot,
  PayloadConstraints,
  Quaternion,
  RobotFault,
  ToolPayload,
  Workspace,
} from '../contracts.js';

export interface JointDefinition {
  name: string;
  type: 'revolute' | 'prismatic';
  unit: 'degrees' | 'mm';
  limits?: { min: number; max: number; source: string };
}
/**
 * One link of a browser-renderable robot skeleton. It is presentation data, not
 * a motion contract: origins and axes are read-only geometry, and a live joint
 * value is mapped in through `jointIndex`/`jointSign` before any renderer sees
 * it. Units are millimetres/degrees unless `assetUnits` says otherwise.
 */
export interface RobotVisualLink {
  name: string;
  parent?: string;
  /** Shown mesh file under `assetBaseUrl`; a link without one is a frame. */
  mesh?: string;
  /** Position in the parent frame, millimetres. */
  originMm: [number, number, number];
  /** Rotation axis in this link's own frame for a revolute joint. */
  axis?: [number, number, number];
  /** 1-based controller joint index that drives this link. */
  jointIndex?: number;
  jointSign?: number;
  jointOffsetDeg?: number;
  /** Passive link driven by another link, e.g. a parallelogram linkage. */
  mimic?: { link: string; multiplier: number; offsetDeg?: number };
}
export interface RobotVisualModel {
  id: string;
  /** Prefix every `mesh` is resolved against, e.g. `/models/mg400/`. */
  assetBaseUrl: string;
  format: 'glb' | 'stl';
  /** Unit of the mesh coordinates; origins are always millimetres. */
  assetUnits: 'm' | 'mm';
  links: RobotVisualLink[];
  /** Link the ToolProfile is mounted on. */
  toolMountLink: string;
  /**
   * Flange face in the mount link's own frame, millimetres. A URDF link origin
   * often sits above the physical mounting face, so the tool starts here.
   */
  toolMountOffsetMm?: [number, number, number];
  /** Optional ready pose used before the first live sample. */
  homeJointDegrees?: number[];
}
export interface RobotKinematics {
  /** Optional drawing and joint marker coordinates in its view box. */
  schematic?: {
    width: number;
    height: number;
    image: string;
    markers: { x: number; y: number }[];
  };
  jointCount: number;
  joints: JointDefinition[];
  cartesianDof: ('x' | 'y' | 'z' | 'rx' | 'ry' | 'rz')[];
  orientation: 'fixed' | 'yaw' | 'full';
  fixedOrientation?: Quaternion;
  orientationToleranceRadians?: number;
  workspace?: Workspace;
  screenNormalToleranceDegrees?: number;
  /** Optional 3D skeleton; absent means the browser cannot draw this arm. */
  visual?: RobotVisualModel;
}
export interface SampleQuality {
  sampleId: string;
  receivedAt: string;
  source: 'push' | 'polling';
  stale: boolean;
}
export interface MeasuredPose extends SampleQuality {
  pose: CartesianPose;
}
export interface MeasuredJoints extends SampleQuality {
  values: number[];
}
/**
 * A passive, high-rate motion sample for a 3D mirror. Unlike `MeasuredPose` it
 * carries joints only, because a push channel can be trusted for joint angles
 * while its Cartesian vector can disagree with `GetPose`.
 */
export interface RobotMotionSample {
  seq: number;
  /** Host receive time, milliseconds. */
  receivedAt: number;
  /** Controller timestamp when the frame carries one. */
  controllerMs?: number;
  /** Controller joint order, degrees. */
  joints: number[];
  source: 'push' | 'poll';
  stale: boolean;
}
/** Vendor-native diagnostics, independent of measured motion readiness. */
export interface ControllerStateSample {
  vendor: string;
  receivedAt: string;
  raw: Record<string, unknown>;
}
export interface RobotStatus {
  connection: 'connected' | 'disconnected' | 'degraded' | 'unknown';
  authority: 'owned' | 'not-owned' | 'not-required' | 'unknown';
  power: 'on' | 'off' | 'unknown';
  enablement: 'enabled' | 'disabled' | 'unknown';
  motion: 'idle' | 'moving' | 'paused' | 'stopping' | 'unknown';
  operationMode: 'automatic' | 'manual' | 'teach' | 'backdrive' | 'unknown';
  emergencyStop: 'active' | 'inactive' | 'unknown';
  protectiveStop: 'active' | 'inactive' | 'unknown';
  faults: RobotFault[];
  quality: SampleQuality;
  pose?: MeasuredPose;
  joints?: MeasuredJoints;
  vendorMode?: string;
}
export interface ReadinessPolicy {
  maxStateAgeMs: number;
  required: (
    | 'authority'
    | 'power'
    | 'operationMode'
    | 'emergencyStop'
    | 'protectiveStop'
  )[];
}
export interface RobotDriver {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Stop physical motion, including when the SDK shuts down a connected arm. */
  stop(): Promise<void>;
  getState(options?: { fresh?: boolean }): Promise<RobotStatus>;
  readControllerState?(): Promise<ControllerStateSample>;
  readMotionSettings?(): Promise<ControllerMotionSettings>;
  updateMotionSettings?(
    request: ControllerMotionSettingsUpdate,
  ): Promise<ControllerMotionSettings>;
  readPayloadApplication?(): PayloadApplicationSnapshot;
  readPose?(options?: { fresh?: boolean }): Promise<MeasuredPose>;
  readJoints?(options?: { fresh?: boolean }): Promise<MeasuredJoints>;
  moveLinear?(
    pose: CartesianPose,
    options: MotionOptions,
  ): Promise<MotionHandle>;
  beginLinearSequence?(
    targets: readonly LinearSequenceTarget[],
    options: LinearSequenceOptions,
  ): Promise<LinearMotionSequence>;
  movePtp?(pose: CartesianPose, options: MotionOptions): Promise<MotionHandle>;
  moveJoints?(values: number[], options: MotionOptions): Promise<MotionHandle>;

  enable?(): Promise<void>;
  enableWithPayload?(payload: ToolPayload): Promise<void>;
  appliedPayload?(): AppliedToolPayload | undefined;
  applyPayload?(payload: ToolPayload): Promise<void>;
  disable?(): Promise<void>;
  clearFaults?(): Promise<void>;
  enterDragMode?(): Promise<void>;
  exitDragMode?(): Promise<void>;
  startJog?(target: JogTarget): Promise<void>;
  stopJog?(): Promise<void>;
  pause?(): Promise<void>;
  resume?(): Promise<void>;
  emergencyStop?(): Promise<void>;
  forwardKinematics?(values: number[]): Promise<CartesianPose>;
  inverseKinematics?(pose: CartesianPose): Promise<number[]>;
  checkReachability?(pose: CartesianPose): Promise<void>;
}
export interface MotionConstraints {
  speed: Partial<
    Record<
      NonNullable<MotionOptions['speed']>['kind'],
      { min: number; max: number }
    >
  >;
  acceleration: Partial<
    Record<
      NonNullable<MotionOptions['acceleration']>['kind'],
      { min: number; max: number }
    >
  >;
}
export interface CapabilityDescriptor {
  payload?: PayloadConstraints;
  payloadApplication?: { requiresDisabled: boolean };
  id: string;
  version: number;
  implementation: 'native' | 'emulated';
  constraints?: MotionConstraints;
}
export interface LinearSequenceTarget {
  readonly pose: CartesianPose;
  readonly options: MotionOptions;
}
export interface MotionReceipt {
  readonly id: string;
  readonly acceptedAt: number;
  readonly submittedAt: number;
}
export interface CartesianHandoff {
  readonly candidateReachedAt: number;
  readonly confirmedAt: number;
  readonly pose: CartesianPose;
}
export interface LinearSequenceOptions {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}
/** A command receipt is not a terminal result. Only finish confirms the tail. */
export interface LinearMotionSequence {
  /** Indices increase; skipping a prevalidated intermediate target is allowed. */
  submit(index: number, mode?: 'feedback' | 'terminal'): Promise<MotionReceipt>;
  waitForHandoff(): Promise<CartesianHandoff>;
  /** Drain the current command before a conservative release. */
  waitForCurrent(): Promise<MotionResult>;
  /** Passive readiness check; never issues a controller query. */
  check(): void;
  finish(): Promise<MotionResult>;
  /** Release only before submission, after finish, or after confirmed Stop. */
  dispose(): void;
}
export interface RobotArmAdapter {
  readonly contractVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly connectionIdentity: string;
  readonly driver: RobotDriver;
  readonly kinematics: RobotKinematics;
  readonly readinessPolicy: ReadinessPolicy;
  /** Optional screen action defaults for this model. Installation geometry is always measured. */
  readonly setupDefaults?: import('../setup-contracts.js').RobotSetupDefaults;
  readonly motionLimits?: Partial<
    Record<'linear' | 'linearSequence' | 'ptp' | 'joints', MotionConstraints>
  >;
  readonly payloadLimits?: PayloadConstraints;
  readonly payloadRequiresDisabled?: boolean;
  feedbackStatus?(): import('../contracts.js').RobotArmFeedbackStatus;
  /**
   * Latest passive tool-vector sample from a push channel, with the host time
   * the frame arrived. Implementations must never issue a controller command
   * here: callers poll it while a motion is in flight, so a query would compete
   * with the driver's own confirmation. Returning undefined means no push
   * channel is available and the caller must fall back to motion results.
   */
  latestToolVectorSample?():
    | { pose: CartesianPose; receivedAt: number }
    | undefined;
  /**
   * Latest passive joint sample for a 3D mirror. Implementations must not issue
   * a controller command here; callers poll it at render rate.
   */
  latestMotionSample?(): RobotMotionSample | undefined;
}
/**
 * One direction of continuous jog. `axisID` values follow the controller
 * protocol: X/Y/Z/R for Cartesian axes and J1..J4 for joints.
 */
export type JogTarget =
  | { axis: 'x' | 'y' | 'z' | 'r'; direction: 1 | -1 }
  | { joint: number; direction: 1 | -1 };
export type MotionRequest = {
  requestId: string;
  robotProfileId: string;
  timeoutMs: number;
  options: MotionOptions;
} & (
  | { kind: 'linear' | 'ptp'; target: CartesianPose }
  | { kind: 'joints'; target: number[] }
  | { kind: 'jog'; axis: 'x' | 'y' | 'z'; deltaMm: number }
  | { kind: 'joint-jog'; joint: number; delta: number }
);
export interface ReadinessResult {
  ready: boolean;
  reasons: string[];
}
