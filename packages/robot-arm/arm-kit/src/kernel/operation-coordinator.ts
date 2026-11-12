import { randomUUID } from 'node:crypto';
import {
  type CurrentOperation,
  type RecoveryReason,
  RobotArmError,
} from '../contracts.js';

/** Shared lease for application services and SDK motion. Safety controls bypass it. */
export class OperationCoordinator {
  protected operation?: CurrentOperation;
  protected leased = false;
  protected operatorStop?: 'manual-stop' | 'emergency-stop';
  protected recoveryRevision = 0;
  private requiredRecovery?: RecoveryReason;
  get requiresOperatorRecovery() {
    return this.operatorStop !== undefined;
  }
  get recoveryReason() {
    return this.operatorStop ?? this.requiredRecovery;
  }
  protected get recoveryRequired() {
    return this.recoveryReason !== undefined;
  }
  protected set recoveryRequired(value: boolean) {
    if (!value) {
      this.operatorStop = undefined;
      this.requiredRecovery = undefined;
    } else this.requireRecovery('interruption');
  }
  protected requireRecovery(reason: RecoveryReason) {
    this.recoveryRevision++;
    // A later transport error must never downgrade an operator or hardware stop.
    const priority: Record<RecoveryReason, number> = {
      'socket-disconnect': 0,
      interruption: 1,
      fault: 2,
      pause: 3,
      'manual-stop': 4,
      'emergency-stop': 5,
    };
    if (
      !this.recoveryReason ||
      priority[reason] > priority[this.recoveryReason]
    )
      this.requiredRecovery = reason;
  }
  protected abort?: AbortController;
  protected interrupt:
    | 'stop'
    | 'cancel'
    | 'pause'
    | 'emergencyStop'
    | undefined;
  protected stopPromise?: Promise<void>;
  protected stopInProgress?: Promise<void>;
  protected accepting?: Promise<unknown>;
  protected motionSubmitted = false;
  protected generation = 0;
  private safety?: { priority: number; promise: Promise<void> };
  protected acquire(
    kind: CurrentOperation['kind'],
    id: string = randomUUID(),
    allowRecovery = false,
  ): void {
    if (this.leased || this.stopInProgress)
      throw new RobotArmError(
        'BUSY',
        'Another operation holds the robot lease',
        409,
      );
    if (this.recoveryRequired && !allowRecovery)
      throw new RobotArmError(
        'RECOVERY_REQUIRED',
        this.requiresOperatorRecovery
          ? 'Explicit recovery check is required after an operator stop'
          : 'Robot recovery is pending',
        409,
      );
    this.leased = true;
    this.interrupt = undefined;
    this.stopPromise = undefined;
    this.motionSubmitted = false;
    this.abort = new AbortController();
    this.operation = { requestId: id, kind, status: 'running' };
  }
  protected release(status: CurrentOperation['status'], error?: unknown): void {
    if (this.operation) {
      this.operation.status = status;
      this.operation.error = error instanceof Error ? error.message : undefined;
    }
    this.leased = false;
  }
  protected check(): void {
    if (this.abort?.signal.aborted)
      throw new RobotArmError(
        this.interrupt === 'cancel' ? 'ACTION_CANCELLED' : 'ACTION_STOPPED',
        'Operation interrupted',
        409,
      );
  }
  protected safetyControl(
    kind: 'stop' | 'pause' | 'emergencyStop',
    work: () => Promise<void>,
  ): Promise<void> {
    const priority = { pause: 1, stop: 2, emergencyStop: 3 }[kind];
    if (this.safety && this.safety.priority >= priority)
      return this.safety.promise;
    this.interrupt = kind;
    this.generation++;
    this.abort?.abort();
    const previous = this.safety?.promise;
    // Dispatch the escalation immediately. Retain the gate until lower-priority work settles.
    const dispatched = work();
    const promise = (async () => {
      try {
        await dispatched;
      } finally {
        await previous?.catch(() => undefined);
      }
    })();
    this.safety = { priority, promise };
    this.stopInProgress = promise;
    this.stopPromise = promise;
    const clear = () => {
      if (this.safety?.promise === promise) {
        this.safety = undefined;
        this.stopInProgress = undefined;
      }
    };
    void promise.then(clear, clear);
    return promise;
  }
}
