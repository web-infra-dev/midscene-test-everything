import { randomUUID } from 'node:crypto';
import {
  type CartesianPose,
  type CurrentOperation,
  type MotionHandle,
  type MotionOptions,
  type MotionResult,
  RobotArmError,
  type ToolPayload,
  type Workspace,
} from '../contracts.js';
import { createMotionHandle } from '../driver/motion-handle.js';
import type { RobotArmAdapter } from './contracts.js';
import { RobotDriverBoundary } from './driver-boundary.js';
import { MotionExecutor } from './motion-executor.js';
import { OperationCoordinator } from './operation-coordinator.js';
import { checkRecovery } from './recovery.js';

/** Public standalone kernel. Applications inherit the same lease and safety arbitration. */
export class RobotKernel extends OperationCoordinator {
  protected readonly adapter: RobotDriverBoundary;
  protected softwarePaused = false;
  private readonly executor: MotionExecutor;
  constructor(adapter: RobotArmAdapter) {
    super();
    this.adapter = new RobotDriverBoundary(adapter, () =>
      this.observeEmergencyStop(),
    );
    this.executor = new MotionExecutor(this.adapter);
  }
  get id() {
    return this.adapter.id;
  }
  get name() {
    return this.adapter.name;
  }
  get connectionIdentity() {
    return this.adapter.connectionIdentity;
  }
  get capabilities() {
    return this.adapter.capabilities;
  }
  get resolver() {
    return { descriptor: (id: string) => this.adapter.resolver.descriptor(id) };
  }
  current() {
    return this.operation ? { ...this.operation } : null;
  }
  feedbackStatus() {
    return this.adapter.feedbackStatus();
  }
  controllerMotionSettings() {
    return this.adapter.controllerMotionSettings();
  }
  controllerState() {
    return this.adapter.controllerState();
  }
  status(fresh = true) {
    return this.adapter.status(fresh);
  }
  getState(fresh = true) {
    return this.adapter.getState(fresh);
  }
  readPose() {
    return this.adapter.readPose();
  }
  getPose() {
    return this.adapter.getPose();
  }
  readJoints() {
    return this.adapter.readJoints();
  }
  validateCartesian(
    kind: 'linear' | 'ptp',
    pose: CartesianPose,
    options: MotionOptions,
    workspace?: Workspace,
  ) {
    this.adapter.validateCartesian(kind, pose, options, workspace);
  }
  validateJointMotion(
    values: number[],
    options: MotionOptions,
    bounds?: { min: number; max: number }[],
  ) {
    this.adapter.validateJointMotion(values, options, bounds);
  }
  preflightCartesian(
    kind: 'linear' | 'ptp',
    pose: CartesianPose,
    options: MotionOptions,
    workspace?: Workspace,
  ) {
    return this.adapter.preflightCartesian(kind, pose, options, workspace);
  }
  protected automaticRecovery?: Promise<void>;

  protected disconnectedByRequest = false;

  protected observeEmergencyStop(): void | Promise<void> {
    this.operatorStop = 'emergency-stop';
    this.requireRecovery('emergency-stop');
  }

  private get canAutomaticallyRecover() {
    return (
      this.recoveryRequired &&
      !this.operatorStop &&
      !this.softwarePaused &&
      !this.disconnectedByRequest
    );
  }

  protected release(status: CurrentOperation['status'], error?: unknown) {
    super.release(status, error);
    if (this.canAutomaticallyRecover) void this.refreshRecovery();
  }

  protected async verifyAutomaticRecovery(check: () => void) {
    await checkRecovery(this.adapter, this.softwarePaused, check);
  }

  private checkAutomaticRecovery() {
    if (this.automaticRecovery) return this.automaticRecovery;
    const revision = this.recoveryRevision;
    const generation = this.generation;
    const guard = () => {
      if (
        !this.canAutomaticallyRecover ||
        revision !== this.recoveryRevision ||
        generation !== this.generation
      )
        throw new RobotArmError(
          'RECOVERY_REQUIRED',
          'Recovery was interrupted',
          409,
        );
    };
    this.automaticRecovery = this.verifyAutomaticRecovery(guard)
      .then(() => {
        guard();
        this.recoveryRequired = false;
      })
      .finally(() => {
        this.automaticRecovery = undefined;
      });
    return this.automaticRecovery;
  }

  protected async refreshRecovery() {
    if (this.canAutomaticallyRecover && !this.leased && !this.stopInProgress)
      await this.checkAutomaticRecovery().catch(() => undefined);
  }

  /** Reserve the requested lease synchronously so cancellation can identify it during recovery. */
  protected acquireForWork(
    kind: CurrentOperation['kind'],
    id?: string,
    allowRecovery = false,
  ): Promise<void> | undefined {
    const automatic = this.canAutomaticallyRecover && !allowRecovery;
    this.acquire(kind, id, allowRecovery || automatic);
    const pending = automatic
      ? this.checkAutomaticRecovery()
      : this.automaticRecovery;
    if (!pending) return;
    const operation = this.operation;
    const signal = this.abort!.signal;
    return (allowRecovery ? pending.catch(() => undefined) : pending)
      .then(() => {
        if (signal.aborted)
          throw new RobotArmError(
            'ACTION_STOPPED',
            'Operation interrupted during recovery',
            409,
          );
        if (!allowRecovery && this.recoveryRequired)
          throw new RobotArmError(
            'RECOVERY_REQUIRED',
            'Recovery was interrupted',
            409,
          );
      })
      .catch((error) => {
        if (this.operation === operation) super.release('failed', error);
        throw error;
      });
  }

  async readiness() {
    await this.refreshRecovery();
    const result = await this.adapter.readiness();
    if (this.recoveryRequired) result.reasons.push('RECOVERY_REQUIRED');
    if (this.softwarePaused) result.reasons.push('ROBOT_PAUSED');
    if (this.leased || this.stopInProgress) result.reasons.push('BUSY');
    return {
      ready: result.reasons.length === 0,
      reasons: [...new Set(result.reasons)],
    };
  }
  async assertReady() {
    const r = await this.readiness();
    if (!r.ready)
      throw new RobotArmError(r.reasons[0], 'Robot is not ready', 409, {
        reasons: r.reasons,
      });
  }
  private async control<T>(
    work: () => Promise<T>,
    allowRecovery = false,
  ): Promise<T> {
    const recovery = this.acquireForWork(
      'control',
      randomUUID(),
      allowRecovery,
    );
    if (recovery) await recovery;
    try {
      const result = await work();
      this.check();
      this.release('completed');
      return result;
    } catch (error) {
      this.release('failed', error);
      throw error;
    }
  }
  connect() {
    return this.control(async () => {
      await this.adapter.connect();
      this.disconnectedByRequest = false;
    }, true);
  }
  disconnect() {
    return this.control(async () => {
      this.disconnectedByRequest = true;
      await this.adapter.disconnect();
    }, true);
  }
  enable(payload?: ToolPayload) {
    return this.control(() => this.adapter.enable(payload));
  }
  applyPayload(payload: ToolPayload) {
    return this.control(() => this.adapter.applyPayload(payload));
  }
  disable() {
    return this.control(() => this.adapter.disable(), true);
  }
  clearFaults() {
    return this.control(() => this.adapter.clearFaults(), true);
  }
  protected recoveryGuard() {
    const revision = this.recoveryRevision;
    return () => {
      this.check();
      if (this.recoveryRevision !== revision)
        throw new RobotArmError(
          'RECOVERY_REQUIRED',
          'Recovery was interrupted',
          409,
        );
    };
  }
  async recover() {
    return this.control(async () => {
      const guard = this.recoveryGuard();
      await checkRecovery(this.adapter, this.softwarePaused, guard);
      guard();
      this.recoveryRequired = false;
    }, true);
  }
  private async confirmStopped() {
    const s = await this.adapter.status();
    if (s.connection !== 'connected' || !['idle', 'paused'].includes(s.motion))
      throw new RobotArmError(
        'STOP_UNCONFIRMED',
        'Actual stop cannot be confirmed',
        503,
      );
  }
  stop(): Promise<void> {
    this.operatorStop ??= 'manual-stop';
    return this.stopAfterInterruption();
  }
  protected stopAfterInterruption(): Promise<void> {
    return this.safetyControl('stop', async () => {
      this.recoveryRequired = true;
      await this.adapter.stop();
      await this.confirmStopped();
      if (this.operation?.kind === 'drag') this.release('stopped');
    });
  }
  pause(): Promise<void> {
    this.adapter.resolver.require('pause');
    this.softwarePaused = true;
    return this.safetyControl('pause', async () => {
      this.recoveryRequired = true;
      await this.adapter.pause!();
      if (this.interrupt === 'pause') await this.adapter.stop();
      await this.confirmStopped();
      if (this.operation?.kind === 'drag') this.release('stopped');
    });
  }
  emergencyStop(): Promise<void> {
    this.adapter.resolver.require('emergencyStop');
    this.operatorStop = 'emergency-stop';
    return this.safetyControl('emergencyStop', async () => {
      this.recoveryRequired = true;
      await this.adapter.emergencyStop!();
      await this.confirmStopped();
      if (this.operation?.kind === 'drag') this.release('stopped');
    });
  }
  resume(): Promise<void> {
    this.adapter.resolver.require('resume');
    return this.control(async () => {
      if (
        !this.softwarePaused &&
        (await this.adapter.status()).motion !== 'paused'
      )
        throw new RobotArmError('NOT_PAUSED', 'Robot is not paused', 409);
      await this.adapter.stop();
      await this.confirmStopped();
      this.check();
      await this.adapter.resume!();
      this.check();
      if ((await this.adapter.status()).motion !== 'idle')
        throw new RobotArmError(
          'RESUME_UNCONFIRMED',
          'Robot is not idle after resume',
          503,
        );
      this.softwarePaused = false;
    }, true);
  }
  async enterDragMode(): Promise<void> {
    this.adapter.resolver.require('enterDragMode');
    const recovery = this.acquireForWork('drag');
    if (recovery) await recovery;
    try {
      await this.adapter.assertReady();
      this.check();
      await this.adapter.enterDragMode!();
      this.check();
      if ((await this.adapter.status()).operationMode !== 'backdrive')
        throw new RobotArmError('DRAG_UNCONFIRMED', 'Drag not confirmed', 503);
    } catch (error) {
      this.recoveryRequired = true;
      this.release('failed', error);
      throw error;
    }
  }
  async exitDragMode(): Promise<void> {
    this.adapter.resolver.require('exitDragMode');
    if (!this.leased || this.operation?.kind !== 'drag')
      throw new RobotArmError(
        'DRAG_NOT_CURRENT',
        'No owned Drag operation',
        409,
      );
    try {
      await this.adapter.exitDragMode!();
      this.check();
      await this.confirmStopped();
      if (this.resolver.descriptor('state.cartesian'))
        await this.executor.stable(
          await this.readPose().then((s) => s.pose),
          5000,
          () => this.check(),
          (ms) => this.delay(ms),
        );
      this.release('completed');
    } catch (error) {
      this.recoveryRequired = true;
      this.release('failed', error);
      throw error;
    }
  }
  protected beforeKernelMotion(): Promise<void> {
    return Promise.resolve();
  }
  protected afterKernelMotion(): Promise<void> {
    return Promise.resolve();
  }
  private async managedMotion(
    submit: () => Promise<MotionHandle>,
    target: CartesianPose | number[] | (() => CartesianPose | number[]),
    timeoutMs: number,
    prepare?: () => Promise<void>,
  ): Promise<MotionHandle> {
    const recovery = this.acquireForWork('motion');
    if (recovery) await recovery;
    try {
      await this.adapter.assertReady();
      this.check();
      if (prepare) await prepare();
      this.check();
      await this.beforeKernelMotion();
      this.check();
      this.motionSubmitted = true;
      const pending = submit();
      this.accepting = pending;
      const handle = await pending;
      this.accepting = undefined;
      this.check();
      const terminal = (async (): Promise<MotionResult> => {
        try {
          const result = await handle.wait();
          this.check();
          const measuredTarget =
            typeof target === 'function' ? target() : target;
          if (result.status === 'completed') {
            if (
              Array.isArray(measuredTarget) &&
              this.resolver.descriptor('state.joints')
            )
              await this.executor.stableJoints(
                measuredTarget,
                timeoutMs,
                () => this.check(),
                (ms) => this.delay(ms),
              );
            else if (
              !Array.isArray(measuredTarget) &&
              this.resolver.descriptor('state.cartesian')
            )
              await this.executor.stable(
                measuredTarget,
                timeoutMs,
                () => this.check(),
                (ms) => this.delay(ms),
              );
          }
          if (result.status === 'completed') {
            await this.afterKernelMotion();
            this.check();
          }
          if (result.status !== 'completed') this.recoveryRequired = true;
          this.check();
          this.release(result.status === 'completed' ? 'completed' : 'stopped');
          return result;
        } catch (error) {
          this.recoveryRequired = true;
          if (this.interrupt) {
            try {
              await this.stopPromise;
              this.release('stopped');
              return {
                status: 'stopped',
                completedAt: new Date().toISOString(),
              };
            } catch (stopError) {
              this.release('failed', stopError);
              throw stopError;
            }
          }
          try {
            await this.stopAfterInterruption();
          } catch (stopError) {
            this.release('failed', stopError);
            throw stopError;
          }
          this.release('failed', error);
          throw error;
        }
      })();
      const wrapped = createMotionHandle(handle.id, terminal);
      return { ...wrapped, acceptedAt: handle.acceptedAt };
    } catch (error) {
      this.accepting = undefined;
      if (this.motionSubmitted) {
        this.recoveryRequired = true;
        try {
          await (this.stopPromise ?? this.stopAfterInterruption());
        } catch (stopError) {
          this.release('failed', stopError);
          throw stopError;
        }
      }
      this.release('failed', error);
      throw error;
    }
  }
  private async delay(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    this.check();
  }
  async moveLinear(
    pose: CartesianPose,
    options: MotionOptions = {},
    workspace?: Workspace,
  ) {
    pose = structuredClone(pose);
    options = structuredClone(options);
    workspace = workspace && structuredClone(workspace);
    this.validateCartesian('linear', pose, options, workspace);
    return this.managedMotion(
      () => this.adapter.moveLinear(pose, options, workspace),
      pose,
      5000,
      workspace
        ? undefined
        : () => this.adapter.preflightCartesian('linear', pose, options),
    );
  }
  async movePtp(
    pose: CartesianPose,
    options: MotionOptions = {},
    workspace?: Workspace,
  ) {
    pose = structuredClone(pose);
    options = structuredClone(options);
    workspace = workspace && structuredClone(workspace);
    this.validateCartesian('ptp', pose, options, workspace);
    return this.managedMotion(
      () => this.adapter.movePtp(pose, options, workspace),
      pose,
      5000,
      workspace
        ? undefined
        : () => this.adapter.preflightCartesian('ptp', pose, options),
    );
  }
  async moveJoints(
    values: number[],
    options: MotionOptions,
    bounds?: { min: number; max: number }[],
  ) {
    this.validateJointMotion(values, options, bounds);
    values = [...values];
    options = structuredClone(options);
    bounds = bounds && structuredClone(bounds);
    this.validateJointMotion(values, options, bounds);
    return this.managedMotion(
      () => this.adapter.moveJoints(values, options, bounds),
      values,
      5000,
    );
  }
  async jog(
    axis: 'x' | 'y' | 'z',
    deltaMm: number,
    options: MotionOptions,
    workspace: Workspace,
  ): Promise<MotionHandle> {
    if (!['x', 'y', 'z'].includes(axis) || !Number.isFinite(deltaMm))
      throw new RobotArmError('INVALID_JOG', 'Invalid Cartesian step');
    // Sampling is inside the managed lease; another action cannot change its origin.
    options = structuredClone(options);
    workspace = structuredClone(workspace);
    let target!: CartesianPose;
    return this.managedMotion(
      () => this.adapter.moveLinear(target, options, workspace),
      () => target,
      5000,
      async () => {
        const sample = await this.readPose();
        this.check();
        target = structuredClone(sample.pose);
        target.positionMm[axis] += deltaMm;
        this.validateCartesian('linear', target, options, workspace);
      },
    );
  }
  async jointJog(
    joint: number,
    delta: number,
    options: MotionOptions,
    bounds?: { min: number; max: number }[],
  ): Promise<MotionHandle> {
    if (
      !Number.isInteger(joint) ||
      joint < 0 ||
      joint >= this.capabilities.jointCount ||
      !Number.isFinite(delta)
    )
      throw new RobotArmError('INVALID_JOG', 'Invalid joint step');
    options = structuredClone(options);
    bounds = bounds && structuredClone(bounds);
    let target!: number[];
    return this.managedMotion(
      () => this.adapter.moveJoints(target, options, bounds),
      () => target,
      5000,
      async () => {
        target = [...(await this.readJoints()).values];
        this.check();
        target[joint] += delta;
        this.validateJointMotion(target, options, bounds);
      },
    );
  }
}
