import { ArmActionQueue } from './action-queue.js';
import type {
  ActionRequest,
  ActionResult,
  CalibrationProfile,
  EnableRequest,
  VisionBinding,
} from './contracts.js';
import { RobotArmError, isRobotArmError } from './contracts.js';
import { registerControllerRuntime } from './controller-runtime.js';
import { RobotArmRuntime, type RobotArmRuntimeOptions } from './runtime.js';
import type {
  PreparedTransferRoute,
  TransferRouteInput,
} from './screen-interaction/transfer.js';

/** Owns one physical arm, its motion lease and the queue shared by Devices. */
export type ArmControllerOptions = RobotArmRuntimeOptions;
export class ArmController {
  readonly #runtime: RobotArmRuntime;
  constructor(options: ArmControllerOptions) {
    this.#runtime = new RobotArmRuntime(options);
    registerControllerRuntime(this, this.#runtime);
  }
  get id() {
    return this.#runtime.id;
  }
  get connectionIdentity() {
    return this.#runtime.connectionIdentity;
  }
  describeCapabilities() {
    return this.#runtime.describeCapabilities();
  }
  getState() {
    return this.#runtime.getState();
  }
  /** Includes recovery and software-pause gates in addition to hardware telemetry. */
  getStatus() {
    return this.#runtime.state();
  }
  current() {
    return this.#runtime.current();
  }
  /** Read-only target context for hosts that offer manual screen control. */
  controlState() {
    return {
      activeCalibrationId: this.lastCalibrationId,
      positionUnknown: this.positionUnknown,
    };
  }

  private readonly deviceActions = new ArmActionQueue();
  private opening?: Promise<void>;
  private closing?: Promise<void>;
  private connected = false;
  private lastCalibrationId?: string;
  private positionUnknown = false;
  private readonly transfers = new Map<string, PreparedTransferRoute>();
  private readonly deviceStopFailures = new Map<string, unknown>();

  connect(): Promise<void> {
    if (this.closing)
      return Promise.reject(new Error('Arm controller is closed'));
    if (this.connected) return Promise.resolve();
    this.opening ??= this.#runtime
      .initialize()
      .then(() => {
        this.connected = true;
      })
      .finally(() => {
        this.opening = undefined;
      });
    return this.opening;
  }

  /** @internal Enable using the Device's accepted tool, serialized with physical work. */
  enableForDevice(
    ownerId: string,
    selection: () => Promise<EnableRequest>,
    signal: AbortSignal,
  ): Promise<void> {
    return this.deviceActions.enqueue(
      ownerId,
      async (abort) => {
        await this.connect();
        abort.throwIfAborted();
        const request = await selection();
        abort.throwIfAborted();
        await this.#runtime.lifecycle('enable', request);
      },
      signal,
    );
  }

  /** @internal Device captures and validates its own camera binding inside the queue. */
  executeForDevice(
    ownerId: string,
    request: ActionRequest,
    readVision: () => Promise<VisionBinding>,
    signal?: AbortSignal,
  ): Promise<ActionResult> {
    const action = structuredClone(request);
    return this.deviceActions.enqueue(
      ownerId,
      async (abort) => {
        await this.connect();
        const vision = await readVision();
        abort.throwIfAborted();
        if (this.positionUnknown)
          throw new RobotArmError(
            'POSITION_UNKNOWN',
            'Arm position changed during calibration or transfer; complete calibration before executing more screen actions',
            409,
          );
        const fromCalibrationId =
          this.lastCalibrationId !== action.calibrationProfileId
            ? this.lastCalibrationId
            : undefined;
        let cancelling: Promise<void> | undefined;
        const cancel = () => {
          if (
            this.current()?.requestId === action.requestId &&
            this.current()?.status === 'running'
          ) {
            cancelling = this.#runtime
              .cancel(action.requestId)
              .catch((error) => {
                this.deviceStopFailures.set(ownerId, error);
                this.deviceActions.stop(error);
                throw error;
              });
            void cancelling.catch(() => undefined);
          }
        };
        abort.addEventListener('abort', cancel, { once: true });
        try {
          abort.throwIfAborted();
          const result = await this.#runtime.execute(
            action,
            undefined,
            vision,
            fromCalibrationId
              ? {
                  fromCalibrationId,
                  route: this.transfers.get(
                    JSON.stringify([
                      fromCalibrationId,
                      action.calibrationProfileId,
                    ]),
                  ),
                  phase: (phase) => {
                    this.positionUnknown = phase === 'moving';
                    if (phase === 'arrived')
                      this.lastCalibrationId = action.calibrationProfileId;
                  },
                }
              : undefined,
          );
          this.lastCalibrationId = action.calibrationProfileId;
          return result;
        } catch (error) {
          if (isRobotArmError(error)) {
            if (error.code === 'TRANSFER_START_CHANGED')
              this.positionUnknown = true;
            if (!fromCalibrationId && error.details?.motionOccurred)
              this.lastCalibrationId = action.calibrationProfileId;
            if (error.details?.recoveryRequired) this.deviceActions.stop(error);
          }
          throw error;
        } finally {
          abort.removeEventListener('abort', cancel);
          await cancelling;
        }
      },
      signal,
    );
  }

  /** Read-only route summaries. Geometry changes make earlier validation stale. */
  transferRoutes() {
    return [...this.transfers.values()].map((route) => ({
      fromCalibrationId: route.fromCalibrationId,
      toCalibrationId: route.toCalibrationId,
      waypoints: structuredClone(route.waypoints),
      status: this.#runtime.transferRouteCurrent(route)
        ? ('verified' as const)
        : ('stale' as const),
    }));
  }

  /** @internal Device-facing registration; validation does not move the arm. */
  configureTransfer(
    ownerId: string,
    input: TransferRouteInput,
    signal?: AbortSignal,
  ): Promise<void> {
    const snapshot = structuredClone(input);
    return this.deviceActions.enqueue(
      ownerId,
      async (abort) => {
        await this.connect();
        abort.throwIfAborted();
        const route = await this.#runtime.verifyTransferRoute(snapshot);
        abort.throwIfAborted();
        this.transfers.set(
          JSON.stringify([route.fromCalibrationId, route.toCalibrationId]),
          route,
        );
      },
      signal,
    );
  }

  /** @internal Reserve complete calibration interaction, including human positioning. */
  calibrateForDevice(
    ownerId: string,
    work: (signal: AbortSignal) => Promise<CalibrationProfile>,
    signal?: AbortSignal,
  ): Promise<CalibrationProfile> {
    return this.deviceActions.enqueue(
      ownerId,
      async (abort) => {
        await this.connect();
        abort.throwIfAborted();
        this.positionUnknown = true;
        this.transfers.clear();
        const result = await work(abort);
        this.lastCalibrationId = result.id;
        this.positionUnknown = false;
        return result;
      },
      signal,
    );
  }

  /** @internal Hold the shared Controller queue across every screen and operator wait. */
  calibrationBatchForDevices<T>(
    ownerId: string,
    work: (
      signal: AbortSignal,
    ) => Promise<{ value: T; lastCalibration?: CalibrationProfile }>,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.deviceActions.enqueue(
      ownerId,
      async (abort) => {
        await this.connect();
        abort.throwIfAborted();
        this.positionUnknown = true;
        this.transfers.clear();
        const result = await work(abort);
        if (result.lastCalibration) {
          this.lastCalibrationId = result.lastCalibration.id;
          this.positionUnknown = false;
        }
        return result.value;
      },
      signal,
    );
  }
  /** @internal Serialize configuration with all device actions. */
  configureForDevice<T>(
    ownerId: string,
    work: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
    safeTarget?: string,
  ): Promise<T> {
    return this.deviceActions.enqueue(
      ownerId,
      async (abort) => {
        await this.connect();
        abort.throwIfAborted();
        if (safeTarget) {
          this.assertSafePositionTarget(safeTarget);
        }
        let result: T;
        try {
          result = await work(abort);
        } catch (error) {
          if (safeTarget && (await this.#runtime.state()).recoveryRequired)
            this.positionUnknown = true;
          throw error;
        }
        if (safeTarget) {
          this.lastCalibrationId = safeTarget;
          this.positionUnknown = false;
        }
        this.transfers.clear();
        return result;
      },
      signal,
    );
  }

  /** @internal Safe-position return must never bypass cross-screen routing. */
  assertSafePositionTarget(id: string): void {
    if (
      this.positionUnknown ||
      (this.lastCalibrationId && this.lastCalibrationId !== id)
    )
      throw new RobotArmError(
        'TRANSFER_REQUIRED',
        'Return to the active screen before using its safe position',
        409,
      );
  }

  /** @internal Called after the Device has drained its work and released its camera. */
  assertDeviceStopped(ownerId: string): void {
    if (this.deviceStopFailures.has(ownerId)) {
      const failure = this.deviceStopFailures.get(ownerId);
      this.deviceStopFailures.delete(ownerId);
      throw failure;
    }
  }

  cancelDevice(ownerId: string): void {
    this.deviceActions.cancelOwner(ownerId);
  }

  async stop(): Promise<void> {
    this.deviceActions.stop();
    await this.#runtime.stop();
  }

  async pause(): Promise<void> {
    this.deviceActions.stop(new Error('Arm paused'));
    await this.#runtime.pause();
  }

  async emergencyStop(): Promise<void> {
    this.deviceActions.stop(new Error('Emergency stop'));
    await this.#runtime.emergencyStop();
  }

  async resume(): Promise<void> {
    await this.#runtime.resume();
    await this.recover();
  }

  async recover(): Promise<void> {
    if (this.closing) throw new Error('Arm controller is closed');
    await this.#runtime.recover();
    this.deviceActions.resume();
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      await this.opening?.catch(() => undefined);
      await this.deviceActions.close();
      await this.#runtime.shutdown();
      await this.#runtime.auditStore?.flush();
      this.connected = false;
    })();
    return this.closing;
  }
}
