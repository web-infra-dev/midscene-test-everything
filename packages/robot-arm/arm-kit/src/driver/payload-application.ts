import { randomUUID } from 'node:crypto';
import {
  type PayloadApplicationSnapshot,
  type PayloadInvalidationReason,
  RobotArmError,
  type ToolPayload,
  sameToolPayload,
} from '../contracts.js';

/** Configuration evidence has its own generation, independent of motion cancellation. */
export class PayloadApplicationTracker {
  private value: PayloadApplicationSnapshot = {
    status: 'unconfirmed',
    sessionId: randomUUID(),
    generation: 0,
    updatedAt: new Date().toISOString(),
    reason: 'service-start',
  };
  read(): PayloadApplicationSnapshot {
    return structuredClone(this.value);
  }
  invalidate(reason: PayloadInvalidationReason): void {
    this.value = {
      status: 'unconfirmed',
      sessionId: this.value.sessionId,
      generation: this.value.generation + 1,
      updatedAt: new Date().toISOString(),
      reason,
    };
  }
  begin(): number {
    this.value = {
      status: 'applying',
      sessionId: this.value.sessionId,
      generation: this.value.generation + 1,
      updatedAt: new Date().toISOString(),
    };
    return this.value.generation;
  }
  check(generation: number): void {
    if (
      this.value.generation !== generation ||
      this.value.status !== 'applying'
    )
      throw new RobotArmError(
        'ACTION_STOPPED',
        'Payload application evidence was invalidated',
        409,
      );
  }
  confirm(generation: number, payload: ToolPayload): void {
    this.check(generation);
    const confirmedAt = new Date().toISOString();
    this.value = {
      status: 'confirmed',
      sessionId: this.value.sessionId,
      generation: generation + 1,
      updatedAt: confirmedAt,
      applied: {
        payload: { ...payload },
        confirmedAt,
        source: 'command-completion',
      },
    };
  }
  /** Fresh controller configuration may restore mass evidence, never optional inertia. */
  observeReadback(
    massKg: number,
    receivedAt: number,
    readbackAfterMs?: number,
  ): void {
    if (
      this.value.status === 'applying' ||
      (readbackAfterMs !== undefined && receivedAt < readbackAfterMs) ||
      receivedAt < Date.parse(this.value.updatedAt) ||
      [
        'application-failed',
        'application-interrupted',
        'emergency-stop',
        'stop-unconfirmed',
      ].includes(this.value.reason ?? '')
    )
      return;
    const applied = this.value.applied;
    // Routine reads keep the confirmation stable. After a connection gap,
    // only a new controller readback can establish the mass again.
    if (
      applied &&
      sameToolPayload({ massKg }, { massKg: applied.payload.massKg }) &&
      (readbackAfterMs === undefined ||
        (applied.source === 'controller-readback' &&
          Date.parse(applied.confirmedAt) >= readbackAfterMs))
    )
      return;
    const confirmedAt = new Date(receivedAt).toISOString();
    this.value = {
      status: 'confirmed',
      sessionId: this.value.sessionId,
      generation: this.value.generation + 1,
      updatedAt: confirmedAt,
      applied: {
        payload: { massKg },
        confirmedAt,
        source: 'controller-readback',
      },
    };
  }
  observeDisabled(generation: number): void {
    // A pre-enable query finishing late must not revoke a newer confirmation.
    if (
      generation === this.value.generation &&
      this.value.status === 'confirmed'
    )
      this.invalidate('disabled');
  }
}
