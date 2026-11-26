import {
  type MotionResult,
  RobotArmError,
  isRobotArmError,
} from '../contracts.js';
import { distance, quaternionDistance } from '../domain.js';
import type {
  CartesianHandoff,
  LinearMotionSequence,
  LinearSequenceOptions,
  LinearSequenceTarget,
  MotionReceipt,
} from '../kernel/contracts.js';

export interface SequenceFeedback {
  readonly sampleId: string;
  readonly connectionGeneration: number;
  readonly receivedAt: number;
  readonly pose: LinearSequenceTarget['pose'];
}
/**
 * A pose sample older than this cannot gate the next motion. The dashboard is
 * serial and can be busy for a few hundred milliseconds while the controller
 * ingests a queued path; command acknowledgements still report real faults, so
 * a scheduling gap must not abort an otherwise healthy sequence.
 */
const SEQUENCE_POSE_MAX_AGE_MS = 500;
export interface LinearSequencePort {
  /** Check control generation and safety, without controller I/O. */
  check(controlOnly?: boolean): void;
  feedback(): SequenceFeedback | undefined;
  feedbackDiagnostics?(checkedAt: number): Record<string, unknown>;
  submit(
    target: LinearSequenceTarget,
    terminal: boolean,
  ): Promise<MotionReceipt>;
  submitQueued?(
    targets: readonly LinearSequenceTarget[],
    blendPercentages: readonly number[],
  ): Promise<MotionReceipt>;
  terminal(target: LinearSequenceTarget): Promise<MotionResult>;
  stopped(): boolean;
  release(): void;
}
function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}

export function isSequenceObservationError(error: unknown): boolean {
  return (
    isRobotArmError(error) &&
    [
      'SEQUENCE_FEEDBACK_UNAVAILABLE',
      'SEQUENCE_FEEDBACK_LOST',
      'SEQUENCE_FAULT_STATE_STALE',
      'SEQUENCE_FAULT_QUERY_FAILED',
      'SEQUENCE_ARRIVAL_TIMEOUT',
    ].includes(error.code)
  );
}

/** Shared ordering and passive handoff observer; contains no screen geometry. */
export function createLinearMotionSequence(
  input: readonly LinearSequenceTarget[],
  options: LinearSequenceOptions,
  port: LinearSequencePort,
): LinearMotionSequence {
  if (
    !input.length ||
    !Number.isFinite(options.timeoutMs) ||
    options.timeoutMs <= 0
  )
    throw new RobotArmError(
      'INVALID_SEQUENCE',
      'A sequence needs targets and a positive timeout',
    );
  const targets = freezeSnapshot(structuredClone(input));
  options = { ...options };
  const feedbackDetails = (checkedAt: number, sample?: SequenceFeedback) => ({
    ...port.feedbackDiagnostics?.(checkedAt),
    poseSampleReceivedAtMs: sample?.receivedAt,
    poseSampleAgeMs: sample && checkedAt - sample.receivedAt,
  });
  const initial = port.feedback();
  const startedAt = Date.now();
  if (!initial || startedAt - initial.receivedAt > SEQUENCE_POSE_MAX_AGE_MS)
    throw new RobotArmError(
      'SEQUENCE_FEEDBACK_UNAVAILABLE',
      'Fresh Cartesian feedback is unavailable',
      409,
      feedbackDetails(startedAt, initial),
    );
  const connectionGeneration = initial.connectionGeneration;
  let index = -1;
  let receipt: MotionReceipt | undefined;
  let readyForSuccessor = true;
  let submitting = false;
  let attempted = false;
  let confirming = false;
  let finishing = false;
  let observing = false;
  let finished = false;
  let disposed = false;
  let terminal: Promise<MotionResult> | undefined;
  const control = () => {
    if (disposed || finished || finishing || options.signal?.aborted)
      throw new RobotArmError(
        'ACTION_STOPPED',
        'Motion sequence is closed or interrupted',
        409,
      );
    port.check();
  };
  const feedback = () => {
    const sample = port.feedback();
    if (sample && sample.connectionGeneration !== connectionGeneration)
      throw new RobotArmError(
        'SEQUENCE_FEEDBACK_LOST',
        'Feedback connection changed during the sequence',
        409,
      );
    return sample;
  };
  const check = () => {
    control();
    const sample = feedback();
    const checkedAt = Date.now();
    if (!sample || checkedAt - sample.receivedAt > SEQUENCE_POSE_MAX_AGE_MS)
      throw new RobotArmError(
        'SEQUENCE_FEEDBACK_UNAVAILABLE',
        'Cartesian feedback is missing or stale',
        409,
        feedbackDetails(checkedAt, sample),
      );
  };
  const waitForCurrent = async (): Promise<MotionResult> => {
    // Terminal confirmation is the deliberate escape from a failed observer.
    if (disposed || options.signal?.aborted)
      throw new RobotArmError(
        'ACTION_STOPPED',
        'Motion sequence interrupted',
        409,
      );
    if (!receipt || submitting)
      throw new RobotArmError(
        'INVALID_SEQUENCE',
        'No accepted command to confirm',
        409,
      );
    terminal ??= port.terminal(targets[index]);
    confirming = true;
    let result: MotionResult;
    try {
      result = await terminal;
    } finally {
      confirming = false;
    }
    if (options.signal?.aborted)
      throw new RobotArmError(
        'ACTION_STOPPED',
        'Motion sequence interrupted',
        409,
      );
    if (result.status !== 'completed')
      throw new RobotArmError(
        'MOTION_INTERRUPTED',
        'Sequence command did not complete',
        409,
        { result },
      );
    readyForSuccessor = true;
    return result;
  };
  const enqueue = port.submitQueued?.bind(port);
  return {
    check,
    submitQueued: enqueue
      ? async (blendPercentages) => {
          check();
          const tail = index + blendPercentages.length;
          if (
            submitting ||
            confirming ||
            observing ||
            !readyForSuccessor ||
            !receipt ||
            tail >= targets.length ||
            blendPercentages.at(-1) !== 0 ||
            blendPercentages.some(
              (value) => !Number.isInteger(value) || value < 0 || value > 100,
            )
          )
            throw new RobotArmError(
              'INVALID_SEQUENCE',
              'Queued targets require a confirmed start and an unblended tail',
              409,
            );
          const queued = targets.slice(index + 1, tail + 1);
          submitting = true;
          attempted = true;
          readyForSuccessor = false;
          index = tail;
          receipt = undefined;
          terminal = undefined;
          try {
            receipt = await enqueue(queued, [...blendPercentages]);
            port.check(true);
            if (options.signal?.aborted)
              throw new RobotArmError(
                'ACTION_STOPPED',
                'Motion sequence interrupted',
                409,
              );
            return receipt;
          } finally {
            submitting = false;
          }
        }
      : undefined,
    async submit(next, mode = 'feedback') {
      if (mode === 'terminal') {
        if (disposed || finished || finishing || options.signal?.aborted)
          throw new RobotArmError(
            'ACTION_STOPPED',
            'Motion sequence interrupted',
            409,
          );
        port.check(true);
      } else check();
      if (
        submitting ||
        confirming ||
        observing ||
        !readyForSuccessor ||
        !Number.isInteger(next) ||
        next <= index ||
        next >= targets.length
      )
        throw new RobotArmError(
          'INVALID_SEQUENCE',
          'Sequence targets must be submitted in order after arrival',
          409,
        );
      submitting = true;
      attempted = true;
      readyForSuccessor = false;
      index = next;
      terminal = undefined;
      try {
        receipt = await port.submit(targets[next], mode === 'terminal');
        port.check(true);
        if (options.signal?.aborted)
          throw new RobotArmError(
            'ACTION_STOPPED',
            'Motion sequence interrupted',
            409,
          );
        return receipt;
      } finally {
        submitting = false;
      }
    },
    async waitForHandoff(): Promise<CartesianHandoff> {
      control();
      if (!receipt || submitting || observing || confirming)
        throw new RobotArmError(
          'INVALID_SEQUENCE',
          'No command available for handoff',
          409,
        );
      observing = true;
      const acceptedAt = receipt.acceptedAt;
      const deadline = Date.now() + Math.min(options.timeoutMs, 8000);
      let lastAt = acceptedAt;
      const seenIds = new Set<string>();
      let window: SequenceFeedback[] = [];
      try {
        while (Date.now() < deadline) {
          control();
          const sample = feedback();
          if (
            sample &&
            sample.receivedAt > acceptedAt &&
            !seenIds.has(sample.sampleId) &&
            sample.receivedAt > lastAt
          ) {
            seenIds.add(sample.sampleId);
            lastAt = sample.receivedAt;
            const target = targets[index].pose;
            if (
              distance(sample.pose.positionMm, target.positionMm) <= 0.2 &&
              quaternionDistance(sample.pose.orientation, target.orientation) <=
                (0.5 * Math.PI) / 180
            ) {
              window.push(sample);
              window = window.slice(-3);
              const stable = window.every((a) =>
                window.every(
                  (b) =>
                    distance(a.pose.positionMm, b.pose.positionMm) <= 0.1 &&
                    quaternionDistance(
                      a.pose.orientation,
                      b.pose.orientation,
                    ) <=
                      (0.15 * Math.PI) / 180,
                ),
              );
              if (window.length === 3 && stable) {
                readyForSuccessor = true;
                return {
                  candidateReachedAt: window[0].receivedAt,
                  confirmedAt: Date.now(),
                  pose: sample.pose,
                };
              }
            } else window = [];
          }
          const checkedAt = Date.now();
          if (checkedAt - lastAt > SEQUENCE_POSE_MAX_AGE_MS)
            throw new RobotArmError(
              'SEQUENCE_FEEDBACK_LOST',
              `Cartesian feedback stalled for ${SEQUENCE_POSE_MAX_AGE_MS} ms`,
              504,
              feedbackDetails(checkedAt, sample),
            );
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        throw new RobotArmError(
          'SEQUENCE_ARRIVAL_TIMEOUT',
          'Cartesian handoff did not reach the target',
          504,
        );
      } finally {
        observing = false;
      }
    },
    waitForCurrent,
    async finish() {
      finishing = true;
      const result = await waitForCurrent();
      finished = true;
      port.release();
      return result;
    },
    dispose() {
      // The owner must confirm Stop before disposing a sequence still in flight.
      if (!disposed) {
        if (attempted && !finished) {
          if (port.stopped()) {
            disposed = true;
            port.release();
            return;
          }
          throw new RobotArmError(
            'SEQUENCE_INCOMPLETE',
            'Confirm completion or Stop before releasing the sequence',
            409,
          );
        }
        disposed = true;
        port.release();
      }
    },
  };
}
