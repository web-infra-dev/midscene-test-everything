import type { CalibrationQualityReading } from './calibration-quality.js';
import type {
  CalibrationProfile,
  CalibrationSession,
  CartesianPose,
  MotionAcceleration,
  MotionOptions,
  MotionSpeed,
  ProfileBinding,
  ScreenMotionSettings,
  Vector3,
  VisionBinding,
} from './contracts.js';
export * from './calibration-quality.js';

export const CALIBRATION_CLICK_RADIUS_PX = 13;
export const CALIBRATION_CLICK_COUNT = 15;
export const CALIBRATION_CLICK_REQUIRED = 15;
export const CALIBRATION_PHONE_PATH = '/phone-calibration';
export const CALIBRATION_PHONE_POLICY = {
  visibilityPattern: {
    columns: 8,
    rows: 12,
    colors: ['#9ec5ff', '#f6f8fb'],
  },
  heartbeatMs: 750,
  stepAcknowledgementMs: 5000,
  measurementFreshMs: 10000,
  displayFreshMs: 10000,
} as const;
export interface PhoneTouchEvent {
  source?: 'document' | 'surface';
  targetElement?: string;
  defaultPrevented?: boolean;
  defaultPreventedAfterDispatch?: boolean;
  /** Browser event clock, separate from the time the listener ran. */
  nativeTimestampMs?: number;
  dispatchDelayMs?: number;
  sequence: number;
  elapsedMs: number;
  kind:
    | 'touchstart'
    | 'touchend'
    | 'touchcancel'
    | 'pointerdown'
    | 'pointerup'
    | 'pointercancel'
    | 'lostpointercapture'
    | 'target-reset'
    | 'step-feedback';
  targetId?: string;
  stepId?: string;
  detail?: string;
  point?: WebPoint;
}
export interface CalibrationPhoneStatus {
  displayRequirement?: 'home-screen' | 'fullscreen';
  model?: string;
  diagnostics?: {
    version?: 2;
    pageId: string;
    receivedAt: number;
    updateSequence: number;
    contact: boolean;
    wakeState?: CalibrationPageUpdate['wakeState'];
    fullscreen?: boolean;
    feedback?: CalibrationPageUpdate['stepFeedback'];
    events: PhoneTouchEvent[];
  };
  state: 'waiting' | 'connected' | 'paused' | 'reconnecting';
  links: Array<{ name: string; url: string }>;
}

export interface CalibrationSnapshot {
  session: AssistedCalibrationState | null;
  setup: AssistedCalibrationSetup;
  phone: CalibrationPhoneStatus;
}

export interface WebPoint {
  x: number;
  y: number;
}
// Outer markers supply the reference fit for scoring the inner check markers.
export const CALIBRATION_MARKER_CODES = [10, 11, 12, 13, 14, 15] as const;
export const CALIBRATION_MARKERS = CALIBRATION_MARKER_CODES.map((code, i) => ({
  code,
  x: [0.16, 0.84, 0.84, 0.16, 0.3, 0.7][i],
  y: [0.12, 0.12, 0.88, 0.88, 0.5, 0.5][i],
  purpose: i < 4 ? ('fit' as const) : ('check' as const),
}));
export function calibrationPageMarkers(width: number, height: number) {
  const size = Math.min(100, Math.min(width, height) * 0.18);
  return CALIBRATION_MARKERS.map((m) => ({
    ...m,
    x: m.x * width,
    y: m.y * height,
    size,
  }));
}
export interface CameraMappingAccuracy {
  fit: { count: number; meanErrorCssPx: number; maxErrorCssPx: number };
  validation: { count: number; meanErrorCssPx: number; maxErrorCssPx: number };
  points: Array<{ code: number; purpose: 'fit' | 'check'; errorCssPx: number }>;
}
/** Shared placement and engineering stability thresholds for point collection. */
export const CALIBRATION_POINT_POLICY = {
  holdMs: 300,
  windowMs: 1000,
  minimumInlierRatio: 0.8,
  maximumDriftRatio: 0.5,
  minimumReadings: 5,
  touchSpreadPx: 3,
  tipSpreadMm: 0.3,
  targetRadiusPx: 24,
  maximumHeartbeatGapMs: 350,
  maximumQueryMs: 100,
  maximumConfirmationMs: 500,
  /** Streamed step cadence while a host step is active; 25 Hz leaves margin over the 100 ms confirmation spacing. */
  streamStepFeedbackIntervalMs: 40,
} as const;
export function calibrationCaptureTargets(
  layout: Pick<CalibrationPageLayout, 'width' | 'height'>,
): WebPoint[] {
  return [
    [0.08, 0.08],
    [0.5, 0.08],
    [0.92, 0.08],
    [0.08, 0.5],
    [0.5, 0.5],
    [0.92, 0.5],
    [0.08, 0.92],
    [0.5, 0.92],
    [0.92, 0.92],
  ].map(([x, y]) => ({ x: layout.width * x, y: layout.height * y }));
}
export interface CapturedCalibrationPoint extends WebCalibrationSample {
  purpose?: 'direction' | 'fit' | 'check';
  readings: number;
  tipSpreadMm: number;
  touchSpreadPx: number;
  /** Original measured samples retained when a validation height is repeated. */
  repeatedSamples?: CapturedCalibrationPoint[];
  /** Touch is associated with this bounded step, not an exact contact-time pose. */
  probeStep?: {
    id: string;
    before: CartesianPose;
    after: CartesianPose;
    positionConvention: 'step-end' | 'contact-interval' | 'predicted';
    heightIntervalMm?: [number, number];
  };
}
export interface CalibrationPointProgress {
  heightRecheck?: boolean;
  mode?: AutomaticExplorationMode;
  index: number;
  total: number;
  phase: 'waiting' | 'holding' | 'captured';
  operation?:
    | 'travel'
    | 'search'
    | 'release'
    | 'refine'
    | 'press'
    | 'slide'
    | 'recover';
  targets?: WebPoint[];
  /** Recorded grid contacts in page CSS pixels, excluding direction probes. */
  measuredPoints?: WebPoint[];
  heightSearch?: {
    precision?: boolean;
    predictedZ: number;
    floorZ: number;
    measuredZ?: number;
    localSteps: number;
    totalSteps: number;
    touching?: boolean;
  };
  waitingReason?: 'movement' | 'latency';
  progress: number;
  readings: number;
  target: { id: string; point: WebPoint };
  step?: { id: string; phase: 'prepare' | 'result'; contactMode?: 'current' };
  /** A server challenge, acknowledged only after the phone renders this reply. */
  probe?: { id: string; contactId: string };
}

export interface CalibrationPageLayout {
  revision: number;
  width: number;
  height: number;
  /** Full display in CSS pixels, oriented with the phone UI; not the viewport. */
  screen: { width: number; height: number; devicePixelRatio: number };
  /** CSS pixels between screen top and page top, when the browser can measure it. */
  topInset?: number;
  /** Diagnostic evidence only; excluded from geometry identity and fitting. */
  insetDiagnostics?: {
    version: 1;
    userAgent: string;
    viewportMeta: string | null;
    reason: string;
    safeArea?: {
      top: number;
      bottom: number;
      paddingTop: string;
      paddingBottom: string;
    };
    touch?: {
      screenX: number;
      screenY: number;
      clientX: number;
      clientY: number;
    };
    measuredOrigin?: number;
    measurementMatchesViewport: boolean;
    visualViewport?: {
      width: number;
      height: number;
      scale: number;
      offsetTop: number;
      offsetLeft: number;
    };
  };
  /** Marker centres in the same client-coordinate frame as pointer events. */
  markers: Array<
    WebPoint & { code: number; size: number; purpose: 'fit' | 'check' }
  >;
}
export interface CalibrationPageUpdate {
  /** Reported by the optical marker page before capture. */
  platform?: 'android' | 'harmonyos' | 'ios' | 'other';
  displayMode?: 'browser' | 'fullscreen' | 'standalone';
  fullscreen?: boolean;
  wakeState?: 'system' | 'video' | 'pending' | 'blocked';
  /** View actually displayed by the phone. */
  view?: CalibrationPageReply['view'];
  markersPainted?: boolean;
  markerRequest?: string;
  imagingPatternSupported?: true;
  visibilityProbeAck?: string;
  imagingPatternAck?: string;
  /** Painted height in CSS pixels when iOS sizes the first row around system overlays. */
  visibilityFirstRowHeight?: number;
  touchDiagnosticsVersion?: 2;
  /**
   * The page reports an active step continuously at `CALIBRATION_POINT_POLICY.streamStepFeedbackIntervalMs`
   * instead of only on touch events, paint and the heartbeat. The host can then
   * confirm a stationary result from two streamed frames instead of issuing two
   * extra result requests. Absent means the request/response protocol.
   */
  streamStepFeedback?: boolean;
  /** Bounded diagnostic history; never used as contact evidence. */
  touchEvents?: PhoneTouchEvent[];
  model?: string;
  /** Issued by the host when it serves this document. */
  pageId: string;
  browserInstanceId?: string;
  resumeBrowserInstanceId?: string;
  claimBrowserInstance?: boolean;
  sequence: number;
  visible: boolean;
  layout: CalibrationPageLayout;
  /** Identity lasts until release; motionRevision invalidates a read crossed by movement. */
  contact?: { id: string; motionRevision: number; point: WebPoint };
  /** Latched per probe, including touches released while a request is in flight. */
  contactStart?: { targetId: string; id: string; point: WebPoint };
  stepFeedback?: {
    id: string;
    phase: 'prepare' | 'result';
    outcome: 'ready' | 'no_touch' | 'touched' | 'unknown';
    /** Echoed only when the phone supports a fresh held-contact snapshot. */
    contactMode?: 'current';
    /** A pointer ended after this request arrived but before the browser's first painted reading. */
    releasedBeforeAck?: boolean;
    reason?: 'multiple_contacts' | 'pointer_cancelled';
    point?: WebPoint;
  };
  captureAck?: string;

  targetReady?: string;
  touches?: Array<{
    targetId: string;
    point: WebPoint;
    durationMs: number;
    travelPx: number;
  }>;
}
export interface CalibrationPageReply {
  /** Briefly identify the phone selected in Playground. */
  selectionHint?: true;
  visibilityProbe?: { id: string; phase: 0 | 1 };
  /** Same-camera transition from camera-only preview to a paired Device. */
  pairingToken?: string;
  insetMarkers?: boolean;
  markerRequest?: string;
  imagingRequest?: string;
  boundaryGuide?: { group: 'hover' | 'contact'; corners: WebPoint[] };
  /** Distinguishes a pending or failed check on the phone's review screen. */
  reviewStage?: 'boundary-review' | 'verification-failed';
  imageTrial?: boolean;
  view:
    | 'markers'
    | 'camera-tuning'
    | 'waiting'
    | 'touch-preview'
    | 'collect'
    | 'reference-required'
    | 'capture-failed'
    | 'verify'
    | 'positioning'
    | 'return-ready'
    | 'returning'
    | 'safety'
    | 'review'
    | 'completed'
    | 'interrupted';
  capture?: CalibrationPointProgress;
  automaticPhase?: 'local' | 'grid';
  error?: string;
  anchors: WebPoint[];
  target?: { id: string; point: WebPoint };
}
export interface AssistedCalibrationInput {
  robotProfileId: string;
  toolProfileId: string;
  cameraId: string;
  width: number;
  height: number;
  /** Adapters without defaults must supply explicit, validated motion settings. */
  motion?: ScreenMotionSettings;
}
export type AssistedMappingInput = Pick<
  AssistedCalibrationInput,
  'cameraId' | 'width' | 'height'
>;
export interface WebCalibrationMapping {
  vision: VisionBinding;
  webToImage: number[];
  layout: CalibrationPageLayout;
  /** Marker shape residual, not the four-centre interpolation residual. */
  markerErrorPx: number;
  accuracy: CameraMappingAccuracy;
}
/** Approximate stylus footprints in the original camera image, in source pixels. */
export interface CalibrationPreviewPositions {
  reference?: WebPoint;
  cameraBoundary?: WebPoint;
  cameraBoundaryEnd?: WebPoint;
  cameraBoundaryLine?: { start: WebPoint; end: WebPoint; allowed: WebPoint };
  safe?: WebPoint;
}
/** Configuration prepared before any calibration task exists. */
export interface AssistedCalibrationSetup {
  selection?: Pick<
    AssistedCalibrationInput,
    'robotProfileId' | 'toolProfileId' | 'cameraId' | 'width' | 'height'
  >;
  teaching?: import('./contracts.js').InstallationTeaching;
  markerCapture?: { request: string; attempt: number; captureAt: number };
  /** Progress of the latest page-mapping check in this setup. */
  mappingCheck?: 'checking' | 'confirmed' | 'failed';
  prepared: boolean;
  phoneConnected: boolean;
  layout?: CalibrationPageLayout;
  mapping?: WebCalibrationMapping;
  imaging?: CalibrationImagingStatus;
}

export interface CalibrationImagingStatus {
  state:
    | 'idle'
    | 'released'
    | 'exposure'
    | 'focus'
    | 'ready'
    | 'error'
    | 'unsupported';
  message?: string;
  focus?: number;
  /** DirectShow exposure value in the camera's reported hardware range. */
  exposure?: number;
  updatedAt?: number;
}
export interface WebCalibrationSample {
  point: WebPoint;
  positionMm: Vector3;
  /** Confidence of the measured/predicted activation height. */
  weight?: number;
}
export type AutomaticExplorationMode = 'standard' | 'fast' | 'slide';
export interface WebVerificationResult {
  id: string;
  target: WebPoint;
  actual: WebPoint;
  errorPx: number;
  durationMs: number;
}
export interface WebVerificationAttempt {
  id: string;
  target: WebPoint;
  hit: boolean;
}
export interface WebVerificationEvidence {
  protocol: 'web-v1';
  /** Phone-only verification does not certify the camera mapping. */
  coordinateSpace: 'phone';
  layout: CalibrationPageLayout;
  results: WebVerificationResult[];
  attempts: WebVerificationAttempt[];
}
export interface AssistedCalibrationState {
  id: string;
  cameraBoundaryPosition?: CartesianPose;
  cameraBoundaryEndPosition?: CartesianPose;
  teachingId?: string;
  stage:
    | 'positioning-boundary'
    | 'avoiding-camera'
    | 'ready'
    | 'positioning-safe'
    | 'boundary-review'
    | 'positioning'
    | 'collecting'
    | 'reference-required'
    | 'capture-failed'
    | 'return-ready'
    | 'returning'
    | 'safety'
    | 'verifying'
    | 'verification-failed'
    | 'reprobing'
    | 'review'
    | 'completed'
    | 'interrupted'
    | 'cancelled';
  motion?: ScreenMotionSettings;
  /** Starting pose used only for automatic calibration sampling. */
  referencePosition?: CartesianPose;
  /** Collection paused until a higher reference pose is recorded. */
  requiredReferenceZ?: number;
  /** Separately recorded after fitting; used for normal screen actions. */
  safePosition?: CartesianPose;
  phoneConnected: boolean;
  capture?: CalibrationPointProgress;
  layout?: CalibrationPageLayout;
  mapping?: WebCalibrationMapping;
  automaticPhase?: 'local' | 'grid';
  samples: number;
  /** Travel to the reference before probing or after a sampling/fit check. */
  referenceTravel?: 'approach' | 'return';
  recheckingPayload?: boolean;
  /** Operator-authorized collection, safe return and verification sequence. */
  automaticWorkflow?: boolean;
  explorationMode?: AutomaticExplorationMode;
  /** Collection failed before boundary verification. */
  collectionFailed?: boolean;
  /** Stage at which this attempt was interrupted. */
  interruptedFrom?: AssistedCalibrationState['stage'];
  awaitingSocketRecovery?: boolean;
  anchors: WebPoint[];
  points: CapturedCalibrationPoint[];
  /** Diagnostic 3D residuals, never a substitute for click verification. */
  fitResidualsMm?: number[];
  explorationQuality?: {
    gridRmsMm: number;
    holdoutMaxMm: number;
    coverage: number;
    shortSideMm?: number;
    warnings?: CalibrationQualityReading[];
  };
  /** The last attempt to record this Safe Position failed the camera visibility check. */
  canConfirmSafeVisibility?: boolean;
  error?: string;
  errorDetails?: {
    code: string;
    status: number;
    details?: Record<string, unknown>;
  };
  binding?: ProfileBinding;
  calibration?: CalibrationSession;
  verification: WebVerificationResult[];
  verificationAttempts?: WebVerificationAttempt[];
  imageTrial?: {
    attempts: WebVerificationAttempt[];
    results: WebVerificationResult[];
  };
  autoRepair?: { active: boolean; round: number; point: number; total: number };
  repair?: {
    attemptId: string;
    target: WebPoint;
    samples: CapturedCalibrationPoint[];
    heightDeltaMm: number;
    canApply: boolean;
  };
  target?: { id: string; point: WebPoint };
  result?: CalibrationProfile;
}
export interface AutomaticCaptureMotionTiming {
  beforeSubmitMs: number;
  adapterCompletionMs: number;
  stableMs: number;
}

export interface AutomaticCaptureHost {
  preflight?(
    poses: CartesianPose[],
    motion?: Pick<MotionOptions, 'speed' | 'acceleration'>,
  ): Promise<void>;
  signal: AbortSignal;
  check(): void;
  read(): Promise<CartesianPose>;
  stop?(): Promise<void>;
  move(
    pose: CartesianPose,
    options?: {
      /** Rechecked until handoff to the motion executor; may reject an unsubmitted step. */
      beforeSubmit?(): void;
      maximumPositionErrorMm?: number;
      speed?: MotionSpeed;
      acceleration?: MotionAcceleration;
      timeoutMs?: number;
      onTiming?(timing: AutomaticCaptureMotionTiming): void;
      referenceTravel?: {
        attemptId: string;
        direction: 'approach' | 'return';
        leg: 'lift' | 'traverse' | 'lower' | 'direct';
      };
    },
  ): Promise<CartesianPose | undefined>;
}

export interface AssistedCaptureHost {
  signal: AbortSignal;
  read(): Promise<CartesianPose>;
  check(): void;
  /** Exit Drag Mode and return a fresh, stable Base-frame pose under the lease. */
  finishDrag(): Promise<CartesianPose>;
}

export interface ScreenDetectionAttempt {
  input: {
    jpegBase64: string;
    width: number;
    height: number;
    prompt: string;
    modelName: string;
    modelFamily?: string;
  };
  /** Assistant text extracted by the SDK, before JSON parsing. */
  output?: { text: string; parsed?: unknown };
  error?: string;
}
export interface ScreenCornerDetection {
  points: {
    topLeft: WebPoint;
    topRight: WebPoint;
    bottomRight: WebPoint;
    bottomLeft: WebPoint;
  };
  attempt: ScreenDetectionAttempt;
}
export type AssistedCalibrationAction =
  | 'position-boundary'
  | 'record-boundary'
  | 'save-teaching'
  | 'auto-repair'
  | 'reprobe'
  | 'apply-reprobe'
  | 'restart'
  | 'position-reference'
  | 'record-reference'
  | 'position-safe'
  | 'record-safe'
  | 'confirm-safe-visibility'
  | 'return-safe'
  | 'return-safe'
  | 'start'
  | 'start-automatic'
  | 'start-fast'
  | 'start-slide'
  | 'verify-boundary'
  | 'retry-standard'
  | 'stop-capture'
  | 'cancel'
  | 'verify'
  | 'image-trial'
  | 'accept';

/** Portable collected-point checkpoint; restoring it never moves the robot. */
export interface AssistedCalibrationRecording {
  /** The screen Device that collected these points, when running per Device. */
  deviceId?: string;
  /** Persisted geometry to preserve the exact plane and compensation on resume. */
  calibrationProfileId?: string;
  explorationMode?: AutomaticExplorationMode;
  points: CapturedCalibrationPoint[];
  input: AssistedCalibrationInput;
  mapping: WebCalibrationMapping;
  geometryKey: string;
  referencePosition: CartesianPose;
  safePosition?: CartesianPose;
  /** Previous failed targets are diagnostics only, never acceptance evidence. */
  failedAttempts?: WebVerificationAttempt[];
}

export type CalibrationBatchSamplingMode = Extract<
  AutomaticExplorationMode,
  'standard' | 'slide'
>;

export interface CalibrationBatchState {
  id: string;
  revision: number;
  status:
    | 'running'
    | 'waiting'
    | 'stopping'
    | 'stopped'
    | 'completed'
    | 'failed';
  cameraId?: string;
  robotProfileId?: string;
  toolProfileId?: string;
  samplingMode?: CalibrationBatchSamplingMode;
  compliantSetupConfirmed?: true;
  usesSharedSafePosition?: true;
  /** Live while the batch searches for the shared Safe Position automatically. */
  automaticSharedParking?: true;
  sharedSafePosition?: CartesianPose;
  sharedSafePositionVerified?: boolean;
  sharedVisibility?: import('./contracts.js').ScreenVisibilityEvidence;
  sharedParkingOperatorConfirmedAt?: string;
  acceptance?: 'manual' | 'automatic';
  error?: string;
  visibilityMissingScreens?: string[];
  planVersion?: string;
  contextVersion?: string;
  transfer?: CalibrationBatchPlan['transfer'];
  currentIndex: number;
  items: Array<{
    deviceId: string;
    screenId: string;
    screenProfileId?: string;
    name: string;
    runIds: string[];
    progress?: {
      phase: string;
      message?: string;
      index: number;
      total: number;
    };
    note?: string;
    status:
      | 'pending'
      | 'preparing'
      | 'transferring'
      | 'awaiting-mapping'
      | 'awaiting-setup'
      | 'awaiting-phone'
      | 'awaiting-placement'
      | 'exploring'
      | 'awaiting-boundary-review'
      | 'awaiting-acceptance'
      | 'completed'
      | 'failed'
      | 'skipped'
      | 'stopped';
    attempts: number;
    error?: string;
    calibrationProfileId?: string;
  }>;
}

export interface CalibrationBatchPlan {
  cameraId: string;
  version: string;
  screens: {
    screenId: string;
    name: string;
    calibrated: boolean;
    cameraMappingChanged?: boolean;
    startsHere: boolean;
    expectedCenterMm?: WebPoint;
    expectedSource?: 'calibration' | 'estimate';
  }[];
  transfer?: {
    travelTipZMm: number;
    highestObstacleZMm: number;
    clearanceMm: number;
    corridor: { minX: number; maxX: number; minY: number; maxY: number };
    waypoints: WebPoint[];
    corridorConfirmed: true;
  };
}
export interface WorkstationScreenState {
  cameraId: string;
  screenId: string;
  name: string;
  screenProfileId?: string;
  calibrationProfileId?: string;
  expectedCenterMm?: WebPoint;
  expectedSource?: 'calibration' | 'estimate';
  selected: boolean;
  ready: boolean;
  status:
    | 'unconfigured'
    | 'unavailable'
    | 'mapping-required'
    | 'camera-mapping-changed'
    | 'calibration-required'
    | 'acceptance-required'
    | 'ready';
}
export interface CalibrationBatchCommand {
  revision: number;
  action:
    | 'continue'
    | 'retry'
    | 'skip'
    | 'stop'
    | 'accept'
    | 'record-safe-position'
    | 'confirm-shared-parking'
    | 'enter-drag'
    | 'exit-drag';
}
