import { randomUUID } from 'node:crypto';
import {
  type CartesianPose,
  type MotionHandle,
  type MotionOptions,
  type MotionResult,
  type RobotArmAdapter,
  type RobotArmCapabilities,
  RobotArmError,
  type RobotState,
  SCREEN_TILT_LIMIT_DEGREES,
} from '../contracts.js';
import { assertPose, assertSpeed, assertTarget, distance } from '../domain.js';
import {
  type SequenceFeedback,
  createLinearMotionSequence,
} from '../driver/linear-sequence.js';
import { createMotionHandle } from '../driver/motion-handle.js';
import type {
  LinearSequenceOptions,
  LinearSequenceTarget,
  RobotDriver,
  RobotKinematics,
  RobotStatus,
  SampleQuality,
} from '../kernel/contracts.js';

export interface TestRobotOptions {
  jointCount?: number;
  orientation?: 'fixed' | 'yaw' | 'full';
  jointOnly?: boolean;
  physicalSpeedOnly?: boolean;
  motionDurationMs?: number;
  initialPose?: CartesianPose;
  /**
   * Test seam only. The shipped Adapter configuration does not set it and the
   * service never passes it, because an installation must not be able to raise the
   * repository-wide SCREEN_TILT_LIMIT_DEGREES. It exists so a test can hold one set
   * of sample points fixed and vary only the declared limit, proving the limit is
   * what decides screen geometry.
   */
  screenTiltLimitDegrees?: number;
}
export class TestRobotAdapter implements RobotArmAdapter {
  private sequenceGeneration = 0;
  private sequenceOwner?: object;
  private sequenceFeedback?: SequenceFeedback;
  private releaseSequence?: () => void;
  readonly id: string;
  readonly name: string;
  readonly connectionIdentity: string;
  readonly contractVersion = 1 as const;
  private readonly motionCapabilities: RobotArmCapabilities;
  readonly kinematics: RobotKinematics;
  readonly readinessPolicy = {
    maxStateAgeMs: 1000,
    required: ['emergencyStop', 'protectiveStop'] as (
      | 'emergencyStop'
      | 'protectiveStop'
    )[],
  };
  readonly driver: RobotDriver;
  readonly motionLimits: NonNullable<RobotArmAdapter['motionLimits']>;
  private sampleSequence = 0;
  private jointValues: number[] = [];
  private state: RobotState;
  private pending?: {
    timer: ReturnType<typeof setInterval>;
    resolve: (r: MotionResult) => void;
  };
  readonly movements: CartesianPose[] = [];
  /** Jog commands the runtime issued, in order. */
  readonly jogStarts: { axis?: string; joint?: number; direction: number }[] =
    [];
  jogStops = 0;
  constructor(private readonly options: TestRobotOptions = {}) {
    const jointCount = options.jointCount ?? 4;
    if (!Number.isInteger(jointCount) || jointCount < 1)
      throw new RobotArmError('INVALID_CONFIG', 'Positive jointCount required');
    const orientation =
      options.orientation ?? (jointCount === 4 ? 'yaw' : 'full');
    const screenTiltLimitDegrees =
      options.screenTiltLimitDegrees ?? SCREEN_TILT_LIMIT_DEGREES;
    if (!Number.isFinite(screenTiltLimitDegrees) || screenTiltLimitDegrees < 0)
      throw new RobotArmError(
        'INVALID_CONFIG',
        'screenTiltLimitDegrees must be a non-negative number of degrees',
      );
    // A full-orientation arm aligns the tool to the fitted screen plane, so a
    // declared tilt limit cannot describe it. Refusing beats ignoring the field:
    // an ignored setting reads as one that took effect.
    if (orientation === 'full' && options.screenTiltLimitDegrees !== undefined)
      throw new RobotArmError(
        'INVALID_CONFIG',
        'The screen tilt limit applies to restricted-orientation adapters only; a full-orientation arm aligns to the fitted screen plane',
      );
    this.id = `test-robot-${jointCount}`;
    this.connectionIdentity = this.id;
    this.name = `${jointCount}-axis Test robot`;
    this.motionCapabilities = {
      jointCount,
      orientation,
      fixedOrientation:
        orientation !== 'full' ? { x: 0, y: 0, z: 0, w: 1 } : undefined,
      ptp: true,
      linear: true,
      dragMode: true,
      stop: true,
      speedModes: ['ratio', 'linear'],
      maxLinearSpeedMmPerSecond: 1000,
      workspace: {
        min: { x: -1000, y: -1000, z: -1000 },
        max: { x: 1000, y: 1000, z: 1000 },
      },
      screenNormalToleranceDegrees: screenTiltLimitDegrees,
    };
    this.kinematics = {
      jointCount,
      joints: Array.from({ length: jointCount }, (_, i) => ({
        name: `J${i + 1}`,
        type: 'revolute',
        unit: 'degrees',
        limits: { min: -360, max: 360, source: 'test-robot' },
      })),
      cartesianDof: options.jointOnly
        ? []
        : [
            'x',
            'y',
            'z',
            ...(orientation === 'full'
              ? (['rx', 'ry', 'rz'] as const)
              : orientation === 'yaw'
                ? (['rz'] as const)
                : []),
          ],
      orientation,
      fixedOrientation: this.motionCapabilities.fixedOrientation,
      workspace: this.motionCapabilities.workspace,
      screenNormalToleranceDegrees: screenTiltLimitDegrees,
    };
    this.jointValues = Array(jointCount).fill(0);
    const speed = options.physicalSpeedOnly
      ? { linear: { min: 0.01, max: 1000 } }
      : {
          ratio: { min: 0.001, max: 1 },
          linear: { min: 0.01, max: 1000 },
          angular: { min: 0.01, max: 360 },
          joints: { min: 0.01, max: 360 },
        };
    const constraints = {
      speed,
      acceleration: {
        ratio: { min: 0.001, max: 1 },
        linear: { min: 0.01, max: 1000 },
        angular: { min: 0.01, max: 360 },
        joints: { min: 0.01, max: 360 },
      },
    };
    this.motionLimits = {
      linear: constraints,
      linearSequence: constraints,
      ptp: constraints,
      joints: constraints,
    };
    this.driver = {
      ...(!options.jointOnly
        ? {
            readPose: async () => ({
              ...this.sample(),
              pose: await this.getPose(),
            }),
            moveLinear: (p: CartesianPose, o: MotionOptions) =>
              this.moveLinear(p, o),
            beginLinearSequence: (
              targets: readonly LinearSequenceTarget[],
              options: LinearSequenceOptions,
            ) => this.beginSequence(targets, options),
            movePtp: (p: CartesianPose, o: MotionOptions) => this.movePtp(p, o),
            checkReachability: async (p: CartesianPose) =>
              assertTarget(p, this.kinematics.workspace!),
          }
        : {}),
      readJoints: async () => ({
        ...this.sample(),
        values: [...this.jointValues],
      }),
      moveJoints: (v, o) => this.moveJoints(v, o),
      stop: () => this.stop(),
      enable: () => this.enable(),
      disable: () => this.disable(),
      clearFaults: () => this.clearFaults(),
      enterDragMode: () => this.enterDragMode(),
      exitDragMode: () => this.exitDragMode(),
      startJog: async (target) => {
        this.jogStarts.push(target);
      },
      stopJog: async () => {
        this.jogStops += 1;
      },
      pause: () => this.pause(),
      resume: () => this.resume(),
      emergencyStop: () => this.emergencyStop(),
      connect: () => this.connect(),
      disconnect: () => this.disconnect(),
      getState: () => this.readStatus(),
    };
    const pose = options.initialPose ?? {
      frame: 'base',
      positionMm: { x: 0, y: 0, z: 100 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    };
    assertPose(pose);
    this.state = {
      connected: false,
      enabled: false,
      moving: false,
      dragMode: false,
      mode: 'disconnected',
      pose: structuredClone(pose),
      faults: [],
      updatedAt: new Date().toISOString(),
    };
  }
  private sample(): SampleQuality {
    return {
      sampleId: String(++this.sampleSequence),
      receivedAt: new Date().toISOString(),
      source: 'polling',
      stale: false,
    };
  }
  private async readStatus(): Promise<RobotStatus> {
    const s = await this.getState();
    const quality = this.sample();
    return {
      connection: s.connected ? 'connected' : 'disconnected',
      authority: 'not-required',
      power: s.connected ? 'on' : 'off',
      enablement: s.enabled ? 'enabled' : 'disabled',
      motion: s.paused ? 'paused' : s.moving ? 'moving' : 'idle',
      operationMode: s.dragMode ? 'backdrive' : 'automatic',
      emergencyStop: s.faults.some((f) => f.code === 'EMERGENCY_STOP')
        ? 'active'
        : 'inactive',
      protectiveStop: 'inactive',
      faults: s.faults,
      quality,
      pose: this.options.jointOnly ? undefined : { ...quality, pose: s.pose! },
      joints: { ...quality, values: [...this.jointValues] },
      vendorMode: s.mode,
    };
  }
  private async moveJoints(values: number[], options: MotionOptions) {
    const handle = await this.move(this.state.pose!, options);
    const terminal = handle.wait().then((result) => {
      if (result.status === 'completed') this.jointValues = [...values];
      return result;
    });
    return createMotionHandle(handle.id, terminal);
  }
  private update(p: Partial<RobotState>) {
    this.state = { ...this.state, ...p, updatedAt: new Date().toISOString() };
  }
  private connected() {
    if (!this.state.connected)
      throw new RobotArmError('DISCONNECTED', 'Test robot disconnected', 503);
  }
  async connect() {
    this.update({
      connected: true,
      mode: this.state.moving
        ? 'moving'
        : this.state.dragMode
          ? 'drag'
          : this.state.enabled
            ? 'enabled'
            : 'disabled',
    });
  }
  async disconnect() {
    if (this.state.connected) await this.stop();
    this.update({
      connected: false,
      enabled: false,
      dragMode: false,
      mode: 'disconnected',
    });
  }
  async getState(): Promise<RobotState> {
    return structuredClone(this.state);
  }
  async getPose(): Promise<CartesianPose> {
    this.connected();
    return structuredClone(this.state.pose!);
  }
  async enable() {
    this.connected();
    if (this.state.faults.length)
      throw new RobotArmError(
        'ROBOT_FAULT',
        'Clear test-robot fault explicitly',
        409,
      );
    this.update({ enabled: true, mode: 'enabled' });
  }
  async disable() {
    this.connected();
    await this.stop();
    this.update({ enabled: false, dragMode: false, mode: 'disabled' });
  }
  async clearFaults() {
    this.connected();
    this.update({ faults: [] });
  }
  async stop() {
    this.sequenceGeneration++;
    this.connected();
    const p = this.pending;
    this.pending = undefined;
    if (p) {
      clearInterval(p.timer);
      p.resolve({ status: 'stopped', completedAt: new Date().toISOString() });
    }
    this.releaseSequence?.();
    this.update({
      moving: false,
      mode: this.state.dragMode
        ? 'drag'
        : this.state.enabled
          ? 'enabled'
          : 'disabled',
    });
  }
  async enterDragMode() {
    this.connected();
    if (!this.state.enabled || this.state.moving || this.state.paused)
      throw new RobotArmError(
        'NOT_READY',
        'Test robot must be enabled and idle',
        409,
      );
    this.update({ dragMode: true, mode: 'drag' });
  }
  async exitDragMode() {
    this.connected();
    this.update({
      dragMode: false,
      mode: this.state.enabled ? 'enabled' : 'disabled',
    });
  }
  async pause() {
    this.connected();
    await this.stop();
    this.update({ paused: true, mode: 'paused' });
  }
  async resume() {
    this.connected();
    this.update({
      paused: false,
      mode: this.state.enabled ? 'enabled' : 'disabled',
    });
  }
  async emergencyStop() {
    this.connected();
    const p = this.pending;
    this.pending = undefined;
    if (p) {
      clearInterval(p.timer);
      p.resolve({ status: 'stopped', completedAt: new Date().toISOString() });
    }
    // Mirrors the real controller: the stop itself leaves a fault behind, which
    // the caller must surface through state rather than as a thrown error.
    this.update({
      moving: false,
      dragMode: false,
      paused: false,
      mode: 'emergency-stop',
      faults: [
        {
          code: 'EMERGENCY_STOP',
          message: 'Test robot emergency stop',
          recoverable: true,
        },
      ],
    });
  }
  moveLinear(p: CartesianPose, o?: MotionOptions): Promise<MotionHandle> {
    return this.move(p, o);
  }
  /**
   * Passive sample from simulated state. The interpolation timer updates the
   * pose every 5 ms, so a caller can watch the tool cross a screen plane while
   * a motion is in flight without issuing any command.
   */
  latestToolVectorSample() {
    if (this.sequenceFeedback)
      return {
        pose: structuredClone(this.sequenceFeedback.pose),
        receivedAt: this.sequenceFeedback.receivedAt,
      };
    return this.state.pose
      ? {
          pose: structuredClone(this.state.pose),
          receivedAt: Date.parse(this.state.updatedAt),
        }
      : undefined;
  }
  private async beginSequence(
    targets: readonly LinearSequenceTarget[],
    options: LinearSequenceOptions,
  ) {
    targets = structuredClone(targets);
    options = { ...options };
    this.connected();
    if (this.sequenceOwner || this.state.moving)
      throw new RobotArmError(
        'BUSY',
        'Test robot has an outstanding motion',
        409,
      );
    if (
      !this.state.enabled ||
      this.state.paused ||
      this.state.dragMode ||
      this.state.faults.length
    )
      throw new RobotArmError('NOT_READY', 'Test robot is not ready', 409);
    const owner = {};
    const generation = this.sequenceGeneration;
    this.sequenceOwner = owner;
    const check = () => {
      if (
        generation !== this.sequenceGeneration ||
        this.sequenceOwner !== owner ||
        options.signal?.aborted
      )
        throw new RobotArmError(
          'ACTION_STOPPED',
          'Test robot sequence interrupted',
          409,
        );
      if (
        !this.state.connected ||
        !this.state.enabled ||
        this.state.paused ||
        this.state.dragMode ||
        this.state.faults.length
      )
        throw new RobotArmError(
          'ROBOT_FAULT',
          'Test robot sequence is not safe',
          409,
        );
    };
    const sample = () => {
      this.sequenceFeedback = {
        sampleId: String(++this.sampleSequence),
        connectionGeneration: generation,
        receivedAt: Date.now(),
        pose: structuredClone(this.state.pose!),
      };
    };
    sample();
    const timer = setInterval(sample, 5);
    const release = () => {
      clearInterval(timer);
      if (this.sequenceOwner === owner) {
        this.sequenceOwner = undefined;
        this.sequenceFeedback = undefined;
        this.releaseSequence = undefined;
      }
    };
    this.releaseSequence = release;
    let tail: Promise<MotionResult> | undefined;
    try {
      return createLinearMotionSequence(targets, options, {
        check,
        feedback: () => {
          const actual = this.latestToolVectorSample();
          return actual && this.sequenceFeedback
            ? {
                ...this.sequenceFeedback,
                pose: actual.pose,
                receivedAt: actual.receivedAt,
              }
            : undefined;
        },
        submit: async (target) => {
          check();
          const previous = tail;
          tail = (async () => {
            await previous;
            check();
            const handle = await this.move(target.pose, target.options, owner);
            return handle.wait({
              timeoutMs: options.timeoutMs,
              signal: options.signal,
            });
          })();
          tail.catch(() => undefined);
          return {
            id: randomUUID(),
            acceptedAt: Date.now(),
            submittedAt: Date.now(),
          };
        },
        terminal: async () => {
          check();
          if (!tail)
            throw new RobotArmError(
              'INVALID_SEQUENCE',
              'No Test robot command to confirm',
              409,
            );
          const result = await tail;
          check();
          return result;
        },
        stopped: () => this.sequenceOwner !== owner && !this.state.moving,
        release,
      });
    } catch (error) {
      release();
      throw error;
    }
  }
  movePtp(p: CartesianPose, o?: MotionOptions): Promise<MotionHandle> {
    return this.move(p, o);
  }
  private async move(
    target: CartesianPose,
    options?: MotionOptions,
    sequenceOwner?: object,
  ): Promise<MotionHandle> {
    this.connected();
    if (this.sequenceOwner && this.sequenceOwner !== sequenceOwner)
      throw new RobotArmError(
        'BUSY',
        'Test robot sequence owns the motion channel',
        409,
      );
    if (
      !this.state.enabled ||
      this.state.dragMode ||
      this.state.moving ||
      this.state.paused ||
      this.state.faults.length
    )
      throw new RobotArmError(
        'NOT_READY',
        'Test robot is not ready for motion',
        409,
      );
    assertPose(target);
    assertTarget(target, this.motionCapabilities.workspace!);
    if (options?.speed) assertSpeed(options.speed);
    if (
      options?.acceleration?.kind === 'ratio' &&
      (options.acceleration.value <= 0 ||
        options.acceleration.value > 1 ||
        !Number.isFinite(options.acceleration.value))
    )
      throw new RobotArmError(
        'INVALID_ACCELERATION',
        'Expected acceleration ratio',
      );
    if (
      this.motionCapabilities.orientation === 'yaw' &&
      (Math.abs(target.orientation.x) > 1e-6 ||
        Math.abs(target.orientation.y) > 1e-6)
    )
      throw new RobotArmError(
        'ORIENTATION_UNSUPPORTED',
        'Four-axis Test robot supports yaw only',
        422,
      );
    const origin = structuredClone(this.state.pose!);
    const start = Date.now();
    const duration =
      options?.speed?.kind === 'linear'
        ? Math.max(
            10,
            (distance(origin.positionMm, target.positionMm) /
              options.speed.mmPerSecond) *
              1000,
          )
        : (this.options.motionDurationMs ?? 10);
    this.movements.push(structuredClone(target));
    this.update({ moving: true, mode: 'moving' });
    const terminal = new Promise<MotionResult>((resolve) => {
      const timer = setInterval(() => {
        const f = Math.min(1, (Date.now() - start) / duration);
        const a = origin.positionMm;
        const b = target.positionMm;
        // Interpolate position; orientation remains actual start orientation until completion.
        this.update({
          pose: {
            ...origin,
            positionMm: {
              x: a.x + (b.x - a.x) * f,
              y: a.y + (b.y - a.y) * f,
              z: a.z + (b.z - a.z) * f,
            },
          },
        });
        if (f >= 1) {
          clearInterval(timer);
          this.pending = undefined;
          this.update({
            pose: structuredClone(target),
            moving: false,
            mode: 'enabled',
          });
          resolve({
            status: 'completed',
            completedAt: new Date().toISOString(),
            arrivedAt: Date.now(),
            submittedAt: start,
            pose: structuredClone(target),
          });
        }
      }, 5);
      this.pending = { timer, resolve };
    });
    return createMotionHandle(randomUUID(), terminal);
  }
  /** Test fixture only. Never exposed as an HTTP positioning endpoint. */
  setPoseForTesting(pose: CartesianPose): void {
    assertPose(pose);
    if (this.state.moving)
      throw new RobotArmError(
        'BUSY',
        'Cannot reposition moving Test robot',
        409,
      );
    this.update({ pose: structuredClone(pose) });
  }
  async faultForTesting(code = 'SIM_FAULT') {
    await this.stop();
    this.update({
      faults: [
        { code, message: 'Injected test-robot fault', recoverable: true },
      ],
      mode: 'fault',
    });
  }
}
