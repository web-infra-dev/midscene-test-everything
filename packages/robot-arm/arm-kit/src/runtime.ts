import { randomUUID } from 'node:crypto';
import { supportsFlangeContact } from '@midscene/robotics-shared/setup-contracts';
import type { MotionTarget } from './application/context.js';
import {
  assertCameraBoundary,
  cameraBoundaryExcessMm,
  taughtCameraBoundary,
} from './application/teaching-constraints.js';
import type {
  AutomaticCaptureHost,
  CalibrationBatchState,
} from './assisted-contracts.js';
import { assertParkingCorridor } from './calibration/camera-avoidance.js';
import { screenContactMm, screenPoseMm } from './calibration/geometry.js';
import { contactDepthMm, surfaceClearanceMm } from './calibration/surface.js';
import { moveToTaughtPosition } from './calibration/taught-position.js';
import {
  type CameraAvoidanceState,
  assertBatchParking,
  assertParkingScreenClearances,
  avoidCamera,
} from './calibration/verification/camera-avoidance.js';
import { applyCalibrationCommand } from './calibration/verification/commands.js';
import {
  calibrationSessionStatus,
  emptyBoundaryVerification,
  resetCalibrationVerification,
  sameCalibrationGeometry,
  verificationContextKey,
} from './calibration/verification/session-state.js';
import { atTravelHeight } from './calibration/verification/travel-height.js';
import {
  type ActionRequest,
  type ActionResult,
  type CalibrationCommand,
  type CalibrationProfile,
  type CalibrationSession,
  type CartesianPose,
  type ContactMoveOptions,
  type CurrentOperation,
  type DeviceBinding,
  type EnableRequest,
  type MotionOptions,
  type MotionResult,
  type PayloadApplicationState,
  type ProfileBinding,
  type ProfileInput,
  type RobotArmAdapter,
  RobotArmError,
  type RobotArmProfile,
  type RobotState,
  type RuntimeState,
  SCREEN_DRIFT_DETECTION_ENABLED,
  SCREEN_TILT_LIMIT_DEGREES,
  type SafePositionRequest,
  type ScreenMotionSettings,
  type ScreenProfile,
  type ScreenVisibilityEvidence,
  type SharedParkingEvidence,
  type ToolProfile,
  type VisionBinding,
  assertScreenMapping,
  assertToolPayload,
  calibrationAccepted,
  evaluatePayloadApplication,
  isPayloadReadbackPending,
  isRobotArmError,
  semanticJson,
} from './contracts.js';
import {
  assertOrientation,
  assertPose,
  assertTarget,
  contactPoint,
  distance,
  dot,
  flangePose,
  quaternionDistance,
  scale,
  sub,
} from './domain.js';
import type { JogTarget, MotionRequest } from './kernel/contracts.js';
import type {
  LinearMotionSequence,
  LinearSequenceTarget,
} from './kernel/contracts.js';
import { MotionExecutor } from './kernel/motion-executor.js';
import { evaluateReadiness } from './kernel/readiness.js';
import { checkRecovery } from './kernel/recovery.js';
import { RobotKernel } from './kernel/robot-kernel.js';
import { ProfileStore, validateScreen } from './runtime/profile-store.js';
import type {
  RobotActionAuditKind,
  RobotActionAuditOutcome,
  RobotActionAuditStore,
} from './runtime/robot-action-audit-store.js';
import { executeContactPlan } from './screen-interaction/contact-executor.js';
import {
  type ContactStage,
  releaseStageOptions,
  stageOptions,
  validateContactPolicy,
} from './screen-interaction/motion-policy.js';
import { effectiveCapabilities } from './screen-interaction/planner.js';
import {
  type ScreenMotionHost,
  executeScreenAction,
  prepareScreenAction,
} from './screen-interaction/service.js';
import {
  type PreparedTransferRoute,
  type TransferRouteInput,
  type TransferScreen,
  assertTransferClearance,
  prepareTransferRoute,
  sampleTransferRoute,
  transferContextKey,
} from './screen-interaction/transfer.js';
export { ProfileStore } from './runtime/profile-store.js';
export {
  DEFAULT_ROBOT_ARM_AUDIT_MAX_BYTES,
  DEFAULT_ROBOT_ARM_AUDIT_RECENT,
  ROBOT_ARM_AUDIT_SCHEMA_VERSION,
  RobotActionAuditStore,
  type RobotActionAuditInput,
  type RobotActionAuditRecord,
  type RobotActionAuditStatus,
  type RobotActionAuditStoreOptions,
} from './runtime/robot-action-audit-store.js';
export interface RobotArmRuntimeOptions {
  adapter: RobotArmAdapter;
  profileStore?: ProfileStore;
  /**
   * Append-only forensic trail. Optional on purpose: a runtime constructed
   * without one audits nothing, which keeps hermetic unit tests from writing
   * files into the repository. The service builds one by default.
   */
  auditStore?: RobotActionAuditStore;
}
type Context = import('./application/context.js').ApplicationContext;
/**
 * How long a jog keeps running without a renewal. The UI renews far more often;
 * this only bounds how far the arm can travel if a release never arrives.
 */
const JOG_LEASE_MS = 500;
/** Starts arriving this soon after a release are renewals, not new presses. */
const JOG_RELEASE_COOLDOWN_MS = 250;
/** How often a failed jog release is retried before a real stop is issued. */
const JOG_RETRY_MS = 400;
const JOG_STOP_ATTEMPTS = 3;
/**
 * How long a pre-motion gate waits for controller feedback that a reset channel
 * invalidated. A socket reset loses the evidence, not the controller's payload
 * configuration: the adapter re-reads that load and re-confirms it as soon as the
 * channels are back. Waiting here keeps a brief gap from failing a run while
 * still refusing every command until the saved payload is confirmed again.
 */
const PAYLOAD_RECONFIRM_TIMEOUT_MS = 3000;
/** Poll interval while waiting for that re-confirmation. */
const PAYLOAD_RECONFIRM_POLL_MS = 100;
function payloadApplicationOf(error: RobotArmError) {
  return error.details?.payloadApplication as
    | PayloadApplicationState
    | undefined;
}
/** The saved payload is unconfirmed only because controller evidence was lost. */
function payloadEvidenceGap(error: RobotArmError) {
  return (
    error.code === 'TOOL_PAYLOAD_NOT_APPLIED' &&
    isPayloadReadbackPending(payloadApplicationOf(error))
  );
}
/** Feedback a reconnect repairs without an operator stop or recovery. */
function isTransientFeedbackLoss(error: RobotArmError) {
  return (
    [
      'DISCONNECTED',
      'QUERY_INTERRUPTED',
      'STATE_STALE',
      'STATE_UNAVAILABLE',
    ].includes(error.code) || payloadEvidenceGap(error)
  );
}
function captureMotion(
  options?: Pick<MotionOptions, 'speed' | 'acceleration'>,
): MotionOptions {
  return {
    speed: options?.speed ?? { kind: 'ratio', value: 0.01 },
    acceleration: options?.acceleration ?? { kind: 'ratio', value: 0.01 },
    // Two consecutive fresh samples are the same evidence the application-level
    // dwell below would collect; asking the driver for both lets this path skip
    // that duplicate dwell instead of sampling the glass twice more.
    arrivalSamples: 2,
  };
}
export class RobotArmRuntime extends RobotKernel {
  allowsOutlineFrame(capturedAt: number) {
    return this.adapter.allowsOutlineFrame(capturedAt);
  }
  private stopGeneration = 0;
  get stopRevision() {
    return this.stopGeneration;
  }
  assertStopRevision(revision: number) {
    if (revision !== this.stopGeneration)
      throw new RobotArmError(
        'ACTION_STOPPED',
        'A safety stop interrupted this operation',
        409,
      );
  }
  /** Uncalibrated probing still owns the normal motion lease and driver checks. */
  async collectAutomaticPoints<T>(
    input: Pick<ProfileBinding, 'robotProfileId' | 'toolProfileId'> & {
      cameraId?: string;
      onPayloadRecheck?: (waiting: boolean) => void;
    },
    work: (
      host: AutomaticCaptureHost &
        Required<Pick<AutomaticCaptureHost, 'preflight'>>,
    ) => Promise<T>,
    calibrationSessionId?: string,
  ): Promise<T> {
    if (this.aiTaskRequestId)
      throw new RobotArmError('BUSY', 'An AI task owns the workstation', 409);
    const robot = this.profileStore.getRobot(input.robotProfileId);
    const tool = this.profileStore.getTool(input.toolProfileId);
    if (calibrationSessionId) {
      if (
        this.commandBusy ||
        !this.leased ||
        this.session?.id !== calibrationSessionId ||
        this.operation?.requestId !== calibrationSessionId ||
        this.session.status !== 'active' ||
        this.session.robotProfileId !== robot.id ||
        this.session.toolProfileId !== tool.id
      )
        throw new RobotArmError(
          'SESSION_NOT_ACTIVE',
          'No idle calibration lease for repair',
          409,
        );
      const ctx = this.context(this.session);
      if (
        !sameCalibrationGeometry(
          this.session,
          ctx,
          this.id,
          this.connectionIdentity,
        ) ||
        !this.session.boundary?.hoverHuman ||
        verificationContextKey(ctx) !== this.session.context?.verificationKey ||
        this.session.dragMode
      )
        throw new RobotArmError(
          'CALIBRATION_INVALID',
          'Repair requires unchanged geometry and confirmed hover',
          409,
        );
      this.commandBusy = true;
    } else {
      const recovery = this.acquireForWork('calibration');
      if (recovery) await recovery;
    }
    const operationId = this.operation!.requestId;
    const signal = this.abort!.signal;
    const teachingInput = input.cameraId
      ? { ...input, cameraId: input.cameraId }
      : undefined;
    const initialTeaching =
      teachingInput && this.profileStore.installationTeaching(teachingInput);
    const check = () => {
      if (
        teachingInput &&
        this.profileStore.installationTeaching(teachingInput)?.id !==
          initialTeaching?.id
      )
        throw new RobotArmError(
          'CALIBRATION_INVALID',
          'Installation teaching changed during collection',
          409,
        );
      signal.throwIfAborted();
      this.check();
      if (
        this.operation?.requestId !== operationId ||
        robot.adapterId !== this.id ||
        robot.connectionIdentity !== this.connectionIdentity ||
        this.profileStore.getRobot(robot.id).geometryRevision !==
          robot.geometryRevision ||
        this.profileStore.getTool(tool.id).geometryRevision !==
          tool.geometryRevision
      )
        throw new RobotArmError(
          'CALIBRATION_INVALID',
          'Automatic collection context changed',
          409,
        );
      try {
        this.assertAppliedPayload(tool);
      } catch (error) {
        // A reset channel drops the evidence, not the configuration. This check
        // runs between commands, so it must not fail an attempt that the next
        // dispatch gate will re-confirm; a changed payload still throws here.
        if (!isRobotArmError(error) || !payloadEvidenceGap(error)) throw error;
      }
    };
    let recheckingPayload = false;
    const setPayloadRecheck = (waiting: boolean) => {
      if (recheckingPayload === waiting) return;
      recheckingPayload = waiting;
      input.onPayloadRecheck?.(waiting);
    };
    let marked = false;
    let referenceAttemptId: string | undefined;
    let retriedStationaryStart = false;
    const stopRevision = this.stopRevision;
    try {
      const host: Parameters<typeof work>[0] = {
        signal,
        check,
        stop: () => this.adapter.stop(),
        preflight: async (poses, motion) => {
          for (const pose of poses) {
            check();
            assertPose(pose);
            assertOrientation(pose, this.capabilities);
            if (initialTeaching)
              assertCameraBoundary(pose, initialTeaching, { tool });
            await this.adapter.preflightCartesian(
              'linear',
              pose,
              captureMotion(motion),
              robot.workspace,
            );
          }
          check();
        },
        read: async () => {
          check();
          await this.ready(tool, setPayloadRecheck);
          const pose = await this.adapter.getPose();
          assertPose(pose);
          check();
          return structuredClone(pose);
        },
        move: async (pose, probeOptions) => {
          const startedAt = performance.now();
          let submittedAt = startedAt;
          let submitted = false;
          const checkSubmission = () => {
            check();
            if (!submitted) probeOptions?.beforeSubmit?.();
          };
          checkSubmission();
          await this.ready(tool, setPayloadRecheck);
          assertPose(pose);
          const teaching =
            input.cameraId &&
            this.profileStore.installationTeaching({
              ...input,
              cameraId: input.cameraId,
            });
          if (teaching) assertCameraBoundary(pose, teaching, { tool });
          assertOrientation(pose, this.capabilities);
          const options = captureMotion(probeOptions);
          const travel = probeOptions?.referenceTravel;
          const detectStartFailure =
            !calibrationSessionId && travel?.direction === 'approach';
          const crossesWorkArea =
            travel?.leg === 'traverse' || travel?.leg === 'direct';
          const trace =
            this.auditStore && (detectStartFailure || crossesWorkArea)
              ? travel
              : undefined;
          if (detectStartFailure) options.detectStartFailure = true;
          const extraReadback =
            travel?.direction === 'approach' &&
            crossesWorkArea &&
            process.env.MIDSCENE_ARM_DIAGNOSTIC_PAYLOAD_READBACK === '1';
          if (trace) options.traceCompletion = true;
          if (extraReadback)
            options.freshPayloadReadbackKg = tool.payload?.massKg;
          await this.adapter.preflightCartesian(
            'linear',
            pose,
            options,
            robot.workspace,
          );
          checkSubmission();
          const previousMotionSubmitted = this.motionSubmitted;
          let arrivedPose: CartesianPose | undefined;
          try {
            const result = await this.motionExecutor.move(
              pose,
              robot.workspace,
              options,
              probeOptions?.timeoutMs ?? 120000,
              {
                check: checkSubmission,
                signal,
                accepting: (promise) => {
                  this.accepting = promise;
                  if (recheckingPayload)
                    void promise?.then(
                      () => setPayloadRecheck(false),
                      () => undefined,
                    );
                },
                submitted: () => {
                  submittedAt = performance.now();
                  submitted = true;
                  this.motionSubmitted = true;
                },
              },
            );
            if ((options.arrivalSamples ?? 0) >= 2) arrivedPose = result.pose;
            if (trace)
              this.audit('calibration', trace.attemptId, 'completed', {
                stage: 'reference-travel',
                direction: trace.direction,
                leg: trace.leg,
                extraReadback,
                operationId,
                completionTrace: result.completionTrace,
              });
          } catch (error) {
            if (trace) {
              referenceAttemptId = trace.attemptId;
              this.audit(
                'calibration',
                trace.attemptId,
                'failed',
                {
                  stage: 'reference-travel',
                  direction: trace.direction,
                  leg: trace.leg,
                  extraReadback,
                  operationId,
                },
                error,
              );
            }
            // A failed acceptance is ambiguous unless the driver confirms it
            // never reached the motion channel. Preserve any earlier motion.
            if (
              isRobotArmError(error) &&
              error.details?.beforeMotionSubmission === true
            )
              this.motionSubmitted = previousMotionSubmitted;
            throw error;
          }
          const adapterCompletedAt = performance.now();
          // The driver returned the pose of its last fresh arrival sample. With
          // two requested, that is the evidence this dwell would collect, so do
          // not spend another two samples with the tool already on the glass.
          // Drivers that cannot report it fall back to the dwell.
          const actual =
            arrivedPose ??
            (await this.motionExecutor.stable(pose, 5000, check, (ms) =>
              this.hold(ms),
            ));
          check();
          if (
            probeOptions?.maximumPositionErrorMm !== undefined &&
            distance(actual.positionMm, pose.positionMm) >
              probeOptions.maximumPositionErrorMm
          )
            throw new RobotArmError(
              'PROBE_POSITION_ERROR',
              'The measured probe position did not reach the requested small step',
              409,
            );
          probeOptions?.onTiming?.({
            beforeSubmitMs: Math.round(submittedAt - startedAt),
            adapterCompletionMs: Math.round(adapterCompletedAt - submittedAt),
            stableMs: arrivedPose
              ? 0
              : Math.round(performance.now() - adapterCompletedAt),
          });
          return actual;
        },
      };
      const collect = async () => {
        let deadline: number | undefined;
        let interrupted: RobotArmError | undefined;
        try {
          while (true) {
            try {
              await this.ready(tool, setPayloadRecheck);
              check();
              if (
                interrupted &&
                deadline !== undefined &&
                performance.now() >= deadline
              )
                throw interrupted;
              if (!marked) {
                await this.profileStore.markOperation(
                  operationId,
                  'calibration',
                );
                marked = true;
              }
              return await work(host);
            } catch (error) {
              if (
                !retriedStationaryStart &&
                !calibrationSessionId &&
                isRobotArmError(error) &&
                error.code === 'CALIBRATION_MOTION_NOT_STARTED'
              ) {
                const guard = () => {
                  this.assertStopRevision(stopRevision);
                  check();
                  if (this.operatorStop || this.recoveryRequired)
                    throw new RobotArmError(
                      'RECOVERY_REQUIRED',
                      'Controller recovery requires confirmation',
                      409,
                    );
                };
                retriedStationaryStart = true;
                guard();
                await this.controlledStop();
                guard();
                await checkRecovery(this.adapter, this.softwarePaused, guard);
                const stoppedPose = await this.adapter.getPose();
                const stablePose = await this.motionExecutor.stable(
                  stoppedPose,
                  5000,
                  guard,
                  (ms) => this.hold(ms),
                );
                const startPose = error.details?.startPose as
                  | CartesianPose
                  | undefined;
                if (
                  !startPose ||
                  distance(stablePose.positionMm, startPose.positionMm) > 0.5 ||
                  quaternionDistance(
                    stablePose.orientation,
                    startPose.orientation,
                  ) > 0.01
                )
                  throw new RobotArmError(
                    'MOTION_INTERRUPTED',
                    'The robot pose changed before the stop was confirmed',
                    409,
                  );
                await this.ready(tool, setPayloadRecheck);
                guard();
                if (referenceAttemptId)
                  this.audit('calibration', referenceAttemptId, 'completed', {
                    stage: 'reference-travel-recovery',
                    operationId,
                    retrying: true,
                  });
                continue;
              }
              if (
                !input.onPayloadRecheck ||
                calibrationSessionId ||
                this.motionSubmitted ||
                signal.aborted ||
                !isRobotArmError(error) ||
                !isTransientFeedbackLoss(error)
              )
                throw error;
              if (deadline === undefined) {
                interrupted = error;
                deadline = performance.now() + PAYLOAD_RECONFIRM_TIMEOUT_MS;
                setPayloadRecheck(true);
              }
              const remaining = deadline - performance.now();
              if (remaining <= 0)
                throw new RobotArmError(
                  error.code,
                  'Could not reconfirm the robot connection and tool payload before calibration motion.',
                  error.status,
                  error.details,
                );
              await this.hold(Math.min(PAYLOAD_RECONFIRM_POLL_MS, remaining));
            }
          }
        } finally {
          setPayloadRecheck(false);
        }
      };
      const value = await collect();
      check();
      if (!calibrationSessionId) {
        await this.profileStore.clearOperation();
        this.release('completed');
      }
      return value;
    } catch (error) {
      if (this.operation?.requestId === operationId && this.leased) {
        if (!signal.aborted) {
          if (!calibrationSessionId && !this.motionSubmitted) {
            if (marked)
              await this.profileStore.clearOperation(operationId).catch(() => {
                this.requireRecovery('interruption');
              });
          } else {
            const disconnected =
              !calibrationSessionId &&
              isRobotArmError(error) &&
              error.code === 'DISCONNECTED';
            if (disconnected) this.requireRecovery('socket-disconnect');
            else if (
              input.onPayloadRecheck &&
              this.motionSubmitted &&
              isRobotArmError(error) &&
              (error.code === 'MOTION_INTERRUPTED' ||
                error.code === 'MOTION_TIMEOUT' ||
                error.code === 'CALIBRATION_MOTION_NOT_STARTED' ||
                error.code === 'COMMAND_TIMEOUT' ||
                isTransientFeedbackLoss(error)) &&
              // An evidence gap is a configuration precondition, not an
              // interruption: no command was travelling when it was reported,
              // so recovering the controller would only cost the operator a stop.
              !payloadEvidenceGap(error)
            )
              this.requireRecovery('interruption');
            if (referenceAttemptId) {
              const recoveryDetail: Record<string, unknown> = {
                stage: 'reference-travel-recovery',
                operationId,
                startedAt: Date.now(),
              };
              try {
                await this.controlledStop();
                this.audit('calibration', referenceAttemptId, 'completed', {
                  ...recoveryDetail,
                  stopConfirmedAt: Date.now(),
                });
              } catch (stopError) {
                this.audit(
                  'calibration',
                  referenceAttemptId,
                  'failed',
                  recoveryDetail,
                  stopError,
                );
              }
            } else await this.controlledStop().catch(() => undefined);
          }
        } else await this.stopPromise;
        if (this.operation?.requestId === operationId)
          this.release(signal.aborted ? 'stopped' : 'failed', error);
      }
      throw error;
    } finally {
      if (calibrationSessionId) this.commandBusy = false;
    }
  }

  /** Passive hand-guided sampling owns the same lease as every motion task. */
  async collectWebPoints<T>(
    input: Pick<ProfileBinding, 'robotProfileId' | 'toolProfileId'> & {
      cameraId?: string;
    },
    work: (
      host: import('./assisted-contracts.js').AssistedCaptureHost,
    ) => Promise<T>,
  ): Promise<T> {
    if (this.aiTaskRequestId)
      throw new RobotArmError('BUSY', 'An AI task owns the workstation', 409);
    const robot = this.profileStore.getRobot(input.robotProfileId);
    const tool = this.profileStore.getTool(input.toolProfileId);
    const recovery = this.acquireForWork('calibration');
    if (recovery) await recovery;
    const operationId = this.operation!.requestId;
    const signal = this.abort!.signal;
    const ownsLease = () =>
      this.operation?.requestId === operationId && this.leased;
    let dragAttempted = false;
    let dragFinished = false;
    const check = () => {
      if (signal.aborted || this.operation?.requestId !== operationId)
        throw new RobotArmError(
          'ACTION_STOPPED',
          'Point capture was interrupted',
          409,
        );
      this.check();
      if (
        robot.adapterId !== this.id ||
        robot.connectionIdentity !== this.connectionIdentity ||
        this.profileStore.getRobot(robot.id).geometryRevision !==
          robot.geometryRevision ||
        this.profileStore.getTool(tool.id).geometryRevision !==
          tool.geometryRevision
      )
        throw new RobotArmError(
          'CALIBRATION_INVALID',
          'Robot or tool geometry changed',
          409,
        );
      try {
        this.assertAppliedPayload(tool);
      } catch (error) {
        // Same rule as automatic collection: evidence a reset channel dropped is
        // re-confirmed before the next command, while a changed payload throws.
        if (!isRobotArmError(error) || !payloadEvidenceGap(error)) throw error;
      }
    };
    try {
      await this.ready(tool);
      check();
      await this.profileStore.markOperation(operationId, 'calibration');
      check();
      dragAttempted = true;
      await this.drag(true, tool);
      const value = await work({
        signal,
        check,
        finishDrag: async () => {
          check();
          await this.drag(false);
          dragFinished = true;
          check();
          await this.ready(tool);
          const pose = await this.motionExecutor.stable(
            await this.adapter.getPose(),
            5000,
            check,
            (ms) => this.hold(ms),
          );
          check();
          assertPose(pose);
          return structuredClone(pose);
        },
        read: async () => {
          check();
          const state = await this.adapter.getState(true);
          check();
          if (
            !state.connected ||
            !state.enabled ||
            !state.dragMode ||
            state.faults.length ||
            !state.status ||
            state.status.quality.stale
          )
            throw new RobotArmError(
              'STATE_UNCONFIRMED',
              'Fresh enabled Drag state is required during point capture',
              409,
            );
          // GetPose is a validated Base-frame read. Vendor push TCP vectors are
          // intentionally not used: some firmware reports another frame there.
          const pose = await this.adapter.getPose();
          check();
          assertPose(pose);
          return structuredClone(pose);
        },
      });
      check();
      if (!dragFinished) await this.drag(false);
      check();
      await this.profileStore.clearOperation();
      this.release('completed');
      return value;
    } catch (error) {
      if (
        ownsLease() &&
        dragAttempted &&
        (!signal.aborted || this.interrupt === 'stop')
      ) {
        try {
          if (signal.aborted) {
            // Stop aborts normal stability waits. Once Stop is confirmed, end
            // this passive Drag session without issuing any motion. A delayed
            // capture must never clean up a newer lease or override an E-stop.
            await this.stopPromise;
            if (ownsLease() && this.interrupt === 'stop') {
              if ((await this.adapter.getState(true)).dragMode)
                await this.adapter.exitDragMode!();
              const state = await this.adapter.getState(true);
              if (!state.connected || state.dragMode || state.moving)
                throw new RobotArmError(
                  'DRAG_UNCONFIRMED',
                  'Drag exit after Stop has not been confirmed',
                  503,
                );
            }
          } else await this.drag(false);
          if (ownsLease()) await this.profileStore.clearOperation();
        } catch {
          this.recoveryRequired = true;
          if (ownsLease()) await this.controlledStop().catch(() => undefined);
        }
      }
      if (ownsLease())
        this.release(signal.aborted ? 'stopped' : 'failed', error);
      throw error;
    }
  }

  /** Only the server-owned phone verifier supplies this evidence, never a command body. */
  async acceptWebCalibration(
    id: string,
    evidence:
      | import('./assisted-contracts.js').WebVerificationEvidence
      | { protocol: 'auto-boundary-v1'; automatic?: boolean },
    binding?: DeviceBinding,
    guard?: () => void,
  ): Promise<CalibrationProfile> {
    if (
      this.commandBusy ||
      this.session?.id !== id ||
      this.operation?.requestId !== id ||
      this.operation.kind !== 'calibration' ||
      !this.leased ||
      calibrationSessionStatus(this.session) !== 'active' ||
      !this.session.candidate
    )
      throw new RobotArmError(
        'SESSION_NOT_ACTIVE',
        'Web calibration session is not active',
        409,
      );
    this.check();
    const signal = this.abort!.signal;
    this.commandBusy = true;
    try {
      const s = structuredClone(this.session);
      const c = s.candidate!;
      if (evidence.protocol === 'auto-boundary-v1') {
        if (
          !(s.auto?.observationRecorded || s.auto?.deferParkingBatchId) ||
          s.stage !== 'verification' ||
          s.dragMode ||
          !s.boundary ||
          ![
            s.boundary.hoverCorners,
            s.boundary.hoverEdges,
            s.boundary.contactCorners,
            s.boundary.contactEdges,
          ].every((value) => value === true)
        )
          throw new RobotArmError(
            'NOT_VERIFIED',
            'Complete automatic boundary verification and record the Safe Position before acceptance',
            409,
          );
        c.verification = {
          protocol: 'auto-boundary-v1',
          boundary: { ...s.boundary },
          auto: {
            ...structuredClone(s.auto.evidence),
            humanAccepted: evidence.automatic !== true,
            automaticAccepted: evidence.automatic === true,
          },
          hoverMotion: true,
          hoverHuman: false,
          confirmedAt: new Date().toISOString(),
        };
      } else {
        if (
          evidence.coordinateSpace !== 'phone' ||
          evidence.layout.width !== c.phoneFrame.width ||
          evidence.layout.height !== c.phoneFrame.height
        )
          throw new RobotArmError(
            'CALIBRATION_INVALID',
            'Phone verification evidence does not match the mechanical coordinate frame',
            409,
          );
        if (
          !s.boundary?.hoverHuman ||
          !s.boundary.hoverCorners ||
          !s.boundary.hoverEdges ||
          s.dragMode
        )
          throw new RobotArmError(
            'HOVER_NOT_VERIFIED',
            'Complete and confirm hover verification first',
            409,
          );
        c.verification = {
          protocol: 'web-v1',
          hoverMotion: true,
          hoverHuman: true,
          web: structuredClone(evidence),
          confirmedAt: new Date().toISOString(),
        };
      }
      c.acceptanceStatus = 'accepted';
      c.pendingParkingBatchId = s.auto?.deferParkingBatchId;
      if (!calibrationAccepted(c, c.pendingParkingBatchId))
        throw new RobotArmError(
          'NOT_VERIFIED',
          'Web touch measurements did not meet acceptance thresholds',
          409,
        );
      this.validateCalibration(c, s, this.context(s), false);
      s.stage = 'completed';
      s.status = 'completed';
      s.revision++;
      c.updatedAt = new Date().toISOString();
      c.revision++;
      await this.profileStore.commitCalibration(
        s,
        () => {
          this.check();
          guard?.();
        },
        binding,
      );
      this.session = s;
      this.release('completed');
      return structuredClone(c);
    } finally {
      this.commandBusy = false;
      // Safety controls defer release while a command is committing. A failed
      // commit must finish that handoff without touching any newer operation.
      if (signal.aborted && this.operation?.requestId === id && this.leased)
        this.release(
          'failed',
          new RobotArmError(
            'ACTION_STOPPED',
            'Calibration acceptance was interrupted',
            409,
          ),
        );
    }
  }
  screenActionGuard?: (request: ActionRequest) => Promise<void>;
  batchTransferContext?: (
    from: string,
    to: string,
  ) => CalibrationBatchState | undefined;
  private aiTaskRequestId?: string;
  beginAiTask(requestId: string): void {
    if (this.aiTaskRequestId || this.leased || this.stopInProgress)
      throw new RobotArmError(
        'BUSY',
        'A robot operation or AI task is already running',
        409,
      );
    this.aiTaskRequestId = requestId;
  }
  endAiTask(requestId: string): void {
    if (this.aiTaskRequestId === requestId) this.aiTaskRequestId = undefined;
  }
  private readonly motionExecutor: MotionExecutor;
  private connectionEstablished = false;
  readonly profileStore: ProfileStore;
  readonly auditStore?: RobotActionAuditStore;
  private session?: CalibrationSession;
  private commandBusy = false;
  private commands = new Map<
    string,
    { payload: string; result: CalibrationSession }
  >();
  private actionIds = new Set<string>();
  private appliedPayloadToolId?: string;
  private lastPayloadEvidence?: string;
  private recordPayloadEvidence(): void {
    const snapshot = this.adapter.payloadApplicationSnapshot();
    const key = JSON.stringify(snapshot);
    if (key === this.lastPayloadEvidence) return;
    this.lastPayloadEvidence = key;
    if (snapshot)
      this.audit('control', randomUUID(), 'dispatched', {
        control: 'payload-application-state',
        snapshot,
      });
  }
  private payloadState(
    toolId?: string,
    state?: RobotState,
  ): PayloadApplicationState {
    const selected =
      toolId ??
      this.profileStore.list().workstation?.toolProfileId ??
      this.appliedPayloadToolId;
    const descriptor = this.adapter.resolver.descriptor(
      'control.enable-with-payload',
    );
    return evaluatePayloadApplication({
      limits: descriptor?.payload,
      requiresDisabled: descriptor?.payloadApplication?.requiresDisabled,
      payload: selected
        ? this.profileStore.getTool(selected).payload
        : undefined,
      snapshot: this.adapter.payloadApplicationSnapshot(),
      connected: state?.connected,
      enabled: state?.enabled,
      stale: state?.status?.quality.stale,
    });
  }
  /**
   * Actual pose last confirmed by `stable()`. Recorded so the audit trail can
   * carry the measured arrival pose without adding a controller round trip.
   */
  private lastStablePose?: CartesianPose;
  private screenSequence?: LinearMotionSequence;
  private screenMotionHost(): ScreenMotionHost {
    return {
      adapter: this.adapter,
      target: (p, ctx) => this.target(p, ctx),
      preflight: (targets, ctx) => this.preflight(targets, ctx),
      move: (p, ctx, speed, acceleration, contact) =>
        this.move(p, ctx, speed, acceleration, contact),
      beginSequence: (targets, ctx) => this.beginScreenSequence(targets, ctx),
      stable: (p, ctx) => this.stable(p, ctx),
      hold: (ms) => this.hold(ms),
      safeLift: (p, c, ctx, onScreen) => this.safeLift(p, c, ctx, onScreen),
      latestToolVector: () => this.latestToolVector(),
    };
  }
  private async beginScreenSequence(
    targets: readonly LinearSequenceTarget[],
    ctx: Context,
  ) {
    if (!this.adapter.resolver.descriptor('motion.linear-sequence'))
      return undefined;
    await this.confirmAppliedPayload(ctx.tool);
    this.check();
    await this.profileStore.markOperation(
      this.operation!.requestId,
      this.operation!.kind,
    );
    this.check();
    const sequence = await this.adapter.beginLinearSequence(targets, {
      timeoutMs: ctx.screen.motionTimeoutMs,
      signal: this.abort?.signal,
    });
    if (!sequence) return undefined;
    this.screenSequence = sequence;
    return {
      ...sequence,
      submit: async (index: number, mode?: 'feedback' | 'terminal') => {
        this.check();
        this.assertAppliedPayload(ctx.tool);
        this.motionSubmitted = true;
        const accepting = sequence.submit(index, mode);
        this.accepting = accepting;
        try {
          const receipt = await accepting;
          this.check();
          return receipt;
        } finally {
          this.accepting = undefined;
        }
      },
      finish: async () => {
        const result = await sequence.finish();
        this.check();
        this.lastStablePose = result.pose ?? this.lastStablePose;
        this.screenSequence = undefined;
        return result;
      },
      dispose: () => {
        sequence.dispose();
        if (this.screenSequence === sequence) this.screenSequence = undefined;
      },
    };
  }
  constructor(options: RobotArmRuntimeOptions) {
    super(options.adapter);
    this.motionExecutor = new MotionExecutor(this.adapter);
    this.profileStore = options.profileStore ?? new ProfileStore();
    this.auditStore = options.auditStore;
  }
  protected async beforeKernelMotion(): Promise<void> {
    await this.profileStore.markOperation(this.operation!.requestId, 'motion');
  }
  protected async afterKernelMotion(): Promise<void> {
    await this.profileStore.clearOperation(this.operation!.requestId);
  }
  /**
   * Best-effort forensic record. Fire-and-forget by design: auditing must never
   * fail or delay a physical operation, so the store absorbs write errors and
   * counts them; `flush()` is available when a caller needs determinism.
   */
  private audit(
    kind: RobotActionAuditKind,
    id: string,
    outcome: RobotActionAuditOutcome,
    detail?: Record<string, unknown>,
    error?: unknown,
  ): void {
    void this.auditStore?.record({
      kind,
      id,
      outcome,
      ...(detail ? { detail } : {}),
      ...(error === undefined
        ? {}
        : {
            error: error instanceof Error ? error.message : String(error),
            ...(error instanceof RobotArmError
              ? {
                  errorDetails: {
                    code: error.code,
                    status: error.status,
                    details: error.details,
                  },
                }
              : {}),
          }),
    });
  }
  /** Records a self-contained control, then rethrows whatever it threw. */
  private async audited<T>(
    kind: RobotActionAuditKind,
    detail: Record<string, unknown>,
    work: () => Promise<T>,
    eventId: string = randomUUID(),
  ): Promise<T> {
    try {
      const result = await work();
      this.audit(
        kind,
        this.operation?.requestId ?? eventId,
        'completed',
        detail,
      );
      return result;
    } catch (error) {
      this.audit(
        kind,
        this.operation?.requestId ?? eventId,
        'failed',
        detail,
        error,
      );
      throw error;
    } finally {
      // Diagnostic sampling must never make a completed Stop fail.
      try {
        this.recordPayloadEvidence();
      } catch {
        /* Invalid driver evidence is surfaced by state/readiness. */
      }
    }
  }
  private profileLoad?: Promise<void>;
  private loadProfiles() {
    this.profileLoad ??= this.profileStore.load().catch((error) => {
      this.profileLoad = undefined;
      throw error;
    });
    return this.profileLoad;
  }
  async initialize(): Promise<void> {
    await this.loadProfiles();
    const saved = this.profileStore.list();
    this.softwarePaused = saved.softwarePaused === true;
    this.operatorStop ??= saved.operatorStop;
    if (
      this.softwarePaused ||
      saved.pendingOperation ||
      saved.sessions?.some(
        (s) =>
          calibrationSessionStatus(s) === 'interrupted' &&
          !s.recoveryAcknowledged,
      )
    )
      this.recoveryRequired = true;
    try {
      await this.adapter.connect();
      this.connectionEstablished = true;
      const state = await this.adapter.getState(true);
      this.recordPayloadEvidence();
      if (state.moving || state.dragMode || state.paused || state.faults.length)
        this.recoveryRequired = true;
      await this.preflightConnection(state);
      this.disconnectedByRequest = false;
      await this.refreshRecovery();
    } catch (error) {
      // A failed startup connect or read leaves the controller unconfirmed, so
      // setup must not treat it as untouched. Unlike a steady-state read
      // failure, this is the first and only chance to establish ground truth.
      // Connect itself stays available for a later retry.
      this.recoveryRequired = true;
      throw error;
    }
  }
  /**
   * Check motion preconditions when the service connects, not when the first
   * calibration command needs them. An operator can spend minutes configuring
   * screens between connecting and starting a batch; discovering an unconfirmed
   * payload only then costs a stopped queue and a manual recovery. This read is
   * non-fatal and writes nothing: the controller's reported load is adopted when
   * it is available, and an unconfirmed payload stays visible as pending.
   */
  private async preflightConnection(state: RobotState): Promise<void> {
    if (!this.describeCapabilities().payload) return;
    const id = randomUUID();
    const detail: Record<string, unknown> = {
      control: 'connection-preflight',
      enabled: state.enabled,
      moving: state.moving,
      dragMode: state.dragMode,
      faults: state.faults.length,
      recoveryRequired: this.recoveryRequired,
    };
    try {
      detail.payload = this.payloadState(undefined, state);
      const toolProfileId = this.profileStore.list().workstation?.toolProfileId;
      if (
        toolProfileId &&
        state.enabled &&
        !state.moving &&
        !state.dragMode &&
        !state.paused &&
        !state.faults.length
      )
        await this.confirmAppliedPayload(
          this.profileStore.getTool(toolProfileId),
        );
      detail.result = 'checked';
      this.audit('control', id, 'completed', detail);
    } catch (error) {
      // Startup must not fail because configuration needs the operator: the
      // pending payload is reported instead, and every motion still waits for it.
      detail.result = 'pending';
      this.audit('control', id, 'completed', detail, error);
    }
  }
  describeCapabilities() {
    const capabilities = this.adapter.capabilities;
    return {
      setupDefaults: this.adapter.adapter.setupDefaults,
      payload: this.adapter.resolver.descriptor('control.enable-with-payload')
        ?.payload,
      payloadApplication: this.adapter.resolver.descriptor(
        'control.enable-with-payload',
      )?.payloadApplication,
      ...effectiveCapabilities(capabilities),
      /**
       * The tilt limit calibration enforces, as the Adapter declares it. Published
       * so an installation can read back the value in force without reading the
       * repository, and so a change to SCREEN_TILT_LIMIT_DEGREES is observable
       * after a rebuild and restart.
       */
      effectiveScreenTiltLimitDegrees:
        capabilities.screenNormalToleranceDegrees ?? SCREEN_TILT_LIMIT_DEGREES,
      controls: this.adapter.resolver.descriptors
        .filter((d) => d.id.startsWith('control.'))
        .map((d) => d.id),
      descriptors: [...this.adapter.resolver.descriptors],
      kinematics: this.adapter.adapter.kinematics,
      readinessPolicy: this.adapter.adapter.readinessPolicy,
    };
  }
  /**
   * Latest passive joint sample for a browser 3D mirror. It is served from the
   * adapter's push cache and never issues a controller command, so a renderer
   * can poll it at frame rate without competing with motion confirmation.
   */
  motionSample() {
    return this.adapter.latestMotionSample();
  }
  async state(
    toolProfileId?: string,
    options: { fresh?: boolean } = {},
  ): Promise<RuntimeState> {
    // A failed read is a connection problem, not a physical interruption. The
    // recovery gate is latched by actions that actually moved the arm, by Stop
    // and Pause confirmation, and by faults — never by an unreachable
    // controller, otherwise a dropped channel would demand recovery that itself
    // needs the channel to clear.
    await this.refreshRecovery();
    const state = await this.adapter.getState(options.fresh === true);
    if (state.faults.length || state.status?.protectiveStop === 'active')
      this.requireRecovery('fault');
    if (state.connected) this.connectionEstablished = true;
    this.recordPayloadEvidence();
    return {
      state,
      operation: this.operation ? { ...this.operation } : undefined,
      recoveryRequired: this.recoveryRequired,
      recoveryReason: this.recoveryReason,
      requiresOperatorRecovery: this.requiresOperatorRecovery,
      softwarePaused: this.softwarePaused,
      stopRevision: this.stopGeneration,
      appliedPayload: this.adapter.appliedPayload(),
      payloadApplication: this.payloadState(toolProfileId, state),
      aiRun: this.aiTaskRequestId
        ? { requestId: this.aiTaskRequestId }
        : undefined,
    };
  }
  current() {
    return this.operation ? { ...this.operation } : null;
  }
  /** A startup error does not prove that no connection was established. */
  get hasEstablishedConnection(): boolean {
    return this.connectionEstablished;
  }
  private context(binding: ProfileBinding): Context {
    const robot = this.profileStore.getRobot(binding.robotProfileId);
    const tool = this.profileStore.getTool(binding.toolProfileId);
    const screen = this.profileStore.getScreen(binding.screenProfileId);
    if (
      robot.adapterId !== this.adapter.id ||
      robot.connectionIdentity !== this.adapter.connectionIdentity
    )
      throw new RobotArmError(
        'ROBOT_BINDING_MISMATCH',
        'Profile does not identify the connected adapter',
        409,
      );
    // Workstation sampling and screen actions do not use stored user bounds.
    // Keep the Profile field for callers that explicitly request bounded SDK motion.
    const { workspace: _workspace, ...installation } = robot;
    const data = this.profileStore.list();
    const cameraId =
      data.devices?.find((d) => d.screenProfileId === screen.id)?.cameraId ??
      (data.workstation?.screenProfileId === screen.id
        ? data.workstation.cameraId
        : undefined);
    const teaching =
      cameraId &&
      this.profileStore.installationTeaching({
        robotProfileId: robot.id,
        toolProfileId: tool.id,
        cameraId,
      });
    return {
      robot: installation,
      tool,
      screen,
      installationTeaching: teaching || undefined,
      minimumTravelTipZMm: teaching
        ? contactPoint(teaching.referencePose, tool.offsetMm).z
        : undefined,
    };
  }
  /**
   * Pre-motion gate. It re-reads the controller while a reset channel has left
   * readiness or payload evidence unconfirmed, so a brief reconnect neither
   * fails a run nor lets a command out on unconfirmed configuration. Returning
   * without a confirmed payload remains impossible: the last error is thrown
   * once the bounded re-confirmation window expires.
   */
  private async ready(
    tool?: ToolProfile,
    onWait?: (waiting: boolean) => void,
  ): Promise<void> {
    if (this.softwarePaused)
      throw new RobotArmError(
        'ROBOT_PAUSED',
        'Resume and perform recovery check before reissuing motion',
        409,
      );
    const deadline = performance.now() + PAYLOAD_RECONFIRM_TIMEOUT_MS;
    let waiting = false;
    try {
      while (true) {
        try {
          await this.adapter.assertReady();
          if (tool) this.assertAppliedPayload(tool);
          else if (!this.payloadCurrent())
            throw new RobotArmError(
              'TOOL_PAYLOAD_NOT_APPLIED',
              'Enable with the current saved tool payload before motion.',
              409,
            );
          return;
        } catch (error) {
          if (
            !isRobotArmError(error) ||
            !isTransientFeedbackLoss(error) ||
            performance.now() >= deadline
          )
            throw error;
          if (!waiting) {
            waiting = true;
            onWait?.(true);
          }
        }
        this.check();
        // A fresh sample is what re-adopts the controller's reported load after
        // a reconnect; the profile is never assumed to still be in force.
        await this.adapter.getState(true).catch(() => undefined);
        this.check();
        await this.hold(PAYLOAD_RECONFIRM_POLL_MS);
      }
    } finally {
      if (waiting) onWait?.(false);
    }
  }
  /** Admission check that absorbs the same transient evidence gap as `ready`. */
  private async confirmAppliedPayload(tool: ToolProfile): Promise<void> {
    const deadline = performance.now() + PAYLOAD_RECONFIRM_TIMEOUT_MS;
    while (true) {
      try {
        this.assertAppliedPayload(tool);
        return;
      } catch (error) {
        if (
          !isRobotArmError(error) ||
          !payloadEvidenceGap(error) ||
          performance.now() >= deadline
        )
          throw error;
      }
      this.check();
      await this.adapter.getState(true).catch(() => undefined);
      this.check();
      await this.hold(PAYLOAD_RECONFIRM_POLL_MS);
    }
  }
  private payloadCurrent() {
    return ['not-required', 'applied'].includes(this.payloadState().status);
  }
  /** Read-only admission check for calibration before any sampling is queued. */
  async assertCalibrationMotionReady(
    toolProfileId: string,
  ): Promise<CartesianPose> {
    const tool = this.profileStore.getTool(toolProfileId);
    const snapshot = await this.state(toolProfileId, { fresh: true });
    const { pose, status } = snapshot.state;
    const readiness =
      status && evaluateReadiness(status, this.adapter.adapter.readinessPolicy);
    if (
      snapshot.recoveryRequired ||
      snapshot.softwarePaused ||
      !pose ||
      !readiness?.ready
    )
      throw new RobotArmError(
        'NOT_READY',
        'Check controller readiness before starting batch calibration.',
        409,
        { reasons: readiness?.reasons },
      );
    await this.confirmAppliedPayload(tool);
    return pose;
  }
  async readiness() {
    const runtime = await this.state(undefined, { fresh: true }).catch(
      (error) => {
        this.requireRecovery(
          isRobotArmError(error) && error.code === 'DISCONNECTED'
            ? 'socket-disconnect'
            : 'interruption',
        );
        throw error;
      },
    );
    // The driver boundary supplies normalized status with every RobotState.
    const readiness = evaluateReadiness(
      runtime.state.status!,
      this.adapter.adapter.readinessPolicy,
    );
    if (this.recoveryRequired) readiness.reasons.push('RECOVERY_REQUIRED');
    if (this.softwarePaused) readiness.reasons.push('ROBOT_PAUSED');
    if (this.leased || this.stopInProgress) readiness.reasons.push('BUSY');
    if (this.aiTaskRequestId) readiness.reasons.push('AI_RUNNING');
    if (!this.payloadCurrent())
      readiness.reasons.push('TOOL_PAYLOAD_NOT_APPLIED');
    return {
      ...runtime,
      ready: readiness.reasons.length === 0,
      reasons: readiness.reasons,
    };
  }
  private validateCalibration(
    c: CalibrationProfile,
    b: ProfileBinding,
    ctx: Context,
    active = true,
  ): void {
    if (
      c.robotProfileId !== b.robotProfileId ||
      c.toolProfileId !== b.toolProfileId ||
      c.screenProfileId !== b.screenProfileId
    )
      throw new RobotArmError(
        'CALIBRATION_BINDING_MISMATCH',
        'Calibration belongs to different Profiles',
        409,
      );
    if (
      c.robotGeometryRevision !== ctx.robot.geometryRevision ||
      c.toolGeometryRevision !== ctx.tool.geometryRevision ||
      c.screenGeometryRevision !== ctx.screen.geometryRevision ||
      c.geometryStatus !== 'valid' ||
      (active && !calibrationAccepted(c))
    )
      throw new RobotArmError(
        'CALIBRATION_INVALID',
        'Recalibrate or verify the selected Profiles',
        409,
      );
    if (!this.describeCapabilities().calibration.includes(c.kind))
      throw new RobotArmError(
        'CALIBRATION_UNSUPPORTED',
        'Calibration strategy is unsupported',
        422,
      );
    if (
      c.kind === 'restrictedPlane' &&
      (Math.acos(Math.min(1, Math.max(-1, dot(c.plane.normal, c.inward)))) *
        180) /
        Math.PI >
        (this.adapter.capabilities.screenNormalToleranceDegrees ??
          SCREEN_TILT_LIMIT_DEGREES)
    )
      throw new RobotArmError(
        'SCREEN_TILT_UNSUPPORTED',
        'Stored plane exceeds Adapter tilt tolerance',
        422,
      );
  }
  inspectScreenConfiguration(binding: ProfileBinding): void {
    const ctx = this.context(binding);
    const constraints =
      this.adapter.resolver.descriptor('motion.linear')?.constraints;
    if (!constraints)
      throw new RobotArmError(
        'UNSUPPORTED_CAPABILITY',
        'Screen interactions require declared linear motion constraints',
        422,
      );
    validateContactPolicy(
      ctx.screen,
      constraints,
      this.adapter.capabilities.jointCount,
    );
    if (this.describeCapabilities().payload)
      assertToolPayload(ctx.tool.payload, this.describeCapabilities().payload);
    const selected = this.profileStore.list().workstation;
    if (
      selected?.calibrationProfileId &&
      selected.robotProfileId === binding.robotProfileId &&
      selected.toolProfileId === binding.toolProfileId &&
      selected.screenProfileId === binding.screenProfileId
    ) {
      const calibration = this.profileStore.getCalibration(
        selected.calibrationProfileId,
      );
      if (
        calibration.geometryStatus === 'valid' &&
        calibration.robotGeometryRevision === ctx.robot.geometryRevision &&
        calibration.toolGeometryRevision === ctx.tool.geometryRevision &&
        calibration.screenGeometryRevision === ctx.screen.geometryRevision
      )
        this.validateScreenTargets(calibration, ctx);
    }
  }
  inspectMechanicalCalibration(
    binding: ProfileBinding,
    calibrationProfileId: string,
    accepted = true,
  ): void {
    const ctx = this.context(binding);
    const calibration = this.profileStore.getCalibration(calibrationProfileId);
    this.validateCalibration(calibration, binding, ctx, accepted);
  }
  configure<T>(work: () => Promise<T>): Promise<T> {
    return this.exclusive(work, true);
  }
  private target(p: CartesianPose, _ctx: Context): void {
    if (_ctx.installationTeaching)
      assertCameraBoundary(p, _ctx.installationTeaching, _ctx);
    assertOrientation(p, this.adapter.capabilities);
    if (this.adapter.capabilities.workspace)
      assertTarget(p, this.adapter.capabilities.workspace);
  }
  private assertAppliedPayload(tool: ToolProfile, state?: RobotState) {
    const limits = this.describeCapabilities().payload;
    if (!limits) return;
    assertToolPayload(tool.payload, limits);
    const payloadApplication = this.payloadState(tool.id, state);
    if (payloadApplication.status !== 'applied')
      throw new RobotArmError(
        'TOOL_PAYLOAD_NOT_APPLIED',
        payloadApplication.reason === 'parameters-changed'
          ? 'The controller tool payload differs from the saved tool payload. Sync the saved payload before motion.'
          : isPayloadReadbackPending(payloadApplication)
            ? 'Waiting for the controller to reconfirm the tool payload.'
            : 'Tool payload is not confirmed for the saved tool. Apply it according to the adapter requirements before motion.',
        409,
        { payloadApplication },
      );
  }
  private async preflight(
    targets: MotionTarget[],
    ctx: Context,
  ): Promise<void> {
    await this.confirmAppliedPayload(ctx.tool);
    for (const target of targets) {
      this.check();
      try {
        this.target(target.pose, ctx);
        await this.adapter.preflightCartesian(
          'linear',
          target.pose,
          target.options,
        );
      } catch (error) {
        if (isRobotArmError(error))
          throw new RobotArmError(
            error.code,
            `${target.name}: ${error.message}`,
            error.status,
            { ...error.details, target: target.name },
          );
        throw new Error(
          `${target.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      this.check();
    }
  }
  private async move(
    p: CartesianPose,
    ctx: Context,
    speed = ctx.screen.actionSpeed,
    acceleration = ctx.screen.actionAcceleration,
    contact?: ContactMoveOptions,
  ): Promise<MotionResult> {
    await this.confirmAppliedPayload(ctx.tool);
    await this.ready();
    this.check();
    this.target(p, ctx);
    await this.profileStore.markOperation(
      this.operation!.requestId,
      this.operation!.kind,
    );
    this.check();
    const result = await this.motionExecutor.move(
      p,
      undefined,
      {
        speed,
        acceleration,
        ...(contact?.arrivalSamples !== undefined
          ? { arrivalSamples: contact.arrivalSamples }
          : {}),
      },
      ctx.screen.motionTimeoutMs,
      {
        check: () => this.check(),
        signal: this.abort?.signal,
        accepting: (promise) => {
          this.accepting = promise;
        },
        submitted: () => {
          this.motionSubmitted = true;
        },
      },
    );
    if (contact?.skipStable) {
      // The driver confirmed arrival from fresh measured samples, and a second
      // dwell here would be spent with the tool already on the glass. The
      // driver's own measured pose keeps the trail honest.
      this.lastStablePose = result.pose ?? this.lastStablePose;
      return result;
    }
    await this.stable(p, ctx);
    return result;
  }
  /**
   * Passive push-channel sample, forwarded for the screen-plane observer. It
   * performs no I/O of its own and is undefined when the adapter has no channel.
   */
  private latestToolVector() {
    return this.adapter.latestToolVectorSample();
  }
  private hold(ms: number): Promise<void> {
    this.check();
    return new Promise((resolve, reject) => {
      const signal = this.abort?.signal;
      const abort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        reject(
          new RobotArmError(
            'ACTION_INTERRUPTED',
            'Contact hold interrupted',
            409,
          ),
        );
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  private async stable(target: CartesianPose, ctx: Context): Promise<void> {
    this.lastStablePose = await this.motionExecutor.stable(
      target,
      ctx.screen.motionTimeoutMs,
      () => this.check(),
      (ms) => this.hold(ms),
    );
  }
  async safePosition(
    request: SafePositionRequest,
  ): Promise<CalibrationProfile> {
    if (
      typeof request.requestId !== 'string' ||
      !request.requestId.trim() ||
      !['return', 'record'].includes(request.mode)
    )
      throw new RobotArmError(
        'INVALID_REQUEST',
        'Safe position operation required',
      );
    if (this.actionIds.has(request.requestId))
      throw new RobotArmError(
        'DUPLICATE_REQUEST',
        'Physical operations are not replayed',
        409,
      );
    return this.audited(
      'control',
      { control: `safe-position-${request.mode}` },
      () =>
        this.exclusive(
          async () => {
            this.actionIds.add(request.requestId);
            this.adapter.resolver.require('stop');
            const ctx = this.context(request);
            const c = this.profileStore.getCalibration(
              request.calibrationProfileId,
            );
            this.validateCalibration(c, request, ctx);
            if (c.revision !== request.revision)
              throw new RobotArmError(
                'REVISION_CONFLICT',
                'Safe position changed. Refresh before retrying.',
                409,
              );
            try {
              await this.ready();
              this.check();
              await this.stable(await this.adapter.getPose(), ctx);
              this.check();
              const actual = this.lastStablePose!;
              const pose =
                request.mode === 'record'
                  ? this.lastStablePose!
                  : c.observationPose;
              this.target(pose, ctx);
              const point = contactPoint(pose, ctx.tool.offsetMm);
              const height =
                (dot(c.plane.normal, point) - c.plane.offset) /
                dot(c.plane.normal, c.inward);
              if (
                !Number.isFinite(height) ||
                height >
                  -ctx.screen.safeHeightMm - surfaceClearanceMm(c.surface)
              )
                throw new RobotArmError(
                  'UNSAFE_OBSERVATION',
                  'Safe position must be at least the safe clearance away from the screen',
                );
              const options = stageOptions(
                ctx.screen,
                'recovery',
                this.adapter.resolver.descriptor('motion.linear')!.constraints!,
                this.adapter.capabilities.jointCount,
              );
              const actualHeight =
                (dot(c.plane.normal, contactPoint(actual, ctx.tool.offsetMm)) -
                  c.plane.offset) /
                dot(c.plane.normal, c.inward);
              // Below clearance, require a known screen contact envelope before lifting.
              // Already-clear poses may be outside the screen, including the saved pose.
              const targets =
                request.mode === 'return'
                  ? [
                      this.safeLift(
                        actual,
                        c,
                        ctx,
                        actualHeight > -ctx.screen.safeHeightMm,
                      ),
                      pose,
                    ]
                  : [pose];
              await this.preflight(
                targets.map((target) => ({
                  name: 'Safe position',
                  pose: target,
                  options,
                })),
                ctx,
              );
              this.check();
              if (request.mode === 'record')
                return await this.profileStore.saveCalibration(
                  {
                    ...c,
                    observationPose: pose,
                    revision: c.revision + 1,
                    updatedAt: new Date().toISOString(),
                  },
                  () => this.check(),
                );
              for (const target of targets) {
                this.check();
                await this.move(
                  target,
                  ctx,
                  options.speed,
                  options.acceleration,
                );
              }
              await this.profileStore.clearOperation(this.operation!.requestId);
              this.check();
              return c;
            } catch (error) {
              if (this.motionSubmitted || this.abort?.signal.aborted) {
                this.recoveryRequired = true;
                await (this.stopPromise ?? this.controlledStop());
              }
              throw error;
            }
          },
          false,
          {
            kind: request.mode === 'return' ? 'motion' : 'control',
            requestId: request.requestId,
          },
        ),
    );
  }
  /** SDK motion shares the lease with calibration, Drag and screen gestures. */
  async motion(request: MotionRequest) {
    if (this.aiTaskRequestId)
      throw new RobotArmError('BUSY', 'An AI task owns the workstation', 409);
    if (
      typeof request.requestId !== 'string' ||
      !request.requestId.trim() ||
      !['linear', 'ptp', 'joints', 'jog', 'joint-jog'].includes(request.kind) ||
      !request.options?.speed ||
      !Number.isFinite(request.timeoutMs) ||
      request.timeoutMs <= 0 ||
      request.timeoutMs > 120000
    )
      throw new RobotArmError(
        'INVALID_REQUEST',
        'Motion identity and bounded timeout required',
      );
    if (this.actionIds.has(request.requestId))
      throw new RobotArmError(
        'DUPLICATE_REQUEST',
        'Physical motions are not replayed',
        409,
      );
    const robot = this.profileStore.getRobot(request.robotProfileId);
    if (
      robot.adapterId !== this.adapter.id ||
      robot.connectionIdentity !== this.adapter.connectionIdentity
    )
      throw new RobotArmError(
        'ROBOT_BINDING_MISMATCH',
        'Profile does not identify connected adapter',
        409,
      );
    this.adapter.resolver.require('stop');
    const recovery = this.acquireForWork('motion', request.requestId);
    if (recovery) await recovery;
    this.actionIds.add(request.requestId);
    try {
      await this.ready();
      this.check();
      let target: CartesianPose | number[];
      const joint = request.kind === 'joints' || request.kind === 'joint-jog';
      if (request.kind === 'jog') {
        if (
          !['x', 'y', 'z'].includes(request.axis) ||
          !this.adapter.adapter.kinematics.cartesianDof.includes(
            request.axis,
          ) ||
          !Number.isFinite(request.deltaMm)
        )
          throw new RobotArmError(
            'INVALID_JOG',
            'Unsupported single-step Cartesian jog',
          );
        target = structuredClone((await this.adapter.readPose()).pose);
        target.positionMm[request.axis] += request.deltaMm;
      } else if (request.kind === 'joint-jog') {
        if (
          !Number.isInteger(request.joint) ||
          request.joint < 0 ||
          request.joint >= this.adapter.capabilities.jointCount ||
          !Number.isFinite(request.delta)
        )
          throw new RobotArmError('INVALID_JOG', 'Invalid joint step');
        target = [...(await this.adapter.readJoints()).values];
        target[request.joint] += request.delta;
      } else target = request.target;
      this.check();
      if (!joint && robot.workspace)
        assertTarget(target as CartesianPose, robot.workspace);
      if (joint)
        this.adapter.validateJointMotion(
          target as number[],
          request.options,
          robot.jointBounds,
        );
      else
        this.adapter.validateCartesian(
          request.kind === 'ptp' ? 'ptp' : 'linear',
          target as CartesianPose,
          request.options,
          robot.workspace,
        );
      await this.profileStore.markOperation(request.requestId, 'motion');
      this.check();
      this.motionSubmitted = true;
      const accepting = joint
        ? this.adapter.moveJoints(
            target as number[],
            request.options,
            robot.jointBounds,
          )
        : request.kind === 'ptp'
          ? this.adapter.movePtp(
              target as CartesianPose,
              request.options,
              robot.workspace,
            )
          : this.adapter.moveLinear(
              target as CartesianPose,
              request.options,
              robot.workspace,
            );
      this.accepting = accepting;
      const handle = await accepting;
      this.accepting = undefined;
      this.check();
      const result = await handle.wait({
        timeoutMs: request.timeoutMs,
        signal: this.abort?.signal,
      });
      this.check();
      if (result.status !== 'completed')
        throw new RobotArmError(
          'MOTION_INTERRUPTED',
          'SDK motion did not complete',
          409,
          { result },
        );
      if (joint)
        await this.motionExecutor.stableJoints(
          target as number[],
          request.timeoutMs,
          () => this.check(),
          (ms) => this.hold(ms),
        );
      else
        await this.motionExecutor.stable(
          target as CartesianPose,
          request.timeoutMs,
          () => this.check(),
          (ms) => this.hold(ms),
        );
      await this.profileStore.clearOperation(request.requestId);
      this.check();
      this.release('completed');
      this.audit('control', request.requestId, 'completed', {
        control: 'motion',
        motion: request.kind,
      });
      return result;
    } catch (error) {
      this.accepting = undefined;
      if (this.motionSubmitted || this.abort?.signal.aborted) {
        this.recoveryRequired = true;
        try {
          await (this.stopPromise ?? this.controlledStop());
        } catch (stopError) {
          this.release('failed', stopError);
          throw stopError;
        }
      }
      const motionError = this.interrupt
        ? new RobotArmError(
            this.interrupt === 'cancel' ? 'ACTION_CANCELLED' : 'ACTION_STOPPED',
            'SDK motion interrupted and physical stop confirmed',
            409,
          )
        : error;
      this.release(this.interrupt ? 'stopped' : 'failed', motionError);
      this.audit(
        'control',
        request.requestId,
        'failed',
        { control: 'motion', motion: request.kind },
        motionError,
      );
      throw motionError;
    }
  }
  /** Current Device selections, not historical calibration candidates. */
  private transferScreens(): TransferScreen[] {
    const selected = this.profileStore.list().devices ?? [];
    const result = new Map<string, TransferScreen>();
    for (const binding of selected) {
      const robot = this.profileStore.getRobot(binding.robotProfileId);
      if (
        robot.adapterId !== this.id ||
        robot.connectionIdentity !== this.connectionIdentity
      )
        continue;
      const ctx = this.context(binding);
      const calibration = this.profileStore.getCalibration(
        binding.calibrationProfileId,
      );
      this.validateCalibration(calibration, binding, ctx);
      result.set(calibration.id, {
        calibration,
        screen: ctx.screen,
        tool: ctx.tool,
      });
    }
    return [...result.values()];
  }
  transferRouteCurrent(route: PreparedTransferRoute): boolean {
    try {
      return route.contextKey === transferContextKey(this.transferScreens());
    } catch {
      return false;
    }
  }
  private transferOptions(screen: ScreenProfile) {
    const constraints =
      this.adapter.resolver.descriptor('motion.linear')?.constraints;
    if (!constraints)
      throw new RobotArmError(
        'UNSUPPORTED_CAPABILITY',
        'Linear motion is required for transfer',
      );
    return stageOptions(
      screen,
      'recovery',
      constraints,
      this.adapter.capabilities.jointCount,
    );
  }
  /** Validate without movement; Controller retains the resulting revision-bound route. */
  async verifyTransferRoute(
    input: TransferRouteInput,
  ): Promise<PreparedTransferRoute> {
    return this.exclusive(async () => {
      const screens = this.transferScreens();
      const route = prepareTransferRoute(input, screens);
      const from = screens.find(
        (entry) => entry.calibration.id === input.fromCalibrationId,
      )!;
      const ctx = this.context(from.calibration);
      await this.ready();
      const options = this.transferOptions(ctx.screen);
      await this.preflight(
        [route.poses[0], ...sampleTransferRoute(route.poses)].map((pose) => ({
          name: 'Cross-device transfer',
          pose,
          options,
        })),
        ctx,
      );
      if (route.contextKey !== transferContextKey(this.transferScreens()))
        throw new RobotArmError(
          'TRANSFER_STALE',
          'Device calibration changed while verifying the route',
        );
      return route;
    });
  }
  private async executeTransfer(
    fromCalibrationId: string,
    route: PreparedTransferRoute | undefined,
    destination: CalibrationProfile,
    phase: (phase: 'moving' | 'arrived') => void,
  ): Promise<void> {
    const batch = this.batchTransferContext?.(
      fromCalibrationId,
      destination.id,
    );
    const corridor = batch?.transfer;
    if (!route && !batch)
      throw new RobotArmError(
        'TRANSFER_REQUIRED',
        'No current confirmed corridor or verified route connects these screens',
        409,
      );
    const screens = this.transferScreens();
    const contextKey = transferContextKey(screens);
    const from = screens.find(
      (entry) => entry.calibration.id === fromCalibrationId,
    );
    if (!from)
      throw new RobotArmError(
        'TRANSFER_STALE',
        'The source screen calibration changed',
        409,
      );
    const ctx = this.context(from.calibration);
    const start = from.calibration.observationPose;
    const end = destination.observationPose;
    const shared = batch?.sharedSafePosition;
    const usesSharedPose = Boolean(
      batch?.sharedSafePositionVerified &&
        shared &&
        semanticJson(start) === semanticJson(shared) &&
        semanticJson(end) === semanticJson(shared) &&
        from.calibration.robotProfileId === destination.robotProfileId &&
        from.calibration.toolProfileId === destination.toolProfileId &&
        semanticJson(atTravelHeight(start, ctx)) ===
          semanticJson(atTravelHeight(end, this.context(destination))),
    );
    const usesCorridor = Boolean(
      !usesSharedPose &&
        corridor?.corridorConfirmed &&
        (!route || route.contextKey !== contextKey),
    );
    const assertCurrent = () => {
      const currentBatch =
        usesSharedPose || usesCorridor
          ? this.batchTransferContext?.(fromCalibrationId, destination.id)
          : undefined;
      if (
        contextKey !== transferContextKey(this.transferScreens()) ||
        ((usesSharedPose || usesCorridor) &&
          (currentBatch?.id !== batch?.id ||
            currentBatch?.revision !== batch?.revision))
      )
        throw new RobotArmError(
          'TRANSFER_STALE',
          'Device calibration or the confirmed batch corridor changed while checking the transfer',
          409,
        );
      this.check();
    };
    let input: TransferRouteInput | undefined = route;
    if (usesCorridor && corridor) {
      const height = corridor.travelTipZMm;
      const sourceTip = contactPoint(start, ctx.tool.offsetMm);
      const targetTip = contactPoint(end, ctx.tool.offsetMm);
      if (
        ![
          height,
          corridor.highestObstacleZMm,
          corridor.clearanceMm,
          ...Object.values(corridor.corridor),
        ].every(Number.isFinite) ||
        corridor.clearanceMm <= 0 ||
        height < corridor.highestObstacleZMm + corridor.clearanceMm ||
        height < Math.max(sourceTip.z, targetTip.z)
      )
        throw new RobotArmError(
          'UNSAFE_OBSERVATION',
          'The confirmed travel height does not cover both observation positions',
          409,
        );
      assertParkingCorridor(sourceTip, corridor.corridor);
      assertParkingCorridor(targetTip, corridor.corridor);
      input = {
        fromCalibrationId,
        toCalibrationId: destination.id,
        confirmed: true,
        waypoints: [sourceTip, targetTip].map((tip) =>
          flangePose(
            { ...tip, z: height },
            start.orientation,
            ctx.tool.offsetMm,
          ),
        ),
      };
    }
    let current: PreparedTransferRoute | undefined;
    if (!usesSharedPose) {
      if (!input)
        throw new RobotArmError(
          'TRANSFER_REQUIRED',
          'These screens have no current common safe position or confirmed travel corridor',
          409,
        );
      if (
        !usesCorridor &&
        (route?.toCalibrationId !== destination.id ||
          route.fromCalibrationId !== fromCalibrationId ||
          route.contextKey !== contextKey)
      )
        throw new RobotArmError(
          'TRANSFER_STALE',
          'Verify the transfer route again after device configuration changes',
          409,
        );
      current = prepareTransferRoute(input, screens);
    }
    const expected = current?.poses[0] ?? atTravelHeight(start, ctx);
    await this.stable(await this.adapter.getPose(), ctx);
    const actual = this.lastStablePose!;
    this.check();
    if (
      distance(actual.positionMm, expected.positionMm) > 0.5 ||
      quaternionDistance(actual.orientation, expected.orientation) > 0.01
    )
      throw new RobotArmError(
        'TRANSFER_START_CHANGED',
        'Arm is no longer at the source observation position; recover before transfer',
        409,
      );
    if (!current) {
      assertTransferClearance([actual], screens, ctx.tool);
      assertCurrent();
      phase('arrived');
      return;
    }
    const poses = [actual, ...current.poses];
    if (usesCorridor)
      assertParkingCorridor(
        contactPoint(actual, ctx.tool.offsetMm),
        corridor?.corridor,
      );
    assertTransferClearance(poses, screens, ctx.tool);
    const options = this.transferOptions(ctx.screen);
    await this.preflight(
      sampleTransferRoute(poses).map((pose) => ({
        name: 'Cross-device transfer',
        pose,
        options,
      })),
      ctx,
    );
    assertCurrent();
    phase('moving');
    for (const pose of current.poses) {
      this.check();
      await this.move(pose, ctx, options.speed, options.acceleration);
    }
    await this.stable(current.poses[current.poses.length - 1], ctx);
    this.check();
    phase('arrived');
  }
  async execute(
    request: ActionRequest,
    aiTaskRequestId?: string,
    deviceVision?: VisionBinding,
    transfer?: {
      fromCalibrationId: string;
      route?: PreparedTransferRoute;
      phase: (phase: 'moving' | 'arrived') => void;
    },
  ): Promise<ActionResult> {
    if (this.aiTaskRequestId && this.aiTaskRequestId !== aiTaskRequestId)
      throw new RobotArmError('BUSY', 'An AI task owns the workstation', 409);
    if (
      !request.requestId ||
      typeof request.contextKey !== 'string' ||
      !request.contextKey
    )
      throw new RobotArmError(
        'INVALID_REQUEST',
        'requestId and execution contextKey are required',
      );
    if (this.actionIds.has(request.requestId))
      throw new RobotArmError(
        'DUPLICATE_REQUEST',
        'Physical actions are not replayed. Query the operation instead.',
        409,
      );
    const recovery = this.acquireForWork('action', request.requestId);
    if (recovery) await recovery;
    this.lastStablePose = undefined;
    let ctx: Context | undefined;
    let c: CalibrationProfile | undefined;
    let outcome: ActionResult | undefined;
    let failure: unknown;
    let transferring = false;
    this.actionIds.add(request.requestId);
    const started = Date.now();
    try {
      await this.screenActionGuard?.(request);
      ctx = this.context(request);
      assertScreenMapping(ctx.screen);
      c = this.profileStore.getCalibration(request.calibrationProfileId);
      this.validateCalibration(c, request, ctx);
      if (
        this.profileStore.contextKey(request, c.id, deviceVision) !==
        request.contextKey
      )
        throw new RobotArmError(
          'EXECUTION_CONTEXT_CHANGED',
          'Coordinate or image context changed. Refresh Device; motion settings do not require recalibration.',
          409,
        );
      {
        const mapping = ctx.screen.phoneMapping;
        const vision =
          deviceVision ?? this.profileStore.list().workstation?.vision;
        if (
          SCREEN_DRIFT_DETECTION_ENABLED &&
          vision?.validity?.state === 'invalid'
        )
          throw new RobotArmError(
            'CALIBRATION_MISMATCH',
            'The saved screen outline no longer matches the camera view. Recalibrate before moving.',
            409,
          );
        if (
          !mapping ||
          !vision ||
          vision.width !== ctx.screen.pixelWidth ||
          vision.height !== ctx.screen.pixelHeight ||
          mapping.visionFingerprint !== vision.fingerprint
        )
          throw new RobotArmError(
            'MAPPING_REQUIRED',
            'Confirm camera-to-phone mapping before image actions',
          );
      }
      await this.ready();
      this.check();
      if (transfer) {
        await prepareScreenAction.call(
          this.screenMotionHost(),
          request,
          c,
          ctx,
          c.observationPose,
        );
        await this.executeTransfer(
          transfer.fromCalibrationId,
          transfer.route,
          c,
          (phase) => {
            transferring = phase === 'moving';
            transfer.phase(phase);
          },
        );
      }
      const result = await executeScreenAction.call(
        this.screenMotionHost(),
        request,
        c,
        ctx,
        started,
      );
      outcome = result;
      await this.profileStore.clearOperation(request.requestId);
      this.check();
      this.release('completed');
      return result;
    } catch (e) {
      failure = e;
      const interrupted = this.interrupt;
      const safelyReleased =
        isRobotArmError(e) && e.details?.safeReleaseConfirmed === true;
      if (safelyReleased)
        await this.profileStore.clearOperation(request.requestId);
      // Parameter/preflight errors never cause movement or unnecessary Stop.
      if (
        !safelyReleased &&
        (this.motionSubmitted || this.abort?.signal.aborted)
      ) {
        try {
          await (this.stopPromise ?? this.controlledStop());
          this.screenSequence?.dispose();
          this.screenSequence = undefined;
          if (transferring) this.recoveryRequired = true;
          if (
            !transferring &&
            interrupted === 'cancel' &&
            ctx &&
            c &&
            !this.recoveryRequired
          ) {
            await this.recoverLift(c, ctx);
          }
        } catch (stopError) {
          this.recoveryRequired = true;
          this.release('failed', stopError);
          failure = stopError;
          throw new RobotArmError(
            'RECOVERY_REQUIRED',
            'Stop or safe lift could not be confirmed',
            503,
            { cause: String(stopError), original: String(e) },
          );
        }
      }
      if (
        !interrupted &&
        !safelyReleased &&
        (this.motionSubmitted ||
          [
            'MOTION_TIMEOUT',
            'POSE_UNSTABLE',
            'DISCONNECTED',
            'ROBOT_FAULT',
            'MOTION_INTERRUPTED',
          ].includes((e as RobotArmError).code))
      )
        this.recoveryRequired = true;
      this.release(
        this.interrupt === 'cancel'
          ? 'cancelled'
          : this.interrupt === 'stop' ||
              this.interrupt === 'pause' ||
              this.interrupt === 'emergencyStop'
            ? 'stopped'
            : 'failed',
        e,
      );
      const reported = new RobotArmError(
        isRobotArmError(e) ? e.code : 'SCREEN_ACTION_FAILED',
        e instanceof Error ? e.message : String(e),
        isRobotArmError(e) ? e.status : 500,
        {
          ...(isRobotArmError(e) ? e.details : {}),
          motionOccurred: this.motionSubmitted,
          safeReleaseConfirmed: safelyReleased,
          recoveryRequired: this.recoveryRequired,
        },
      );
      failure = reported;
      throw reported;
    } finally {
      if (this.leased && this.operation?.kind === 'action')
        this.release('failed');
      // Recorded from the operation's terminal status so success, cancellation,
      // stop and failure all land in the trail, not just the happy path.
      const status = this.operation?.status;
      this.audit(
        'action',
        request.requestId,
        status === 'completed' ||
          status === 'cancelled' ||
          status === 'stopped' ||
          status === 'failed'
          ? status
          : 'failed',
        {
          action: request.action.type,
          requestedDurationMs:
            'durationMs' in request.action
              ? request.action.durationMs
              : undefined,
          gestureDurationMs: outcome?.gestureDurationMs,
          totalDurationMs: outcome?.totalDurationMs ?? Date.now() - started,
          limitations: outcome?.limitations,
          // The press window is reported separately from the requested hold so a
          // window stretched by arrival confirmation stays visible in the trail.
          timing: outcome
            ? {
                executionMode: outcome.executionMode,
                timingStatus: outcome.timingStatus,
                degradationReason: outcome.degradationReason,
                contactStartedAt: outcome.contactStartedAt,
                handoffConfirmedAt: outcome.handoffConfirmedAt,
                releaseSubmittedAt: outcome.releaseSubmittedAt,
                releasedAt: outcome.releasedAt,
                terminalConfirmedAt: outcome.terminalConfirmedAt,
                targetContactMs: outcome.targetContactMs,
                contactMs: outcome.contactMs,
                scheduledHoldMs: outcome.scheduledHoldMs,
                timingOverrunMs: outcome.timingOverrunMs,
                arrivalSource: outcome.arrivalSource,
              }
            : isRobotArmError(failure)
              ? failure.details?.timing
              : undefined,
          bindings: {
            robotProfileId: request.robotProfileId,
            toolProfileId: request.toolProfileId,
            screenProfileId: request.screenProfileId,
            calibrationProfileId: request.calibrationProfileId,
          },
          contextKey: request.contextKey,
          motionSettings: ctx
            ? {
                actionSpeed: ctx.screen.actionSpeed,
                actionAcceleration: ctx.screen.actionAcceleration,
                pressDepthMm: ctx.screen.pressDepthMm,
                safeHeightMm: ctx.screen.safeHeightMm,
                contactMs: ctx.screen.contactMs,
                swipeEndpointHoldMs: ctx.screen.swipeEndpointHoldMs,
                longPressMs: ctx.screen.longPressMs,
                dragHoldMs: ctx.screen.dragHoldMs,
                releaseSpeedFactor: ctx.screen.releaseSpeedFactor,
                releaseAccelerationFactor: ctx.screen.releaseAccelerationFactor,
                successorStartLeadMs: ctx.screen.successorStartLeadMs,
                motionTimeoutMs: ctx.screen.motionTimeoutMs,
              }
            : undefined,
          ...(this.lastStablePose ? { actualPose: this.lastStablePose } : {}),
        },
        failure,
      );
    }
  }
  private safeLift(
    actual: CartesianPose,
    c: CalibrationProfile,
    ctx: Context,
    requireOnScreen: boolean,
  ): CartesianPose {
    assertPose(actual);
    const point = contactPoint(actual, ctx.tool.offsetMm);
    const height =
      (dot(c.plane.normal, point) - c.plane.offset) /
      dot(c.plane.normal, c.inward);
    const surfacePoint = sub(point, scale(c.inward, height));
    const relative = sub(surfacePoint, c.origin);
    const x = dot(relative, c.xAxis);
    const y = dot(relative, c.yAxis);
    if (
      requireOnScreen &&
      (x < -1 ||
        y < -1 ||
        x > ctx.screen.physicalWidthMm + 1 ||
        y > ctx.screen.physicalHeightMm + 1)
    )
      throw new RobotArmError(
        'UNSAFE_RECOVERY',
        'Current contact projection is outside the screen',
        409,
      );
    if (
      requireOnScreen &&
      contactDepthMm(c, point) > ctx.screen.pressDepthMm + 1
    )
      throw new RobotArmError(
        'UNSAFE_RECOVERY',
        'Actual contact point is deeper than the calibrated contact envelope',
        409,
      );
    const amount = Math.max(
      0,
      height + ctx.screen.safeHeightMm + surfaceClearanceMm(c.surface),
    );
    this.target(actual, ctx);
    const pose = flangePose(
      sub(point, scale(c.inward, amount)),
      actual.orientation,
      ctx.tool.offsetMm,
    );
    const travel = atTravelHeight(pose, ctx);
    this.target(travel, ctx);
    return travel;
  }
  private async recoverLift(
    c: CalibrationProfile,
    ctx: Context,
  ): Promise<void> {
    if (this.interrupt !== 'cancel') return;
    const s = await this.adapter.getState();
    if (!s.connected || !s.enabled || s.moving || s.dragMode || s.faults.length)
      throw new RobotArmError(
        'UNSAFE_RECOVERY',
        'Robot is not safely stopped',
        409,
      );
    const p = await this.adapter.getPose();
    const target = this.safeLift(p, c, ctx, true);
    if (this.interrupt !== 'cancel') return;
    // Keep the cancel request, but use a new waiter for the explicitly permitted lift.
    this.abort = new AbortController();
    const options = stageOptions(
      ctx.screen,
      'recovery',
      this.adapter.resolver.descriptor('motion.linear')!.constraints!,
      this.adapter.capabilities.jointCount,
    );
    await this.move(target, ctx, options.speed, options.acceleration);
    await this.stable(target, ctx);
  }
  private async controlledStop(
    disconnectedBeforeMotion = false,
  ): Promise<void> {
    try {
      // Send Stop immediately, then clear the queue again after a racing acceptance.
      const accepting = this.accepting;
      await this.adapter.stop();
      if (accepting) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () =>
              reject(
                new RobotArmError(
                  'STOP_UNCONFIRMED',
                  'Motion acceptance did not settle after Stop',
                  504,
                ),
              ),
            5000,
          );
          accepting.then(
            () => {
              clearTimeout(timer);
              resolve();
            },
            () => {
              clearTimeout(timer);
              resolve();
            },
          );
        });
        if (this.interrupt !== 'emergencyStop') await this.adapter.stop();
      }
      const s = await this.adapter.getState();
      if (!s.connected || s.moving)
        throw new RobotArmError(
          'STOP_UNCONFIRMED',
          'Stop has not been confirmed',
          503,
        );
      this.screenSequence?.dispose();
      this.screenSequence = undefined;
    } catch (e) {
      if (
        !(
          disconnectedBeforeMotion &&
          isRobotArmError(e) &&
          e.code === 'DISCONNECTED'
        )
      )
        this.recoveryRequired = true;
      throw e;
    }
  }
  async stop(): Promise<void> {
    this.operatorStop ??= 'manual-stop';
    await Promise.all([
      this.stopCalibrationOperation(),
      this.persistOperatorStop(this.operatorStop),
    ]);
  }
  private async persistOperatorStop(reason: 'manual-stop' | 'emergency-stop') {
    // Safety controls can arrive before connect(). Dispatch immediately, but
    // load the saved installation before updating its recovery state.
    await this.loadProfiles();
    await this.profileStore.setOperatorStop(reason);
  }
  protected stopAfterInterruption() {
    return this.stopCalibrationOperation();
  }
  protected observeEmergencyStop() {
    const newlyObserved = this.operatorStop !== 'emergency-stop';
    super.observeEmergencyStop();
    if (newlyObserved) {
      this.stopGeneration++;
      return this.persistOperatorStop('emergency-stop');
    }
  }
  /** Internal stop initiated by a calibration interlock, not an operator command. */
  async stopCalibrationOperation(socketDisconnected = false): Promise<void> {
    this.requireRecovery(
      socketDisconnected ? 'socket-disconnect' : 'interruption',
    );
    this.stopGeneration++;
    // A jog is not part of the motion queue, so Stop must release it explicitly.
    if (this.jogTimer) await this.stopJog().catch(() => undefined);
    const eventId = this.operation?.requestId ?? randomUUID();
    await this.audited(
      'control',
      { control: 'stop', recoveryReason: this.recoveryReason },
      () => this.safetyControl('stop', () => this.finishStop()),
      eventId,
    );
    await this.refreshRecovery();
  }
  /**
   * Mark a running calibration session interrupted and persist it. Returns true
   * when a session was actually interrupted. Shared by stop, pause and emergency
   * stop so the bookkeeping cannot drift apart.
   */
  private async interruptSession(): Promise<boolean> {
    if (!this.session || calibrationSessionStatus(this.session) !== 'active')
      return false;
    this.session.status = 'interrupted';
    this.session.interruptionReason =
      'Calibration stopped. Measurements are retained; complete recovery before continuing.';
    this.session.recoveryAcknowledged = false;
    const lastRun =
      this.session.verificationRuns?.[this.session.verificationRuns.length - 1];
    if (lastRun?.outcome === 'running') {
      lastRun.outcome = 'interrupted';
      lastRun.finishedAt = new Date().toISOString();
    }
    resetCalibrationVerification(this.session);
    this.session.revision++;
    await this.profileStore.saveSession(this.session);
    return true;
  }
  private async finishStop(): Promise<void> {
    const pending = this.controlledStop();
    await pending;
    if (await this.interruptSession()) {
      this.recoveryRequired = true;
      if (!this.commandBusy) this.release('stopped');
    } else if (this.operation?.kind === 'drag' && this.leased) {
      this.recoveryRequired = true;
      this.release('stopped');
    }
  }
  /**
   * Shared implementation of the two controls that must work *while* another
   * operation holds the lease: pause and emergency stop. They preempt the
   * owner and invalidate any recovery check already in flight.
   */
  private async abortLikeOperation(
    kind: 'pause' | 'emergencyStop',
    send: () => Promise<void>,
  ): Promise<void> {
    await this.safetyControl(kind, async () => {
      this.recoveryRequired = true;
      try {
        await send();
        await this.interruptSession();
        if (
          !this.commandBusy &&
          this.operation?.kind !== 'action' &&
          this.operation?.kind !== 'motion'
        )
          this.release('stopped');
      } catch (error) {
        await this.interruptSession();
        if (
          !this.commandBusy &&
          this.operation?.kind !== 'action' &&
          this.operation?.kind !== 'motion'
        )
          this.release('failed', error);
        throw error;
      }
    });
  }

  /**
   * Vendor-level emergency stop. This is the one control that must never be
   * refused, so it bypasses the operation lease entirely and works while an
   * action is running. The adapter already refuses to throw for a resulting
   * fault; only an unconfirmable stop fails here.
   */
  async emergencyStop(): Promise<void> {
    this.operatorStop = 'emergency-stop';
    await Promise.all([
      this.sendEmergencyStop(),
      this.persistOperatorStop(this.operatorStop),
    ]);
  }
  private async sendEmergencyStop(): Promise<void> {
    this.requireRecovery('emergency-stop');
    this.stopGeneration++;
    if (this.jogTimer) await this.stopJog().catch(() => undefined);
    const send = this.adapter.emergencyStop?.bind(this.adapter);
    if (!send)
      throw new RobotArmError(
        'EMERGENCY_STOP_UNSUPPORTED',
        'Adapter has no emergency stop; use the hardware emergency-stop circuit',
        422,
      );
    const eventId = this.operation?.requestId ?? randomUUID();
    try {
      await this.abortLikeOperation('emergencyStop', send);
      // Recorded explicitly: when this interrupts an action it never releases
      // the lease, so release()-based recording would miss the one event an
      // operator most wants in the trail.
      this.audit('control', eventId, 'completed', {
        control: 'emergencyStop',
        interruptedAction: this.operation?.kind === 'action',
      });
    } catch (error) {
      this.audit(
        'control',
        eventId,
        'failed',
        { control: 'emergencyStop' },
        error,
      );
      throw error;
    }
  }
  /**
   * Pause the controller. Like emergency stop it works while an action is
   * running. Recovery can proceed once the operator resumes the controller.
   */
  async pause(): Promise<void> {
    this.requireRecovery('pause');
    this.stopGeneration++;
    const send = this.adapter.pause?.bind(this.adapter);
    if (!send)
      throw new RobotArmError(
        'PAUSE_UNSUPPORTED',
        'Adapter does not support pause',
        422,
      );
    const eventId = this.operation?.requestId ?? randomUUID();
    try {
      this.softwarePaused = true;
      const pausing = this.abortLikeOperation('pause', async () => {
        await send();
        if (this.interrupt === 'pause') await this.controlledStop();
      });
      await Promise.all([pausing, this.profileStore.setSoftwarePaused(true)]);
      this.audit('control', eventId, 'completed', {
        control: 'pause',
        interruptedAction: this.operation?.kind === 'action',
      });
    } catch (error) {
      this.audit('control', eventId, 'failed', { control: 'pause' }, error);
      throw error;
    }
  }
  /**
   * Continue a paused controller. This is an ordinary control action, so it is
   * refused while another operation holds the lease. It deliberately passes the
   * recovery gate: pause() sets `recoveryRequired`, and without that the
   * operator could never leave the paused state.
   */
  async resume(): Promise<void> {
    const send = this.adapter.resume?.bind(this.adapter);
    if (!send)
      throw new RobotArmError(
        'RESUME_UNSUPPORTED',
        'Adapter does not support resume',
        422,
      );
    const work = () =>
      this.exclusive(async () => {
        const before = await this.adapter.getState();
        if (!before.paused && !this.softwarePaused)
          throw new RobotArmError(
            'NOT_PAUSED',
            'The controller is not paused',
            409,
          );
        await this.adapter.stop();
        await send();
        const after = await this.adapter.getState();
        if (after.paused)
          throw new RobotArmError(
            'RESUME_UNCONFIRMED',
            'The controller is still paused',
            503,
          );
        await this.profileStore.setSoftwarePaused(false);
        this.check();
        this.softwarePaused = false;
      }, true);
    await this.audited('control', { control: 'resume' }, work);
  }
  async cancel(requestId: string): Promise<void> {
    if (
      !requestId ||
      this.operation?.requestId !== requestId ||
      this.operation.kind !== 'action' ||
      this.operation.status !== 'running'
    )
      throw new RobotArmError(
        'ACTION_NOT_CURRENT',
        'requestId does not match the active action',
        409,
      );
    if (this.interrupt && this.interrupt !== 'cancel')
      throw new RobotArmError(
        'ACTION_STOPPED',
        'Stop cannot be converted into Cancel',
        409,
      );
    if (this.interrupt === 'cancel' && this.stopPromise) {
      await this.stopPromise;
      return;
    }
    const eventId = this.operation?.requestId ?? randomUUID();
    this.interrupt = 'cancel';
    this.abort?.abort();
    this.stopPromise = this.controlledStop();
    try {
      await this.stopPromise;
      // Intent and outcome are both worth keeping: the action itself records
      // 'cancelled', this records that an operator asked for it.
      this.audit('control', eventId, 'completed', {
        control: 'cancel',
        actionRequestId: requestId,
      });
    } catch (error) {
      this.audit(
        'control',
        eventId,
        'failed',
        { control: 'cancel', actionRequestId: requestId },
        error,
      );
      throw error;
    }
  }
  private recoveredSocketOperation?: string;

  canRecoverSamplingSocket(operationId: string) {
    return (
      this.current()?.requestId === operationId &&
      (this.recoveryReason === 'socket-disconnect' ||
        (!this.recoveryRequired &&
          this.recoveredSocketOperation === operationId))
    );
  }

  /** Only the interrupted collection may return to sampling preparation. */
  async recoverSamplingSocket(
    operationId: string,
    revision: number,
    validateAttempt: () => void,
  ) {
    const guard = () => {
      validateAttempt();
      this.assertStopRevision(revision);
      if (!this.canRecoverSamplingSocket(operationId))
        throw new RobotArmError(
          'RECOVERY_REQUIRED',
          'The interrupted collection can no longer recover automatically',
          409,
        );
      this.check();
    };
    if (this.current()?.requestId !== operationId)
      throw new RobotArmError(
        'STALE_CONTEXT',
        'The interrupted collection no longer owns recovery',
        409,
      );
    if (this.leased || this.stopInProgress)
      throw new RobotArmError(
        'BUSY',
        'Wait for the interrupted collection to finish',
        409,
      );
    await this.exclusive(
      async () => {
        guard();
        try {
          await checkRecovery(this.adapter, this.softwarePaused, guard);
        } catch (error) {
          const reasons = isRobotArmError(error) && error.details?.reasons;
          if (Array.isArray(reasons)) {
            if (reasons.includes('SIGNAL_EMERGENCYSTOP_ACTIVE'))
              this.requireRecovery('emergency-stop');
            else if (
              reasons.includes('ROBOT_FAULT') ||
              reasons.includes('SIGNAL_PROTECTIVESTOP_ACTIVE')
            )
              this.requireRecovery('fault');
            else if (reasons.includes('ROBOT_PAUSED'))
              this.requireRecovery('pause');
            else this.requireRecovery('interruption');
          }
          throw error;
        }
        guard();
        await this.profileStore.clearOperation(operationId);
        guard();
        this.recoveryRequired = false;
      },
      true,
      { kind: 'control', requestId: operationId },
    );
    this.audit('control', operationId, 'completed', {
      control: 'recover',
      automatic: true,
      recoveryReason: 'socket-disconnect',
    });
  }
  protected async verifyAutomaticRecovery(guard: () => void) {
    const reason = this.recoveryReason;
    const interruptedId = this.operation?.requestId;
    await super.verifyAutomaticRecovery(guard);
    await this.profileStore.clearOperation(undefined, guard);
    guard();
    this.connectionEstablished = true;
    this.recoveredSocketOperation =
      reason === 'socket-disconnect' ? interruptedId : undefined;
    this.audit('control', randomUUID(), 'completed', {
      control: 'recover',
      automatic: true,
      operationId: interruptedId,
      recoveryReason: reason,
    });
  }
  async recover(): Promise<void> {
    if (this.leased)
      throw new RobotArmError(
        'BUSY',
        'Wait for the interrupted operation to finish',
        409,
      );
    const before = this.adapter.payloadApplicationSnapshot();
    const detail: Record<string, unknown> = {
      control: 'recover',
      recoveryReason: this.recoveryReason,
      payloadBefore: before,
    };
    await this.audited('control', detail, () =>
      this.exclusive(async () => {
        const guard = this.recoveryGuard();
        await checkRecovery(this.adapter, this.softwarePaused, guard);
        this.connectionEstablished = true;
        await this.profileStore.clearOperation(undefined, guard);
        if (this.operatorStop)
          await this.profileStore.setOperatorStop(undefined, guard);
        guard();
        this.recoveryRequired = false;
        const after = this.adapter.payloadApplicationSnapshot();
        detail.payloadAfter = after;
        detail.payloadConfirmationRetained =
          before?.status === 'confirmed' &&
          after?.status === 'confirmed' &&
          before.sessionId === after.sessionId &&
          before.applied?.confirmedAt === after.applied?.confirmedAt;
      }, true),
    );
  }
  private payloadTool(request?: EnableRequest): ToolProfile {
    if (!request?.robotProfileId || !request.toolProfileId)
      throw new RobotArmError(
        'TOOL_PROFILE_REQUIRED',
        'Select and save the current robot and tool before applying payload.',
        400,
      );
    const robot = this.profileStore.getRobot(request.robotProfileId);
    if (
      robot.adapterId !== this.adapter.id ||
      robot.connectionIdentity !== this.adapter.connectionIdentity
    )
      throw new RobotArmError(
        'ROBOT_BINDING_MISMATCH',
        'Profile does not identify the connected adapter',
        409,
      );
    const tool = this.profileStore.getTool(request.toolProfileId);
    if (tool.revision !== request.toolRevision)
      throw new RobotArmError(
        'STALE_PROFILE',
        'Reload the saved tool configuration before applying payload.',
        409,
      );
    assertToolPayload(tool.payload, this.describeCapabilities().payload);
    return tool;
  }
  controllerState() {
    return this.adapter.controllerState();
  }
  controllerMotionSettings() {
    return this.adapter.controllerMotionSettings();
  }
  async updateControllerMotionSettings(
    request: import('./contracts.js').ControllerMotionSettingsUpdate,
  ) {
    const detail: Record<string, unknown> = {
      control: 'controller-motion-settings',
      request,
    };
    return this.audited('control', detail, () =>
      this.exclusive(async () => {
        detail.before = await this.adapter.controllerMotionSettings();
        this.check();
        const result =
          await this.adapter.updateControllerMotionSettings(request);
        detail.after = result;
        return result;
      }),
    );
  }
  async applySavedPayload(request: EnableRequest): Promise<void> {
    await this.audited('control', { control: 'apply-payload' }, () =>
      this.exclusive(async () => {
        const tool = this.payloadTool(request);
        await this.adapter.applyPayload(tool.payload!);
        this.appliedPayloadToolId = tool.id;
        await this.adapter.getState();
      }),
    );
  }
  async lifecycle(
    type: 'connect' | 'disconnect' | 'enable' | 'disable' | 'clearFaults',
    request?: EnableRequest,
  ): Promise<void> {
    await this.audited('control', { control: type }, () =>
      this.exclusive(async () => {
        if (type === 'enable' && this.describeCapabilities().payload) {
          const tool = this.payloadTool(request);
          await this.adapter.enable(tool.payload);
          this.appliedPayloadToolId = tool.id;
        } else {
          if (type === 'disconnect') this.disconnectedByRequest = true;
          await this.adapter[type]();
          if (type === 'connect') {
            this.disconnectedByRequest = false;
            this.connectionEstablished = true;
          }
        }
        if (type !== 'disconnect') {
          const state = await this.adapter.getState();
          if (type === 'connect') await this.preflightConnection(state);
        }
      }, type !== 'enable'),
    );
  }
  private async exclusive<T>(
    work: () => Promise<T>,
    allowRecovery = false,
    operation?: { kind: CurrentOperation['kind']; requestId: string },
  ): Promise<T> {
    if (this.aiTaskRequestId)
      throw new RobotArmError(
        'BUSY',
        'Configuration and normal controls are locked by the active AI task',
        409,
      );
    const recovery = this.acquireForWork(
      operation?.kind ?? 'control',
      operation?.requestId ?? randomUUID(),
      allowRecovery,
    );
    if (recovery) await recovery;
    try {
      const result = await work();
      this.check();
      this.release('completed');
      return result;
    } catch (e) {
      this.release(operation && this.interrupt ? 'stopped' : 'failed', e);
      throw e;
    }
  }
  putRobot(input: ProfileInput<RobotArmProfile>) {
    return this.audited(
      'control',
      { control: 'put-robot-profile', id: input.id },
      () => this.exclusive(() => this.profileStore.putRobot(input)),
    );
  }
  putTool(input: ProfileInput<ToolProfile>) {
    return this.audited(
      'control',
      { control: 'put-tool-profile', id: input.id },
      () =>
        this.exclusive(() => {
          if (
            input.contactFrame === 'flange' &&
            !supportsFlangeContact(this.describeCapabilities())
          )
            throw new RobotArmError(
              'INVALID_PROFILE',
              'This adapter does not support flange contact calibration',
            );
          if (input.payload !== undefined)
            assertToolPayload(
              input.payload,
              this.describeCapabilities().payload,
            );
          return this.profileStore.putTool(input);
        }),
    );
  }
  putScreen(input: ProfileInput<ScreenProfile>) {
    return this.audited(
      'control',
      { control: 'put-screen-profile', id: input.id },
      () =>
        this.exclusive(() => {
          validateScreen(input);
          const constraints =
            this.adapter.resolver.descriptor('motion.linear')?.constraints;
          if (!constraints)
            throw new RobotArmError(
              'UNSUPPORTED_CAPABILITY',
              'Screen interactions require declared linear motion constraints',
              422,
            );
          validateContactPolicy(
            input as ScreenProfile,
            constraints,
            this.adapter.capabilities.jointCount,
          );
          return this.profileStore.putScreen(input);
        }),
    );
  }
  invalidate(id: string) {
    return this.audited(
      'control',
      { control: 'invalidate-calibration', id },
      () => this.exclusive(() => this.profileStore.invalidate(id)),
    );
  }
  private jogTimer?: ReturnType<typeof setTimeout>;
  private jogRetries = 0;
  private jogLease?: string;
  private jogTarget?: JogTarget;
  private jogSerial: Promise<void> = Promise.resolve();
  private jogStopVersion = 0;

  private endJogLease(leaseId: string | undefined): void {
    if (!leaseId || this.endedJogLeases.includes(leaseId)) return;
    this.endedJogLeases.push(leaseId);
    if (this.endedJogLeases.length > 64) this.endedJogLeases.shift();
  }

  private queueJog(work: () => Promise<void>): Promise<void> {
    const result = this.jogSerial.then(work);
    this.jogSerial = result.catch(() => undefined);
    return result;
  }
  /**
   * Lease IDs whose release has already been handled. A renewal issued before
   * the release can arrive after it; without this it would start the jog again
   * and nobody would be holding the button any more.
   */
  private endedJogLeases: string[] = [];
  private lastJogStopAt = 0;
  /**
   * Continuous manual jog. `MoveJog` runs until the controller is told to stop,
   * so the runtime holds a short lease: every renewal extends it, and losing the
   * caller (closed tab, dropped request) stops the arm on its own.
   */
  startJog(target: JogTarget, leaseId?: string): Promise<void> {
    const stopVersion = this.jogStopVersion;
    const revision = this.stopRevision;
    return this.queueJog(() =>
      this.startJogNow(target, leaseId, stopVersion, revision),
    );
  }

  private async startJogNow(
    target: JogTarget,
    leaseId: string | undefined,
    stopVersion: number,
    revision: number,
  ): Promise<void> {
    const released = () => {
      if (stopVersion !== this.jogStopVersion) {
        this.endJogLease(leaseId);
        return true;
      }
      return Boolean(leaseId && this.endedJogLeases.includes(leaseId));
    };
    if (released()) return;
    if (this.aiTaskRequestId)
      throw new RobotArmError('BUSY', 'An AI task owns the workstation', 409);
    // A renewal can arrive right after the release that ended the press. A
    // caller that identifies its press is filtered by lease above; an older
    // console sends none, so an unleased start is ignored for a short window
    // after any release rather than restarting an arm nobody is holding.
    if (!leaseId && Date.now() - this.lastJogStopAt < JOG_RELEASE_COOLDOWN_MS) {
      this.audit('control', randomUUID(), 'completed', {
        control: 'jog-ignore',
        reason: 'release-cooldown',
      });
      return;
    }
    const jog = this.adapter.resolver.require('startJog');
    if (leaseId && this.jogLease && leaseId !== this.jogLease) {
      // A different press took over: release the previous one first.
      this.endJogLease(this.jogLease);
      await this.stopJogNow(this.jogLease);
    }
    const renewing = this.jogTimer !== undefined;
    if (!renewing) {
      // Readiness is checked once: a running jog reports motion, which would
      // otherwise reject its own renewal.
      await this.refreshRecovery();
      if (this.recoveryRequired)
        throw new RobotArmError(
          'RECOVERY_REQUIRED',
          'Robot recovery is pending',
          409,
        );
      await this.ready();
      if (released()) return;
      if (this.leased) this.check();
    }
    if (released()) return;
    this.assertStopRevision(revision);
    // A renewal only extends the watchdog. Re-sending MoveJog fills the
    // controller command queue and delays the release behind acknowledgements.
    if (
      !renewing ||
      JSON.stringify(target) !== JSON.stringify(this.jogTarget)
    ) {
      this.jogLease = leaseId;
      this.jogTarget = target;
      this.armJogWatchdog();
      await jog(target);
    }
    // A release can arrive while the controller acknowledges the start. The
    // queued stop owns cleanup; never re-arm its lease after that release.
    if (released()) return;
    this.jogLease = leaseId;
    this.armJogWatchdog();
    if (!renewing)
      this.audit('control', randomUUID(), 'completed', {
        control: 'jog-start',
        target,
        lease: leaseId ?? null,
      });
  }
  private armJogWatchdog(): void {
    if (this.jogTimer) clearTimeout(this.jogTimer);
    this.jogTimer = setTimeout(() => {
      void this.stopJog(this.jogLease).catch(() => undefined);
    }, JOG_LEASE_MS);
  }

  stopJog(leaseId?: string): Promise<void> {
    // Invalidate synchronously, even when a start is waiting for readiness or
    // the controller. Serializing hardware writes alone does not cancel it.
    if (!leaseId) this.jogStopVersion += 1;
    this.lastJogStopAt = Date.now();
    this.endJogLease(leaseId ?? this.jogLease);
    return this.queueJog(() => this.stopJogNow(leaseId));
  }

  private async stopJogNow(leaseId?: string): Promise<void> {
    // A delayed release from a previous press must not stop a newer press.
    if (leaseId && this.jogLease && leaseId !== this.jogLease) return;
    if (this.jogTimer) {
      clearTimeout(this.jogTimer);
      this.jogTimer = undefined;
    }
    const jog = this.adapter.resolver.method('stopJog');
    if (!jog) return;
    try {
      await jog();
      this.jogRetries = 0;
    } catch (error) {
      // A failed release leaves a moving arm, so the lease is re-armed rather
      // than dropped: retry a couple of times, then stop for real.
      this.jogRetries += 1;
      if (this.jogRetries >= JOG_STOP_ATTEMPTS) {
        this.jogRetries = 0;
        await this.sendEmergencyStop().catch(() => undefined);
        throw error;
      }
      this.jogTimer = setTimeout(() => {
        this.jogTimer = undefined;
        void this.stopJog(leaseId).catch(() => undefined);
      }, JOG_RETRY_MS);
      throw error;
    }
    this.jogLease = undefined;
    this.jogTarget = undefined;
    this.audit('control', randomUUID(), 'completed', {
      control: 'jog-stop',
      lease: leaseId ?? null,
    });
  }
  private teachingContext(input: {
    robotProfileId: string;
    toolProfileId: string;
    cameraId: string;
    screenProfileId: string;
  }) {
    const robot = this.profileStore.getRobot(input.robotProfileId);
    const tool = this.profileStore.getTool(input.toolProfileId);
    if (
      robot.adapterId !== this.id ||
      robot.connectionIdentity !== this.connectionIdentity
    )
      throw new RobotArmError(
        'PROFILE_MISMATCH',
        'Select the current robot installation',
        409,
      );
    return JSON.stringify([
      'camera-boundary-v2',
      robot.id,
      tool.id,
      input.cameraId,
      input.screenProfileId,
      robot.geometryRevision,
      tool.geometryRevision,
    ]);
  }
  installationTeachingDraft(input: {
    robotProfileId: string;
    toolProfileId: string;
    cameraId: string;
    screenProfileId: string;
  }) {
    return (
      this.profileStore
        .list()
        .installationTeachingDrafts?.find(
          (t) => t.context === this.teachingContext(input),
        ) ?? null
    );
  }
  private teachingCaptureBusy = false;
  async captureInstallationPoint(
    input: {
      robotProfileId: string;
      toolProfileId: string;
      cameraId: string;
      screenProfileId: string;
    },
    point: import('./contracts.js').InstallationTeachingPoint,
  ) {
    if (!['reference', 'cameraBoundary', 'cameraBoundaryEnd'].includes(point))
      throw new RobotArmError(
        'INVALID_ARGUMENT',
        'Unknown installation position',
      );
    if (this.teachingCaptureBusy)
      throw new RobotArmError(
        'BUSY',
        'A teaching capture is already running',
        409,
      );
    const capture = async () => {
      const abort = this.abort;
      const check = () => {
        if (abort !== this.abort || abort?.signal.aborted)
          throw new RobotArmError(
            'ACTION_STOPPED',
            'Teaching capture interrupted',
            409,
          );
        this.check();
      };
      check();
      const state = await this.state(input.toolProfileId);
      const pose = state.state.pose;
      if (
        !pose ||
        !state.state.connected ||
        !state.state.enabled ||
        state.state.moving ||
        state.state.faults.length ||
        state.state.status?.quality.stale
      )
        throw new RobotArmError(
          'NOT_READY',
          'Enable the robot and hold it still before recording',
          409,
        );
      const tool = this.profileStore.getTool(input.toolProfileId);
      this.assertAppliedPayload(tool);
      const measured = await this.motionExecutor.stable(
        pose,
        10000,
        check,
        (ms) => this.hold(ms),
      );
      const latest = await this.adapter.getState();
      check();
      if (
        !latest.connected ||
        !latest.enabled ||
        latest.moving ||
        latest.faults.length ||
        latest.status?.quality.stale
      )
        throw new RobotArmError(
          'NOT_READY',
          'Enable the robot and hold it still before recording',
          409,
        );
      const context = this.teachingContext(input);
      const previous = this.installationTeachingDraft(input);
      const draft: import('./contracts.js').InstallationTeachingDraft =
        previous ?? { ...input, id: randomUUID(), context, poses: {} };
      if (point === 'reference') draft.poses = {};
      else if (!draft.poses.reference)
        throw new RobotArmError(
          'NOT_READY',
          'Record the reference position first',
          409,
        );
      if (point === 'cameraBoundaryEnd' && !draft.poses.cameraBoundary)
        throw new RobotArmError(
          'NOT_READY',
          'Record boundary point A first',
          409,
        );
      if (point === 'cameraBoundary') {
        const { cameraBoundaryEnd: _previousEnd, ...poses } = draft.poses;
        draft.poses = poses;
      }
      draft.id = randomUUID();
      draft.poses[point] = structuredClone(measured);
      await this.profileStore.saveInstallationTeachingDraft(draft, check);
      return draft;
    };
    this.teachingCaptureBusy = true;
    try {
      return this.leased &&
        this.operation?.kind === 'drag' &&
        this.operation.status === 'running'
        ? await capture()
        : await this.configure(capture);
    } finally {
      this.teachingCaptureBusy = false;
    }
  }
  async teachInstallation(input: {
    binding: {
      robotProfileId: string;
      toolProfileId: string;
      cameraId: string;
      screenProfileId: string;
    };
    draftId: string;
    corridorConfirmed: boolean;
  }) {
    return this.configure(async () => {
      const { binding } = input;
      if (input.corridorConfirmed !== true)
        throw new RobotArmError(
          'CONFIRMATION_REQUIRED',
          'Confirm the clear approach corridor before recording installation',
          409,
        );
      const state = await this.state(binding.toolProfileId);
      if (
        !state.state.connected ||
        !state.state.enabled ||
        state.state.moving ||
        state.state.dragMode ||
        state.state.faults.length ||
        state.state.status?.quality.stale
      )
        throw new RobotArmError(
          'NOT_READY',
          'Stop teaching motion and confirm the clear approach corridor before recording installation',
          409,
        );
      const draft = this.installationTeachingDraft(binding);
      if (!draft || draft.id !== input.draftId)
        throw new RobotArmError(
          'STALE_CONTEXT',
          'Record installation positions for the current equipment',
          409,
        );
      const { reference, cameraBoundary, cameraBoundaryEnd } = draft.poses;
      if (!reference || !cameraBoundary || !cameraBoundaryEnd)
        throw new RobotArmError(
          'NOT_READY',
          'Record the reference and both camera-side boundary points',
          409,
        );
      const tool = this.profileStore.getTool(binding.toolProfileId);
      this.assertAppliedPayload(tool);
      const boundary = taughtCameraBoundary(
        reference,
        cameraBoundary,
        cameraBoundaryEnd,
        tool,
      );
      const teaching: import('./contracts.js').InstallationTeaching = {
        ...binding,
        id: randomUUID(),
        recordedAt: new Date().toISOString(),
        referenceDeviceId: binding.screenProfileId,
        robotGeometryRevision: this.profileStore.getRobot(
          binding.robotProfileId,
        ).geometryRevision,
        toolGeometryRevision: tool.geometryRevision,
        referencePose: reference,
        poses: { reference, cameraBoundary, cameraBoundaryEnd },
        cameraBoundary: boundary,
        corridorConfirmed: true,
      };
      await this.profileStore.saveInstallationTeaching(teaching);
      return teaching;
    });
  }
  async parkScreenGroup(
    binding: ProfileBinding,
    calibrationId: string,
    parking: NonNullable<
      NonNullable<CalibrationSession['auto']>['batchParking']
    >,
    minimumTravelTipZMm: number,
    verifyVisibility: (
      signal: AbortSignal,
    ) => Promise<ScreenVisibilityEvidence>,
    guard: () => void,
    confirmPages: () => Promise<void>,
    options: {
      operatorConfirmed?: boolean;
      requireTravel?: boolean;
      clearanceProfileIds?: readonly string[];
    } = {},
  ): Promise<{ pose: CartesianPose; visibility: SharedParkingEvidence }> {
    const { operatorConfirmed, requireTravel } = options;
    const profile = this.profileStore.getCalibration(calibrationId);
    const screens = options.clearanceProfileIds?.map((id) => {
      const geometry = this.profileStore.getCalibration(id);
      const screen = this.profileStore.getScreen(geometry.screenProfileId);
      return { geometry, screen };
    });
    const screenClearances = screens?.map(({ geometry, screen }) => ({
      geometry,
      clearanceMm: screen.safeHeightMm,
    }));
    const screenCenters = screens?.map(({ geometry, screen }) =>
      screenContactMm(geometry, {
        x: screen.physicalWidthMm / 2,
        y: screen.physicalHeightMm / 2,
      }),
    );
    const ctx = this.context(binding);
    ctx.minimumTravelTipZMm = Math.max(
      ctx.minimumTravelTipZMm ?? Number.NEGATIVE_INFINITY,
      minimumTravelTipZMm,
    );
    if (
      !calibrationAccepted(
        profile,
        this.profileStore.list().calibrationBatch?.id,
      )
    )
      throw new RobotArmError(
        'CALIBRATION_INVALID',
        'A verified screen from the current batch is required for shared parking.',
        409,
      );
    this.validateCalibration(profile, binding, ctx, false);
    if (!operatorConfirmed) await confirmPages();
    guard();
    const input = { ...binding, cameraId: ctx.installationTeaching?.cameraId };
    return this.collectAutomaticPoints(input, async (host) => {
      const check = () => {
        guard();
        host.check();
      };
      const state: CameraAvoidanceState = {
        candidate: structuredClone(profile),
        stage: 'verification',
        requireTravel,
        screenClearances,
        screenCenters,
        auto: { batchParking: parking },
      };
      if (operatorConfirmed) {
        check();
        const pose = await host.read();
        const teaching = ctx.installationTeaching;
        if (
          !teaching ||
          cameraBoundaryExcessMm(pose.positionMm, teaching) > -20 ||
          cameraBoundaryExcessMm(
            contactPoint(pose, ctx.tool.offsetMm),
            teaching,
          ) > -20
        )
          throw new RobotArmError(
            'CAMERA_CLEARANCE_REQUIRED',
            'The current position must clear the taught camera boundary by at least 20 mm.',
            409,
          );
        assertBatchParking(state, ctx, pose);
        assertParkingScreenClearances(state, ctx, pose);
        await this.motionExecutor.stable(pose, 5000, check, (ms) =>
          this.hold(ms),
        );
        check();
        return {
          pose,
          visibility: { operatorConfirmedAt: new Date().toISOString() },
        };
      }
      const auditId = this.operation?.requestId ?? randomUUID();
      const found = await avoidCamera(
        {
          profileStore: this.profileStore,
          check,
          interrupted: () => host.signal.aborted,
          stationaryPose: async () => {
            check();
            return host.read();
          },
          safeLift: (pose, candidate, context, onScreen) =>
            this.safeLift(pose, candidate, context, onScreen),
          preflight: async (targets) => {
            check();
            await host.preflight(
              targets.map((target) => target.pose),
              targets[0]?.options,
            );
            check();
          },
          move: (pose, _context, speed, acceleration) => {
            check();
            return host.move(pose, {
              speed,
              acceleration,
              beforeSubmit: check,
            });
          },
          stable: (pose) =>
            this.motionExecutor
              .stable(pose, 5000, check, (ms) => this.hold(ms))
              .then(() => undefined),
          verifyCameraVisibility: async (pose) => {
            check();
            const detail = { stage: 'shared-parking-visibility', pose };
            try {
              const evidence = await verifyVisibility(host.signal);
              check();
              this.audit('calibration', auditId, 'completed', {
                ...detail,
                evidence,
              });
              return evidence;
            } catch (error) {
              this.audit('calibration', auditId, 'failed', detail, error);
              throw error;
            }
          },
        },
        state,
        ctx,
      );
      check();
      if (!found && state.auto?.cameraVisibility)
        throw new RobotArmError(
          'CAMERA_VIEW_OBSTRUCTED',
          'The arm reached a candidate Safe Position, but the camera could not verify every screen.',
          409,
          {
            screens: state.auto.cameraVisibility.screens
              .filter((screen) => screen.clear !== true)
              .map(({ id }) => ({ id })),
          },
        );
      if (!found || !state.auto?.cameraVisibility?.clear)
        throw new RobotArmError(
          'CAMERA_AVOIDANCE_FAILED',
          'No reachable camera-clear Safe Position was found within the bounded search.',
          409,
        );
      return {
        pose: state.candidate!.observationPose,
        visibility: state.auto.cameraVisibility,
      };
    });
  }

  async positionInstallationPoint(
    input: {
      robotProfileId: string;
      toolProfileId: string;
      cameraId: string;
      motion?: Pick<ScreenMotionSettings, 'actionSpeed' | 'actionAcceleration'>;
    },
    point: import('./contracts.js').InstallationTeachingPoint,
  ) {
    const teaching = this.profileStore.installationTeaching(input);
    if (!teaching)
      throw new RobotArmError(
        'INSTALLATION_TEACHING_REQUIRED',
        'Record installation teaching for the current robot, tool and camera',
        409,
      );
    const target =
      point === 'reference'
        ? teaching.referencePose
        : point === 'cameraBoundary' || point === 'cameraBoundaryEnd'
          ? teaching.poses[point]
          : undefined;
    if (!target)
      throw new RobotArmError(
        'INVALID_ARGUMENT',
        'Unknown installation position',
      );
    const tool = this.profileStore.getTool(input.toolProfileId);
    const motion = input.motion ?? this.describeCapabilities().setupDefaults;
    if (!motion)
      throw new RobotArmError(
        'MOTION_SETTINGS_REQUIRED',
        'This adapter needs explicit screen motion settings',
      );
    return this.collectAutomaticPoints(input, (host) =>
      moveToTaughtPosition(host, teaching, tool, target, motion),
    );
  }
  async enterDragMode(
    selection?: Pick<ProfileBinding, 'robotProfileId' | 'toolProfileId'>,
  ): Promise<void> {
    if (this.aiTaskRequestId)
      throw new RobotArmError('BUSY', 'An AI task owns the workstation', 409);
    const recovery = this.acquireForWork('drag');
    if (recovery) await recovery;
    const eventId = this.operation!.requestId;
    try {
      await this.drag(
        true,
        selection
          ? this.profileStore.getTool(selection.toolProfileId)
          : undefined,
      );
      this.check();
      this.audit('drag', eventId, 'completed', { control: 'drag-enter' });
    } catch (e) {
      this.release('failed', e);
      this.audit('drag', eventId, 'failed', { control: 'drag-enter' }, e);
      throw e;
    }
  }
  async exitDragMode(): Promise<void> {
    if (this.recoveryRequired && !this.leased) {
      try {
        // Stop invalidated the Drag lease. The measured exit needs a new,
        // recovery-only control lease so another Stop can still interrupt it.
        await this.exclusive(() => this.drag(false), true);
        this.audit('drag', randomUUID(), 'completed', {
          control: 'drag-exit',
          standalone: true,
        });
      } catch (e) {
        this.audit(
          'drag',
          randomUUID(),
          'failed',
          { control: 'drag-exit', standalone: true },
          e,
        );
        throw e;
      }
      return;
    }
    if (this.operation?.kind !== 'drag' || !this.leased)
      throw new RobotArmError('BUSY', 'No standalone Drag lease', 409);
    const eventId = this.operation.requestId;
    try {
      await this.drag(false);
      this.release('completed');
      this.audit('drag', eventId, 'completed', { control: 'drag-exit' });
    } catch (e) {
      this.recoveryRequired = true;
      this.release('failed', e);
      this.audit('drag', eventId, 'failed', { control: 'drag-exit' }, e);
      throw e;
    }
  }
  private async drag(enter: boolean, tool?: ToolProfile): Promise<void> {
    if (
      !this.adapter.capabilities.dragMode ||
      !this.adapter.enterDragMode ||
      !this.adapter.exitDragMode
    )
      throw new RobotArmError(
        'DRAG_UNSUPPORTED',
        'Use the vendor teach pendant for manual positioning',
        422,
      );
    if (enter) {
      await this.ready(tool);
      this.check();
    }
    await (enter ? this.adapter.enterDragMode() : this.adapter.exitDragMode());
    const s = await this.adapter.getState();
    if (!enter && s.moving)
      throw new RobotArmError(
        'DRAG_UNCONFIRMED',
        'Robot is still moving after Drag exit',
        503,
      );
    if (!enter && this.adapter.resolver.descriptor('state.cartesian')) {
      const actual = await this.adapter.getPose();
      await this.motionExecutor.stable(
        actual,
        5000,
        () => this.check(),
        (ms) => this.hold(ms),
      );
    }
    if (s.dragMode !== enter)
      throw new RobotArmError(
        'DRAG_UNCONFIRMED',
        'Actual Drag state did not match command',
        503,
      );
  }
  async startCalibration(
    binding: ProfileBinding,
    calibrationProfileId: string,
    options: {
      reuseObservation?: boolean;
      auto?: CalibrationSession['auto'];
    } = {},
  ): Promise<CalibrationSession> {
    if (this.aiTaskRequestId)
      throw new RobotArmError('BUSY', 'An AI task owns the workstation', 409);
    const previousSession = this.session;
    const recovery = this.acquireForWork('calibration');
    if (recovery) await recovery;
    const id = this.operation!.requestId;
    const signal = this.abort!.signal;
    const check = () => {
      if (signal.aborted || this.operation?.requestId !== id)
        throw new RobotArmError(
          'ACTION_STOPPED',
          'Calibration startup was interrupted',
          409,
        );
      this.check();
    };
    try {
      if (!this.describeCapabilities().calibration.length)
        throw new RobotArmError(
          'UNSUPPORTED_CAPABILITY',
          'This adapter does not support screen calibration',
          409,
        );
      const ctx = this.context(binding);
      await this.ready();
      check();
      const sourceCalibration =
        this.profileStore.getCalibration(calibrationProfileId);
      this.validateCalibration(sourceCalibration, binding, ctx, false);
      if (options.reuseObservation && !sourceCalibration.observationPose)
        throw new RobotArmError(
          'SAFE_POSITION_REQUIRED',
          'A validated saved safe position is required',
        );
      this.session = {
        robotProfileId: binding.robotProfileId,
        toolProfileId: binding.toolProfileId,
        screenProfileId: binding.screenProfileId,
        id,
        revision: 1,
        stage: options.reuseObservation ? 'verification' : 'observation',
        status: 'active',
        boundary: emptyBoundaryVerification(),
        auto: options.auto && structuredClone(options.auto),
        updatedAt: new Date().toISOString(),
        context: {
          adapterId: this.id,
          connectionIdentity: this.connectionIdentity,
          robotGeometryRevision: ctx.robot.geometryRevision,
          toolGeometryRevision: ctx.tool.geometryRevision,
          screenGeometryRevision: ctx.screen.geometryRevision,
          verificationKey: verificationContextKey(ctx),
          workstationRevision:
            this.profileStore.list().workstation?.revision ?? 0,
        },
        dragMode: false,
      };
      this.commands.clear();
      this.session.candidate = {
        ...sourceCalibration,
        id: randomUUID(),
        acceptanceStatus: 'pending',
        verification: undefined,
        createdAt: new Date().toISOString(),
        screenRevision: ctx.screen.revision,
      };
      await this.profileStore.createCalibrationSession(this.session, check);
      check();
      this.audit('calibration', this.session.id, 'dispatched', {
        control: 'start-session',
        stage: this.session.stage,
        robotProfileId: binding.robotProfileId,
        toolProfileId: binding.toolProfileId,
        screenProfileId: binding.screenProfileId,
        ...(calibrationProfileId ? { calibrationProfileId } : {}),
      });
      return structuredClone(this.session);
    } catch (e) {
      if (
        this.session?.id === id &&
        this.session !== previousSession &&
        !this.profileStore
          .list()
          .sessions?.some((s) => s.id === this.session?.id)
      )
        this.session = previousSession;
      if (this.operation?.requestId === id && this.leased)
        this.release('failed', e);
      this.audit('calibration', id, 'failed', { control: 'start-session' }, e);
      throw e;
    }
  }
  getSession(id: string): CalibrationSession {
    const s =
      this.session?.id === id
        ? this.session
        : this.profileStore.list().sessions?.find((s) => s.id === id);
    if (!s)
      throw new RobotArmError(
        'SESSION_NOT_FOUND',
        'Calibration session not found',
        404,
      );
    return structuredClone(s);
  }
  async calibrationCommand(
    id: string,
    command: CalibrationCommand,
    beforeMove?: () => Promise<void>,
    onProgress?: () => void,
    verifyCameraVisibility?: (
      signal: AbortSignal,
    ) => Promise<ScreenVisibilityEvidence>,
  ): Promise<CalibrationSession> {
    if (
      !command ||
      typeof command.commandId !== 'string' ||
      !command.commandId.trim() ||
      !Number.isInteger(command.expectedRevision) ||
      command.expectedRevision < 0
    )
      throw new RobotArmError(
        'INVALID_COMMAND',
        'commandId and expectedRevision are required',
      );
    const key = `${id}:${command.commandId}`;
    const payload = JSON.stringify(command);
    const existing = this.commands.get(key);
    if (existing) {
      if (existing.payload !== payload)
        throw new RobotArmError(
          'COMMAND_ID_CONFLICT',
          'commandId was reused with different data',
          409,
        );
      return structuredClone(existing.result);
    }
    if (this.commandBusy)
      throw new RobotArmError('BUSY', 'A calibration command is running', 409);
    const stored = this.getSession(id);
    if (stored.lastCommand?.id === command.commandId) {
      if (stored.lastCommand.payload !== payload)
        throw new RobotArmError(
          'COMMAND_ID_CONFLICT',
          'commandId was reused with different data',
          409,
        );
      return stored;
    }
    if (stored.revision !== command.expectedRevision)
      throw new RobotArmError(
        'STALE_SESSION',
        'Calibration revision is stale',
        409,
      );
    if (
      command.type === 'cancel' &&
      calibrationSessionStatus(stored) !== 'active'
    ) {
      if (['completed', 'cancelled'].includes(calibrationSessionStatus(stored)))
        throw new RobotArmError(
          'INVALID_STAGE',
          'This session has already ended',
          409,
        );
      stored.stage = 'cancelled';
      stored.status = 'cancelled';
      stored.revision++;
      stored.lastCommand = { id: command.commandId, payload };
      await this.profileStore.saveSession(stored);
      if (this.session?.id === stored.id) this.session = stored;
      return stored;
    }
    if (
      this.session?.id !== id ||
      !this.leased ||
      this.operation?.kind !== 'calibration'
    )
      throw new RobotArmError(
        'SESSION_NOT_ACTIVE',
        'Calibration session is not active',
        409,
      );
    const s = structuredClone(this.session);
    if (s.revision !== command.expectedRevision)
      throw new RobotArmError(
        'STALE_SESSION',
        'Calibration revision is stale',
        409,
      );
    const ctx = this.context(s);
    const stageBefore = s.stage;
    this.commandBusy = true;
    this.motionSubmitted = false;
    try {
      this.check();
      if (
        [
          'return-observation',
          'verify-hover-boundary',
          'verify-contact-boundary',
          'verify-web-target',
          'verify-automatic-boundary',
          'record-observation',
        ].includes(command.type)
      ) {
        const actual = await this.adapter.getState(true);
        this.check();
        if (
          actual.connected &&
          actual.status &&
          !actual.status.quality.stale &&
          actual.status.operationMode !== 'unknown'
        )
          s.dragMode = actual.dragMode;
      }
      if (
        s.context &&
        !sameCalibrationGeometry(s, ctx, this.id, this.connectionIdentity)
      )
        throw new RobotArmError(
          'CALIBRATION_INVALID',
          'The measurement context changed',
          409,
        );
      if (
        s.context &&
        verificationContextKey(ctx) !== s.context.verificationKey
      ) {
        resetCalibrationVerification(s);
        s.context.verificationKey = verificationContextKey(ctx);
        s.revision++;
        await this.profileStore.saveSession(s);
        this.session = s;
        throw new RobotArmError(
          'VERIFICATION_CONTEXT_CHANGED',
          'Verification settings changed. Run hover and contact verification again.',
          409,
        );
      }
      if (command.type === 'verify-hover-boundary')
        resetCalibrationVerification(s);
      await applyCalibrationCommand.call(
        {
          progress: (next) => {
            if (this.session?.id === id && !this.abort?.signal.aborted) {
              this.session.progress = next.progress;
              this.session.verificationRuns = next.verificationRuns;
              if (this.session.auto && next.auto)
                Object.assign(this.session.auto, {
                  avoidingCamera: next.auto.avoidingCamera,
                  checkingVisibility: next.auto.checkingVisibility,
                  cameraVisibility: next.auto.cameraVisibility,
                });
              onProgress?.();
            }
          },
          adapter: this.adapter,
          verifyCameraVisibility: verifyCameraVisibility
            ? async () => {
                this.check();
                const signal = this.abort!.signal;
                const result = await verifyCameraVisibility(signal);
                signal.throwIfAborted();
                this.check();
                return result;
              }
            : undefined,
          profileStore: this.profileStore,
          check: () => this.check(),
          interrupted: () => Boolean(this.abort?.signal.aborted),
          ready: () => this.ready(),
          drag: (enter) => this.drag(enter),
          target: (p, ctx) => this.target(p, ctx),
          preflight: (targets, ctx) => this.preflight(targets, ctx),
          move: async (p, ctx, speed, acceleration) => {
            await beforeMove?.();
            return this.move(p, ctx, speed, acceleration);
          },
          stable: (p, ctx) => this.stable(p, ctx),
          stationaryPose: async (ctx) => {
            await this.ready();
            const p = await this.adapter.getPose();
            await this.stable(p, ctx);
            return this.lastStablePose!;
          },
          hold: (ms) => this.hold(ms),
          contactAction: async (contact, hover, calibration, ctx) => {
            const constraints =
              this.adapter.resolver.descriptor('motion.linear')!.constraints!;
            const options = (stage: ContactStage) =>
              stageOptions(
                ctx.screen,
                stage,
                constraints,
                this.adapter.capabilities.jointCount,
              );
            const started = Date.now();
            const outcome = await executeContactPlan(
              this.screenMotionHost(),
              {
                contact,
                entryLift: hover,
                lift: hover,
                entryOptions: options('entry'),
                traverseOptions: options('traverse'),
                releaseOptions: releaseStageOptions(
                  ctx.screen,
                  constraints,
                  this.adapter.capabilities.jointCount,
                ),
                holdMs: ctx.screen.contactMs,
                holdMode: 'target',
              },
              calibration,
              ctx,
            );
            return {
              ...outcome,
              requestId: command.commandId,
              action: 'tap' as const,
              completedAt: new Date().toISOString(),
              totalDurationMs: Date.now() - started,
            };
          },
          safeLift: (p, c, ctx, onScreen) => this.safeLift(p, c, ctx, onScreen),
          validateCalibration: (c, s, ctx, active) =>
            this.validateCalibration(c, s, ctx, active),
          validateScreenTargets: (c, ctx) => this.validateScreenTargets(c, ctx),
        },
        s,
        command,
        ctx,
      );
      this.check();
      s.revision++;
      s.updatedAt = new Date().toISOString();
      s.lastCommand = { id: command.commandId, payload };
      if (s.stage === 'cancelled') s.status = 'cancelled';
      await this.profileStore.saveSession(s, s.stage === 'cancelled', () =>
        this.check(),
      );
      this.session = s;
      const result = structuredClone(s);
      this.commands.set(key, { payload, result });
      this.audit(
        'calibration',
        id,
        s.stage === 'cancelled' ? 'cancelled' : 'completed',
        {
          control: 'session-command',
          commandId: command.commandId,
          command: command.type,
          stageBefore,
          stageAfter: s.stage,
          revision: s.revision,
          timing:
            command.type === 'verify-web-target' ? s.tapResult : undefined,
        },
      );
      if (s.stage === 'completed' || s.stage === 'cancelled') {
        this.release(s.stage === 'completed' ? 'completed' : 'cancelled');
      }
      return result;
    } catch (e) {
      const safelyReleased =
        isRobotArmError(e) && e.details?.safeReleaseConfirmed === true;
      if (safelyReleased) {
        s.tapResult = undefined;
        s.revision++;
        await this.profileStore.saveSession(s);
        this.session = s;
      }
      if (
        !safelyReleased &&
        (this.motionSubmitted ||
          this.abort?.signal.aborted ||
          [
            'MOTION_TIMEOUT',
            'POSE_UNSTABLE',
            'DISCONNECTED',
            'DRAG_UNCONFIRMED',
          ].includes((e as RobotArmError).code))
      ) {
        this.abort?.abort();
        try {
          await (this.stopPromise ?? this.controlledStop());
          this.screenSequence?.dispose();
          this.screenSequence = undefined;
        } catch {
          this.recoveryRequired = true;
        }
        this.recoveryRequired = true;
        if (this.session) {
          this.session.status = 'interrupted';
          this.session.interruptionReason =
            e instanceof Error ? e.message : String(e);
          this.session.recoveryAcknowledged = false;
          const lastRun =
            this.session.verificationRuns?.[
              this.session.verificationRuns.length - 1
            ];
          if (lastRun?.outcome === 'running') {
            lastRun.outcome = 'interrupted';
            lastRun.finishedAt = new Date().toISOString();
          }
          resetCalibrationVerification(this.session);
          this.session.revision++;
          await this.profileStore.saveSession(this.session);
        }
        this.release('failed', e);
      }
      this.audit(
        'calibration',
        id,
        'failed',
        {
          control: 'session-command',
          commandId: command.commandId,
          command: command.type,
          stageBefore,
          timing: isRobotArmError(e) ? e.details?.timing : undefined,
          safeReleaseConfirmed: safelyReleased,
        },
        e,
      );
      throw new RobotArmError(
        isRobotArmError(e) ? e.code : 'CALIBRATION_ACTION_FAILED',
        e instanceof Error ? e.message : String(e),
        isRobotArmError(e) ? e.status : 500,
        {
          ...(isRobotArmError(e) ? e.details : {}),
          safeReleaseConfirmed: safelyReleased,
          recoveryRequired: this.recoveryRequired,
        },
      );
    } finally {
      this.commandBusy = false;
    }
  }
  private validateScreenTargets(c: CalibrationProfile, ctx: Context): void {
    for (const x of [0, ctx.screen.physicalWidthMm])
      for (const y of [0, ctx.screen.physicalHeightMm])
        for (const depth of [-ctx.screen.safeHeightMm, ctx.screen.pressDepthMm])
          this.target(screenPoseMm(c, ctx.tool, { x, y }, depth), ctx);
  }
  async shutdown(): Promise<void> {
    this.disconnectedByRequest = true;
    try {
      // A failed initial connection never accepted application motion. Do not
      // make disposing it reconnect the old controller through a Stop command.
      // Once connected, retain the normal stop even after communication loss.
      if (this.connectionEstablished) await this.stopCalibrationOperation();
    } finally {
      await this.automaticRecovery?.catch(() => undefined);
      await this.adapter.disconnect();
    }
  }
}
