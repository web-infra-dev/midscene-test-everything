import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { getDebug } from '@midscene/shared/logger';
import { taughtCameraBoundary } from '../application/teaching-constraints.js';
import type {
  AssistedCalibrationAction,
  AssistedCalibrationInput,
  AssistedCalibrationRecording,
  AssistedCalibrationSetup,
  AssistedCalibrationState,
  AssistedMappingInput,
  AutomaticCaptureHost,
  AutomaticExplorationMode,
  CalibrationLogoStatus,
  CalibrationPageReply,
  CalibrationPageUpdate,
  CalibrationPhoneStatus,
  WebVerificationResult,
} from '../assisted-contracts.js';
import {
  CALIBRATION_PHONE_POLICY,
  mappingQualityWarnings,
} from '../assisted-contracts.js';
import {
  type CalibrationCommand,
  type CalibrationProfile,
  type CartesianPose,
  RobotArmError,
  type ScreenVisibilityProbePattern,
  isRobotArmError,
  sameVisionMapping,
  semanticJson,
} from '../contracts.js';
import {
  add,
  assertPose,
  contactPoint,
  distance,
  quaternionDistance,
  scale,
} from '../domain.js';
import type { RobotArmRuntime } from '../runtime.js';
import { verifyScreenVisibility } from './camera/visibility.js';
import type { CalibrationVision } from './camera/vision.js';
import {
  CALIBRATION_LOGO_STROKE_COUNT,
  type LogoCanvasSession,
} from './draw-logo.js';
import { AutomaticCapture } from './exploration/capture.js';
import { fitExploration } from './exploration/fit.js';
import type { FastSamplingCheckpoint } from './exploration/sampler.js';
import { invertMapping, pointDistance, project } from './phone/geometry.js';
import {
  CalibrationPhoneSession,
  sameLayout,
  sameLayoutGeometry,
} from './phone/session.js';
import { knownScreenTravelHeight, pageOrderedQuad } from './screen-position.js';
import { CalibrationSetup, calibrationGeometryKey } from './setup.js';
import { SAMPLED_SURFACE_LIMIT_MM } from './surface.js';
import { moveToTaughtPosition } from './taught-position.js';
import { assertSafeObservation } from './verification/safe-position.js';

const log = getDebug('robot-arm:web-calibration', { console: true });
const debug = getDebug('robot-arm:web-calibration');
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
// Only feedback and data-quality failures permit motion after a measured probe.
const recoverableSamplingErrors = new Set([
  'AUTOMATIC_CAPTURE_FAILED',
  'CALIBRATION_QUALITY',
  'DUPLICATE_SAMPLE',
  'FAST_ADAPTATION_LIMIT',
  'SCREEN_TILT_UNSUPPORTED',
  'TOUCH_AMBIGUOUS',
  'TOUCH_CONTACT_LOST',
  'TOUCH_NOT_FOUND',
  'TOUCH_NOT_RELEASED',
  'TOUCH_RELEASE_NOT_FOUND',
  'TOUCH_SAFETY_LIMIT',
  'VISION_UNAVAILABLE',
]);
const SAMPLING_RECOVERY_MS = 15_000;

type Fit = Pick<
  CalibrationProfile,
  | 'kind'
  | 'origin'
  | 'xAxis'
  | 'yAxis'
  | 'inward'
  | 'orientation'
  | 'plane'
  | 'quality'
  | 'surface'
  | 'geometryFrame'
> & {
  physicalWidthMm: number;
  physicalHeightMm: number;
  phoneFrame: { width: number; height: number };
  fitResidualsMm: number[];
};
type SessionState = Omit<
  AssistedCalibrationState,
  'phoneConnected' | 'layout' | 'samples' | 'anchors' | 'points'
>;
type AutomaticRun = {
  session: SessionState;
  finish: boolean;
  retried: boolean;
  checkpoint: FastSamplingCheckpoint;
};
type SamplingRetryEvidence = {
  error: RobotArmError;
  pose?: CartesianPose;
  contactId?: string;
};
export interface AssistedCalibrationOptions {
  deviceId?: string;
  vision: CalibrationVision;
  onPhoneObservation?: (update?: CalibrationPageUpdate) => void;
  phoneLinks?: () => { name: string; url: string }[];
  referencePosition?: () => CartesianPose | undefined;
  markerCodes?: readonly number[];
  /** Shows or clears the test pattern on every screen owned by this camera. */
  onImagingPattern?: (request?: string) => Promise<void>;
}

/** Coordinates an explicit calibration task; setup and phone requests have independent lifetimes. */
export class CalibrationWorkflow {
  private automaticEvidence?: ReturnType<typeof fitExploration>['evidence'];
  private readonly listeners = new Set<() => void>();
  private notificationPending = false;
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private readonly changed = () => {
    if (!this.listeners.size || this.notificationPending) return;
    this.notificationPending = true;
    queueMicrotask(() => {
      this.notificationPending = false;
      for (const notify of this.listeners) notify();
    });
  };
  phoneHeartbeat() {
    // A keepalive cannot substitute for a fresh observation during motion.
    if (
      !this.measuring() &&
      this.state?.logo?.state !== 'drawing' &&
      this.debugLogo?.state !== 'drawing'
    )
      this.phone.lastSeen = Date.now();
    if (this.state?.calibration) this.changed();
    void this.recoverSamplingSocket();
  }
  private measuring() {
    return (
      this.state &&
      ['collecting', 'reprobing', 'verifying'].includes(this.state.stage)
    );
  }
  disconnectPhone(transportLost = true) {
    if (!transportLost) this.socketRecovery = undefined;
    else if (this.socketRecovery) this.socketRecovery.awaitingClose = false;
    this.phone.lastSeen = 0;
    this.options.onPhoneObservation?.();
    if (
      this.measuring() ||
      (this.state?.stage === 'safety' &&
        (!transportLost || this.boundaryPreflight !== this.state)) ||
      this.state?.stage === 'returning'
    ) {
      this.retryVerification = this.state?.stage !== 'collecting';
      this.interrupt(
        'Phone disconnected during calibration. Restart this step.',
        undefined,
        transportLost ? 'phone' : undefined,
      );
    }
    this.changed();
  }
  private readonly phoneLinks: () => { name: string; url: string }[];
  private state?: SessionState;
  private debugLogo?: CalibrationLogoStatus;
  private input?: AssistedCalibrationInput;
  private readonly phone: CalibrationPhoneSession;
  private capture?: Promise<void>;
  private captureOperationId?: string;
  private verification?: Promise<void>;
  private readonly configuration: CalibrationSetup;
  private measurements?: AutomaticCapture;
  private recordPositionRequested = false;
  private fittedGeometry?: Fit;
  private persistedCalibrationId?: string;
  private deviceRevision = 0;
  private attemptRevision = 0;
  private assertAttempt(revision: number) {
    if (this.attemptRevision !== revision)
      throw new RobotArmError(
        'ACTION_STOPPED',
        'Calibration attempt was cancelled',
        409,
      );
  }
  /** A new Device lease keeps the phone and optical setup, but owns fresh samples. */
  resetAttempt() {
    if (
      this.activeAction ||
      this.capture ||
      this.verification ||
      this.ownsOperation()
    )
      throw new RobotArmError(
        'BUSY',
        'Previous calibration is still stopping',
        409,
      );
    this.attemptRevision++;
    this.socketRecovery = undefined;
    this.automaticSamplingStop = undefined;
    this.debugLogo = undefined;
    this.state = undefined;
    this.measurements = undefined;
    this.fittedGeometry = undefined;
    this.automaticEvidence = undefined;
    this.persistedCalibrationId = undefined;
    this.captureOperationId = undefined;
    this.receipt = undefined;
    this.receivingTarget = undefined;
    this.batchTravelTipZMm = undefined;
    this.batchParking = undefined;
    this.phoneHome = false;
    this.changed();
  }
  recording() {
    if (!this.measurements)
      throw new RobotArmError('INVALID_STAGE', 'No points have been collected');
    return {
      deviceId: this.options.deviceId,
      calibrationProfileId: this.persistedCalibrationId,
      explorationMode: this.state!.explorationMode,
      points: this.measurements.snapshot().points,
      input: structuredClone(this.input!),
      mapping: structuredClone(this.state!.mapping!),
      geometryKey: this.geometryKey!,
      referencePosition: structuredClone(this.state!.referencePosition!),
      safePosition: structuredClone(this.state!.safePosition),
      failedAttempts:
        this.state!.stage !== 'completed' &&
        this.state!.verificationAttempts?.some((a) => !a.hit)
          ? structuredClone(this.state!.verificationAttempts)
          : undefined,
    } satisfies AssistedCalibrationRecording;
  }
  async restoreRecording(
    recording: AssistedCalibrationRecording,
    confirmed: boolean,
  ) {
    if (!confirmed)
      throw new RobotArmError(
        'CONFIRMATION_REQUIRED',
        'Confirm that the phone, robot and tool have not moved since collection',
        409,
      );
    if (
      this.activeAction ||
      this.capture ||
      this.verification ||
      this.runtime.current()?.status === 'running'
    )
      throw new RobotArmError(
        'BUSY',
        'Finish the current operation before restoring points',
        409,
      );
    if (recording?.deviceId !== this.options.deviceId)
      throw new RobotArmError(
        'PROFILE_MISMATCH',
        'Collected points belong to a different screen',
        409,
      );
    const gridCount = recording?.points?.length === 9 ? 6 : 9;
    const checkCount = gridCount === 6 ? 2 : 3;
    if (
      !recording ||
      !(
        recording.points?.length === 14 ||
        (recording.points?.length === gridCount + 3 &&
          recording.points
            .slice(0, 3)
            .every((p) => p.purpose === 'direction') &&
          recording.points.slice(3).filter((p) => p.purpose === 'check')
            .length === checkCount &&
          recording.points.slice(3).filter((p) => p.purpose === 'fit')
            .length ===
            gridCount - checkCount)
      ) ||
      !recording.referencePosition ||
      !recording.mapping
    )
      throw new RobotArmError(
        'CALIBRATION_INVALID',
        'Restore requires a complete exploration recording with its configuration',
      );
    if (
      calibrationGeometryKey(this.runtime, recording.input) !==
      recording.geometryKey
    )
      throw new RobotArmError(
        'CALIBRATION_INVALID',
        'Robot or tool configuration changed since collection',
        409,
      );
    assertPose(recording.referencePosition);
    const revision = this.attemptRevision;
    this.beginAction();
    try {
      await this.configuration.restore(recording.input, recording.mapping);
      this.assertAttempt(revision);
      this.beginTask(recording.mapping, recording.referencePosition);
      this.state!.explorationMode = recording.explorationMode;
      const tool = this.runtime.profileStore.getTool(
        recording.input.toolProfileId,
      );
      const measurements = new AutomaticCapture(
        recording.mapping.layout,
        tool.offsetMm,
        this.changed,
        recording.explorationMode,
      );
      const directions = recording.points.length - gridCount;
      measurements.localPoints.push(
        ...structuredClone(recording.points.slice(0, directions)),
      );
      measurements.points.push(
        ...structuredClone(recording.points.slice(directions)),
      );
      measurements.reference = structuredClone(recording.referencePosition);
      this.measurements = measurements;
      if (recording.calibrationProfileId) {
        const c = this.runtime.profileStore.getCalibration(
          recording.calibrationProfileId,
        );
        const screen = this.runtime.profileStore.getScreen(c.screenProfileId);
        const robot = this.runtime.profileStore.getRobot(
          recording.input.robotProfileId,
        );
        if (
          c.robotProfileId !== robot.id ||
          c.toolProfileId !== tool.id ||
          c.robotGeometryRevision !== robot.geometryRevision ||
          c.toolGeometryRevision !== tool.geometryRevision ||
          c.phoneFrame.width !== recording.mapping.layout.width ||
          c.phoneFrame.height !== recording.mapping.layout.height
        )
          throw new RobotArmError(
            'CALIBRATION_INVALID',
            'Saved geometry does not match the recording configuration',
          );
        const {
          kind,
          origin,
          xAxis,
          yAxis,
          inward,
          orientation,
          plane,
          phoneFrame,
          geometryFrame,
          quality,
          surface,
        } = c;
        this.fittedGeometry = structuredClone({
          kind,
          origin,
          xAxis,
          yAxis,
          inward,
          orientation,
          plane,
          phoneFrame,
          geometryFrame,
          quality,
          surface,
          physicalWidthMm: screen.physicalWidthMm,
          physicalHeightMm: screen.physicalHeightMm,
          fitResidualsMm: measurements.points.map((p) =>
            distance(
              p.positionMm,
              add(
                origin,
                add(
                  scale(
                    xAxis,
                    (p.point.x / phoneFrame.width) * screen.physicalWidthMm,
                  ),
                  scale(
                    yAxis,
                    (p.point.y / phoneFrame.height) * screen.physicalHeightMm,
                  ),
                ),
              ),
            ),
          ),
        });
        assertSafeObservation(
          this.fittedGeometry,
          recording.referencePosition,
          tool.offsetMm,
          this.input!.motion!.safeHeightMm,
        );
        this.state!.fitResidualsMm = this.fittedGeometry.fitResidualsMm;
      } else this.fitMeasurements();
      if (recording.safePosition) {
        assertPose(recording.safePosition);
        assertSafeObservation(
          this.fittedGeometry!,
          recording.safePosition,
          tool.offsetMm,
          this.input!.motion!.safeHeightMm,
        );
        this.state!.safePosition = structuredClone(recording.safePosition);
      }
      if (this.state!.explorationQuality?.warnings?.length) {
        this.captureStopRevision = this.runtime.stopRevision;
        this.state!.stage = 'boundary-review';
        return this.status()!;
      }
      this.state!.stage = 'return-ready';
      if (recording.safePosition) {
        this.state!.stage = 'returning';
        // Restore measured geometry, but never replay movement or old verification.
        await this.adopt(this.fittedGeometry!, recording.safePosition, false);
        this.state!.stage = 'safety';
        this.state!.verificationAttempts = structuredClone(
          recording.failedAttempts,
        );
      }
      return this.status()!;
    } catch (error) {
      if (this.state) this.interrupt(errorText(error));
      throw error;
    } finally {
      this.endAction();
      this.changed();
    }
  }
  private acceptingAutomatically = false;
  private retryVerification = false;
  private receipt?: WebVerificationResult;
  private receivingTarget?: string;
  private activeAction?: Promise<void>;
  private resolveAction?: () => void;
  private beginAction() {
    this.activeAction = new Promise<void>((resolve) => {
      this.resolveAction = resolve;
    });
  }
  private endAction() {
    this.resolveAction?.();
    this.resolveAction = undefined;
    this.activeAction = undefined;
  }
  private geometryKey?: string;
  constructor(
    private readonly runtime: RobotArmRuntime,
    private readonly options: AssistedCalibrationOptions,
  ) {
    this.phone = new CalibrationPhoneSession(options.markerCodes);
    this.phoneLinks = options.phoneLinks ?? (() => []);
    this.configuration = new CalibrationSetup(
      runtime,
      this.phone,
      options.vision,
      options.deviceId,
    );
  }
  private displayStage(s: SessionState) {
    return s.stage === 'safety' && s.calibration?.auto?.avoidingCamera
      ? 'avoiding-camera'
      : s.stage;
  }
  status(): AssistedCalibrationState | null {
    if (!this.state) return null;
    const s = this.state;

    if (s.calibration) {
      s.calibration = this.runtime.getSession(s.calibration.id);
      if (
        ['interrupted', 'cancelled'].includes(s.calibration.status ?? '') &&
        !['completed', 'cancelled', 'interrupted'].includes(s.stage)
      ) {
        if (s.autoRepair) s.autoRepair.active = false;
        s.interruptedFrom = this.displayStage(s);
        s.collectionFailed = s.stage === 'collecting';
        s.stage = 'interrupted';
        s.error ??=
          'Calibration was interrupted. Restart calibration here when ready.';
      }
    }
    return structuredClone({
      ...s,
      ...(this.measurements?.snapshot() ?? {
        samples: 0,
        anchors: [],
        points: [],
      }),
      stage: this.displayStage(s),
      awaitingSocketRecovery:
        this.socketRecovery?.session === s &&
        this.socketRecovery.stopRevision === this.runtime.stopRevision &&
        this.runtime.canRecoverSamplingSocket(this.socketRecovery.operationId),
      finishingAutomatically:
        this.automaticRun?.session === s && this.automaticRun.finish,
      phoneConnected: this.phone?.connected() ?? false,
      layout: s.mapping?.layout ?? this.phone?.update?.layout,
    });
  }
  private require(id?: string) {
    if (
      !this.state ||
      (id && this.state.id !== id) ||
      this.state.stage === 'cancelled'
    )
      throw new RobotArmError(
        'CALIBRATION_REQUIRED',
        'Start calibration in the Calibration step',
        409,
      );
    return this.state;
  }
  phoneStatus(): CalibrationPhoneStatus {
    const model = this.phone.update?.model;
    return {
      state: this.phone.presence(),
      displayRequirement: this.phone.update && this.phone.displayRequirement(),
      diagnostics: this.phone.update && {
        version: this.phone.update.touchDiagnosticsVersion,
        wakeState: this.phone.update.wakeState,
        fullscreen: this.phone.update.fullscreen,
        pageId: this.phone.update.pageId,
        receivedAt: this.phone.lastUpdateAt,
        updateSequence: this.phone.update.sequence,
        contact: Boolean(this.phone.update.contact),
        feedback: this.phone.update.stepFeedback,
        events: this.phone.update.touchEvents ?? [],
      },
      links: this.phoneLinks(),
      model:
        typeof model === 'string'
          ? model.trim().slice(0, 80) || undefined
          : undefined,
    };
  }
  openPhonePage(): string {
    return this.phone.openPage();
  }
  receivePhone(update: CalibrationPageUpdate): CalibrationPageReply {
    const reloaded = this.phone.receive(update);
    this.changed();
    const input = this.phone.update!;
    this.options.onPhoneObservation?.(
      this.phone.connected() ? input : undefined,
    );
    const s = this.state;
    if (!s || s.stage === 'cancelled') return this.phoneView();
    if (reloaded) {
      this.measurements?.resetStability();
    }
    if (
      reloaded &&
      this.boundaryPreflight !== s &&
      [
        'collecting',
        'reprobing',
        'safety',
        'verifying',
        'boundary-review',
      ].includes(s.stage)
    ) {
      this.retryVerification = s.stage !== 'collecting';
      this.interrupt(
        this.retryVerification
          ? 'Phone page changed. Confirm the setup and restart verification.'
          : 'Phone page changed. Restart point collection.',
      );
    }
    if (
      s.mapping &&
      !sameLayout(s.mapping.layout, input.layout) &&
      [
        'collecting',
        'reprobing',
        'capture-failed',
        'boundary-review',
        'verifying',
        'safety',
        'returning',
      ].includes(s.stage)
    )
      this.interrupt(
        'The phone layout changed. Check camera mapping before restarting here.',
      );
    if (
      (!input.visible || this.phone.displayRequirement()) &&
      this.boundaryPreflight !== s &&
      ['collecting', 'reprobing', 'verifying', 'safety', 'returning'].includes(
        s.stage,
      )
    ) {
      this.retryVerification = s.stage !== 'collecting';
      this.interrupt(
        'Keep the phone page visible during verification. Restart here when ready.',
        undefined,
        this.automaticRun?.session === s &&
          !input.visible &&
          !this.phone.displayRequirement()
          ? 'phone-timeout'
          : undefined,
      );
    }
    if (s.stage === 'collecting') this.measurements?.receive(input);
    if (s.stage === 'verifying' && s.target) {
      const touches =
        input.touches?.filter((t) => t.targetId === s.target!.id) ?? [];
      if (touches.length && this.receivingTarget !== s.target.id) {
        this.interrupt(
          'An unexpected touch occurred before the robot tap. Keep hands clear during verification.',
        );
      } else if (touches.length > 1 || (touches.length > 0 && this.receipt))
        this.interrupt(
          'A repeated touch was detected. Check contact and release settings.',
        );
      else if (touches.length === 1) {
        const touch = touches[0];
        this.receipt = {
          id: s.target.id,
          target: s.target.point,
          actual: touch.point,
          durationMs: touch.durationMs,
          errorPx: pointDistance(touch.point, s.target.point),
        };
      }
    }
    void this.recoverSamplingSocket();
    return this.phoneView();
  }
  private markerRequest?: string;
  private aligned = false;
  private insetMarkers = false;

  requestMarkerDisplay(reposition = false) {
    this.debugLogo = undefined;
    if (reposition) this.insetMarkers = !this.insetMarkers;
    this.phoneHome = false;
    this.markerRequest = randomUUID();
    this.aligned = false;
    this.changed();
    return this.markerRequest;
  }
  markerObservation(request: string) {
    const update = this.phone.update;
    if (
      this.phone.connected() &&
      update?.markersPainted &&
      update.markerRequest === request &&
      this.markerRequest === request &&
      this.phoneView().view === 'markers'
    )
      return update;
  }
  finishMarkerDisplay(request: string, aligned: boolean) {
    if (this.markerRequest !== request) return;
    this.markerRequest = undefined;
    this.aligned = aligned;
    this.changed();
  }
  private phoneHome = false;
  private imagingRequest?: string;
  private imagingStatus?: AssistedCalibrationSetup['imaging'];
  private imagingRun?: Promise<void>;
  private imagingGeneration = 0;
  restorePhoneHome() {
    this.debugLogo = undefined;
    this.phoneHome = true;
    this.changed();
  }
  resumePhonePage() {
    this.phoneHome = false;
    this.changed();
  }
  private visibilityProbe?: CalibrationPageReply['visibilityProbe'];
  private visibilityContext?: CalibrationPageUpdate;
  showVisibilityProbe(phase: 0 | 1, pattern?: ScreenVisibilityProbePattern) {
    if (this.visibilityProbe)
      throw new RobotArmError(
        'BUSY',
        'A screen visibility check is already active',
        409,
      );
    if (this.phone.presence() !== 'connected') this.phone.assertConnected();
    this.visibilityContext = structuredClone(this.phone.update!);
    const id = randomUUID();
    this.visibilityProbe = { id, phase, pattern };
    this.options.onPhoneObservation?.(undefined);
    this.changed();
    return id;
  }
  visibilityObservation(id: string) {
    const update = this.phone.update;
    return this.visibilityProbe?.id === id &&
      this.phone.connected() &&
      update &&
      this.visibilityContext &&
      update?.pageId === this.visibilityContext?.pageId &&
      update?.browserInstanceId === this.visibilityContext?.browserInstanceId &&
      (this.visibilityContext.displayMode === 'browser' ||
        sameLayout(update.layout, this.visibilityContext.layout)) &&
      update?.visibilityProbeAck === id
      ? update
      : undefined;
  }
  clearVisibilityProbe(id: string) {
    if (this.visibilityProbe?.id !== id) return;
    this.visibilityProbe = undefined;
    this.visibilityContext = undefined;
    this.changed();
  }
  phoneView(): CalibrationPageReply {
    const view = this.normalPhoneView();
    return this.visibilityProbe
      ? { ...view, visibilityProbe: this.visibilityProbe }
      : view;
  }
  private normalPhoneView(): CalibrationPageReply {
    if (this.phoneHome) return { view: 'waiting', anchors: [] };
    if (this.imagingRequest)
      return {
        view: 'camera-tuning',
        imagingRequest: this.imagingRequest,
        anchors: [],
      };
    if (this.debugLogo)
      return { view: 'completed', logo: this.debugLogo, anchors: [] };
    const s = this.state;
    if (
      !s ||
      s.stage === 'cancelled' ||
      s.stage === 'ready' ||
      (this.markerRequest && ['completed', 'interrupted'].includes(s.stage))
    )
      return {
        view: this.aligned ? 'touch-preview' : 'markers',
        markerRequest: this.markerRequest,
        insetMarkers: this.insetMarkers,
        anchors: [],
      };
    const progress =
      s.stage === 'safety' && s.calibration
        ? this.runtime.getSession(s.calibration.id).progress
        : undefined;
    const imageToWeb = progress?.guide && invertMapping(s.mapping!.webToImage);
    const measurements = this.measurements?.snapshot();
    const stage = s.stage;
    const needsReview =
      stage === 'boundary-review' || stage === 'verification-failed';
    return {
      reviewStage: needsReview ? stage : undefined,
      boundaryGuide:
        progress?.guide && imageToWeb
          ? {
              group: progress.group,
              corners: progress.guide.map((p) =>
                project(imageToWeb, {
                  x: p.x * (this.input!.width - 1),
                  y: p.y * (this.input!.height - 1),
                }),
              ),
            }
          : undefined,
      view: needsReview
        ? 'review'
        : stage === 'positioning-boundary'
          ? 'positioning'
          : stage === 'avoiding-camera'
            ? 'safety'
            : stage === 'positioning-safe'
              ? 'return-ready'
              : stage === 'collecting' || stage === 'reprobing'
                ? 'collect'
                : stage === 'verifying'
                  ? 'verify'
                  : stage,
      logo: s.logo,
      imageTrial: Boolean(s.imageTrial && s.stage === 'verifying'),
      capture:
        s.stage === 'collecting' ||
        s.stage === 'reprobing' ||
        (s.stage === 'interrupted' && s.collectionFailed)
          ? measurements?.capture
          : undefined,
      automaticPhase: measurements?.automaticPhase,
      error: s.error,
      anchors: measurements?.anchors ?? [],
      target: s.target,
    };
  }
  imagingPatternObservation(request: string) {
    const update = this.phone.update;
    return this.imagingRequest === request &&
      this.phone.connected() &&
      update?.visible &&
      update.imagingPatternAck === request
      ? update
      : undefined;
  }
  supportsImagingPattern() {
    return this.phone.update?.imagingPatternSupported === true;
  }
  private async calibrateImaging(generation: number) {
    if (!this.options.vision.calibrateImaging) return;
    const request = randomUUID();
    const patternStartedAt = Date.now();
    if (this.supportsImagingPattern()) this.imagingRequest = request;
    this.imagingStatus = {
      state: 'exposure',
      message: 'Waiting for the phone camera imaging pattern',
      updatedAt: Date.now(),
    };
    this.changed();
    try {
      if (!this.supportsImagingPattern())
        throw new RobotArmError(
          'PHONE_PAGE_OUTDATED',
          'Reload the phone calibration page before tuning the camera image.',
          409,
        );
      await this.options.onImagingPattern?.(request);
      if (generation !== this.imagingGeneration) return;
      this.imagingStatus = await this.options.vision.calibrateImaging();
    } catch (error) {
      this.imagingStatus = {
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now(),
      };
    } finally {
      if (this.imagingRequest === request) {
        const remaining = Math.max(0, 1_000 - (Date.now() - patternStartedAt));
        if (remaining) await delay(remaining);
      }
      if (this.imagingRequest === request) this.imagingRequest = undefined;
      await this.options.onImagingPattern?.(undefined).catch(() => undefined);
      this.changed();
    }
  }
  startImagingCalibration(): Promise<void> {
    if (this.imagingRun) return this.imagingRun;
    const current = this.options.vision.imagingStatus?.() ?? this.imagingStatus;
    if (current?.state === 'ready' || current?.state === 'unsupported')
      return Promise.resolve();
    const generation = ++this.imagingGeneration;
    const run = this.calibrateImaging(generation);
    this.imagingRun = run;
    void run.finally(() => {
      if (this.imagingRun === run) this.imagingRun = undefined;
    });
    return run;
  }
  showImagingPattern(request: string) {
    this.imagingRequest = request;
    this.changed();
  }
  clearImagingPattern(request?: string) {
    if (!request || this.imagingRequest === request)
      this.imagingRequest = undefined;
    this.changed();
  }
  async releaseImaging() {
    this.imagingGeneration++;
    this.imagingRun = undefined;
    await this.options.vision.releaseImaging?.();
    this.imagingStatus = this.options.vision.imagingStatus?.() ?? {
      state: 'released',
      updatedAt: Date.now(),
    };
    this.changed();
  }
  private ownsOperation(): boolean {
    const current = this.runtime.current();
    return (
      current?.status === 'running' &&
      (current.requestId === this.state?.calibration?.id ||
        current.requestId === this.captureOperationId)
    );
  }
  private auditFailure(message: string) {
    const s = this.state!;
    const snapshot = this.measurements?.snapshot();
    void this.runtime.auditStore?.record({
      kind: 'calibration',
      id: s.id,
      outcome: 'failed',
      error: message,
      errorDetails: s.errorDetails,
      detail: structuredClone({
        deviceId: this.options.deviceId,
        stage: s.stage,
        operationId: this.captureOperationId,
        samplingTarget: this.automaticRun?.checkpoint.next,
        samplingAttempt:
          this.automaticRun?.session === s && s.stage === 'collecting'
            ? this.automaticRun.retried
              ? 2
              : 1
            : undefined,
        explorationMode: s.explorationMode,
        phoneConnected: this.phone.connected(),
        phoneDiagnostics: this.phoneStatus().diagnostics,
        phoneObservations: this.measurements?.phoneObservations,
        coarsePhoneObservations: this.measurements?.coarsePhoneObservations,
        slideRecoveries: this.measurements?.slideRecoveries,
        capture: snapshot?.capture,
        points: snapshot?.points,
        verificationAttempts: s.verificationAttempts,
        verification: s.verification,
      }),
    });
  }
  private captureStopRevision?: number;
  private boundaryPreflight?: SessionState;
  private automaticRun?: AutomaticRun;
  private automaticSamplingStop?: { id: string; before: number; after: number };
  private socketRecovery?: {
    session: SessionState;
    operationId: string;
    stopRevision: number;
    phone: CalibrationPageUpdate;
    waitForPhoneUpdate: boolean;
    awaitingClose: boolean;
    retryAfter: number;
    stop?: Promise<void>;
    deadline: number;
  };

  followsAutomaticSamplingStop(id: string, revision: number) {
    const stop = this.automaticSamplingStop;
    return (
      stop?.id === id &&
      stop.before === revision &&
      stop.after === this.runtime.stopRevision
    );
  }

  private async recoverSamplingSocket() {
    const pending = this.socketRecovery;
    if (!pending || !this.phone.update) return;
    const s = pending.session;
    if (this.automaticRun?.session === s) return;
    const phone = this.phone.update!;
    if (
      (phone.browserInstanceId ?? phone.pageId) !==
        (pending.phone.browserInstanceId ?? pending.phone.pageId) ||
      this.state !== s ||
      s.stage !== 'interrupted' ||
      this.runtime.stopRevision !== pending.stopRevision ||
      !s.mapping ||
      !sameLayout(s.mapping.layout, phone.layout)
    ) {
      this.socketRecovery = undefined;
      return;
    }
    // A missing measurement alone can be a suspended page on a healthy socket.
    if (pending.awaitingClose) {
      if (phone === pending.phone) return;
      if (phone.pageId === pending.phone.pageId) {
        this.socketRecovery = undefined;
        return;
      }
    }
    if (
      this.activeAction ||
      this.capture ||
      this.verification ||
      !this.phone.connected() ||
      Date.now() < pending.retryAfter ||
      (pending.waitForPhoneUpdate && phone === pending.phone)
    )
      return;
    const revision = this.attemptRevision;
    const guard = () => {
      this.assertAttempt(revision);
      this.runtime.assertStopRevision(pending.stopRevision);
      const current = this.phone.assertConnected();
      if (
        this.socketRecovery !== pending ||
        this.state !== s ||
        s.stage !== 'interrupted' ||
        (current.browserInstanceId ?? current.pageId) !==
          (phone.browserInstanceId ?? phone.pageId) ||
        !s.mapping ||
        !sameLayout(s.mapping.layout, current.layout) ||
        this.currentGeometryKey() !== this.geometryKey
      )
        throw new RobotArmError(
          'STALE_CONTEXT',
          'Calibration context changed during recovery',
          409,
        );
    };
    this.beginAction();
    try {
      const mapping = await this.configuration.assertCurrent();
      guard();
      await this.runtime.recoverSamplingSocket(
        pending.operationId,
        pending.stopRevision,
        guard,
      );
      guard();
      this.beginTask(mapping, s.referencePosition, s.safePosition);
      this.state!.teachingId = s.teachingId;
      this.state!.cameraBoundaryPosition = s.cameraBoundaryPosition;
      this.state!.cameraBoundaryEndPosition = s.cameraBoundaryEndPosition;
    } catch (error) {
      if (
        isRobotArmError(error) &&
        ['DISCONNECTED', 'BUSY', 'STATE_STALE', 'PHONE_DISCONNECTED'].includes(
          error.code,
        )
      )
        pending.retryAfter = Date.now() + 1000;
      else {
        this.socketRecovery = undefined;
        if (this.state === s && s.stage === 'interrupted')
          s.error = errorText(error);
      }
    } finally {
      this.endAction();
      this.changed();
    }
  }
  private interrupt(
    message: string,
    cause?: unknown,
    lostSocket?: 'phone' | 'phone-timeout' | 'controller',
  ) {
    this.state!.errorDetails =
      cause instanceof RobotArmError
        ? { code: cause.code, status: cause.status, details: cause.details }
        : undefined;
    this.auditFailure(message);
    const s = this.state!;
    const owned = this.ownsOperation();
    if (s.autoRepair) s.autoRepair.active = false;
    if (s.stage !== 'interrupted') {
      s.interruptedFrom = this.displayStage(s);
      s.collectionFailed = s.stage === 'collecting';
    }
    const run = this.automaticRun;
    const automatic = run?.session === s ? run : undefined;
    const socketOnly =
      s.collectionFailed &&
      lostSocket &&
      this.captureStopRevision === this.runtime.stopRevision &&
      (automatic
        ? lostSocket !== 'controller' && !automatic.retried && owned
        : this.batchAttempt !== s.id);
    this.socketRecovery = undefined;
    s.stage = 'interrupted';
    this.changed();
    s.error = message;
    s.target = undefined;
    const before = this.runtime.stopRevision;
    const stop = owned
      ? this.runtime.stopCalibrationOperation(Boolean(socketOnly))
      : undefined;
    void stop?.catch((e) => log('Failed to stop interrupted calibration:', e));
    if (socketOnly && this.phone.update && this.captureOperationId) {
      this.socketRecovery = {
        session: s,
        operationId: this.captureOperationId,
        stopRevision: this.runtime.stopRevision,
        phone: this.phone.update,
        waitForPhoneUpdate: lostSocket !== 'controller',
        awaitingClose: lostSocket === 'phone-timeout',
        retryAfter: 0,
        stop,
        deadline: performance.now() + SAMPLING_RECOVERY_MS,
      };
      if (automatic) {
        this.automaticSamplingStop = {
          id: s.id,
          before,
          after: this.runtime.stopRevision,
        };
        s.automaticRecovery = {
          kind: 'phone',
          reason: 'Phone feedback was lost during automatic collection',
          attempt: 2,
        };
      }
    }
  }
  private markerCapture?: AssistedCalibrationSetup['markerCapture'];
  private mappingCheck?: AssistedCalibrationSetup['mappingCheck'];
  setMarkerCapture(value?: AssistedCalibrationSetup['markerCapture']) {
    this.markerCapture = value;
    this.changed();
  }
  setup(): AssistedCalibrationSetup {
    const setup = this.configuration.status();
    const { layout, mapping } = setup;
    return {
      ...setup,
      mapping:
        layout && mapping && sameLayout(mapping.layout, layout)
          ? mapping
          : undefined,
      markerCapture: this.markerCapture,
      mappingCheck: this.mappingCheck,
      imaging: this.options.vision.imagingStatus?.() ?? this.imagingStatus,
    };
  }
  async prepare(input: AssistedCalibrationInput) {
    return this.configureSetup(() => {
      this.mappingCheck = undefined;
      return this.configuration.prepare(input);
    });
  }
  async mapSetup(
    output?: AssistedMappingInput,
    options: {
      reuseVisibleMarkers?: boolean;
      deferImagingCalibration?: boolean;
      reuseAppliedPerspective?: boolean;
      signal?: AbortSignal;
    } = {},
  ) {
    return this.configureSetup(async () => {
      options.signal?.throwIfAborted();
      let request: string | undefined;
      let mapped = false;
      const previousMapping =
        this.configuration.status()?.mapping ??
        (this.options.deviceId
          ? this.runtime.profileStore.calibrationMapping(this.options.deviceId)
              ?.mapping
          : undefined);
      this.mappingCheck = 'checking';
      this.changed();
      try {
        const result = await this.configuration.map(
          output,
          async () => {
            options.signal?.throwIfAborted();
            // An unchanged mapping can be confirmed while the touch preview is open.
            // A fresh optical check needs the phone to paint the codes again.
            const view = this.phoneView().view;
            const page = this.phone.update;
            if (
              options.reuseVisibleMarkers &&
              view === 'markers' &&
              page?.markersPainted
            )
              return;
            let expected = this.markerRequest;
            if (!expected) {
              if (
                !options.reuseAppliedPerspective &&
                view !== 'touch-preview' &&
                !(
                  view === 'markers' &&
                  (page?.markersPainted === false ||
                    page?.markerRequest !== undefined)
                )
              )
                return;
              request = this.requestMarkerDisplay();
              expected = request;
            }
            const deadline = Date.now() + 12000;
            while (!this.markerObservation(expected)) {
              if (this.markerRequest !== expected || Date.now() >= deadline)
                throw new RobotArmError(
                  'PAGE_CHANGED',
                  'The phone did not report visible screen markers. Keep the paired page in the foreground.',
                  409,
                );
              this.phone.assertAvailable();
              await delay(80, undefined, { signal: options.signal });
            }
          },
          options.signal,
        );
        mapped = Boolean(result.mapping);
        const mappingChanged =
          mapped &&
          (!previousMapping ||
            previousMapping.vision.fingerprint !==
              result.mapping!.vision.fingerprint);
        // A page-only mapping leaves the perspective and its imaging binding intact.
        if (mappingChanged && !options.reuseAppliedPerspective) {
          await this.releaseImaging();
          if (!options.deferImagingCalibration)
            void this.startImagingCalibration();
        }
        if (!this.markerRequest && this.phone.update?.markersPainted && mapped)
          this.aligned = true;
        return result;
      } finally {
        this.mappingCheck = mapped ? 'confirmed' : 'failed';
        if (request) this.finishMarkerDisplay(request, mapped);
      }
    });
  }
  /** The camera correction was cleared, so the page mapping no longer holds. */
  async clearMapping() {
    return this.configureSetup(async () => {
      this.imagingGeneration++;
      this.imagingRun = undefined;
      await this.options.vision.releaseImaging?.();
      this.imagingStatus = this.options.vision.imagingStatus?.() ?? {
        state: 'released',
        message:
          'Camera imaging controls are released until the new mapping is ready',
        updatedAt: Date.now(),
      };
      this.mappingCheck = undefined;
      return this.configuration.clearMapping();
    });
  }
  /** Apply a manual perspective without replaying marker or imaging calibration. */
  async rebindCameraMapping() {
    return this.configureSetup(async () => {
      const setup = await this.configuration.rebindCurrentMapping();
      if (setup.mapping) this.mappingCheck = 'confirmed';
      return setup;
    });
  }
  private async configureSetup(
    work: () => AssistedCalibrationSetup | Promise<AssistedCalibrationSetup>,
  ) {
    if (
      this.activeAction ||
      this.capture ||
      this.verification ||
      this.ownsOperation()
    )
      throw new RobotArmError(
        'BUSY',
        'Finish the current calibration operation first',
        409,
      );
    const configurationKey = () =>
      semanticJson([
        this.configuration.status().prepared
          ? this.configuration.inputSnapshot()
          : undefined,
        this.configuration.status().mapping,
      ]);
    const previous = configurationKey();
    this.beginAction();
    try {
      const result = await work();
      // UI entry can check the same setup more than once. Preserve measured
      // teaching and collected evidence unless the actual configuration changed.
      if (
        previous !== configurationKey() ||
        (this.state &&
          this.geometryKey !==
            calibrationGeometryKey(
              this.runtime,
              this.configuration.inputSnapshot(),
            ))
      ) {
        this.state = undefined;
        this.measurements = undefined;
      }
      return result;
    } catch (error) {
      this.state = undefined;
      this.measurements = undefined;
      throw error;
    } finally {
      this.endAction();
      this.changed();
    }
  }
  private batchAttempt?: string;
  async create(
    options: { batch?: boolean } = {},
  ): Promise<AssistedCalibrationState> {
    if (
      this.activeAction ||
      this.capture ||
      this.verification ||
      this.ownsOperation()
    )
      throw new RobotArmError(
        'BUSY',
        'Finish the current calibration operation first',
        409,
      );
    const revision = this.attemptRevision;
    this.beginAction();
    try {
      const mapping = await this.configuration.assertCurrent();
      this.assertAttempt(revision);
      this.beginTask(mapping);
      this.batchAttempt = options.batch ? this.state!.id : undefined;
      const teaching = this.runtime.profileStore.installationTeaching(
        this.input!,
      );
      if (teaching) {
        this.state!.referencePosition =
          !teaching.referenceDeviceId ||
          teaching.referenceDeviceId === this.options.deviceId
            ? teaching.referencePose
            : undefined;
        this.state!.cameraBoundaryPosition = teaching.poses.cameraBoundary;
        this.state!.cameraBoundaryEndPosition =
          teaching.poses.cameraBoundaryEnd;
        this.state!.teachingId = teaching.id;
        this.state!.referencePosition =
          this.options.referencePosition?.() ?? this.state!.referencePosition;
      }
      return this.status()!;
    } finally {
      this.endAction();
      this.changed();
    }
  }
  private beginTask(
    mapping: NonNullable<AssistedCalibrationState['mapping']>,
    referencePosition?: CartesianPose,
    safePosition?: CartesianPose,
  ) {
    this.socketRecovery = undefined;
    this.automaticSamplingStop = undefined;
    this.phoneHome = false;
    this.retryVerification = false;
    this.debugLogo = undefined;
    this.receipt = undefined;
    this.receivingTarget = undefined;
    this.deviceRevision = this.options.deviceId
      ? (this.runtime.profileStore.deviceBinding(this.options.deviceId)
          ?.revision ?? 0)
      : 0;
    this.input = this.configuration.inputSnapshot();
    this.geometryKey = this.currentGeometryKey();
    this.measurements = undefined;
    this.fittedGeometry = undefined;
    this.automaticEvidence = undefined;
    this.persistedCalibrationId = undefined;
    this.captureOperationId = undefined;
    this.state = {
      id: randomUUID(),
      stage: 'ready',
      mapping,
      motion: { ...this.input.motion! },
      referencePosition,
      safePosition,
      verification: [],
    };
  }
  private currentGeometryKey() {
    return calibrationGeometryKey(this.runtime, this.input!);
  }
  private async assertMechanicalFrame(requirePhone = false) {
    const s = this.require();
    const stage = s.stage;
    const stopRevision = this.runtime.stopRevision;
    const assertCurrentAttempt = () => {
      if (
        this.state !== s ||
        s.stage !== stage ||
        stopRevision !== this.runtime.stopRevision
      )
        throw new RobotArmError(
          'ACTION_STOPPED',
          'Calibration changed or stopped during outline verification',
          409,
        );
    };
    for (let attempt = 0; ; attempt++) {
      assertCurrentAttempt();
      try {
        await this.options.vision.assertPerspectiveCurrent?.();
        break;
      } catch (error) {
        if (
          attempt >= 2 ||
          !isRobotArmError(error) ||
          error.code !== 'VISION_UNAVAILABLE'
        )
          throw error;
        await delay(300 * (attempt + 1));
      }
    }
    assertCurrentAttempt();
    if (requirePhone) this.phone.assertConnected();
    if (
      !s.mapping ||
      (requirePhone && !sameLayout(s.mapping.layout, this.phone.update!.layout))
    )
      throw new RobotArmError(
        'MAPPING_REQUIRED',
        'Check camera mapping before starting calibration',
        409,
      );
    if (this.geometryKey !== this.currentGeometryKey())
      throw new RobotArmError(
        'CALIBRATION_INVALID',
        'Phone layout, robot or tool changed. Check the affected configuration and restart here.',
        409,
      );
  }
  prepareSavedLogoCanvas(): LogoCanvasSession {
    const id = this.options.deviceId;
    const store = this.runtime.profileStore;
    const binding = id && store.deviceBinding(id);
    const saved = id && store.calibrationMapping(id)?.mapping;
    const page = this.phone.assertConnected();
    if (
      !binding ||
      !saved ||
      !sameVisionMapping(saved.vision, binding.vision) ||
      !sameLayoutGeometry(saved.layout, page.layout)
    )
      throw new RobotArmError(
        'MAPPING_REQUIRED',
        'Keep the saved calibration page open in its calibrated orientation',
        409,
      );
    const guard = () => {
      if (
        this.phoneHome ||
        this.markerRequest ||
        this.imagingRequest ||
        this.activeAction ||
        store.deviceBinding(binding.deviceId)?.revision !== binding.revision
      )
        throw new RobotArmError(
          'STALE_CONTEXT',
          'The saved drawing context changed',
          409,
        );
    };
    guard();
    const canvas = this.prepareLogoCanvas(
      page.layout,
      (logo) => {
        this.debugLogo = logo;
      },
      guard,
    );
    if (!canvas)
      throw new RobotArmError(
        'PHONE_PAGE_OUTDATED',
        'Reload the phone calibration page before drawing',
        409,
      );
    return canvas;
  }
  private prepareLogoCanvas(
    layout: CalibrationPageUpdate['layout'],
    setStatus: (status: CalibrationLogoStatus) => void,
    guard: () => void,
    minimumTravelTipZMm?: number,
  ): LogoCanvasSession | undefined {
    const page = this.phone.update;
    if (page?.logoCanvasSupported !== 2 && page?.logoCanvasSupported !== 3)
      return undefined;
    const id = randomUUID();
    let expectedAck = id;
    const assertPage = () => {
      guard();
      const current = this.phone.assertConnected();
      if (
        current.pageId !== page.pageId ||
        !sameLayout(current.layout, layout) ||
        this.visibilityProbe
      )
        throw new RobotArmError(
          'MAPPING_REQUIRED',
          'Keep the same calibrated phone page open while drawing the logo',
          409,
        );
      return current;
    };
    const check = () => {
      if (assertPage().logoCanvasAck !== expectedAck)
        throw new RobotArmError(
          'PHONE_DISPLAY_NOT_READY',
          'The phone drawing canvas is no longer ready',
          409,
        );
    };
    const drawing = { id, expectedStrokes: CALIBRATION_LOGO_STROKE_COUNT };
    const waitForAck = async (signal: AbortSignal) => {
      const deadline = Date.now() + 4_000;
      while (
        assertPage().logoCanvasAck !== expectedAck &&
        Date.now() < deadline
      )
        await delay(50, undefined, { signal });
      signal.throwIfAborted();
      check();
    };
    return {
      viewport: layout,
      minimumTravelTipZMm,
      prepare: async (signal) => {
        signal.throwIfAborted();
        assertPage();
        const started = performance.now();
        setStatus({ ...drawing, state: 'drawing' });
        this.changed();
        await waitForAck(signal);
        debug(
          `Logo canvas ready in ${Math.round(performance.now() - started)} ms`,
        );
      },
      check,
      retryStroke:
        page.logoCanvasSupported === 3
          ? async (stroke, signal) => {
              signal.throwIfAborted();
              check();
              expectedAck = `${id}:${stroke}`;
              setStatus({
                ...drawing,
                state: 'drawing',
                retryFromStroke: stroke,
              });
              this.changed();
              await waitForAck(signal);
            }
          : undefined,
      finish: (error) => {
        setStatus(
          error
            ? { ...drawing, state: 'failed', error }
            : { ...drawing, state: 'completed' },
        );
        this.changed();
      },
    };
  }
  async command(
    id: string,
    action: AssistedCalibrationAction,
    confirmed = false,
    _attemptId?: string,
  ): Promise<AssistedCalibrationState> {
    const s =
      action === 'restart' && this.state?.id === id
        ? this.state
        : this.require(id);
    // Cancellation must preempt a pending read/verification instead of waiting
    // behind the normal command gate and allowing that command to start motion.
    const revision = this.attemptRevision;
    if (action === 'cancel') {
      this.attemptRevision++;
      if (s.stage !== 'completed') await this.cancel();
      return this.status()!;
    }
    if (this.activeAction)
      throw new RobotArmError(
        'BUSY',
        'Another calibration command is running',
        409,
      );
    if (
      s.automaticRecovery ||
      (this.automaticRun?.finish &&
        ['boundary-review', 'review'].includes(s.stage) &&
        !(action === 'accept' && this.acceptingAutomatically))
    )
      throw new RobotArmError(
        'BUSY',
        'Automatic calibration is still running',
        409,
      );
    this.beginAction();
    try {
      if (
        ['auto-repair', 'reprobe', 'apply-reprobe', 'verify'].includes(action)
      )
        throw new RobotArmError(
          'INVALID_COMMAND',
          'Use automatic boundary verification and confirm the calibration result',
          409,
        );
      if (
        action !== 'stop-capture' &&
        this.phone.presence() === 'connected' &&
        this.phone.displayRequirement()
      )
        throw new RobotArmError(
          'PHONE_UNAVAILABLE',
          'Enter the required phone display mode first',
          409,
        );
      if (action === 'restart' || action === 'retry-standard') {
        if (
          action === 'retry-standard' &&
          !(
            s.stage === 'interrupted' &&
            s.collectionFailed &&
            s.explorationMode === 'slide'
          )
        )
          throw new RobotArmError(
            'INVALID_STAGE',
            'No failed sliding collection to retry',
            409,
          );
        if (
          ![
            'interrupted',
            'cancelled',
            'capture-failed',
            'ready',
            'boundary-review',
          ].includes(s.stage) ||
          !confirmed
        )
          throw new RobotArmError(
            'CONFIRMATION_REQUIRED',
            'Confirm before restarting calibration here',
            409,
          );
        const mapping = await this.configuration.assertCurrent();
        this.assertAttempt(revision);
        const sameGeometry = this.geometryKey === this.currentGeometryKey();
        const referencePosition = sameGeometry
          ? s.referencePosition
          : undefined;
        const safePosition = sameGeometry ? s.safePosition : undefined;
        await this.stopPendingWork();
        this.assertAttempt(revision);
        const teachingId = sameGeometry ? s.teachingId : undefined;
        const cameraBoundaryPosition = sameGeometry
          ? s.cameraBoundaryPosition
          : undefined;
        this.beginTask(mapping, referencePosition, safePosition);
        this.state!.teachingId = teachingId;
        this.state!.cameraBoundaryPosition = cameraBoundaryPosition;
        this.state!.cameraBoundaryEndPosition = sameGeometry
          ? s.cameraBoundaryEndPosition
          : undefined;
        if (action === 'retry-standard')
          await this.startCollection(this.state!, 'standard', true, confirmed);
      } else if (action === 'position-boundary') {
        if (
          !confirmed ||
          s.stage !== 'ready' ||
          !s.referencePosition ||
          this.capture
        )
          throw new RobotArmError(
            'INVALID_STAGE',
            'Record the reference position first',
            409,
          );
        await this.assertMechanicalFrame();
        this.recordPositionRequested = false;
        if (s.teachingId || s.cameraBoundaryEndPosition) {
          s.cameraBoundaryPosition = undefined;
          s.cameraBoundaryEndPosition = undefined;
        }
        s.teachingId = undefined;
        s.stage = 'positioning-boundary';
        this.capture = this.recordPosition(false, true)
          .catch((e) => {
            if (s.stage === 'positioning-boundary') s.stage = 'ready';
            s.error = errorText(e);
          })
          .finally(() => {
            this.capture = undefined;
            this.changed();
          });
      } else if (action === 'record-boundary') {
        if (!confirmed || s.stage !== 'positioning-boundary' || !this.capture)
          throw new RobotArmError(
            'INVALID_STAGE',
            'Position the arm at the camera-side boundary first',
            409,
          );
        const recordingEnd = Boolean(s.cameraBoundaryPosition);
        this.recordPositionRequested = true;
        await this.capture;
        if (
          !(recordingEnd
            ? s.cameraBoundaryEndPosition
            : s.cameraBoundaryPosition)
        )
          throw new RobotArmError(
            'NOT_READY',
            s.error ?? 'Boundary was not recorded',
            409,
          );
      } else if (action === 'save-teaching') {
        if (
          !confirmed ||
          s.stage !== 'ready' ||
          !s.referencePosition ||
          !s.cameraBoundaryPosition ||
          !s.cameraBoundaryEndPosition ||
          this.capture
        )
          throw new RobotArmError(
            'CONFIRMATION_REQUIRED',
            'Record the reference and both boundary points, then confirm the clear arm corridor',
            409,
          );
        await this.assertMechanicalFrame();
        const tool = this.runtime.profileStore.getTool(
          this.input!.toolProfileId,
        );
        const reference = s.referencePosition;
        const boundary = s.cameraBoundaryPosition;
        const boundaryEnd = s.cameraBoundaryEndPosition;
        const cameraBoundary = taughtCameraBoundary(
          reference,
          boundary,
          boundaryEnd,
          tool,
        );
        const teaching = {
          id: randomUUID(),
          recordedAt: new Date().toISOString(),
          referenceDeviceId: this.options.deviceId,
          robotProfileId: this.input!.robotProfileId,
          toolProfileId: tool.id,
          cameraId: this.input!.cameraId,
          robotGeometryRevision: this.runtime.profileStore.getRobot(
            this.input!.robotProfileId,
          ).geometryRevision,
          toolGeometryRevision: tool.geometryRevision,
          referencePose: reference,
          poses: {
            reference,
            cameraBoundary: boundary,
            cameraBoundaryEnd: boundaryEnd,
          },
          cameraBoundary,
          corridorConfirmed: true as const,
        };
        await this.runtime.configure(() =>
          this.runtime.profileStore.saveInstallationTeaching(teaching),
        );
        s.teachingId = teaching.id;
      } else if (action === 'position-reference') {
        if (!['ready', 'reference-required'].includes(s.stage) || this.capture)
          throw new RobotArmError(
            'INVALID_STAGE',
            'Set a calibration reference position before collecting points',
            409,
          );
        if (!confirmed)
          throw new RobotArmError(
            'CONFIRMATION_REQUIRED',
            'Confirm before entering Drag Mode',
            409,
          );
        await this.assertMechanicalFrame();
        this.recordPositionRequested = false;
        s.error = undefined;
        // Replacing an existing reference starts a new teaching draft. A new
        // screen only needs a sampling start within the shared installation.
        if (s.referencePosition || !s.teachingId) {
          s.cameraBoundaryPosition = undefined;
          s.cameraBoundaryEndPosition = undefined;
          s.teachingId = undefined;
        }
        s.referencePosition = undefined;
        s.stage = 'positioning';
        this.capture = this.recordPosition()
          .catch((e) => {
            if (s.stage === 'positioning') s.stage = 'ready';
            s.error ??= errorText(e);
            log('Reference position recording failed:', e);
          })
          .finally(() => {
            this.changed();
            this.capture = undefined;
          });
      } else if (action === 'record-reference') {
        if (s.stage !== 'positioning' || !this.capture)
          throw new RobotArmError(
            'INVALID_STAGE',
            'Position the stylus above the screen first',
            409,
          );
        if (!confirmed)
          throw new RobotArmError(
            'CONFIRMATION_REQUIRED',
            'Release the robot before recording the reference position',
            409,
          );
        this.recordPositionRequested = true;
        await this.capture;
        if (
          !['ready', 'return-ready'].includes(this.status()?.stage ?? '') ||
          !s.referencePosition
        )
          throw new RobotArmError(
            'REFERENCE_POSITION_NOT_RECORDED',
            s.error ?? 'Reference position was not recorded',
            409,
          );
      } else if (action === 'position-safe' && s.calibration?.auto) {
        if (
          !['return-ready', 'positioning-safe'].includes(s.stage) ||
          !confirmed
        )
          throw new RobotArmError(
            'INVALID_STAGE',
            'Complete boundary verification before recording the Safe Position',
            409,
          );
        s.calibration = await this.runtime.calibrationCommand(
          s.calibration.id,
          {
            type: 'enter-drag',
            commandId: randomUUID(),
            expectedRevision: s.calibration.revision,
          },
        );
        s.stage = 'positioning-safe';
      } else if (
        (action === 'record-safe' || action === 'confirm-safe-visibility') &&
        s.calibration?.auto
      ) {
        if (s.stage !== 'positioning-safe' || !confirmed)
          throw new RobotArmError(
            'CONFIRMATION_REQUIRED',
            'Release the robot before recording the Safe Position',
            409,
          );
        const manualVisibility = action === 'confirm-safe-visibility';
        if (manualVisibility && !s.canConfirmSafeVisibility)
          throw new RobotArmError(
            'INVALID_STAGE',
            'Run the camera visibility check before confirming it manually',
            409,
          );
        s.canConfirmSafeVisibility = undefined;
        if (manualVisibility) {
          await this.assertMechanicalFrame(true);
          this.assertAttempt(revision);
        }
        try {
          s.calibration = await this.runtime.calibrationCommand(
            s.calibration.id,
            {
              type: 'record-observation',
              commandId: randomUUID(),
              expectedRevision: s.calibration.revision,
            },
            undefined,
            this.changed,
            manualVisibility ? undefined : this.visibilityVerifier(),
          );
        } catch (error) {
          if (isRobotArmError(error) && error.code === 'CAMERA_OCCLUDED')
            s.canConfirmSafeVisibility = true;
          throw error;
        }
        s.safePosition = s.calibration.candidate!.observationPose;
        s.stage = 'review';
        s.error = undefined;
      } else if (action === 'position-safe') {
        if (!['ready', 'return-ready'].includes(s.stage) || this.capture)
          throw new RobotArmError(
            'INVALID_STAGE',
            'Record the safe position before collection or after the plane is fitted',
            409,
          );
        if (!confirmed)
          throw new RobotArmError(
            'CONFIRMATION_REQUIRED',
            'Confirm before entering Drag Mode',
            409,
          );
        await this.assertMechanicalFrame();
        this.recordPositionRequested = false;
        s.safePosition = undefined;
        s.error = undefined;
        s.stage = 'positioning-safe';
        this.capture = this.recordPosition(true)
          .catch((e) => {
            if (s.stage === 'positioning-safe')
              s.stage = this.fittedGeometry ? 'return-ready' : 'ready';
            s.error ??= errorText(e);
            log('Safe position recording failed:', e);
          })
          .finally(() => {
            this.changed();
            this.capture = undefined;
          });
      } else if (action === 'record-safe') {
        if (s.stage !== 'positioning-safe' || !this.capture)
          throw new RobotArmError(
            'INVALID_STAGE',
            'Position the robot at its task return location first',
            409,
          );
        if (!confirmed)
          throw new RobotArmError(
            'CONFIRMATION_REQUIRED',
            'Release the robot before recording the safe position',
            409,
          );
        this.recordPositionRequested = true;
        await this.capture;
        if (
          !s.safePosition ||
          !['ready', 'return-ready'].includes(this.status()?.stage ?? '')
        )
          throw new RobotArmError(
            'SAFE_POSITION_NOT_RECORDED',
            s.error ?? 'Safe position was not recorded',
            409,
          );
        if (this.fittedGeometry) this.startSafeReturn();
      } else if (action === 'return-safe') {
        if (
          !confirmed ||
          this.capture ||
          s.stage !== 'return-ready' ||
          !s.safePosition ||
          !this.fittedGeometry
        )
          throw new RobotArmError(
            'INVALID_STAGE',
            'Confirm the checked return path before moving',
            409,
          );
        this.startSafeReturn();
      } else if (
        [
          'start',
          'start-automatic',
          'start-fast',
          'start-slide',
          'start-unattended-slide',
        ].includes(action)
      ) {
        const mode =
          action === 'start-slide' || action === 'start-unattended-slide'
            ? 'slide'
            : action === 'start-fast'
              ? 'fast'
              : 'standard';
        const finish = action === 'start-unattended-slide';
        await this.startCollection(
          s,
          mode,
          action !== 'start',
          confirmed,
          finish,
        );
      } else if (
        action === 'stop-capture' &&
        s.calibration?.auto &&
        s.stage === 'positioning-safe'
      ) {
        s.calibration = await this.runtime.calibrationCommand(
          s.calibration.id,
          {
            type: 'exit-drag',
            commandId: randomUUID(),
            expectedRevision: s.calibration.revision,
          },
        );
        s.stage = 'return-ready';
      } else if (action === 'stop-capture') {
        if (
          ![
            'positioning',
            'positioning-boundary',
            'positioning-safe',
            'collecting',
            'capture-failed',
            'return-ready',
          ].includes(s.stage)
        )
          throw new RobotArmError(
            'INVALID_STAGE',
            'Manual positioning or point collection is not running',
            409,
          );
        s.stage = this.fittedGeometry ? 'return-ready' : 'ready';
        s.error = undefined;
        if (this.ownsOperation()) await this.runtime.stop();
        await this.capture;
      } else if (action === 'verify-boundary') {
        if (s.stage !== 'boundary-review' || !confirmed)
          throw new RobotArmError(
            'INVALID_STAGE',
            'Review the measurements before starting boundary verification',
            409,
          );
        await this.configuration.assertCurrent();
        await this.assertMechanicalFrame(true);
        this.assertAttempt(revision);
        if (this.state !== s || s.stage !== 'boundary-review')
          throw new RobotArmError(
            'ACTION_STOPPED',
            'Boundary review was interrupted',
            409,
          );
        try {
          await this.verifyFittedBoundary(s);
        } catch (error) {
          if (
            this.attemptRevision === revision &&
            !['interrupted', 'cancelled'].includes(s.stage)
          )
            this.interrupt(errorText(error), error);
          throw error;
        }
      } else if (action === 'accept') {
        if (
          s.stage !== 'review' ||
          (!s.calibration?.auto && !s.verificationAttempts) ||
          !s.calibration ||
          !confirmed ||
          this.verification
        )
          throw new RobotArmError(
            'NOT_VERIFIED',
            'Complete boundary verification, record the Safe Position and confirm before saving',
            409,
          );
        await this.assertMechanicalFrame(true);
        s.result ??= await this.runtime.acceptWebCalibration(
          s.calibration.id,
          s.calibration.auto
            ? {
                protocol: 'auto-boundary-v1',
                automatic: this.acceptingAutomatically,
              }
            : {
                protocol: 'web-v1',
                coordinateSpace: 'phone',
                layout: s.mapping!.layout,
                results: s.verification,
                attempts: s.verificationAttempts!,
              },
          this.options.deviceId
            ? {
                ...s.binding!,
                deviceId: this.options.deviceId,
                revision: this.deviceRevision,
                cameraId: this.input!.cameraId,
                calibrationProfileId: s.calibration.candidate!.id,
                vision: {
                  ...s.mapping!.vision,
                  confirmedAt: new Date().toISOString(),
                },
              }
            : undefined,
          () => this.assertAttempt(revision),
          s.mapping &&
            this.prepareLogoCanvas(
              s.mapping.layout,
              (logo) => {
                s.logo = logo;
              },
              () => this.assertAttempt(revision),
              this.batchTravelTipZMm,
            ),
        );
        if (this.attemptRevision === revision) s.stage = 'completed';
      } else
        throw new RobotArmError(
          'INVALID_COMMAND',
          'Unknown web calibration command',
        );
      return this.status()!;
    } finally {
      this.endAction();
      this.changed();
    }
  }
  private async startCollection(
    s: SessionState,
    mode: AutomaticExplorationMode,
    automaticWorkflow: boolean,
    confirmed: boolean,
    finish = false,
  ) {
    if (this.capture || s.stage !== 'ready')
      throw new RobotArmError(
        'INVALID_STAGE',
        'Record the starting position before automatic collection',
        409,
      );
    if (!confirmed)
      throw new RobotArmError(
        'CONFIRMATION_REQUIRED',
        'Confirm the contact and motion settings before collecting points',
        409,
      );
    if (!s.referencePosition)
      throw new RobotArmError(
        'REFERENCE_POSITION_REQUIRED',
        'Record a calibration reference position before collecting points',
        409,
      );
    const stopRevision = this.runtime.stopRevision;
    const revision = this.attemptRevision;
    await this.assertMechanicalFrame(true);
    this.assertAttempt(revision);
    this.runtime.assertStopRevision(stopRevision);
    const input = this.input!;
    if (
      this.runtime.profileStore.getTool(input.toolProfileId).contactFrame ===
        'flange' &&
      (!s.teachingId ||
        this.runtime.profileStore.installationTeaching(input)?.id !==
          s.teachingId)
    )
      throw new RobotArmError(
        'INSTALLATION_TEACHING_REQUIRED',
        'Save installation teaching before flange contact calibration',
        409,
      );
    this.captureStopRevision = stopRevision;
    s.automaticWorkflow = automaticWorkflow;
    s.explorationMode = mode;
    s.stage = 'collecting';
    s.error = undefined;
    this.measurements = undefined;
    s.requiredReferenceZ = undefined;
    const run: AutomaticRun | undefined =
      mode === 'slide' && (finish || this.batchAttempt === s.id)
        ? {
            session: s,
            finish,
            retried: false,
            checkpoint: {
              direction: [],
              heights: [],
              grid: [],
              samples: [],
              gridBudgets: new Map(),
              retriedTargets: new Set(),
            },
          }
        : undefined;
    this.automaticRun = run;
    this.capture = (
      run ? this.runAutomaticCollection(run) : this.capturePoints()
    )
      .catch((e) => {
        if (['collecting', 'returning', 'safety'].includes(s.stage)) {
          this.interrupt(
            errorText(e),
            e,
            isRobotArmError(e) && e.code === 'DISCONNECTED'
              ? 'controller'
              : undefined,
          );
          log('Automatic point collection failed:', e);
        } else if (s.automaticRecovery && s.stage === 'interrupted') {
          s.error = errorText(e);
          s.errorDetails = isRobotArmError(e)
            ? { code: e.code, status: e.status, details: e.details }
            : undefined;
        }
      })
      .finally(() => {
        if (run) {
          this.automaticRun = undefined;
          this.socketRecovery = undefined;
          s.automaticRecovery = undefined;
        }
        this.capture = undefined;
        this.changed();
      });
  }

  private async runAutomaticCollection(run: AutomaticRun) {
    const s = run.session;
    const checkpoint = run.checkpoint;
    const revision = this.attemptRevision;
    while (true) {
      let failure: unknown;
      const recovery: { evidence?: SamplingRetryEvidence } = {};
      try {
        await this.capturePoints(checkpoint, (evidence) => {
          recovery.evidence = evidence;
        });
      } catch (error) {
        failure = error;
      }
      const evidence = recovery.evidence;
      const pending = this.socketRecovery;
      const retry =
        evidence && this.samplingRetryScope(checkpoint, evidence.error);
      if (run.retried || (!pending && (!retry || s.stage !== 'collecting'))) {
        if (failure) throw failure;
        if (run.finish) await this.finishAutomaticCollection(s, revision);
        return;
      }
      const stopRevision = pending?.stopRevision ?? this.captureStopRevision!;
      const originalPhone = pending?.phone ?? this.phone.update;
      const guard = () => {
        this.assertAttempt(revision);
        this.runtime.assertStopRevision(stopRevision);
        const current = this.phone.update;
        if (
          (current?.browserInstanceId ?? current?.pageId) !==
            (originalPhone?.browserInstanceId ?? originalPhone?.pageId) ||
          (current && !sameLayout(s.mapping!.layout, current.layout))
        )
          throw new RobotArmError(
            'STALE_CONTEXT',
            'Calibration context changed during recovery',
            409,
          );
      };
      guard();
      const scope = retry ?? (checkpoint.direction.length ? 'point' : 'screen');
      const mayReleaseLocally = scope !== 'screen' && Boolean(s.teachingId);
      const releasableContact = mayReleaseLocally
        ? (pending?.phone.contact?.id ?? evidence?.contactId)
        : undefined;
      if (pending)
        await this.waitForSamplingReconnect(pending, guard, releasableContact);
      else {
        this.auditFailure(evidence!.error.message);
        s.automaticRecovery = {
          kind: 'sampling',
          scope,
          targetId: checkpoint.next?.targetId,
          reason: evidence!.error.message,
          attempt: 2,
        };
        this.changed();
      }
      run.retried = true;
      await this.configuration.assertCurrent();
      await this.assertMechanicalFrame(true);
      const pose = await this.runtime.assertCalibrationMotionReady(
        this.input!.toolProfileId,
      );
      guard();
      const phone = this.phone.assertConnected();
      if (
        (phone.contact && phone.contact.id !== releasableContact) ||
        Date.now() - this.phone.lastUpdateAt >=
          CALIBRATION_PHONE_POLICY.measurementFreshMs
      )
        throw new RobotArmError(
          'TOUCH_NOT_RELEASED',
          'Fresh feedback confirming that the stylus is released is required before restarting sampling.',
          409,
        );
      const reference = s.referencePosition!;
      const expected =
        evidence?.pose ?? (!pending || !s.teachingId ? reference : undefined);
      if (
        (expected && distance(pose.positionMm, expected.positionMm) > 0.5) ||
        quaternionDistance(pose.orientation, reference.orientation) > 0.01
      )
        throw new RobotArmError(
          'REFERENCE_RETURN_FAILED',
          'The robot is not at the verified calibration reference. Check its position before restarting.',
          409,
        );
      this.socketRecovery = undefined;
      this.captureStopRevision = stopRevision;
      this.captureOperationId = undefined;
      this.measurements = undefined;
      checkpoint.releaseBeforeResume = Boolean(phone.contact);
      if (scope === 'screen') checkpoint.direction.length = 0;
      if (scope !== 'point') {
        checkpoint.heights.length = 0;
        checkpoint.grid.length = 0;
        checkpoint.samples.length = checkpoint.direction.length;
        checkpoint.next = undefined;
      }
      this.fittedGeometry = undefined;
      this.automaticEvidence = undefined;
      s.explorationQuality = undefined;
      s.fitResidualsMm = undefined;
      s.requiredReferenceZ = undefined;
      s.error = undefined;
      s.errorDetails = undefined;
      s.collectionFailed = undefined;
      s.interruptedFrom = undefined;
      if (s.automaticRecovery) {
        s.automaticRecovery.kind = 'sampling';
        s.automaticRecovery.scope = scope;
        s.automaticRecovery.targetId =
          scope === 'point' ? checkpoint.next?.targetId : undefined;
      }
      s.stage = 'collecting';
      this.changed();
    }
  }

  private samplingRetryScope(
    checkpoint: FastSamplingCheckpoint,
    error: RobotArmError,
  ): 'point' | 'height' | 'screen' | undefined {
    if (
      error.code === 'CALIBRATION_QUALITY' &&
      error.details?.recoveryPhase === 'height'
    )
      return 'height';
    if (
      error.code === 'CALIBRATION_QUALITY' &&
      error.details?.recoveryPhase === 'reference'
    )
      return 'screen';
    if (
      error.code === 'PHONE_STEP_TIMEOUT' ||
      error.code === 'VISION_UNAVAILABLE'
    )
      return checkpoint.direction.length ? 'point' : 'screen';
    const details = error.details;
    const retryDetails = details?.retryDetails;
    if (
      checkpoint.direction.length &&
      checkpoint.next?.phase === 'grid' &&
      error.code === 'TOUCH_CONTACT_LOST' &&
      details &&
      details.targetId === checkpoint.next.targetId &&
      details.recovery === 'vertical-probe' &&
      details.cause === 'TOUCH_CONTACT_LOST' &&
      details.retryCause === 'PHONE_TOUCH_UNSTABLE' &&
      retryDetails &&
      typeof retryDetails === 'object' &&
      'reason' in retryDetails &&
      retryDetails.reason === 'intermittent_contact'
    )
      return 'point';
    if (
      !checkpoint.direction.length &&
      error.code === 'PHONE_TOUCH_UNSTABLE' &&
      error.details?.reason === 'intermittent_contact'
    )
      return 'screen';
  }

  private async waitForSamplingReconnect(
    pending: NonNullable<CalibrationWorkflow['socketRecovery']>,
    guard: () => void,
    releasableContact?: string,
  ) {
    await pending.stop;
    const { session: s } = pending;
    const check = () => {
      guard();
      if (
        this.socketRecovery !== pending ||
        this.state !== s ||
        s.stage !== 'interrupted' ||
        this.currentGeometryKey() !== this.geometryKey
      )
        throw new RobotArmError(
          'STALE_CONTEXT',
          'Calibration context changed during recovery',
          409,
        );
    };
    while (performance.now() < pending.deadline) {
      check();
      const phone = this.phone.update;
      if (
        phone &&
        phone !== pending.phone &&
        this.phone.connected() &&
        (!phone.contact || phone.contact.id === releasableContact)
      ) {
        try {
          await this.runtime.recoverSamplingSocket(
            pending.operationId,
            pending.stopRevision,
            check,
          );
          check();
          return;
        } catch (error) {
          if (
            !isRobotArmError(error) ||
            !['BUSY', 'STATE_STALE'].includes(error.code)
          )
            throw error;
        }
      }
      await delay(200);
    }
    throw new RobotArmError(
      'PHONE_DISCONNECTED',
      'The calibration page did not recover. Keep the original page visible and fullscreen before restarting.',
      409,
    );
  }

  private async finishAutomaticCollection(s: SessionState, revision: number) {
    this.assertAttempt(revision);
    this.runtime.assertStopRevision(this.captureStopRevision!);
    s.automaticRecovery = undefined;
    if (
      s.stage === 'boundary-review' &&
      !s.explorationQuality?.warnings?.some(
        ({ percent }) => !Number.isFinite(percent) || percent < 0,
      )
    )
      await this.verifyFittedBoundary(s);
    if (s.stage === 'review') {
      try {
        const result = await this.acceptAutomatically();
        if (!result.accepted) s.error = result.reasons.join(' · ');
      } catch (error) {
        if (s.stage === 'review') s.error = errorText(error);
      }
    }
  }
  private async recordPosition(
    recordTaskPosition = false,
    recordBoundary = false,
  ) {
    const s = this.state!;
    const stage = recordBoundary
      ? 'positioning-boundary'
      : recordTaskPosition
        ? 'positioning-safe'
        : 'positioning';
    const task = this.runtime.collectWebPoints(this.input!, async (host) => {
      while (s.stage === stage && !this.recordPositionRequested) {
        host.check();
        await delay(50, undefined, { signal: host.signal });
      }
      if (s.stage !== stage) return;
      const pose = await host.finishDrag();
      await this.assertMechanicalFrame();
      host.check();
      if (s.stage !== stage) return;
      if (recordTaskPosition) {
        const tool = this.runtime.profileStore.getTool(
          this.input!.toolProfileId,
        );
        if (this.fittedGeometry)
          assertSafeObservation(
            this.fittedGeometry,
            pose,
            tool.offsetMm,
            this.input!.motion!.safeHeightMm,
          );
        s.safePosition = pose;
        if (!this.fittedGeometry) s.referencePosition = undefined;
        s.stage = this.fittedGeometry ? 'return-ready' : 'ready';
      } else if (recordBoundary) {
        if (s.cameraBoundaryPosition) s.cameraBoundaryEndPosition = pose;
        else s.cameraBoundaryPosition = pose;
        s.stage = 'ready';
      } else {
        s.referencePosition = pose;
        s.stage = 'ready';
      }
      s.error = undefined;
    });
    this.captureOperationId = this.runtime.current()?.requestId;
    await task;
  }
  private async capturePoints(
    checkpoint?: FastSamplingCheckpoint,
    onRetry?: (evidence: SamplingRetryEvidence) => void,
  ) {
    const s = this.state!;
    const input = this.input!;
    const tool = this.runtime.profileStore.getTool(input.toolProfileId);
    const measurements =
      this.measurements ??
      new AutomaticCapture(
        s.mapping!.layout,
        tool.offsetMm,
        this.changed,
        s.explorationMode,
      );
    this.measurements = measurements;
    if (checkpoint && this.phone.connected())
      measurements.receive(this.phone.update!);
    const collectionInput = {
      ...input,
      onPayloadRecheck: (waiting: boolean) => {
        s.recheckingPayload = waiting || undefined;
        this.changed();
      },
    };
    const collect = async (
      host: AutomaticCaptureHost &
        Required<Pick<AutomaticCaptureHost, 'preflight'>>,
    ) => {
      await this.assertMechanicalFrame(true);
      host.check();
      const teaching = this.runtime.profileStore.installationTeaching(input);
      if (s.teachingId && teaching?.id !== s.teachingId)
        throw new RobotArmError(
          'CALIBRATION_INVALID',
          'Installation teaching changed',
          409,
        );
      const reference = s.referencePosition!;
      const knownTravelTipZMm = Math.max(
        knownScreenTravelHeight(this.runtime.profileStore.list(), input),
        this.batchTravelTipZMm ?? Number.NEGATIVE_INFINITY,
      );
      const allowDirectTravel =
        (s.explorationMode === 'fast' || s.explorationMode === 'slide') &&
        teaching !== undefined &&
        semanticJson(reference) === semanticJson(teaching.referencePose);
      const travelToReference = async (reason: 'approach' | 'return') => {
        s.referenceTravel = reason;
        this.changed();
        try {
          await moveToTaughtPosition(
            host,
            teaching,
            tool,
            reference,
            input.motion!,
            knownTravelTipZMm,
            {
              attemptId: s.id,
              direction: reason,
              allowDirect: allowDirectTravel,
            },
          );
        } catch (error) {
          if (!isRobotArmError(error)) throw error;
          throw new RobotArmError(error.code, error.message, error.status, {
            ...error.details,
            referenceTravel: reason,
          });
        } finally {
          s.referenceTravel = undefined;
          this.changed();
        }
      };
      if (teaching && !checkpoint?.direction.length)
        await travelToReference('approach');
      let lastMoveConfirmed = false;
      const checkCollecting = () => {
        host.check();
        if (s.stage !== 'collecting')
          throw new RobotArmError(
            'ACTION_STOPPED',
            'Automatic collection stopped',
            409,
          );
      };
      const samplingTiming = new Map<string, { count: number; ms: number }>();
      const trackTiming = (event: string, elapsedMs: number) => {
        const previous = samplingTiming.get(event) ?? { count: 0, ms: 0 };
        samplingTiming.set(event, {
          count: previous.count + 1,
          ms: previous.ms + elapsedMs,
        });
      };
      try {
        await measurements.run(
          {
            ...host,
            check: checkCollecting,
            move: async (pose, options) => {
              lastMoveConfirmed = false;
              const actual = await host.move(pose, options);
              lastMoveConfirmed = true;
              return actual;
            },
          },
          reference,
          {
            tool,
            checkpoint,
            webToImage: s.mapping!.webToImage,
            directTravel: allowDirectTravel
              ? {
                  teaching,
                  minimumTipZMm: Math.max(
                    contactPoint(reference, tool.offsetMm).z,
                    knownTravelTipZMm,
                  ),
                }
              : undefined,
            minimumTravelTipZMm: Math.max(
              teaching
                ? contactPoint(teaching.referencePose, tool.offsetMm).z
                : Number.NEGATIVE_INFINITY,
              this.batchTravelTipZMm ?? Number.NEGATIVE_INFINITY,
            ),
            onTiming: trackTiming,
            screen: {
              ...input.motion!,
              id: s.id,
              name: 'Exploration draft',
              revision: 1,
              geometryRevision: 1,
              updatedAt: new Date().toISOString(),
              direction: 'right-down',
              physicalWidthMm: 0,
              physicalHeightMm: 0,
              pixelWidth: input.width,
              pixelHeight: input.height,
            },
          },
        );
        await this.assertMechanicalFrame(true);
        checkCollecting();
        this.fitMeasurements();
        this.logSamplingTiming(s.id, samplingTiming);
      } catch (error) {
        this.logSamplingTiming(s.id, samplingTiming);
        const retryScope =
          checkpoint &&
          isRobotArmError(error) &&
          this.samplingRetryScope(checkpoint, error);
        if (
          this.automaticRun?.session === s &&
          s.stage === 'collecting' &&
          isRobotArmError(error) &&
          error.code === 'PHONE_DISCONNECTED'
        )
          this.interrupt(error.message, error, 'phone-timeout');
        if (
          !lastMoveConfirmed ||
          !isRobotArmError(error) ||
          (checkpoint && error.code === 'TOUCH_SAFETY_LIMIT') ||
          (!recoverableSamplingErrors.has(error.code) && !retryScope)
        )
          throw error;
        checkCollecting();
        await this.assertMechanicalFrame(true);
        checkCollecting();
        if (
          retryScope &&
          retryScope !== 'screen' &&
          teaching &&
          !this.automaticRun?.retried
        ) {
          const pose = await host.read();
          checkCollecting();
          onRetry?.({ error, pose, contactId: this.phone.update?.contact?.id });
          throw error;
        }
        try {
          await travelToReference('return');
          onRetry?.({ error });
        } catch (returnError) {
          throw new RobotArmError(
            isRobotArmError(returnError)
              ? returnError.code
              : 'REFERENCE_RETURN_FAILED',
            `${error.message}. Return to the calibration reference failed: ${errorText(returnError)}`,
            isRobotArmError(returnError) ? returnError.status : 409,
            { samplingError: error.code },
          );
        }
        throw error;
      }
      // Sampling can finish with the tip pressed. Park using the measured
      // reference before waiting for a review of the new geometry.
      if (lastMoveConfirmed && s.explorationQuality?.warnings?.length)
        await travelToReference('return');
      if (
        measurements.coarsePhoneObservations.length ||
        measurements.slideRecoveries.length
      )
        void this.runtime.auditStore?.record({
          kind: 'calibration',
          id: s.id,
          outcome: 'completed',
          detail: structuredClone({
            stage: 'automatic-sampling',
            deviceId: this.options.deviceId,
            coarsePhoneObservations: measurements.coarsePhoneObservations,
            slideRecoveries: measurements.slideRecoveries,
          }),
        });
    };
    const task = this.runtime.collectAutomaticPoints(collectionInput, collect);
    this.captureOperationId = this.runtime.current()?.requestId;
    let outlineCheck: Promise<void> | undefined;
    let nextOutlineCheck = 0;
    const watchdog = setInterval(() => {
      if (s.stage === 'collecting' && !this.phone.connected())
        this.interrupt(
          'Phone feedback was lost during automatic collection',
          undefined,
          'phone-timeout',
        );
      if (
        s.stage === 'collecting' &&
        !outlineCheck &&
        Date.now() >= nextOutlineCheck
      ) {
        nextOutlineCheck = Date.now() + 1_000;
        outlineCheck = this.assertMechanicalFrame(true)
          .catch((error) => {
            if (s.stage === 'collecting')
              this.interrupt(errorText(error), error);
          })
          .finally(() => {
            outlineCheck = undefined;
          });
      }
    }, 100);
    try {
      await task;
    } finally {
      clearInterval(watchdog);
      await outlineCheck;
    }
    if (s.stage !== 'collecting') return;
    s.automaticRecovery = undefined;
    this.runtime.assertStopRevision(this.captureStopRevision!);
    if (s.explorationQuality?.warnings?.length) {
      s.stage = 'boundary-review';
      this.changed();
      return;
    }
    await this.verifyFittedBoundary(s);
  }

  private async verifyFittedBoundary(s: SessionState) {
    this.runtime.assertStopRevision(this.captureStopRevision!);
    s.stage = 'returning';
    this.changed();
    await this.adopt(this.fittedGeometry!, s.referencePosition!, false);
    if (s.stage !== 'returning') return;
    s.stage = 'safety';
    const phone = this.phone.update;
    const assertBoundaryFrame = async () => {
      await this.assertMechanicalFrame(true);
      const current = this.phone.update;
      if (
        s.explorationMode === 'slide' &&
        (current?.browserInstanceId ?? current?.pageId) !==
          (phone?.browserInstanceId ?? phone?.pageId)
      )
        throw new RobotArmError(
          'STALE_CONTEXT',
          'Calibration page changed during boundary verification',
          409,
        );
    };
    const verify = async (
      boundaryStep?: CalibrationCommand['boundaryStep'],
    ) => {
      s.calibration = await this.runtime.calibrationCommand(
        s.calibration!.id,
        {
          type: 'verify-automatic-boundary',
          ...(boundaryStep && { boundaryStep }),
          accepted: true,
          commandId: randomUUID(),
          expectedRevision: s.calibration!.revision,
        },
        assertBoundaryFrame,
        this.changed,
        this.visibilityVerifier(),
      );
    };
    if (s.explorationMode === 'slide') {
      const revision = this.attemptRevision;
      let recovered = false;
      for (const step of ['hover', 'contact', 'parking'] as const) {
        this.assertAttempt(revision);
        this.runtime.assertStopRevision(this.captureStopRevision!);
        if (s.stage !== 'safety') return;
        try {
          this.boundaryPreflight = s;
          try {
            await assertBoundaryFrame();
          } finally {
            this.boundaryPreflight = undefined;
          }
          await verify(step);
        } catch (error) {
          const current = this.runtime.getSession(s.calibration!.id);
          if (
            recovered ||
            s.stage !== 'safety' ||
            current.status !== 'active' ||
            !isRobotArmError(error) ||
            error.details?.recoveryRequired === true ||
            !['PHONE_DISCONNECTED', 'VISION_UNAVAILABLE'].includes(error.code)
          )
            throw error;
          recovered = true;
          this.boundaryPreflight = s;
          s.automaticRecovery = {
            kind: 'verification',
            reason: error.message,
            attempt: 2,
          };
          this.changed();
          try {
            await this.waitForVerificationPage(s, revision, phone);
          } finally {
            this.boundaryPreflight = undefined;
            s.automaticRecovery = undefined;
            this.changed();
          }
          s.calibration = current;
          await verify(step);
        }
      }
    } else await verify();
    if (s.stage !== 'safety') return;
    const calibration = s.calibration;
    if (!calibration)
      throw new RobotArmError(
        'INVALID_SESSION',
        'Boundary verification session is missing',
        409,
      );
    const auto = calibration.auto;
    if (auto?.deferParkingBatchId || auto?.observationRecorded) {
      s.safePosition = auto.observationRecorded
        ? calibration.candidate!.observationPose
        : undefined;
      s.stage = 'review';
    } else {
      s.safePosition = undefined;
      s.stage = 'return-ready';
      if (s.teachingId)
        s.error =
          auto?.cameraVisibility?.clear === false
            ? 'The camera could not verify the current screen after automatic parking. Check the live view or record a Safe Position manually.'
            : 'No reachable camera-clear Safe Position was found within the bounded search.';
    }
    this.changed();
  }

  private async waitForVerificationPage(
    s: SessionState,
    revision: number,
    phone?: CalibrationPageUpdate,
  ) {
    const deadline = performance.now() + SAMPLING_RECOVERY_MS;
    await delay(200);
    while (true) {
      this.assertAttempt(revision);
      this.runtime.assertStopRevision(this.captureStopRevision!);
      const current = this.phone.update;
      if (
        s.stage !== 'safety' ||
        (current?.browserInstanceId ?? current?.pageId) !==
          (phone?.browserInstanceId ?? phone?.pageId) ||
        (current && !sameLayout(s.mapping!.layout, current.layout))
      )
        throw new RobotArmError(
          'STALE_CONTEXT',
          'Calibration context changed during recovery',
          409,
        );
      if (
        this.phone.connected() &&
        !current?.contact &&
        Date.now() - this.phone.lastUpdateAt <
          CALIBRATION_PHONE_POLICY.measurementFreshMs
      ) {
        await this.assertMechanicalFrame(true);
        this.assertAttempt(revision);
        return;
      }
      if (performance.now() >= deadline)
        throw new RobotArmError(
          'PHONE_DISCONNECTED',
          'The calibration page did not recover. Keep the original page visible and fullscreen before restarting.',
          409,
        );
      await delay(200);
    }
  }

  /**
   * Sampling stages are a fixed cost; log them per attempt so a speed change can
   * be read off one normal run instead of a dedicated experiment.
   */
  private logSamplingTiming(
    attemptId: string,
    timing: ReadonlyMap<string, { count: number; ms: number }>,
  ) {
    if (!timing.size) return;
    // One JSON object per attempt so the log report can parse it without
    // depending on the logger's object formatting.
    debug(
      `Automatic sampling timing ${JSON.stringify({
        attemptId,
        deviceId: this.options.deviceId,
        timing: Object.fromEntries(
          [...timing].map(([event, entry]) => [
            event,
            { count: entry.count, ms: Math.round(entry.ms) },
          ]),
        ),
      })}`,
    );
  }

  private fitMeasurements() {
    const s = this.state!;
    const input = this.input!;
    const measurements = this.measurements!;
    const tool = this.runtime.profileStore.getTool(input.toolProfileId);
    const screen = {
      ...input.motion!,
      id: s.id,
      name: 'Exploration draft',
      revision: 1,
      geometryRevision: 1,
      updatedAt: new Date().toISOString(),
      direction: 'right-down',
      physicalWidthMm: 0,
      physicalHeightMm: 0,
      pixelWidth: input.width,
      pixelHeight: input.height,
    };
    const toTouch = (p: (typeof measurements.points)[number]) => ({
      contact: p.positionMm,
      heightIntervalMm: p.probeStep?.heightIntervalMm,
      screen: project(s.mapping!.webToImage, p.point),
      weight: p.weight,
      // The local bridge only records stepped contacts; every height is measured.
      zSource: 'measured' as const,
      pressedZ: p.probeStep
        ? contactPoint(p.probeStep.after, tool.offsetMm).z
        : p.positionMm.z - 0.5,
    });
    const collection = measurements.upstreamResult ?? {
      probes: measurements.localPoints.map(toTouch),
      grid: measurements.points.map((p, index) => ({
        ...toTouch(p),
        target: {
          id: String(index),
          css: p.point,
          screen: project(s.mapping!.webToImage, p.point),
          role:
            p.purpose === 'check' || (!p.purpose && [3, 5, 7].includes(index))
              ? ('validation' as const)
              : ('fit' as const),
        },
      })),
      start: measurements.reference!,
      screen,
    };
    const robot = this.runtime.profileStore.getRobot(input.robotProfileId);
    const result = fitExploration(
      collection,
      tool,
      this.runtime.capabilities,
      {
        id: randomUUID(),
        robotProfileId: robot.id,
        toolProfileId: tool.id,
        screenProfileId: s.id,
        robotGeometryRevision: robot.geometryRevision,
        toolGeometryRevision: tool.geometryRevision,
        screenGeometryRevision: 1,
      },
      s.explorationMode === 'slide' || s.explorationMode === 'fast',
    );
    const candidate = result.candidate;
    const fit: Fit = {
      kind: candidate.kind,
      origin: candidate.origin,
      xAxis: candidate.xAxis,
      yAxis: candidate.yAxis,
      inward: candidate.inward,
      orientation: candidate.orientation,
      plane: candidate.plane,
      quality: candidate.quality,
      surface: candidate.surface,
      ...result.measuredSize,
      phoneFrame: {
        width: s.mapping!.layout.width,
        height: s.mapping!.layout.height,
      },
      geometryFrame: 'screen',
      fitResidualsMm: [],
    };
    s.explorationQuality = {
      gridRmsMm: result.gridRmsMm,
      holdoutMaxMm: result.evidence.validationMaxMm,
      coverage: result.coverage,
      shortSideMm: Math.min(fit.physicalWidthMm, fit.physicalHeightMm),
      warnings: [
        ...result.warnings,
        ...mappingQualityWarnings(s.mapping!.accuracy, s.mapping!.layout),
      ],
    };
    s.fitResidualsMm = fit.fitResidualsMm;
    this.automaticEvidence = result.evidence;
    this.fittedGeometry = fit;
    if (s.safePosition) {
      try {
        assertSafeObservation(
          fit,
          s.safePosition,
          tool.offsetMm,
          input.motion!.safeHeightMm,
        );
      } catch (error) {
        s.safePosition = undefined;
        s.error = errorText(error);
      }
    }
  }

  private startSafeReturn() {
    const s = this.require();
    s.stage = 'returning';
    this.capture = this.finishReturn(this.fittedGeometry!)
      .catch((error) => {
        this.interrupt(errorText(error));
        log('Safe position adoption failed:', error);
      })
      .finally(() => {
        this.changed();
        this.capture = undefined;
      });
  }

  private async finishReturn(fit: Fit) {
    const s = this.state!;
    await this.assertMechanicalFrame();
    if (s.stage !== 'returning') return;
    if (!s.safePosition)
      throw new RobotArmError(
        'SAFE_POSITION_REQUIRED',
        'Record a separate safe position before verification',
        409,
      );
    await this.adopt(fit, s.safePosition);
    if (s.stage !== 'returning') return;
    s.stage = 'safety';
    s.error = undefined;
    if (s.automaticWorkflow && s.calibration) {
      this.changed();
      await this.calibrationCommand(s.id, {
        type: 'verify-hover-boundary',
        commandId: randomUUID(),
        expectedRevision: s.calibration.revision,
      });
    }
  }

  private async adopt(
    fit: Fit,
    safePosition: CartesianPose,
    returnToSafe = true,
  ) {
    const s = this.state!;
    const i = this.input!;
    const store = this.runtime.profileStore;
    const {
      physicalWidthMm,
      physicalHeightMm,
      fitResidualsMm: _residuals,
      ...geometry
    } = fit;
    let pending!: CalibrationProfile;
    await this.runtime.configure(async () => {
      if (this.geometryKey !== this.currentGeometryKey())
        throw new RobotArmError('CALIBRATION_INVALID', 'Tool geometry changed');
      const robot = store.getRobot(i.robotProfileId);
      const tool = store.getTool(i.toolProfileId);
      const screen = await store.putScreen({
        id: randomUUID(),
        name: 'Web-calibrated screen',
        direction: 'right-down',
        ...i.motion!,
        physicalWidthMm,
        physicalHeightMm,
        pixelWidth: i.width,
        pixelHeight: i.height,
        phoneMapping: {
          ...fit.phoneFrame,
          imageToPhone: invertMapping(s.mapping!.webToImage),
          visionFingerprint: s.mapping!.vision.fingerprint,
        },
      });
      const now = new Date().toISOString();
      s.binding = {
        robotProfileId: robot.id,
        toolProfileId: tool.id,
        screenProfileId: screen.id,
      };
      pending = {
        ...s.binding,
        ...geometry,
        id: randomUUID(),
        geometryStatus: 'valid',
        acceptanceStatus: 'pending',
        robotGeometryRevision: robot.geometryRevision,
        toolGeometryRevision: tool.geometryRevision,
        screenGeometryRevision: screen.geometryRevision,
        screenRevision: screen.revision,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        observationPose: safePosition,
      };
      await store.saveCalibration(pending);
      this.persistedCalibrationId = pending.id;
      const binding = await store.putWorkstation({
        ...s.binding,
        revision: store.list().workstation?.revision ?? 0,
        cameraId: i.cameraId,
        calibrationProfileId: pending.id,
      });
      await store.confirmVision(
        { ...s.mapping!.vision, confirmedAt: now },
        binding.revision,
      );
    });
    await this.startVerificationSession(pending.id, returnToSafe);
  }

  private async startVerificationSession(
    profileId: string,
    returnToSafe: boolean,
  ) {
    const s = this.state!;
    const checkReturning = () => {
      if (s.stage !== 'returning')
        throw new RobotArmError(
          'ACTION_CANCELLED',
          'Calibration was interrupted before safety preparation',
          409,
        );
    };
    checkReturning();
    const previousOperationId = this.runtime.current()?.requestId;
    let travelTipZMm = this.batchTravelTipZMm;
    if (this.batchParking) {
      const store = this.runtime.profileStore;
      const knownHeight = knownScreenTravelHeight(store.list(), s.binding!);
      if (Number.isFinite(knownHeight))
        travelTipZMm = Math.max(travelTipZMm ?? knownHeight, knownHeight);
    }
    const starting = this.runtime.startCalibration(s.binding!, profileId, {
      reuseObservation: !returnToSafe,
      auto: this.automaticEvidence
        ? {
            evidence: this.automaticEvidence,
            deferParkingBatchId: this.batchParking,
            minimumTravelTipZMm: travelTipZMm,
            startPose: s.referencePosition!,
            fast:
              s.explorationMode !== 'standard' &&
              !s.explorationQuality?.warnings?.length,
          }
        : undefined,
    });
    const operation = this.runtime.current();
    // startCalibration acquires synchronously; claim that lease before its
    // readiness/persistence await so cancellation can stop startup as well.
    if (
      operation?.kind === 'calibration' &&
      operation.requestId !== previousOperationId
    )
      this.captureOperationId = operation.requestId;
    s.calibration = await starting;
    checkReturning();
    if (!returnToSafe) return;
    s.calibration = await this.runtime.calibrationCommand(s.calibration.id, {
      type: 'return-observation',
      accepted: true,
      commandId: randomUUID(),
      expectedRevision: s.calibration.revision,
    });
    checkReturning();
  }

  async calibrationCommand(id: string, command: CalibrationCommand) {
    const s = this.require(id);
    if (s.stage !== 'safety' || !s.calibration)
      throw new RobotArmError(
        'INVALID_STAGE',
        'Safety preparation is not active',
        409,
      );
    if (
      ![
        'enter-drag',
        'exit-drag',
        'verify-hover-boundary',
        'verify-contact-boundary',
        'confirm-hover-boundary',
      ].includes(command.type)
    )
      throw new RobotArmError(
        'INVALID_COMMAND',
        'This calibration command is unavailable',
      );
    await this.assertMechanicalFrame();
    if (
      command.type === 'verify-hover-boundary' ||
      command.type === 'verify-contact-boundary'
    )
      await this.configuration.assertCurrent();
    s.calibration = await this.runtime.calibrationCommand(
      s.calibration.id,
      command,
      undefined,
      this.changed,
    );
    this.changed();
    return this.status()!;
  }
  private async cancel() {
    const s = this.state!;
    if (s.autoRepair) s.autoRepair.active = false;
    s.stage = 'cancelled';
    s.target = undefined;
    this.changed();
    await this.stopPendingWork();
    if (!s.result) s.stage = 'cancelled';
  }
  private async stopPendingWork() {
    if (this.ownsOperation()) await this.runtime.stopCalibrationOperation();
    await this.capture;
    await this.verification;
  }
  setBatchReference(pose: CartesianPose) {
    const state = this.require();
    if (state.stage !== 'ready' || this.capture)
      throw new RobotArmError(
        'INVALID_STAGE',
        'Finish the current operation before confirming placement',
        409,
      );
    assertPose(pose);
    state.referencePosition = structuredClone(pose);
    this.changed();
  }
  private batchTravelTipZMm?: number;
  private batchParking?: string;
  setBatchParking(batchId?: string) {
    this.batchParking = batchId;
  }
  private visibilityVerifier() {
    if (this.batchParking) return undefined;
    const vision = this.options.vision;
    const correction = vision.getCorrection?.();
    if (!correction || !vision.rawFrame) return undefined;
    return (signal: AbortSignal) =>
      verifyScreenVisibility(
        [
          {
            id: this.options.deviceId ?? 'screen',
            points: pageOrderedQuad(correction.points, correction.rotation),
            sourceWidth: correction.sourceWidth,
            sourceHeight: correction.sourceHeight,
            show: (phase, pattern) => this.showVisibilityProbe(phase, pattern),
            observation: (id) => this.visibilityObservation(id),
            clear: (id) => this.clearVisibilityProbe(id),
          },
        ],
        () => vision.rawFrame!(),
        signal,
        () => {
          this.runtime.assertStopRevision(this.captureStopRevision!);
          if (
            semanticJson(vision.getCorrection?.()) !== semanticJson(correction)
          )
            throw new RobotArmError(
              'VISION_BINDING_CHANGED',
              'The screen mapping changed during visibility verification.',
              409,
            );
        },
      );
  }

  setBatchTravelHeight(value?: number) {
    if (value !== undefined && !Number.isFinite(value))
      throw new RobotArmError('INVALID_ARGUMENT', 'Invalid travel height');
    this.batchTravelTipZMm = value;
  }
  phoneObservation() {
    return this.phone.update ? structuredClone(this.phone.update) : undefined;
  }
  async acceptAutomatically() {
    const state = this.status();
    const c = state?.calibration;
    const evidence = c?.auto?.evidence;
    const reasons: string[] = [];
    if (
      state?.stage !== 'review' ||
      (!c?.auto?.deferParkingBatchId &&
        (!c?.auto?.observationRecorded || !c.auto.cameraAvoidanceRecorded))
    )
      reasons.push('The camera-avoidance Safe Position is missing');
    if (
      !c?.candidate ||
      c.candidate.geometryStatus !== 'valid' ||
      c.candidate.acceptanceStatus !== 'pending'
    )
      reasons.push('The automatic result has no valid pending candidate');
    const quality = c?.candidate?.quality;
    if (
      !quality ||
      !evidence ||
      !Number.isInteger(quality.inliers) ||
      !Number.isInteger(quality.total) ||
      quality.inliers < 5 ||
      quality.inliers > quality.total ||
      !Array.isArray(evidence.samples) ||
      evidence.samples.length < 7 ||
      (evidence.planeSource !== 'measured' &&
        !(
          (state?.explorationMode === 'slide' ||
            state?.explorationMode === 'fast') &&
          evidence.planeSource === 'assumed-horizontal'
        )) ||
      // An assumed plane must have at least one measured held-out height;
      // without it the tilt audit never ran and the assumption is unverified.
      (evidence.planeSource === 'assumed-horizontal' &&
        evidence.validationHeightMaxMm === undefined) ||
      !Number.isFinite(evidence.surfaceMaxMm ?? 0) ||
      (evidence.surfaceMaxMm ?? 0) > SAMPLED_SURFACE_LIMIT_MM
    )
      reasons.push(
        'Automatic acceptance requires complete contact and plane evidence for the selected sampling mode',
      );
    if (
      state?.explorationQuality?.warnings?.some(
        ({ percent }) => !Number.isFinite(percent) || percent < 0,
      )
    )
      reasons.push('Automatic acceptance requires valid quality measurements');
    if (
      !c?.boundary ||
      ![
        c.boundary.hoverCorners,
        c.boundary.hoverEdges,
        c.boundary.contactCorners,
        c.boundary.contactEdges,
      ].every(Boolean)
    )
      reasons.push('Complete both boundary verification groups');
    if (!this.setup().teaching) reasons.push('Installation teaching changed');
    if (reasons.length) return { accepted: false, reasons };
    const revision = this.attemptRevision;
    const stopRevision = this.runtime.stopRevision;
    const phone = this.phone.update;
    const guard = () => {
      this.assertAttempt(revision);
      this.runtime.assertStopRevision(stopRevision);
      const current = this.phone.update;
      if (
        this.state?.id !== state!.id ||
        this.state.stage !== 'review' ||
        (phone?.browserInstanceId ?? phone?.pageId) !==
          (current?.browserInstanceId ?? current?.pageId) ||
        (current && !sameLayout(state!.mapping!.layout, current.layout))
      )
        throw new RobotArmError(
          'STALE_CONTEXT',
          'Calibration context changed before saving',
          409,
        );
    };
    const accept = async () => {
      guard();
      await this.configuration.assertCurrent();
      guard();
      this.acceptingAutomatically = true;
      try {
        await this.command(state!.id, 'accept', true);
      } finally {
        this.acceptingAutomatically = false;
      }
    };
    try {
      await accept();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      const phoneLost =
        code === 'PHONE_DISCONNECTED' || code === 'PHONE_UNAVAILABLE';
      if (
        !phoneLost &&
        !['VISION_UNAVAILABLE', 'EBUSY', 'EAGAIN'].includes(code ?? '')
      )
        throw error;
      // The store commits both the candidate and session together. If the
      // commit completed, preserve that result and avoid repeating acceptance.
      const saved = this.runtime.getSession(c!.id);
      if (
        saved.status === 'completed' &&
        saved.candidate?.acceptanceStatus === 'accepted'
      ) {
        if (this.state?.id === state!.id && this.state.stage === 'review') {
          this.state.result = saved.candidate;
          this.state.stage = 'completed';
          this.changed();
        }
        return { accepted: true, reasons: [] };
      }
      await delay(200);
      if (phoneLost) {
        const deadline = performance.now() + SAMPLING_RECOVERY_MS;
        while (!this.phone.connected() && performance.now() < deadline) {
          guard();
          await delay(200);
        }
      }
      await accept();
    }
    return { accepted: true, reasons: [] };
  }
  async stop() {
    const pending = this.activeAction;
    this.attemptRevision++;
    this.socketRecovery = undefined;
    if (this.state && this.state.stage !== 'completed') await this.cancel();
    await pending;
  }
}
