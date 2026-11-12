import type { ApplicationContext } from '../application/context.js';
import {
  type ActionResult,
  type CalibrationProfile,
  type CartesianPose,
  type MotionOptions,
  RobotArmError,
} from '../contracts.js';
import { isSequenceObservationError } from '../driver/linear-sequence.js';
import type {
  LinearMotionSequence,
  LinearSequenceTarget,
} from '../kernel/contracts.js';
import { type PlaneWatch, watchScreenPlane } from './plane-observer.js';
import type { ScreenMotionHost } from './service.js';

export interface ContactPlan {
  contact: CartesianPose;
  entryLift: CartesianPose;
  endContact?: CartesianPose;
  lift: CartesianPose;
  entryOptions: MotionOptions;
  traverseOptions: MotionOptions;
  releaseOptions: MotionOptions;
  holdMs: number;
  holdMode: 'target' | 'minimum';
}
export type ContactOutcome = Omit<
  ActionResult,
  'requestId' | 'action' | 'completedAt' | 'totalDurationMs'
>;

/** Shared by accepted screen actions and candidate-calibration tap verification. */
export async function executeContactPlan(
  host: ScreenMotionHost,
  plan: ContactPlan,
  calibration: CalibrationProfile,
  ctx: ApplicationContext,
): Promise<ContactOutcome> {
  const targets: LinearSequenceTarget[] = [
    { pose: plan.contact, options: plan.entryOptions },
    { pose: plan.entryLift, options: plan.releaseOptions },
  ];
  if (plan.endContact)
    targets.push(
      { pose: plan.endContact, options: plan.traverseOptions },
      { pose: plan.lift, options: plan.releaseOptions },
    );
  let sequence: LinearMotionSequence | undefined;
  let degradationReason: string | undefined;
  try {
    sequence = await host.beginSequence(targets, ctx);
  } catch (error) {
    if (!isSequenceObservationError(error)) throw error;
    degradationReason = error instanceof Error ? error.message : String(error);
  }
  if (!sequence)
    degradationReason ??=
      'Adapter has no available feedback sequence; terminal confirmation may extend contact time.';
  let executionMode: 'feedback-sequence' | 'terminal' = sequence
    ? 'feedback-sequence'
    : 'terminal';
  let down: PlaneWatch | undefined;
  let release: PlaneWatch | undefined;
  let lastIndex = -1;
  let submitted = false;
  let finished = false;
  let contactStartedAt: number | undefined;
  let handoffConfirmedAt: number | undefined;
  let releaseSubmittedAt: number | undefined;
  let terminalConfirmedAt: number | undefined;
  let holdAnchorAt: number | undefined;
  let scheduledHoldMs = 0;
  const started = Date.now();
  const move = async (
    index: number,
  ): Promise<{ at: number; source: ActionResult['arrivalSource'] }> => {
    const target = targets[index];
    if (sequence) {
      try {
        await sequence.submit(index);
      } catch (error) {
        if (submitted || !isSequenceObservationError(error)) throw error;
        degradationReason =
          error instanceof Error ? error.message : String(error);
        sequence.dispose();
        sequence = undefined;
        executionMode = 'terminal';
        return move(index);
      }
      lastIndex = index;
      submitted = true;
      const arrival = await sequence.waitForHandoff();
      handoffConfirmedAt = arrival.confirmedAt;
      return {
        at: arrival.candidateReachedAt,
        source: 'driver-arrival-sample' as const,
      };
    }
    const result = await host.move(
      target.pose,
      ctx,
      target.options.speed,
      target.options.acceleration,
      { arrivalSamples: 1, skipStable: true },
    );
    return {
      at: result.arrivedAt ?? Date.parse(result.completedAt),
      source:
        result.arrivedAt === undefined
          ? ('driver-completed' as const)
          : ('driver-arrival-sample' as const),
    };
  };
  const outcome = (
    arrivalSource: ActionResult['arrivalSource'],
    gestureDurationMs: number,
  ): ContactOutcome => {
    const releasedAt = release?.at;
    const timingOverrunMs =
      releasedAt === undefined || holdAnchorAt === undefined
        ? undefined
        : Math.max(0, releasedAt - holdAnchorAt - plan.holdMs);
    const limitations = degradationReason ? [degradationReason] : [];
    if (timingOverrunMs && timingOverrunMs > 0)
      limitations.push(
        `Contact timing exceeded its target by ${timingOverrunMs} ms; the physical action was not retried.`,
      );
    return {
      gestureDurationMs,
      limitations,
      targetContactMs: plan.holdMs,
      contactMs:
        down?.at !== undefined && releasedAt !== undefined
          ? releasedAt - down.at
          : undefined,
      scheduledHoldMs,
      timingOverrunMs,
      arrivalSource,
      executionMode,
      timingStatus:
        timingOverrunMs === undefined
          ? 'unmeasurable'
          : timingOverrunMs > 0
            ? 'overrun'
            : 'within-target',
      degradationReason,
      contactStartedAt: down?.at ?? contactStartedAt,
      handoffConfirmedAt,
      releaseSubmittedAt,
      releasedAt,
      terminalConfirmedAt,
    };
  };
  const failure = (error: unknown) =>
    new RobotArmError(
      error instanceof RobotArmError ? error.code : 'SCREEN_ACTION_FAILED',
      error instanceof Error ? error.message : String(error),
      error instanceof RobotArmError ? error.status : 500,
      {
        ...(error instanceof RobotArmError ? error.details : {}),
        safeReleaseConfirmed: false,
        timing: outcome(
          down?.at === undefined
            ? 'driver-completed'
            : 'feedback-plane-crossing',
          Date.now() - started,
        ),
      },
    );
  const disposeSequence = () => {
    if (!submitted || finished) {
      try {
        sequence?.dispose();
      } catch (error) {
        if (
          !(error instanceof RobotArmError) ||
          error.code !== 'SEQUENCE_INCOMPLETE' ||
          finished
        )
          throw error;
      }
    }
  };
  try {
    down = watchScreenPlane(host, calibration, ctx, 'enter');
    const entry = await move(0);
    contactStartedAt = down.at ?? entry.at;
    const gestureStartedAt = Date.now();
    const endpoint = plan.endContact ? await move(2) : undefined;
    const traverseMs = Date.now() - gestureStartedAt;
    holdAnchorAt = endpoint?.at ?? contactStartedAt;
    const lead =
      plan.holdMode === 'minimum' || !plan.holdMs
        ? 0
        : ctx.screen.successorStartLeadMs;
    const waitStartedAt = Date.now();
    for (;;) {
      sequence?.check();
      // Arrival tolerance can be reached before physical contact. Keep watching
      // through the hold and anchor it on the crossing once it is measured.
      if (!endpoint && down.at !== undefined) holdAnchorAt = down.at;
      const deadline = holdAnchorAt + plan.holdMs - lead;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await host.hold(Math.min(20, remaining));
    }
    scheduledHoldMs = Date.now() - waitStartedAt;
    const gestureDurationMs = endpoint
      ? traverseMs
      : Date.now() - gestureStartedAt;
    down.stop();
    const arrivalSource =
      down.at === undefined ? entry.source : 'feedback-plane-crossing';
    release = watchScreenPlane(host, calibration, ctx, 'leave');
    const releaseIndex = plan.endContact ? 3 : 1;
    if (sequence) {
      const receipt = await sequence.submit(releaseIndex);
      releaseSubmittedAt = receipt.submittedAt;
      const terminal = await sequence.finish();
      terminalConfirmedAt = Date.parse(terminal.completedAt);
      finished = true;
    } else {
      const terminal = await host.move(
        plan.lift,
        ctx,
        plan.releaseOptions.speed,
        plan.releaseOptions.acceleration,
      );
      releaseSubmittedAt = terminal.submittedAt;
      terminalConfirmedAt = Date.parse(terminal.completedAt);
    }
    release.stop();
    return outcome(arrivalSource, gestureDurationMs);
  } catch (error) {
    if (sequence && submitted && isSequenceObservationError(error)) {
      degradationReason =
        error instanceof Error ? error.message : String(error);
      // No remaining hold or traverse is submitted. Confirm the current target
      // before choosing the prevalidated lift at that target's screen point.
      try {
        await sequence.waitForCurrent();
        release = watchScreenPlane(host, calibration, ctx, 'leave');
        const receipt = await sequence.submit(
          lastIndex >= 2 ? 3 : 1,
          'terminal',
        );
        releaseSubmittedAt = receipt.submittedAt;
        const terminal = await sequence.finish();
        terminalConfirmedAt = Date.parse(terminal.completedAt);
        finished = true;
        release.stop();
      } catch (recoveryError) {
        throw failure(recoveryError);
      }
      throw new RobotArmError(
        'SCREEN_ACTION_INCOMPLETE',
        'Screen action was interrupted; safe release was confirmed. The action was not retried.',
        409,
        {
          safeReleaseConfirmed: true,
          motionOccurred: true,
          timing: outcome(
            down?.at === undefined
              ? 'driver-completed'
              : 'feedback-plane-crossing',
            Date.now() - started,
          ),
        },
      );
    }
    throw failure(error);
  } finally {
    down?.stop();
    release?.stop();
    disposeSequence();
    // On any other failure the runtime retains the lease and confirms Stop
    // before disposing the outstanding sequence.
  }
}
