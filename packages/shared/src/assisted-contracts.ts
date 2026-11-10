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

export const CALIBRATION_CLICK_RADIUS_PX = 13;
export const CALIBRATION_CLICK_COUNT = 15;
export const CALIBRATION_CLICK_REQUIRED = 15;
export const CALIBRATION_PHONE_PATH = '/phone-calibration';
export const CALIBRATION_PHONE_POLICY = {
  heartbeatMs: 750,
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
// Four outer markers fit the page transform. The two inner markers only score it.
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
  touchDiagnosticsVersion?: 2;
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
    reason?: 'multiple_contacts';
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
  /** Same-camera transition from camera-only preview to a paired Device. */
  pairingToken?: string;
  insetMarkers?: boolean;
  markerRequest?: string;
  boundaryGuide?: { group: 'hover' | 'contact'; corners: WebPoint[] };
  imageTrial?: boolean;
  view:
    | 'markers'
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
  prepared: boolean;
  phoneConnected: boolean;
  layout?: CalibrationPageLayout;
  mapping?: WebCalibrationMapping;
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
  teachingId?: string;
  stage:
    | 'positioning-boundary'
    | 'avoiding-camera'
    | 'ready'
    | 'positioning-safe'
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
  /** Operator-authorized collection, safe return and verification sequence. */
  automaticWorkflow?: boolean;
  explorationMode?: AutomaticExplorationMode;
  /** Collection failed before boundary verification. */
  collectionFailed?: boolean;
  anchors: WebPoint[];
  points: CapturedCalibrationPoint[];
  /** Diagnostic 3D residuals, never a substitute for click verification. */
  fitResidualsMm?: number[];
  explorationQuality?: {
    gridRmsMm: number;
    holdoutMaxMm: number;
    coverage: number;
  };
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
    },
  ): Promise<void>;
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
  | 'return-safe'
  | 'return-safe'
  | 'start'
  | 'start-automatic'
  | 'start-fast'
  | 'start-slide'
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
  points: CapturedCalibrationPoint[];
  input: AssistedCalibrationInput;
  mapping: WebCalibrationMapping;
  geometryKey: string;
  referencePosition: CartesianPose;
  safePosition?: CartesianPose;
  /** Previous failed targets are diagnostics only, never acceptance evidence. */
  failedAttempts?: WebVerificationAttempt[];
}

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
  acceptance?: 'manual' | 'automatic';
  error?: string;
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
    | 'enter-drag'
    | 'exit-drag';
}
