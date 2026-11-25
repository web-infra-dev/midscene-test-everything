import { randomUUID } from 'node:crypto';
import {
  type CartesianPose,
  type ControllerMotionSettingsUpdate,
  type MotionHandle,
  type MotionOptions,
  type PayloadApplicationSnapshot,
  type PayloadInvalidationReason,
  type RobotArmCapabilities,
  RobotArmError,
  type RobotState,
  type ToolPayload,
  type Workspace,
  assertToolPayload,
  isRobotArmError,
} from '../contracts.js';
import { assertOrientation, assertPose, assertTarget } from '../domain.js';
import type {
  LinearMotionSequence,
  LinearPreflightScope,
  LinearSequenceOptions,
  LinearSequenceTarget,
  RobotArmAdapter,
  RobotStatus,
} from './contracts.js';
import { DriverSupport } from './driver-support.js';
import { validateJoints, validateMotionOptions } from './motion.js';
import { assertFresh, evaluateReadiness } from './readiness.js';

/** Identity of a Cartesian target, used to spend a preflight exactly once. */
function poseSignature(pose: CartesianPose): string {
  return JSON.stringify([
    pose.frame,
    pose.positionMm.x,
    pose.positionMm.y,
    pose.positionMm.z,
    pose.orientation.x,
    pose.orientation.y,
    pose.orientation.z,
    pose.orientation.w,
  ]);
}

function linearTargetSignature(
  pose: CartesianPose,
  options: MotionOptions,
): string {
  return JSON.stringify([poseSignature(pose), options]);
}

export interface LinearPreflightTiming {
  inverseKinematicsMs: number;
  inverseKinematicsCalls: number;
  inverseKinematicsReused: number;
}

/** Vendor-neutral state and motion boundary. No screen geometry or vendor branches. */
export class RobotDriverBoundary {
  private generation = 0;
  /**
   * Target already validated by `preflightCartesian` in this generation.
   * Callers preflight and then move the same target; the dispatch gate still
   * checks controller reachability before submission, so the boundary's own
   * duplicate query for that target can be consumed once.
   */
  private preflighted?: { signature: string; generation: number };
  private readonly linearPreflights = new WeakMap<
    LinearPreflightScope,
    {
      generation: number;
      payloadEpoch: number;
      targets: Set<string>;
      inversePoses: Set<string>;
      timing: LinearPreflightTiming;
    }
  >();
  private payloadInvalidationReason?: PayloadInvalidationReason;
  private payloadEnabling = false;
  private readonly payloadSessionId = randomUUID();
  private readonly createdAt = new Date().toISOString();
  private payloadEpoch = 0;
  private payloadUpdatedAt = this.createdAt;
  private invalidatePayload(reason: PayloadInvalidationReason): void {
    this.payloadEpoch++;
    this.payloadUpdatedAt = new Date().toISOString();
    this.payloadInvalidationReason = reason;
  }
  readonly resolver: DriverSupport;
  readonly id: string;
  readonly name: string;
  readonly connectionIdentity: string;
  constructor(
    readonly adapter: RobotArmAdapter,
    private readonly onEmergencyStop?: () => void | Promise<void>,
  ) {
    this.resolver = new DriverSupport(adapter);
    this.id = adapter.id;
    this.name = adapter.name;
    this.connectionIdentity = adapter.connectionIdentity;
  }
  get capabilities(): RobotArmCapabilities {
    const adapter = this.adapter;
    const linear = this.resolver.descriptor('motion.linear');
    return {
      jointCount: adapter.kinematics.jointCount,
      orientation: adapter.kinematics.orientation,
      fixedOrientation: adapter.kinematics.fixedOrientation,
      orientationToleranceRadians:
        adapter.kinematics.orientationToleranceRadians,
      cartesianDof: adapter.kinematics.cartesianDof,
      measuredCartesian: Boolean(this.resolver.descriptor('state.cartesian')),
      workspace: adapter.kinematics.workspace,
      screenNormalToleranceDegrees:
        adapter.kinematics.screenNormalToleranceDegrees,
      linear: Boolean(linear),
      ptp: Boolean(this.resolver.descriptor('motion.ptp')),
      stop: Boolean(this.resolver.descriptor('control.stop')),
      dragMode: Boolean(this.resolver.descriptor('control.drag')),
      speedModes: Object.keys(
        linear?.constraints?.speed ?? {},
      ) as RobotArmCapabilities['speedModes'],
      accelerationModes: Object.keys(
        linear?.constraints?.acceleration ?? {},
      ) as NonNullable<RobotArmCapabilities['accelerationModes']>,
      maxLinearSpeedMmPerSecond: linear?.constraints?.speed.linear?.max,
    };
  }
  private backdriving = false;
  private enteringDrag = false;
  private dragEndedAt = Number.NEGATIVE_INFINITY;
  private dragFeedbackAt = Number.NEGATIVE_INFINITY;

  allowsOutlineFrame(capturedAt: number) {
    return (
      !this.enteringDrag && !this.backdriving && capturedAt > this.dragEndedAt
    );
  }
  get enterDragMode() {
    const enter = this.resolver.method('enterDragMode');
    return (
      enter &&
      (async () => {
        this.enteringDrag = true;
        try {
          await enter();
          this.backdriving = true;
        } finally {
          this.enteringDrag = false;
          this.dragFeedbackAt = Date.now();
          this.dragEndedAt = Date.now();
        }
      })
    );
  }
  get exitDragMode() {
    return this.resolver.method('exitDragMode');
  }
  get pause() {
    const pause = this.resolver.method('pause');
    return pause
      ? () => {
          this.generation++;
          if (this.payloadEnabling)
            this.invalidatePayload('application-interrupted');
          return pause();
        }
      : undefined;
  }
  get resume() {
    return this.resolver.method('resume');
  }
  get emergencyStop() {
    const emergency = this.resolver.method('emergencyStop');
    return emergency
      ? () => {
          this.generation++;
          this.invalidatePayload('emergency-stop');
          return emergency();
        }
      : undefined;
  }
  async connect() {
    await this.adapter.driver.connect();
    new DriverSupport(this.adapter);
  }
  disconnect() {
    this.generation++;
    this.invalidatePayload('disconnected');
    return this.adapter.driver.disconnect();
  }
  createLinearPreflightScope(signal: AbortSignal): LinearPreflightScope {
    const scope = Object.freeze({ signal });
    this.linearPreflights.set(scope, {
      generation: this.generation,
      payloadEpoch: this.payloadEpoch,
      targets: new Set(),
      inversePoses: new Set(),
      timing: {
        inverseKinematicsMs: 0,
        inverseKinematicsCalls: 0,
        inverseKinematicsReused: 0,
      },
    });
    return scope;
  }
  private linearPreflight(scope: LinearPreflightScope | undefined) {
    if (!scope || scope.signal.aborted) return undefined;
    const preflight = this.linearPreflights.get(scope);
    return preflight?.generation === this.generation &&
      preflight.payloadEpoch === this.payloadEpoch
      ? preflight
      : undefined;
  }
  linearPreflightTiming(scope: LinearPreflightScope | undefined) {
    const timing = this.linearPreflight(scope)?.timing;
    return (
      timing && {
        ...timing,
        inverseKinematicsMs: Math.round(timing.inverseKinematicsMs),
      }
    );
  }
  async preflightLinearTargets(
    scope: LinearPreflightScope,
    validate: (
      target: (pose: CartesianPose, options: MotionOptions) => Promise<void>,
    ) => Promise<void>,
  ): Promise<void> {
    const evidence = this.linearPreflight(scope);
    const check = () => {
      if (!evidence || this.linearPreflight(scope) !== evidence)
        throw new RobotArmError(
          'ACTION_STOPPED',
          'Linear path preflight is no longer valid',
          409,
        );
    };
    try {
      check();
      await this.assertReady();
      check();
      // Path planning sends no motion. Check readiness around the batch and
      // keep checking each target and the operation's generation within it.
      await validate(async (pose, options) => {
        check();
        await this.preflightTarget('linear', pose, options, undefined, scope);
      });
      check();
      await this.assertReady();
      check();
    } catch (error) {
      this.linearPreflights.delete(scope);
      throw error;
    }
  }
  async beginLinearSequence(
    input: readonly LinearSequenceTarget[],
    options: LinearSequenceOptions,
    preflight?: LinearPreflightScope,
  ): Promise<LinearMotionSequence | undefined> {
    const implementation = this.resolver.method('beginLinearSequence');
    if (!implementation) return undefined;
    const targets = structuredClone(input);
    const generation = this.generation;
    const check = () => {
      if (generation !== this.generation || options.signal?.aborted)
        throw new RobotArmError(
          'ACTION_STOPPED',
          'Prepared sequence is no longer valid',
          409,
        );
    };
    const scoped = preflight?.signal === options.signal ? preflight : undefined;
    if (this.linearPreflight(scoped)) await this.assertReady();
    const reused: LinearSequenceTarget[] = [];
    for (const target of targets) {
      if (
        this.linearPreflight(scoped)?.targets.has(
          linearTargetSignature(target.pose, target.options),
        )
      ) {
        this.validateCartesian('linear', target.pose, target.options);
        await this.assertCartesianFreedom(target.pose);
        reused.push(target);
      } else {
        await this.preflightCartesian('linear', target.pose, target.options);
      }
      validateMotionOptions(
        target.options,
        this.resolver.descriptor('motion.linear-sequence')!.constraints!,
        this.adapter.kinematics.jointCount,
      );
      check();
    }
    if (reused.length && !this.linearPreflight(scoped)) {
      for (const target of reused) {
        await this.preflightCartesian('linear', target.pose, target.options);
        check();
      }
    }
    const sequence =
      reused.length === targets.length && this.linearPreflight(scoped)
        ? await implementation(targets, options, scoped)
        : await implementation(targets, options);
    try {
      check();
    } catch (error) {
      sequence.dispose();
      throw error;
    }
    const submitQueued = sequence.submitQueued?.bind(sequence);
    return {
      submitQueued: submitQueued
        ? (blendPercentages) => {
            check();
            return submitQueued(blendPercentages);
          }
        : undefined,
      submit: (index, mode) => {
        check();
        return sequence.submit(index, mode);
      },
      waitForHandoff: () => {
        check();
        return sequence.waitForHandoff();
      },
      waitForCurrent: () => {
        check();
        return sequence.waitForCurrent();
      },
      check: () => {
        check();
        sequence.check();
      },
      finish: () => {
        check();
        return sequence.finish();
      },
      dispose: () => sequence.dispose(),
    };
  }
  feedbackStatus() {
    return this.adapter.feedbackStatus?.();
  }
  controllerMotionSettings() {
    return this.resolver.require('readMotionSettings')();
  }
  updateControllerMotionSettings(request: ControllerMotionSettingsUpdate) {
    return this.resolver.require('updateMotionSettings')(request);
  }
  async controllerState() {
    const generation = this.generation;
    const sample = await this.resolver.require('readControllerState')();
    if (generation !== this.generation)
      throw new RobotArmError(
        'QUERY_INTERRUPTED',
        'Controller read belongs to an older session',
        409,
      );
    if (
      !sample ||
      typeof sample.vendor !== 'string' ||
      !sample.vendor ||
      typeof sample.receivedAt !== 'string' ||
      !Number.isFinite(Date.parse(sample.receivedAt)) ||
      !sample.raw ||
      typeof sample.raw !== 'object' ||
      Array.isArray(sample.raw)
    )
      throw new RobotArmError(
        'INVALID_STATE',
        'Driver returned malformed controller diagnostics',
        502,
      );
    return structuredClone(sample);
  }
  /** Passive push-channel sample; absent when the adapter has no such channel. */
  latestToolVectorSample() {
    return this.adapter.latestToolVectorSample?.();
  }
  /** Passive joint sample for a 3D mirror; never issues a controller command. */
  latestMotionSample() {
    return this.adapter.latestMotionSample?.();
  }
  async status(fresh = true): Promise<RobotStatus> {
    const payloadEpoch = this.payloadEpoch;
    const generation = this.generation;
    let s: RobotStatus;
    try {
      s = await this.adapter.driver.getState({ fresh });
    } catch (error) {
      if (
        error instanceof RobotArmError &&
        error.code === 'DISCONNECTED' &&
        payloadEpoch === this.payloadEpoch &&
        generation === this.generation &&
        this.payloadInvalidationReason !== 'disconnected'
      )
        this.invalidatePayload('connection-lost');
      throw error;
    }
    if (
      !s ||
      !s.quality ||
      !Array.isArray(s.faults) ||
      !['connected', 'disconnected', 'degraded', 'unknown'].includes(
        s.connection,
      ) ||
      !['idle', 'moving', 'paused', 'stopping', 'unknown'].includes(s.motion) ||
      !['enabled', 'disabled', 'unknown'].includes(s.enablement)
    )
      throw new RobotArmError(
        'INVALID_STATE',
        'Driver returned malformed status',
        502,
      );
    for (const [field, values] of Object.entries({
      authority: ['owned', 'not-owned', 'not-required', 'unknown'],
      power: ['on', 'off', 'unknown'],
      operationMode: ['automatic', 'manual', 'teach', 'backdrive', 'unknown'],
      emergencyStop: ['active', 'inactive', 'unknown'],
      protectiveStop: ['active', 'inactive', 'unknown'],
    })) {
      if (!values.includes(s[field as 'authority'] as string))
        throw new RobotArmError(
          'INVALID_STATE',
          `Invalid status signal ${field}`,
          502,
        );
    }
    if (fresh)
      assertFresh(s.quality, this.adapter.readinessPolicy.maxStateAgeMs);
    const current =
      payloadEpoch === this.payloadEpoch && generation === this.generation;
    const receivedAt = Date.parse(s.quality.receivedAt);
    if (
      current &&
      !this.enteringDrag &&
      !s.quality.stale &&
      receivedAt >= this.dragFeedbackAt &&
      s.connection === 'connected' &&
      s.operationMode !== 'unknown'
    ) {
      this.dragFeedbackAt = receivedAt;
      const dragging = s.operationMode === 'backdrive';
      if (this.backdriving && !dragging) this.dragEndedAt = Date.now();
      this.backdriving = dragging;
    }
    if (
      current &&
      s.connection === 'disconnected' &&
      this.payloadInvalidationReason !== 'connection-lost'
    )
      this.invalidatePayload('connection-lost');
    if (
      current &&
      !this.resolver.descriptor('state.payload-application') &&
      !this.payloadEnabling &&
      s.enablement === 'disabled' &&
      this.appliedPayload()
    )
      this.invalidatePayload('disabled');
    if (current && s.emergencyStop === 'active') await this.onEmergencyStop?.();
    return s;
  }
  async getState(fresh = true): Promise<RobotState> {
    const status = await this.status(fresh);
    return {
      status,
      connected: status.connection === 'connected',
      enabled: status.enablement === 'enabled',
      moving:
        status.motion === 'moving' ||
        status.motion === 'stopping' ||
        status.motion === 'unknown',
      paused: status.motion === 'paused',
      dragMode: status.operationMode === 'backdrive',
      faults: status.faults,
      mode: status.vendorMode ?? status.motion,
      pose: status.pose && !status.pose.stale ? status.pose.pose : undefined,
      updatedAt: status.quality.receivedAt,
    };
  }
  async readiness() {
    return evaluateReadiness(await this.status(), this.adapter.readinessPolicy);
  }
  async assertReady() {
    const result = await this.readiness();
    if (!result.ready)
      throw new RobotArmError(
        result.reasons[0],
        'Robot is not ready for motion',
        409,
        { reasons: result.reasons },
      );
  }
  async readPose() {
    const sample = await this.resolver.require('readPose')({ fresh: true });
    assertFresh(sample, this.adapter.readinessPolicy.maxStateAgeMs);
    assertPose(sample.pose);
    return sample;
  }
  async getPose(): Promise<CartesianPose> {
    return (await this.readPose()).pose;
  }
  async readJoints() {
    const sample = await this.resolver.require('readJoints')({ fresh: true });
    assertFresh(sample, this.adapter.readinessPolicy.maxStateAgeMs);
    if (
      sample.values.length !== this.adapter.kinematics.jointCount ||
      sample.values.some((v) => !Number.isFinite(v))
    )
      throw new RobotArmError('INVALID_JOINTS', 'Invalid measured joints', 502);
    return sample;
  }
  private async applyPayloadCommand(payload: ToolPayload, applyOnly: boolean) {
    const generation = this.generation;
    const apply = applyOnly ? this.resolver.require('applyPayload') : undefined;
    const enable = applyOnly
      ? undefined
      : this.resolver.require('enableWithPayload');
    assertToolPayload(
      payload,
      this.resolver.descriptor('control.enable-with-payload')!.payload,
    );
    const source = this.resolver.method('readPayloadApplication');
    const before = source?.();
    const previousReason = this.payloadInvalidationReason;
    this.payloadEnabling = true;
    this.invalidatePayload('application-failed');
    try {
      if (apply) await apply({ ...payload });
      else await enable!({ ...payload });
      if (generation !== this.generation)
        throw new RobotArmError(
          'ACTION_STOPPED',
          'Payload application was interrupted',
          409,
        );
      this.payloadInvalidationReason = undefined;
    } catch (error) {
      const after = source?.();
      // A vendor rejecting an already-enabled request before dispatch does not
      // revoke an unchanged earlier confirmation.
      if (
        generation === this.generation &&
        before?.status === 'confirmed' &&
        after?.status === 'confirmed' &&
        JSON.stringify(before) === JSON.stringify(after)
      )
        this.payloadInvalidationReason = previousReason;
      else if (
        this.payloadInvalidationReason === 'application-failed' &&
        after?.reason
      )
        this.payloadInvalidationReason = after.reason;
      throw error;
    } finally {
      this.payloadEnabling = false;
      this.payloadEpoch++;
      this.payloadUpdatedAt = new Date().toISOString();
    }
  }
  applyPayload(payload: ToolPayload) {
    return this.applyPayloadCommand(payload, true);
  }
  async enable(payload?: ToolPayload) {
    if (payload !== undefined) return this.applyPayloadCommand(payload, false);
    this.invalidatePayload('not-applied');
    return this.resolver.require('enable')();
  }
  payloadApplicationSnapshot(): PayloadApplicationSnapshot | undefined {
    if (!this.resolver.descriptor('control.enable-with-payload'))
      return undefined;
    const source = this.resolver.method('readPayloadApplication');
    const readbackAfterMs =
      !this.payloadEnabling &&
      this.payloadInvalidationReason === 'connection-lost'
        ? Date.parse(this.payloadUpdatedAt)
        : undefined;
    const raw = source?.(readbackAfterMs);
    if (source && !raw)
      throw new RobotArmError(
        'INVALID_STATE',
        'Payload application capability returned no evidence',
        502,
      );
    const legacy = source ? undefined : this.adapter.driver.appliedPayload?.();
    const snapshot: PayloadApplicationSnapshot = raw ?? {
      status: this.payloadEnabling
        ? 'applying'
        : legacy
          ? 'confirmed'
          : 'unconfirmed',
      sessionId: this.payloadSessionId,
      generation: this.payloadEpoch,
      updatedAt: this.payloadInvalidationReason
        ? this.payloadUpdatedAt
        : (legacy?.confirmedAt ?? this.createdAt),
      applied: this.payloadEnabling ? undefined : legacy,
      reason: legacy ? undefined : 'not-applied',
    };
    if (
      !['confirmed', 'unconfirmed', 'applying'].includes(snapshot.status) ||
      typeof snapshot.sessionId !== 'string' ||
      !snapshot.sessionId ||
      !Number.isInteger(snapshot.generation) ||
      snapshot.generation < 0 ||
      !Number.isFinite(Date.parse(snapshot.updatedAt)) ||
      (snapshot.status !== 'confirmed' &&
        snapshot.applied !== undefined &&
        source !== undefined) ||
      (snapshot.status === 'confirmed' &&
        (!snapshot.applied ||
          !Number.isFinite(Date.parse(snapshot.applied.confirmedAt))))
    )
      throw new RobotArmError(
        'INVALID_STATE',
        'Malformed payload application evidence',
        502,
      );
    if (snapshot.status === 'confirmed')
      assertToolPayload(
        snapshot.applied!.payload,
        this.resolver.descriptor('control.enable-with-payload')?.payload,
      );
    if (
      source &&
      snapshot.status === 'confirmed' &&
      snapshot.applied?.source === 'controller-readback' &&
      !this.payloadEnabling &&
      ['connection-lost', 'disconnected', 'disabled', 'not-applied'].includes(
        this.payloadInvalidationReason ?? '',
      ) &&
      Date.parse(snapshot.applied.confirmedAt) >=
        Date.parse(this.payloadUpdatedAt)
    )
      this.payloadInvalidationReason = undefined;
    if (
      this.payloadEnabling &&
      this.payloadInvalidationReason === 'application-failed'
    )
      return {
        ...structuredClone(snapshot),
        status: 'applying',
        applied: undefined,
        reason: undefined,
      };
    return structuredClone(
      this.payloadInvalidationReason
        ? {
            ...snapshot,
            status: 'unconfirmed' as const,
            applied: undefined,
            reason: this.payloadInvalidationReason,
          }
        : snapshot,
    );
  }
  appliedPayload() {
    const snapshot = this.payloadApplicationSnapshot();
    if (snapshot)
      return snapshot.status === 'confirmed' ? snapshot.applied : undefined;
    return this.adapter.driver.appliedPayload?.();
  }
  disable() {
    this.invalidatePayload('disabled');
    return this.resolver.require('disable')();
  }
  clearFaults() {
    return this.resolver.require('clearFaults')();
  }
  async stop() {
    this.generation++;
    if (this.payloadEnabling) this.invalidatePayload('application-interrupted');
    try {
      await this.resolver.require('stop')();
    } catch (error) {
      this.invalidatePayload('stop-unconfirmed');
      throw error;
    }
  }
  validateCartesian(
    kind: 'linear' | 'ptp',
    pose: CartesianPose,
    options: MotionOptions,
    workspace?: Workspace,
  ) {
    assertOrientation(pose, this.capabilities);
    if (
      !workspace &&
      !this.resolver.descriptor('kinematics.inverse') &&
      !this.resolver.descriptor('kinematics.reachability')
    )
      throw new RobotArmError(
        'REACHABILITY_UNAVAILABLE',
        'Adapter cannot validate Cartesian target reachability',
        422,
      );
    if (workspace) assertTarget(pose, workspace);
    if (this.capabilities.workspace)
      assertTarget(pose, this.capabilities.workspace);
    const implementation = this.resolver.require(
      kind === 'linear' ? 'moveLinear' : 'movePtp',
    );
    validateMotionOptions(
      options,
      this.adapter.motionLimits![kind]!,
      this.adapter.kinematics.jointCount,
    );
    return implementation;
  }
  preflightCartesian(
    kind: 'linear' | 'ptp',
    pose: CartesianPose,
    options: MotionOptions,
    workspace?: Workspace,
  ): Promise<void> {
    return this.preflightTarget(kind, pose, options, workspace);
  }
  private async preflightTarget(
    kind: 'linear' | 'ptp',
    pose: CartesianPose,
    options: MotionOptions,
    workspace?: Workspace,
    scope?: LinearPreflightScope,
  ): Promise<void> {
    const generation = this.generation;
    const preflight = this.linearPreflight(scope);
    this.validateCartesian(kind, pose, options, workspace);
    if (!scope) await this.assertReady();
    await this.assertCartesianFreedom(pose);
    const signature = poseSignature(pose);
    const inverse = this.resolver.method('inverseKinematics');
    const reusedInverse = inverse && preflight?.inversePoses.has(signature);
    let inverseMs = 0;
    if (inverse) {
      if (!reusedInverse) {
        const started = performance.now();
        const target = structuredClone(pose);
        const joints = scope
          ? await inverse(target, scope)
          : await inverse(target);
        validateJoints(joints, this.adapter.kinematics);
        inverseMs = performance.now() - started;
      }
    } else {
      const reachability = this.resolver.method('checkReachability');
      if (!reachability)
        throw new RobotArmError(
          'REACHABILITY_UNAVAILABLE',
          'Adapter cannot validate Cartesian target reachability',
          422,
        );
      await reachability(structuredClone(pose));
    }
    if (!scope) await this.assertReady();
    if (
      generation !== this.generation ||
      (scope && (!preflight || this.linearPreflight(scope) !== preflight))
    )
      throw new RobotArmError(
        'ACTION_STOPPED',
        'Motion interrupted during target preflight',
        409,
      );
    if (!scope) this.preflighted = { signature, generation };
    if (preflight) {
      preflight.targets.add(linearTargetSignature(pose, options));
      if (inverse) {
        preflight.inversePoses.add(signature);
        if (reusedInverse) {
          preflight.timing.inverseKinematicsReused++;
        } else {
          preflight.timing.inverseKinematicsCalls++;
          preflight.timing.inverseKinematicsMs += inverseMs;
        }
      }
    }
  }
  private async assertCartesianFreedom(pose: CartesianPose): Promise<void> {
    const lockedAxes = (['x', 'y', 'z'] as const).filter(
      (axis) => !this.adapter.kinematics.cartesianDof.includes(axis),
    );
    if (!lockedAxes.length) return;
    const measured = await this.readPose();
    if (
      lockedAxes.some(
        (axis) =>
          Math.abs(pose.positionMm[axis] - measured.pose.positionMm[axis]) >
          0.01,
      )
    )
      throw new RobotArmError(
        'CARTESIAN_DOF_UNSUPPORTED',
        'Target changes an uncontrolled Cartesian axis',
        422,
      );
  }
  validateJointMotion(
    values: number[],
    options: MotionOptions,
    bounds?: { min: number; max: number }[],
  ) {
    validateJoints(values, this.adapter.kinematics, bounds);
    const implementation = this.resolver.require('moveJoints');
    validateMotionOptions(
      options,
      this.resolver.descriptor('motion.joints')!.constraints!,
      this.adapter.kinematics.jointCount,
    );
    return implementation;
  }
  private async move(
    kind: 'linear' | 'ptp',
    pose: CartesianPose,
    options: MotionOptions,
    workspace?: Workspace,
    scope?: LinearPreflightScope,
  ): Promise<MotionHandle> {
    pose = structuredClone(pose);
    options = structuredClone(options);
    workspace = workspace && structuredClone(workspace);
    const generation = this.generation;
    const implementation = this.validateCartesian(
      kind,
      pose,
      options,
      workspace,
    );
    const signature = poseSignature(pose);
    const evidence =
      kind === 'linear' && !workspace ? this.linearPreflight(scope) : undefined;
    const planned = evidence?.inversePoses.has(signature)
      ? evidence
      : undefined;
    try {
      const preflighted =
        !workspace &&
        this.preflighted?.generation === this.generation &&
        this.preflighted.signature === signature;
      // Spend any ticket up front: this move owns it, and a failed preflight
      // must not leave a stale target for the next move to skip.
      this.preflighted = undefined;
      if (!workspace && !preflighted && !planned)
        await this.preflightCartesian(kind, pose, options);
      await this.assertCartesianFreedom(pose);
      await this.assertReady();
    } catch (error) {
      if (!isRobotArmError(error)) throw error;
      throw new RobotArmError(error.code, error.message, error.status, {
        ...error.details,
        beforeMotionSubmission: true,
      });
    }
    if (
      generation !== this.generation ||
      (planned && this.linearPreflight(scope) !== planned)
    )
      throw new RobotArmError(
        'ACTION_STOPPED',
        'Motion interrupted before submission',
        409,
      );
    return planned
      ? this.resolver.require('moveLinear')(pose, options, scope)
      : implementation(pose, options);
  }
  moveLinear(
    pose: CartesianPose,
    options: MotionOptions = {},
    workspace?: Workspace,
    preflight?: LinearPreflightScope,
  ) {
    return this.move('linear', pose, options, workspace, preflight);
  }
  movePtp(
    pose: CartesianPose,
    options: MotionOptions = {},
    workspace?: Workspace,
  ) {
    return this.move('ptp', pose, options, workspace);
  }
  async moveJoints(
    values: number[],
    options: MotionOptions,
    bounds?: { min: number; max: number }[],
  ) {
    values = [...values];
    options = structuredClone(options);
    bounds = bounds && structuredClone(bounds);
    const generation = this.generation;
    const implementation = this.validateJointMotion(values, options, bounds);
    await this.assertReady();
    if (generation !== this.generation)
      throw new RobotArmError(
        'ACTION_STOPPED',
        'Motion interrupted before submission',
        409,
      );
    return implementation(values, options);
  }
}
