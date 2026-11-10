import {
  CALIBRATION_CLICK_COUNT,
  CALIBRATION_CLICK_RADIUS_PX,
  CALIBRATION_CLICK_REQUIRED,
} from './assisted-contracts.js';
import type { PerspectiveValiditySummary } from './camera/perspective-validity.js';
/** Browser-safe public protocol. Native units and frames belong in adapters. */
export * from './kernel/contracts.js';
export * from './setup-contracts.js';
export type * from './assisted-contracts.js';
export {
  calibrationPageMarkers,
  CALIBRATION_CLICK_RADIUS_PX,
  CALIBRATION_CLICK_COUNT,
  CALIBRATION_CLICK_REQUIRED,
  CALIBRATION_POINT_POLICY,
  CALIBRATION_PHONE_PATH,
  CALIBRATION_PHONE_POLICY,
} from './assisted-contracts.js';
import type { RobotStatus } from './kernel/contracts.js';
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}
export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}
export interface CartesianPose {
  positionMm: Vector3;
  orientation: Quaternion;
  frame: 'base';
}
export type Pose = CartesianPose;
export type MotionSpeed =
  | { kind: 'ratio'; value: number }
  | { kind: 'linear'; mmPerSecond: number }
  | { kind: 'angular'; degreesPerSecond: number }
  | { kind: 'joints'; valuesPerSecond: number[] };
export type MotionAcceleration =
  | { kind: 'ratio'; value: number }
  | { kind: 'linear'; mmPerSecondSquared: number }
  | { kind: 'angular'; degreesPerSecondSquared: number }
  | { kind: 'joints'; valuesPerSecondSquared: number[] };
export interface MotionOptions {
  speed?: MotionSpeed;
  acceleration?: MotionAcceleration;
  /**
   * How many consecutive fresh samples must confirm arrival before a driver
   * reports terminal completion. Every extra sample of a contact move is spent
   * with the tool already on the glass, which a phone reads as a longer press,
   * so screen contact asks for one. Absent keeps the driver's own default.
   */
  arrivalSamples?: number;
}
/**
 * How a contact move confirms that it arrived. A screen-press move is the one
 * place where confirmation cost is also user-visible press time, so it asks for
 * less confirmation than the default and skips the runtime's own dwell.
 */
export interface ContactMoveOptions {
  /** Fresh samples the driver must see before it reports arrival. */
  arrivalSamples?: number;
  /** Skip the runtime's own stability dwell; the driver already confirmed. */
  skipStable?: boolean;
}
export interface MotionResult {
  status: 'completed' | 'stopped' | 'cancelled' | 'failed';
  completedAt: string;
  submittedAt?: number;
  /**
   * Host-clock milliseconds of the first fresh sample that showed the target
   * reached, when the driver can observe arrival before its own terminal
   * confirmation. Screen timing uses it as a press-window anchor; absent means
   * only the completion time is available as evidence.
   */
  arrivedAt?: number;
  /**
   * Pose the driver measured when it confirmed the move. It lets a caller that
   * skipped its own stability dwell still record a measured arrival pose.
   */
  pose?: CartesianPose;
  fault?: RobotFault;
}
export interface MotionHandle {
  id: string;
  acceptedAt: string;
  wait(options?: {
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<MotionResult>;
}
export interface RobotFault {
  /** One-based joint index, or the mechanism affected by this alarm. */
  affected?: { joint: number } | { mechanism: string };
  limitDirection?: 'positive' | 'negative';
  code: string;
  message: string;
  recoverable: boolean;
  category?: 'communication' | 'motion' | 'safety' | 'controller';
  severity?: 'warning' | 'error' | 'fatal';
  vendorCode?: string | number;
  /** Controller-supplied alarm text, when the vendor catalog covers this code.
   * `message` stays the English fallback so callers that cannot localize still
   * get a description.
   */
  description?: { en: string; zh?: string };
  /** Controller-supplied remedy for this alarm, when the catalog has one. */
  solution?: { en: string; zh?: string };
  /** Controller alarm level, shown verbatim as the robot's own alarm table does. */
  level?: number;
  raw?: unknown;
}
/** Application/UI summary derived from the orthogonal Driver status. */
export interface RobotState {
  status?: RobotStatus;
  connected: boolean;
  enabled: boolean;
  moving: boolean;
  dragMode: boolean;
  mode: string;
  pose?: CartesianPose;
  faults: RobotFault[];
  /**
   * UI projection of Driver motion=paused. Use status and readiness policy
   * for actual motion authorization; absent signals are never inferred safe.
   */
  paused?: boolean;
  updatedAt: string;
}
export interface Workspace {
  min: Vector3;
  max: Vector3;
}
export interface RobotArmCapabilities {
  jointCount: number;
  orientation: 'fixed' | 'yaw' | 'full';
  fixedOrientation?: Quaternion;
  orientationToleranceRadians?: number;
  cartesianDof?: ('x' | 'y' | 'z' | 'rx' | 'ry' | 'rz')[];
  measuredCartesian?: boolean;
  ptp: boolean;
  linear: boolean;
  dragMode: boolean;
  stop: boolean;
  speedModes: readonly MotionSpeed['kind'][];
  accelerationModes?: readonly MotionAcceleration['kind'][];
  maxLinearSpeedMmPerSecond?: number;
  workspace?: Workspace;
  /**
   * Tilt installed on this adapter, in degrees, between the fitted screen normal
   * and the tool's contact direction. It applies to restricted-orientation
   * (fixed/yaw) adapters only, because they keep the declared tool direction, so
   * the screen has to suit the tool. A full-orientation arm aligns to the fitted
   * plane and must not declare one.
   *
   * Restricted-orientation adapters declare SCREEN_TILT_LIMIT_DEGREES. Installing
   * a screen flatter than that is encouraged; installing one steeper is not
   * supported, and there is deliberately no per-installation way to raise it.
   */
  screenNormalToleranceDegrees?: number;
}
/**
 * Tilt a restricted-orientation arm accepts between the fitted screen normal and
 * the tool's contact direction, in degrees.
 *
 * One repository-wide value on purpose. Installation discipline is what keeps a
 * four-axis screen usable: the tool direction is fixed, so a screen built steeper
 * than this cannot be calibrated, and no Profile, adapter configuration or
 * environment variable may raise it. Changing it is a reviewed change to this
 * file, and it applies to every restricted-orientation arm at once.
 */
export const SCREEN_TILT_LIMIT_DEGREES = 6;
export type ScreenActionType = 'tap' | 'longPress' | 'swipe' | 'dragAndDrop';
export type CalibrationKind = 'restrictedPlane' | 'spatialPlane';
export interface EffectiveCapabilities extends RobotArmCapabilities {
  setupDefaults?: import('./setup-contracts.js').RobotSetupDefaults;
  payload?: PayloadConstraints;
  payloadApplication?: { requiresDisabled: boolean };
  /**
   * The tilt limit calibration enforces right now, resolved from the Adapter's
   * configuration. Published so an installation can read back what a
   * configuration change actually took effect as.
   */
  effectiveScreenTiltLimitDegrees: number;
  controls: string[];
  descriptors: import('./kernel/contracts.js').CapabilityDescriptor[];
  kinematics: import('./kernel/contracts.js').RobotKinematics;
  readinessPolicy: import('./kernel/contracts.js').ReadinessPolicy;
  screenActions: ScreenActionType[];
  calibration: CalibrationKind[];
}
/** Diagnostics for an Adapter's optional push (realtime) actual-state source. */
export interface RobotArmFeedbackStatus {
  /** Source that a fresh actual-state read currently uses. */
  source: 'push' | 'polling';
  /** True while the push channel is connected, regardless of frame freshness. */
  available: boolean;
  /** ISO timestamp of the last accepted push frame. */
  lastFrameAt?: string;
  /** Age in milliseconds of the newest push frame at read time. */
  frameAgeMs?: number;
  /**
   * Age in milliseconds of the cached dashboard state sample that `getState()`
   * may return without re-querying. Absent when the Adapter does not bound its
   * state reads this way, or before the first sample exists.
   */
  stateSampleAgeMs?: number;
  /** Why push feedback is not in use; absent while source is 'push'. */
  reason?: string;
  /** Most recent push-channel failure, including a rejected frame. */
  lastError?: string;
  poseSource?: 'push' | 'polling';
  poseReason?: string;
}
export interface VersionedProfile {
  id: string;
  name: string;
  revision: number;
  geometryRevision: number;
  updatedAt: string;
}
export interface RobotArmProfile extends VersionedProfile {
  adapterId: string;
  connectionIdentity: string;
  installation: string;
  workspace?: Workspace;
  jointBounds?: { min: number; max: number }[];
}
export interface ToolProfile extends VersionedProfile {
  offsetMm: Vector3;
  contactDirection: Vector3;
  payload?: ToolPayload;
}
export interface ToolPayload {
  massKg: number;
  inertiaKgM2?: number;
}
export interface PayloadConstraints {
  massKg: { min: number; max: number };
  inertiaKgM2?: { min: number; max?: number };
}
/** Evidence of controller configuration, not a measurement of physical tool mass. */
export interface AppliedToolPayload {
  payload: ToolPayload;
  confirmedAt: string;
  source?: 'command-completion' | 'controller-readback';
}
export type PayloadInvalidationReason =
  | 'service-start'
  | 'not-applied'
  | 'disabled'
  | 'disconnected'
  | 'connection-lost'
  | 'controller-restarted'
  | 'state-unavailable'
  | 'application-failed'
  | 'application-interrupted'
  | 'emergency-stop'
  | 'stop-unconfirmed'
  | 'readback-unavailable'
  | 'inertia-unconfirmed';
/** Passive driver evidence, scoped to this process and configuration generation. */
export interface PayloadApplicationSnapshot {
  status: 'confirmed' | 'unconfirmed' | 'applying';
  sessionId: string;
  generation: number;
  updatedAt: string;
  applied?: AppliedToolPayload;
  reason?: PayloadInvalidationReason;
}
export interface PayloadApplicationState {
  status:
    | 'not-required'
    | 'missing'
    | 'pending'
    | 'applied'
    | 'unconfirmed'
    | 'applying';
  requiresDisabled: boolean;
  reason?: PayloadInvalidationReason | 'parameters-changed';
  applied?: AppliedToolPayload;
  snapshot?: PayloadApplicationSnapshot;
}
export interface EnableRequest {
  robotProfileId: string;
  toolProfileId: string;
  toolRevision: number;
}
export function assertToolPayload(
  payload: ToolPayload | undefined,
  limits?: PayloadConstraints,
): asserts payload is ToolPayload {
  if (
    !payload ||
    !Number.isFinite(payload.massKg) ||
    payload.massKg < (limits?.massKg.min ?? 0) ||
    payload.massKg > (limits?.massKg.max ?? Number.POSITIVE_INFINITY)
  )
    throw new RobotArmError(
      'INVALID_PAYLOAD',
      'Enter the measured end-effector mass within the adapter range.',
      400,
    );
  if (
    payload.inertiaKgM2 !== undefined &&
    (!Number.isFinite(payload.inertiaKgM2) ||
      payload.inertiaKgM2 < (limits?.inertiaKgM2?.min ?? 0) ||
      payload.inertiaKgM2 >
        (limits?.inertiaKgM2?.max ?? Number.POSITIVE_INFINITY) ||
      (limits && !limits.inertiaKgM2))
  )
    throw new RobotArmError(
      'INVALID_PAYLOAD',
      'Enter a supported measured payload inertia, or leave it unset.',
      400,
    );
}
export function sameToolPayload(
  a: ToolPayload | undefined,
  b: ToolPayload | undefined,
) {
  return Boolean(
    a &&
      b &&
      Math.abs(a.massKg - b.massKg) <= 0.000001 &&
      a.inertiaKgM2 === b.inertiaKgM2,
  );
}
/** Shared by server preflight/readiness and the console's selected Tool Profile. */
export function evaluatePayloadApplication(input: {
  limits?: PayloadConstraints;
  requiresDisabled?: boolean;
  payload?: ToolPayload;
  snapshot?: PayloadApplicationSnapshot;
  applied?: AppliedToolPayload;
  connected?: boolean;
  enabled?: boolean;
  stale?: boolean;
}): PayloadApplicationState {
  const base = {
    requiresDisabled: input.requiresDisabled ?? true,
    snapshot: input.snapshot,
  };
  if (!input.limits) return { ...base, status: 'not-required' };
  try {
    assertToolPayload(input.payload, input.limits);
  } catch {
    return { ...base, status: 'missing' };
  }
  if (input.connected === false || input.stale)
    return {
      ...base,
      status: 'unconfirmed',
      reason: input.connected === false ? 'disconnected' : 'state-unavailable',
    };
  if (input.snapshot?.status === 'applying')
    return { ...base, status: 'applying' };
  const applied = input.snapshot
    ? input.snapshot.status === 'confirmed'
      ? input.snapshot.applied
      : undefined
    : input.applied;
  if (input.enabled === false && applied)
    return { ...base, status: 'unconfirmed', reason: 'disabled' };
  if (
    applied?.source === 'controller-readback' &&
    input.payload.inertiaKgM2 !== undefined &&
    sameToolPayload({ massKg: input.payload.massKg }, applied.payload)
  )
    return { ...base, status: 'unconfirmed', reason: 'inertia-unconfirmed' };
  if (applied)
    return {
      ...base,
      applied,
      status: sameToolPayload(input.payload, applied.payload)
        ? 'applied'
        : 'pending',
      reason: sameToolPayload(input.payload, applied.payload)
        ? undefined
        : 'parameters-changed',
    };
  const reason = input.snapshot?.reason ?? 'not-applied';
  return {
    ...base,
    status: reason === 'not-applied' ? 'pending' : 'unconfirmed',
    reason,
  };
}
export interface ScreenMotionSettings {
  pressDepthMm: number;
  safeHeightMm: number;
  actionSpeed: MotionSpeed;
  actionAcceleration: MotionAcceleration;
  /**
   * Target duration of a tap press, closed loop from the moment the tool
   * physically reaches the screen. It is a window, not a wait: arrival
   * confirmation already spent counts against it.
   */
  contactMs: number;
  /** Endpoint hold after a swipe; zero requests immediate release. */
  swipeEndpointHoldMs: number;
  /** Default long-press duration; an explicit per-call duration still wins. */
  longPressMs: number;
  /**
   * Endpoint hold of a drag, kept separate from a tap's press target because a
   * drag's traverse is intended travel and must not be charged as press time.
   */
  dragHoldMs: number;
  /**
   * Speed and acceleration factors for the exit segment, which is the segment
   * that releases the screen. Short travel is acceleration-limited, so these are
   * the levers that decide how quickly the tool leaves the glass.
   */
  releaseSpeedFactor: number;
  releaseAccelerationFactor: number;
  /**
   * How early the segment after a target-mode hold may be dispatched, to absorb
   * command latency. Ignored for a long press, whose hold must not be shortened.
   */
  successorStartLeadMs: number;
  motionTimeoutMs: number;
}
export interface ScreenImageSettings {
  /** Independent corrected-image → calibration viewport mapping. */
  phoneMapping?: {
    imageToPhone: number[];
    width: number;
    height: number;
    visionFingerprint: string;
  };
  /** Omit both dimensions until the screen-to-image mapping is configured. */
  pixelWidth?: number;
  pixelHeight?: number;
}
export interface ScreenPhysicalSettings {
  physicalWidthMm: number;
  physicalHeightMm: number;
  direction: string;
}
export interface ScreenProfile
  extends VersionedProfile,
    ScreenPhysicalSettings,
    ScreenImageSettings,
    ScreenMotionSettings {
  visionTarget?: { cameraId: string; screenId: string };
}
/** Screen operations require a complete pixel mapping, unlike Profile storage. */
export type MappedScreenProfile = ScreenProfile & {
  pixelWidth: number;
  pixelHeight: number;
};
export function hasScreenMapping<
  T extends {
    pixelWidth?: unknown;
    pixelHeight?: unknown;
  },
>(
  screen: T | undefined,
): screen is T & { pixelWidth: number; pixelHeight: number } {
  return Boolean(
    screen &&
      typeof screen.pixelWidth === 'number' &&
      typeof screen.pixelHeight === 'number' &&
      Number.isInteger(screen.pixelWidth) &&
      screen.pixelWidth >= 2 &&
      Number.isInteger(screen.pixelHeight) &&
      screen.pixelHeight >= 2,
  );
}
export function assertScreenMapping<
  T extends {
    pixelWidth?: unknown;
    pixelHeight?: unknown;
  },
>(
  screen: T,
): asserts screen is T & { pixelWidth: number; pixelHeight: number } {
  if (!hasScreenMapping(screen))
    throw new RobotArmError(
      'SCREEN_MAPPING_REQUIRED',
      'Screen actions require image dimensions of at least 2 × 2. Mechanical calibration does not require image dimensions.',
      409,
    );
}
export type ProfileInput<T extends VersionedProfile> = Omit<
  T,
  'revision' | 'geometryRevision' | 'updatedAt'
> & { revision?: number };
export interface ProfileBinding {
  robotProfileId: string;
  toolProfileId: string;
  screenProfileId: string;
}
/** Operates on an explicitly selected, unchanged mechanical calibration. */
export interface SafePositionRequest extends ProfileBinding {
  requestId: string;
  calibrationProfileId: string;
  revision: number;
  mode: 'return' | 'record';
}
/** Local contact-height corrections; coordinates are screen millimeters. */
interface LocalSurfaceCompensation {
  kind: 'local';
  patches: { x: number; y: number; depthMm: number; radiusMm: number }[];
}
export type ScreenSurfaceCompensation =
  | LocalSurfaceCompensation
  | {
      kind: 'sampled';
      widthMm: number;
      heightMm: number;
      limitMm: number;
      samples: { x: number; y: number; depthMm: number; weight: number }[];
      /** Later, independently verified local repairs override the sampled surface. */
      patches: LocalSurfaceCompensation['patches'];
    };
export interface CalibrationProfile extends ProfileBinding {
  /** Absent on legacy viewport fits; upstream exploration fits full-screen pixels. */
  geometryFrame?: 'screen';
  /** Mechanical geometry spans this phone viewport, independent of camera pixels. */
  phoneFrame: { width: number; height: number };
  id: string;
  kind: CalibrationKind;
  geometryStatus: 'valid' | 'invalid';
  acceptanceStatus: 'pending' | 'accepted';
  robotGeometryRevision: number;
  toolGeometryRevision: number;
  screenGeometryRevision: number;
  screenRevision: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  origin: Vector3;
  xAxis: Vector3;
  yAxis: Vector3;
  inward: Vector3;
  orientation: Quaternion;
  plane: { normal: Vector3; offset: number };
  surface?: ScreenSurfaceCompensation;
  observationPose: CartesianPose;
  quality: PlaneQuality;
  invalidReason?: string;
  verification?: CalibrationVerification;
}
export interface BoundaryVerification {
  contactCorners?: boolean;
  contactEdges?: boolean;
  hoverCorners: boolean;
  hoverEdges: boolean;
  hoverHuman: boolean;
}
export interface CalibrationVerification {
  protocol: 'web-v1' | 'auto-boundary-v1';
  web?: import('./assisted-contracts.js').WebVerificationEvidence;
  boundary?: BoundaryVerification;
  auto?: AutoCalibrationEvidence & {
    humanAccepted: boolean;
    automaticAccepted?: boolean;
  };
  hoverMotion: boolean;
  hoverHuman: boolean;
  confirmedAt: string;
}
export interface AutoCalibrationEvidence {
  planeSource?: string;
  planeRmseMm: number;
  gridRmsPx: number;
  gridRmsMm: number;
  validationRmsPx: number;
  validationMaxPx: number;
  validationMaxMm: number;
  coverage: number;
  surfaceMaxMm?: number;
  samples: {
    screen: { x: number; y: number };
    planeMm: { x: number; y: number };
    zMm: number;
  }[];
}
export interface PlaneQuality {
  rmseMm: number;
  inliers: number;
  total: number;
  minorSpanMm: number;
  majorSpanMm: number;
}
export type InstallationTeachingPoint = 'reference' | 'cameraBoundary';
/** Measured mounting, shared by screens on the same robot/tool/camera. */
export interface InstallationTeaching {
  invalidatedReason?: string;
  id: string;
  recordedAt: string;
  referenceDeviceId?: string;
  robotProfileId: string;
  toolProfileId: string;
  cameraId: string;
  robotGeometryRevision: number;
  toolGeometryRevision: number;
  referencePose: CartesianPose;
  poses: Record<InstallationTeachingPoint, CartesianPose>;
  cameraBoundary: { point: ScreenPoint; normal: ScreenPoint };
  corridorConfirmed: true;
}
export type CameraImageEdge = 'top' | 'right' | 'bottom' | 'left';
export interface CameraAvoidanceEstimate {
  direction: ScreenPoint;
  confidence: number;
  horizontalSkew: number;
  verticalSkew: number;
  source: 'installation-teaching' | 'source-image-edge' | 'perspective-quad';
  nearImageEdge?: CameraImageEdge;
}
export interface InstallationTeachingDraft {
  id: string;
  context: string;
  robotProfileId: string;
  toolProfileId: string;
  screenProfileId: string;
  cameraId: string;
  poses: Partial<Record<InstallationTeachingPoint, CartesianPose>>;
}
export interface ProfileData {
  screenPages?: {
    id: string;
    pageKey: string;
    token: string;
    name: string;
    cameraId?: string;
    targetId?: string;
  }[];
  installationTeachingDrafts?: InstallationTeachingDraft[];
  installationTeachings?: InstallationTeaching[];
  screenTargets?: {
    id: string;
    cameraId: string;
    name: string;
    pageKey?: string;
    markerSlot?: number;
    archived?: boolean;
  }[];
  calibrationBatch?: import('./assisted-contracts.js').CalibrationBatchState;
  format: 'midscene.robot-arm.profiles';
  schemaVersion: 1;
  softwarePaused?: boolean;
  pendingOperation?: { requestId: string; kind: string; startedAt: string };
  robots: RobotArmProfile[];
  tools: ToolProfile[];
  screens: ScreenProfile[];
  calibrations: CalibrationProfile[];
  sessions?: CalibrationSession[];
  workstation?: WorkstationBinding;
  devices?: DeviceBinding[];
  /** Measured setup preferences only; never an accepted calibration or motion permission. */
  calibrationSetups?: {
    deviceId: string;
    robotProfileId: string;
    toolProfileId: string;
    cameraId: string;
    width: number;
    height: number;
    autoOutput: boolean;
    motion?: ScreenMotionSettings;
  }[];
}
export interface WorkstationBinding extends ProfileBinding {
  revision: number;
  calibrationProfileId: string;
  cameraId: string;
  vision?: VisionBinding & { confirmedAt: string };
}
export interface DeviceBinding extends WorkstationBinding {
  deviceId: string;
  vision: VisionBinding & { confirmedAt: string };
}
export interface WorkstationIssue {
  code: string;
  area: 'configuration' | 'mechanical' | 'vision' | 'hardware';
  message: string;
  action:
    | 'setup'
    | 'calibration'
    | 'verify'
    | 'vision'
    | 'recover'
    | 'payload'
    | 'connect';
}
export interface WorkstationState {
  binding?: WorkstationBinding;
  ready: boolean;
  contextKey?: string;
  issues: WorkstationIssue[];
  checks: Record<WorkstationIssue['area'], boolean>;
  vision?: VisionBinding;
}
/** Accept only the current phone-frame workflow; historical formats require recalibration. */
export function calibrationAccepted(
  c: CalibrationProfile | undefined,
): boolean {
  const v = c?.verification;
  if (v?.protocol === 'auto-boundary-v1') {
    const b = v.boundary;
    return Boolean(
      c?.observationPose &&
        c.geometryStatus === 'valid' &&
        c.acceptanceStatus === 'accepted' &&
        Number.isFinite(Date.parse(v.confirmedAt)) &&
        b &&
        [b.hoverCorners, b.hoverEdges, b.contactCorners, b.contactEdges].every(
          (value) => value === true,
        ) &&
        (v.auto?.humanAccepted === true || v.auto?.automaticAccepted === true),
    );
  }
  const web = v?.web;
  if (
    !c ||
    c.geometryStatus !== 'valid' ||
    c.acceptanceStatus !== 'accepted' ||
    !c.phoneFrame ||
    !v ||
    v.protocol !== 'web-v1' ||
    !v.hoverMotion ||
    !v.hoverHuman ||
    !Number.isFinite(Date.parse(v.confirmedAt)) ||
    !web ||
    web.protocol !== 'web-v1' ||
    web.coordinateSpace !== 'phone' ||
    web.layout?.width !== c.phoneFrame.width ||
    web.layout?.height !== c.phoneFrame.height ||
    ![web.layout.width, web.layout.height].every(
      (n) => Number.isInteger(n) && n >= 180,
    ) ||
    !Array.isArray(web.attempts) ||
    web.attempts.length !== CALIBRATION_CLICK_COUNT ||
    new Set(web.attempts.map((a) => a.id)).size !== CALIBRATION_CLICK_COUNT ||
    !Array.isArray(web.results) ||
    web.results.length > CALIBRATION_CLICK_COUNT ||
    new Set(web.results.map((r) => r.id)).size !== web.results.length
  )
    return false;
  const inside = (p: import('./assisted-contracts.js').WebPoint) =>
    p &&
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    p.x >= 0 &&
    p.y >= 0 &&
    p.x < web.layout.width &&
    p.y < web.layout.height;
  if (
    !web.results.every(
      (r) =>
        r.id &&
        inside(r.target) &&
        inside(r.actual) &&
        web.attempts.some((a) => a.id === r.id) &&
        Number.isFinite(r.durationMs) &&
        r.durationMs > 0 &&
        Number.isFinite(r.errorPx) &&
        Math.abs(
          r.errorPx -
            Math.hypot(r.target.x - r.actual.x, r.target.y - r.actual.y),
        ) < 1e-6,
    )
  )
    return false;
  return (
    web.attempts.every((a) => {
      if (!a.id || typeof a.hit !== 'boolean' || !inside(a.target))
        return false;
      const r = web.results.find((r) => r.id === a.id);
      return (
        (!r || (r.target.x === a.target.x && r.target.y === a.target.y)) &&
        a.hit === Boolean(r && r.errorPx <= CALIBRATION_CLICK_RADIUS_PX)
      );
    }) && web.attempts.filter((a) => a.hit).length >= CALIBRATION_CLICK_REQUIRED
  );
}
export interface ScreenPoint {
  x: number;
  y: number;
}
export type ScreenAction =
  | { type: 'tap'; point: ScreenPoint }
  | { type: 'longPress'; point: ScreenPoint; durationMs?: number }
  | {
      type: 'swipe' | 'dragAndDrop';
      from: ScreenPoint;
      to: ScreenPoint;
      durationMs?: number;
    };
export interface ActionRequest extends ProfileBinding {
  requestId: string;
  calibrationProfileId: string;
  contextKey: string;
  action: ScreenAction;
}
/**
 * Which evidence anchored the measured press window. A passive push channel is
 * the only source that can see the tool cross the screen plane, so it is the
 * most faithful anchor; the driver sample and the completion time are fallbacks
 * for installations without a feedback port.
 */
export type ContactArrivalSource =
  | 'feedback-plane-crossing'
  | 'driver-arrival-sample'
  | 'driver-completed';
export interface ActionResult {
  requestId: string;
  action: ScreenActionType;
  completedAt: string;
  requestedDurationMs?: number;
  gestureDurationMs: number;
  totalDurationMs: number;
  limitations: string[];
  /**
   * Target duration of the hold that closes the contact: the whole press for a
   * tap, the endpoint hold for a gesture whose traverse is intended travel.
   */
  targetContactMs: number;
  /**
   * Measured press window: the press evidence to the first passive sample above
   * the screen plane. For a gesture this includes the traverse. Absent when no
   * passive tool-vector channel was available, so an unmeasurable window is
   * never reported as a measured zero.
   */
  contactMs?: number;
  /** Milliseconds actually spent waiting on the contact hold. */
  scheduledHoldMs: number;
  /** Endpoint/press overrun; absent when release could not be observed. */
  timingOverrunMs?: number;
  /** Which evidence produced the press-window anchor. */
  arrivalSource: ContactArrivalSource;
  executionMode?: 'feedback-sequence' | 'terminal';
  timingStatus?: 'within-target' | 'overrun' | 'unmeasurable';
  degradationReason?: string;
  contactStartedAt?: number;
  handoffConfirmedAt?: number;
  releaseSubmittedAt?: number;
  releasedAt?: number;
  terminalConfirmedAt?: number;
}
export interface CurrentOperation {
  requestId: string;
  kind: 'action' | 'calibration' | 'drag' | 'control' | 'motion';
  status: 'running' | 'completed' | 'cancelled' | 'stopped' | 'failed';
  error?: string;
}
export interface RuntimeState {
  stopRevision: number;
  aiRun?: { requestId: string };
  appliedPayload?: AppliedToolPayload;
  payloadApplication?: PayloadApplicationState;
  state: RobotState;
  operation?: CurrentOperation;
  recoveryRequired: boolean;
  softwarePaused: boolean;
}
/** Controller initialization diagnostics; HTTP service availability is separate. */
export interface RobotArmInitializationError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
/**
 * Append-only forensic trail. These shapes are the wire protocol for
 * `GET /audit/actions`, so they live in the browser-safe contracts rather than
 * in the Node-side store that writes them.
 */
export type RobotActionAuditKind =
  | 'action'
  | 'control'
  | 'calibration'
  | 'drag';
export type RobotActionAuditOutcome =
  | 'completed'
  | 'cancelled'
  | 'stopped'
  | 'failed'
  /** An event rather than an outcome, e.g. a control pressed while an operation
   * was already running, or a calibration session being opened. */
  | 'dispatched';
export interface RobotActionAuditRecord {
  schemaVersion: number;
  /** Monotonic within a process, so rotated files can still be ordered. */
  seq: number;
  at: string;
  kind: RobotActionAuditKind;
  /** The action `requestId` when there is one, otherwise the operation id. */
  id: string;
  outcome: RobotActionAuditOutcome;
  error?: string;
  /** Structured vendor evidence retained alongside the readable error. */
  errorDetails?: {
    code: string;
    status: number;
    details?: Record<string, unknown>;
  };
  /** Free-form per kind; see the runtime call sites. */
  detail?: Record<string, unknown>;
}
export interface RobotActionAuditStatus {
  enabled: boolean;
  filePath?: string;
  /** Records held in the in-memory index. */
  records: number;
  written: number;
  /** Write failures. Non-zero means the trail has holes but control still works. */
  failures: number;
  lastError?: string;
  bytes: number;
  maxBytes: number;
}
/** Active verification of an already fitted phone coordinate frame. */
export interface CalibrationSession extends ProfileBinding {
  auto?: {
    evidence: AutoCalibrationEvidence;
    startPose: CartesianPose;
    fast: boolean;
    observationRecorded?: boolean;
    cameraAvoidanceRecorded?: boolean;
    minimumTravelTipZMm?: number;
    avoidingCamera?: boolean;
  };
  verificationRuns?: Array<{
    group: 'hover' | 'contact';
    startedAt: string;
    finishedAt?: string;
    outcome: 'running' | 'completed' | 'failed' | 'interrupted';
    targets: Array<{ name: string; positionMm: Vector3 }>;
    speed: MotionSpeed;
    acceleration: MotionAcceleration;
  }>;
  lastCommand?: { id: string; payload: string };
  status: 'active' | 'interrupted' | 'completed' | 'cancelled';
  context: {
    adapterId: string;
    connectionIdentity: string;
    robotGeometryRevision: number;
    toolGeometryRevision: number;
    screenGeometryRevision: number;
    verificationKey: string;
    workstationRevision: number;
  };
  boundary: BoundaryVerification;
  progress?: {
    group: 'hover' | 'contact';
    task: 'corners' | 'edges' | 'return';
    guide?: { x: number; y: number }[];
    index: number;
    total: number;
  };
  updatedAt?: string;
  tapResult?: ActionResult;
  recoveryAcknowledged?: boolean;
  interruptionReason?: string;
  id: string;
  revision: number;
  stage:
    | 'observation'
    | 'verification'
    | 'completed'
    | 'cancelled'
    | 'interrupted';
  candidate?: CalibrationProfile;
  dragMode: boolean;
}
export interface CalibrationCommand {
  point?: { x: number; y: number };
  commandId: string;
  expectedRevision: number;
  type:
    | 'verify-automatic-boundary'
    | 'record-observation'
    | 'verify-hover-boundary'
    | 'verify-contact-boundary'
    | 'confirm-hover-boundary'
    | 'return-observation'
    | 'enter-drag'
    | 'exit-drag'
    | 'verify-web-target'
    | 'cancel';
  accepted?: boolean;
}
export interface VisionBinding {
  cameraId: string;
  cameraName: string;
  perspectiveProfileKey: string;
  fingerprint: string;
  width: number;
  height: number;
  /** Observed evidence; deliberately excluded from mapping identity. */
  validity?: PerspectiveValiditySummary;
}
export interface VisionSnapshot {
  base64: string;
  width: number;
  height: number;
  binding: VisionBinding;
}
export interface VisionProvider {
  snapshot(): Promise<VisionSnapshot>;
}
export function sameVisionMapping(
  left: VisionBinding,
  right: VisionBinding,
): boolean {
  return (
    left.cameraId === right.cameraId && left.fingerprint === right.fingerprint
  );
}
export function semanticJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(semanticJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${semanticJson(item)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export type RobotArmAiMode =
  | 'act'
  | 'locate'
  | 'query'
  | 'assert'
  | 'extract'
  | 'boolean'
  | 'number'
  | 'string'
  | 'waitFor';
export interface RobotArmAiBinding extends ProfileBinding {
  installationSession?: string;
  calibrationProfileId: string;
  contextKey: string;
  vision: VisionBinding;
}
export interface RobotArmAiRequest extends RobotArmAiBinding {
  requestId: string;
  mode: RobotArmAiMode;
  prompt: string;
  modelConfig?: {
    modelName: string;
    modelFamily: string;
    baseUrl: string;
    apiKey: string;
  };
}
export class RobotArmError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RobotArmError';
  }
}

/** Preserve structured errors across independently bundled community modules. */
export function isRobotArmError(error: unknown): error is RobotArmError {
  const e = error as Partial<RobotArmError> | null;
  return (
    error instanceof Error &&
    e?.name === 'RobotArmError' &&
    typeof e.code === 'string' &&
    Number.isInteger(e.status) &&
    e.status! >= 400 &&
    e.status! <= 599
  );
}

/** Persisted controller motion parameters, separate from screen action ratios. */
export interface ControllerMotionSettings {
  revision: string;
  receivedAt: string;
  values: {
    globalSpeedPercent: number;
    linearSpeed: number;
    linearAcceleration: number;
    linearJerk: number;
  };
  ranges: Record<
    keyof ControllerMotionSettings['values'],
    { min: number; max: number; default: number }
  >;
}
export interface ControllerMotionSettingsUpdate {
  revision: string;
  values: ControllerMotionSettings['values'];
}

// Browser consumers use these types without loading Node camera backends.
export type { CameraProfile, CameraCorrection } from './camera/profile.js';
export type * from './camera/perspective-validity.js';
