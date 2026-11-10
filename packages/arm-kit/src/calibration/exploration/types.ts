/** Narrow host boundary for the pinned upstream sampling algorithm. */
import type {
  CartesianPose,
  MotionAcceleration,
  MotionOptions,
  MotionSpeed,
  ScreenProfile,
  ToolProfile,
} from '../../contracts.js';
import { RobotArmError } from '../../contracts.js';
export interface ScreenCalibTarget {
  id: string;
  role: 'fit' | 'validation';
  css: { x: number; y: number };
  screen: { x: number; y: number };
}
export interface ScreenCalibSessionSummary {
  id: string;
  connected: boolean;
  instanceId?: string;
  display?: { width: number; height: number; visible: boolean };
  config?: {
    cameraId?: string;
    screenId?: string;
    pixelWidth: number;
    pixelHeight: number;
  };
  mapping?: { version: number; displayKey: string; cameraFingerprint?: string };
  sampleId?: string;
  sampleSnapshot?: {
    sampleId: string;
    mappingVersion: number;
    pointerCount: number;
    screen: { x: number; y: number } | null;
  };
}
export function assertSameScreenPage(
  current: ScreenCalibSessionSummary,
  expected: ScreenCalibSessionSummary,
) {
  if (
    current.id !== expected.id ||
    !current.connected ||
    !current.display?.visible ||
    !current.mapping ||
    !current.config ||
    current.instanceId !== expected.instanceId ||
    current.mapping.version !== expected.mapping?.version ||
    current.mapping.displayKey !== expected.mapping?.displayKey ||
    current.mapping.cameraFingerprint !== expected.mapping?.cameraFingerprint ||
    current.config.cameraId !== expected.config?.cameraId ||
    current.config.screenId !== expected.config?.screenId ||
    current.config.pixelWidth !== expected.config?.pixelWidth ||
    current.config.pixelHeight !== expected.config?.pixelHeight
  )
    throw new RobotArmError(
      'SCREEN_PAGE_REQUIRED',
      'The selected screen page or mapping changed; restart automatic exploration',
      409,
    );
}
export interface AutoCalibrationProgress {
  phase: 'preflight' | 'probe' | 'search' | 'grid';
  index: number;
  total: number;
  message?: string;
  sampleId?: string;
  probeZMm?: number;
  touching?: boolean;
}
export type ProbePurpose =
  | 'preflight'
  | 'release'
  | 'search'
  | 'search-limit'
  | 'refine'
  | 'press'
  | 'slide';
export interface CollectedSample {
  robot: { x: number; y: number; z: number };
  pressedZMm: number;
  screen: { x: number; y: number };
  role: 'probe' | 'fit' | 'validation';
  method: 'stepped' | 'direct' | 'slide';
  weight?: number;
}
export interface CalibrationSession {
  auto?: {
    progress?: AutoCalibrationProgress;
    fastAdaptation?: { searchSteps: number; maxSearchSteps: number };
    mode?: string;
    collection?: string;
    horizontalConfirmed?: boolean;
    screenSessionId?: string;
    collectedSamples?: CollectedSample[];
  };
}
export interface ApplicationContext {
  screen: ScreenProfile & {
    visionTarget?: { cameraId: string; screenId: string };
  };
  tool: ToolProfile;
  minimumTravelTipZMm?: number;
  batchTransfer?: { travelTipZMm: number };
}
export interface AutoExplorationOptions {
  startPose: CartesianPose;
  page?: ScreenCalibSessionSummary;
  mode?: 'standard' | 'fast-horizontal';
  collection?: 'tap' | 'slide';
  horizontalConfirmed?: boolean;
}
export interface AutoExplorationHost {
  currentPose(): Promise<CartesianPose>;
  move(
    pose: CartesianPose,
    ctx: ApplicationContext,
    speed: MotionSpeed,
    acceleration: MotionAcceleration,
  ): Promise<void>;
  stable(pose: CartesianPose, ctx: ApplicationContext): Promise<void>;
  preflight(
    steps: Array<{ name: string; pose: CartesianPose; options: MotionOptions }>,
    ctx: ApplicationContext,
  ): Promise<void>;
  check(): void;
  stop?(): Promise<void>;
  progress?(session: CalibrationSession): void;
  profileStore: {
    saveSession(
      session: CalibrationSession,
      final: boolean,
      check: () => void,
    ): Promise<void>;
  };
  screenCalib: {
    findMappedSession(
      target?: ApplicationContext['screen']['visionTarget'],
    ): Promise<ScreenCalibSessionSummary>;
    session(id: string): Promise<ScreenCalibSessionSummary>;
    setSample(
      id: string,
      sampleId: string,
      purpose: ProbePurpose,
      settleMs: number,
    ): Promise<void>;
    targets(
      id: string,
    ): Promise<{ mappingVersion: number; targets: ScreenCalibTarget[] }>;
  };
}
