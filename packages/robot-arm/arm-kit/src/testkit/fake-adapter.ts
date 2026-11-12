import { randomUUID } from 'node:crypto';
import {
  type CartesianPose,
  type MotionResult,
  RobotArmError,
} from '../contracts.js';
import { assertTarget } from '../domain.js';
import { createMotionHandle } from '../driver/motion-handle.js';
import type {
  RobotArmAdapter,
  RobotDriver,
  RobotKinematics,
  RobotStatus,
  SampleQuality,
} from '../kernel/contracts.js';

export interface FakeAdapterOptions {
  jointCount?: number;
  orientation?: 'fixed' | 'yaw' | 'full';
  jointOnly?: boolean;
  physicalSpeedOnly?: boolean;
  drag?: boolean;
  linearOnly?: boolean;
  motionDurationMs?: number;
  /** Expose `latestToolVectorSample`, as an adapter with a push channel does. */
  passiveSamples?: boolean;
}
/** Independent protocol fake. Independent of the motion test adapter. */
export class FakeAdapter implements RobotArmAdapter {
  readonly contractVersion = 1 as const;
  readonly id = 'independent-fake';
  readonly name = 'Independent adapter fake';
  readonly connectionIdentity = 'fake://local';
  readonly readinessPolicy = {
    maxStateAgeMs: 1000,
    required: ['emergencyStop', 'protectiveStop'] as (
      | 'emergencyStop'
      | 'protectiveStop'
    )[],
  };
  readonly kinematics: RobotKinematics;
  readonly driver: RobotDriver;
  readonly motionLimits: NonNullable<RobotArmAdapter['motionLimits']>;
  private sequence = 0;
  private connected = false;
  private enabled = false;
  private paused = false;
  private drag = false;
  private emergency = false;
  private pending?: {
    timer: ReturnType<typeof setTimeout>;
    resolve: (r: MotionResult) => void;
  };
  private pose: CartesianPose = {
    frame: 'base',
    positionMm: { x: 0, y: 0, z: 100 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  };
  private joints: number[];
  readonly submissions: (CartesianPose | number[])[] = [];
  readonly controls: string[] = [];
  repeatedSamples = false;
  staleSamples = false;
  unknownRequiredSafety = false;
  private sample(): SampleQuality {
    return {
      sampleId: this.repeatedSamples ? 'same' : String(++this.sequence),
      receivedAt: new Date(
        Date.now() - (this.staleSamples ? 10000 : 0),
      ).toISOString(),
      source: 'polling',
      stale: this.staleSamples,
    };
  }
  constructor(private options: FakeAdapterOptions = {}) {
    const jointCount = options.jointCount ?? 7;
    const orientation = options.orientation ?? 'full';
    this.joints = Array(jointCount).fill(0);
    this.kinematics = {
      jointCount,
      joints: this.joints.map((_, i) => ({
        name: `J${i}`,
        type: 'revolute',
        unit: 'degrees',
        limits: { min: -180, max: 180, source: 'fake' },
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
      workspace: {
        min: { x: -1000, y: -1000, z: -1000 },
        max: { x: 1000, y: 1000, z: 1000 },
      },
      fixedOrientation:
        orientation === 'full' ? undefined : this.pose.orientation,
    };
    const implementations: Partial<RobotDriver> = {
      readJoints: async () => ({ ...this.sample(), values: [...this.joints] }),
      moveJoints: (values) => this.submit(values),
      enable: async () => {
        this.enabled = true;
        this.controls.push('enable');
      },
      disable: async () => {
        await this.stop();
        this.enabled = false;
      },
      clearFaults: async () => {
        this.emergency = false;
      },
      pause: async () => {
        await this.stop();
        this.paused = true;
      },
      resume: async () => {
        this.paused = false;
      },
      emergencyStop: async () => {
        this.controls.push('emergencyStop');
        await this.stop();
        this.emergency = true;
      },
    };
    if (!options.jointOnly) {
      Object.assign(implementations, {
        readPose: async () => ({
          ...this.sample(),
          pose: structuredClone(this.pose),
        }),
      } satisfies Partial<RobotDriver>);
      Object.assign(implementations, {
        moveLinear: (p) => this.submit(p),
      } satisfies Partial<RobotDriver>);
      Object.assign(implementations, {
        checkReachability: async (p) =>
          assertTarget(p, this.kinematics.workspace!),
      } satisfies Partial<RobotDriver>);
      if (!options.linearOnly)
        Object.assign(implementations, {
          movePtp: (p) => this.submit(p),
        } satisfies Partial<RobotDriver>);
    }
    if (options.drag)
      Object.assign(implementations, {
        enterDragMode: async () => {
          this.drag = true;
        },
        exitDragMode: async () => {
          this.drag = false;
        },
      } satisfies Partial<RobotDriver>);
    const constraints = {
      speed: options.physicalSpeedOnly
        ? { linear: { min: 0.01, max: 100 } }
        : { ratio: { min: 0.001, max: 1 } },
      acceleration: {
        ratio: { min: 0.001, max: 1 },
        linear: { min: 0.01, max: 100 },
      },
    };
    this.motionLimits = {
      linear: constraints,
      ptp: constraints,
      joints: constraints,
    };
    this.driver = {
      ...implementations,
      stop: () => this.stop(),
      connect: async () => {
        this.connected = true;
      },
      disconnect: async () => {
        await this.stop();
        this.connected = false;
      },
      getState: async (): Promise<RobotStatus> => {
        const quality = this.sample();
        return {
          connection: this.connected ? 'connected' : 'disconnected',
          authority: 'owned',
          power: 'on',
          enablement: this.enabled ? 'enabled' : 'disabled',
          motion: this.paused ? 'paused' : this.pending ? 'moving' : 'idle',
          operationMode: this.drag ? 'backdrive' : 'automatic',
          emergencyStop: this.unknownRequiredSafety
            ? 'unknown'
            : this.emergency
              ? 'active'
              : 'inactive',
          protectiveStop: 'inactive',
          faults: this.emergency
            ? [
                {
                  code: 'ESTOP',
                  message: 'Fake emergency stop',
                  recoverable: true,
                },
              ]
            : [],
          quality,
          pose: options.jointOnly
            ? undefined
            : { ...quality, pose: structuredClone(this.pose) },
          joints: { ...quality, values: [...this.joints] },
        };
      },
    };
  }
  latestToolVectorSample() {
    return this.options.passiveSamples
      ? { pose: structuredClone(this.pose), receivedAt: Date.now() }
      : undefined;
  }
  private async submit(target: CartesianPose | number[]) {
    if (
      !this.connected ||
      !this.enabled ||
      this.pending ||
      this.paused ||
      this.drag ||
      this.emergency
    )
      throw new RobotArmError('NOT_READY', 'Fake not ready', 409);
    this.submissions.push(structuredClone(target));
    const terminal = new Promise<MotionResult>((resolve) => {
      const timer = setTimeout(() => {
        if (Array.isArray(target)) this.joints = [...target];
        else this.pose = structuredClone(target);
        this.pending = undefined;
        resolve({
          status: 'completed',
          completedAt: new Date().toISOString(),
          arrivedAt: Date.now(),
          ...(Array.isArray(target) ? {} : { pose: structuredClone(target) }),
        });
      }, this.options.motionDurationMs ?? 5);
      this.pending = { timer, resolve };
    });
    return createMotionHandle(randomUUID(), terminal);
  }
  private async stop() {
    this.controls.push('stop');
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.resolve({
        status: 'stopped',
        completedAt: new Date().toISOString(),
      });
      this.pending = undefined;
    }
  }
}
