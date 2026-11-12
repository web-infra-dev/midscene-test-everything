import { setTimeout as delay } from 'node:timers/promises';
import {
  CALIBRATION_PHONE_POLICY,
  CALIBRATION_RELATIVE_SLACK,
  type CalibrationPageUpdate,
  type CalibrationPointProgress,
  type WebPoint,
} from '../../assisted-contracts.js';
import { RobotArmError } from '../../contracts.js';
import type { ProbePurpose } from './types.js';

const CONFIRM_INTERVAL_MS = 100;
type Step = NonNullable<CalibrationPointProgress['step']>;
type Feedback = NonNullable<CalibrationPageUpdate['stepFeedback']>;
type Reading = { revision: number; point?: WebPoint };

export interface PhoneProbeEvidence {
  sampleId: string;
  targetId: string;
  purpose: ProbePurpose;
  requestedTipZMm: number;
  startedAt: string;
  elapsedMs: number;
  outcome: string;
  changes: number;
  lastContactChange?: {
    id: string;
    phase: Step['phase'];
    sequence: number;
    elapsedMs: number;
    outcome: Feedback['outcome'];
  };
  replies: Array<{
    id: string;
    phase: Step['phase'];
    sequence: number;
    roundTripMs: number;
    outcome: Feedback['outcome'];
    reason?: Feedback['reason'];
    releasedBeforeAck?: boolean;
    point?: WebPoint;
  }>;
}

/** One stationary pose. Heartbeats and replies to earlier poses cannot complete a read. */
export class StationaryPhoneObservation {
  private readonly evidence: PhoneProbeEvidence;
  step?: Step;
  private readonly started = performance.now();
  private sentAt = this.started;
  private receivedAt: number;
  private readonly issued = new Map<string, { releasedBeforeAck?: boolean }>();
  private sequence: number;
  private lastFeedbackId?: string;
  private firstReply?: Reading;
  private current?: Reading;
  private pointerId?: string;
  private failure?: 'multiple_contacts' | 'pointer_cancelled' | 'unstable';

  constructor(
    sampleId: string,
    targetId: string,
    purpose: ProbePurpose,
    requestedTipZMm: number,
    sequence: number,
    receivedAt: number,
  ) {
    this.sequence = sequence;
    this.receivedAt = receivedAt;
    this.evidence = {
      sampleId,
      targetId,
      purpose,
      requestedTipZMm,
      startedAt: new Date().toISOString(),
      elapsedMs: 0,
      outcome: 'interrupted',
      changes: 0,
      replies: [],
    };
  }
  diagnostics(): PhoneProbeEvidence {
    return {
      ...this.evidence,
      elapsedMs: Math.round(performance.now() - this.started),
    };
  }

  receive(update: CalibrationPageUpdate) {
    if (update.sequence <= this.sequence) return;
    this.sequence = update.sequence;
    this.receivedAt = performance.now();
    const reply = update.stepFeedback;
    if (reply) this.lastFeedbackId = reply.id;
    const issued = reply && this.issued.get(`${reply.id}/${reply.phase}`);
    if (
      !update.visible ||
      update.targetReady !== this.evidence.targetId ||
      !this.step ||
      !reply ||
      !issued ||
      reply.contactMode !== 'current'
    )
      return;
    if (
      (reply.outcome === 'ready' && reply.phase !== 'prepare') ||
      (reply.outcome === 'no_touch' && reply.phase !== 'result')
    )
      return;

    const point = reply.outcome === 'touched' ? reply.point : undefined;
    const pointerId = point ? update.contact?.id : undefined;
    if (reply.outcome === 'unknown')
      this.failure ??= reply.reason ?? 'unstable';
    if (reply.outcome === 'touched' && !point) this.failure = 'unstable';
    if (point && this.pointerId && pointerId && pointerId !== this.pointerId)
      this.failure = 'unstable';
    const earlyRelease = reply.releasedBeforeAck && !issued.releasedBeforeAck;
    if (earlyRelease) issued.releasedBeforeAck = true;
    if (
      earlyRelease ||
      (this.current && Boolean(this.current.point) !== Boolean(point))
    ) {
      this.evidence.changes++;
      this.evidence.lastContactChange = {
        id: reply.id,
        phase: reply.phase,
        sequence: update.sequence,
        elapsedMs: Math.round(this.receivedAt - this.started),
        outcome: reply.outcome,
      };
      // A press that appeared and vanished at a fixed Z is not evidence for a deeper descent.
      if (
        (earlyRelease || !point) &&
        this.evidence.purpose !== 'release' &&
        this.evidence.purpose !== 'preflight'
      )
        this.failure ??= 'unstable';
    }
    this.pointerId = pointerId;
    this.current = {
      revision: this.evidence.changes,
      point: point && { ...point },
    };
    if (
      !this.firstReply &&
      reply.id === this.step.id &&
      reply.phase === this.step.phase
    ) {
      this.firstReply = this.current;
      this.evidence.replies.push({
        id: reply.id,
        phase: reply.phase,
        sequence: update.sequence,
        roundTripMs: Math.round(this.receivedAt - this.sentAt),
        outcome: reply.outcome,
        reason: reply.reason,
        releasedBeforeAck: reply.releasedBeforeAck,
        point: this.current.point,
      });
    }
  }

  async measure(
    host: { signal: AbortSignal; check(): void },
    publish: () => void,
    shortEdgeCssPx: number,
    settleMs = 0,
  ): Promise<WebPoint | undefined> {
    const deadline =
      this.started + CALIBRATION_PHONE_POLICY.stepAcknowledgementMs;
    const jitterPx =
      Math.max(1, shortEdgeCssPx * 0.0075) * (1 + CALIBRATION_RELATIVE_SLACK);
    const matches = (a: Reading, b: Reading) => {
      if (a.revision !== b.revision) return false;
      if (!a.point || !b.point) return a.point === b.point;
      return (
        Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y) <= jitterPx
      );
    };
    const fail = (code: string, message: string): never => {
      this.evidence.outcome = code;
      throw new RobotArmError(code, message, 409, {
        sampleId: this.evidence.sampleId,
        targetId: this.evidence.targetId,
        purpose: this.evidence.purpose,
        stepId: this.step?.id,
        phase: this.step?.phase,
        elapsedMs: Math.round(performance.now() - this.started),
        lastUpdateAgeMs: Math.round(performance.now() - this.receivedAt),
        lastUpdateSequence: this.sequence,
        lastFeedbackId: this.lastFeedbackId,
      });
    };
    const check = () => {
      host.check();
      if (this.failure === 'multiple_contacts')
        fail('TOUCH_AMBIGUOUS', 'Expected zero or one mapped touch');
      if (this.failure === 'pointer_cancelled')
        fail(
          'PHONE_TOUCH_UNSTABLE',
          'The phone cancelled the active pointer. Touch at this position is unknown.',
        );
      if (this.failure === 'unstable')
        fail(
          'PHONE_TOUCH_UNSTABLE',
          'Phone contact changed while the robot was stationary. This position could not be measured.',
        );
      if (performance.now() >= deadline)
        fail(
          'PHONE_STEP_TIMEOUT',
          'Phone step acknowledgement timed out. Touch at this position is unknown.',
        );
    };
    const read = async (id: string, phase: Step['phase']): Promise<Reading> => {
      check();
      this.firstReply = undefined;
      this.sentAt = performance.now();
      this.step = { id, phase, contactMode: 'current' };
      this.issued.set(`${id}/${phase}`, {});
      publish();
      while (!this.firstReply) {
        check();
        await delay(20, undefined, { signal: host.signal });
      }
      check();
      return this.firstReply;
    };
    try {
      const id = this.evidence.sampleId;
      let previous = await read(id, 'prepare');
      // Two independent browser reads while the arm is still. A late change gets one recheck.
      for (const nextId of [id, `${id}-confirm`]) {
        // Allow a full phone report cycle before accepting absence at a depth limit or expected touch.
        const awaitingContact =
          !previous.point &&
          ['search-limit', 'press', 'slide'].includes(this.evidence.purpose);
        const now = performance.now();
        const waitMs = Math.max(
          awaitingContact
            ? CALIBRATION_PHONE_POLICY.heartbeatMs
            : CONFIRM_INTERVAL_MS,
          this.started + settleMs - now,
        );
        await delay(Math.max(0, Math.min(waitMs, deadline - now)), undefined, {
          signal: host.signal,
        });
        const result = await read(nextId, 'result');
        if (matches(previous, result) && matches(result, this.current!)) {
          this.evidence.outcome = result.point ? 'touched' : 'no_touch';
          return result.point;
        }
        previous = result;
      }
      return fail(
        'PHONE_TOUCH_UNSTABLE',
        'Phone contact changed while the robot was stationary. This position could not be measured.',
      );
    } finally {
      this.step = undefined;
    }
  }
}
