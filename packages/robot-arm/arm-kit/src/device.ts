import { randomUUID } from 'node:crypto';
import type { LogoCanvasSession } from './calibration/draw-logo.js';
import { type CameraSession, CameraSessionManager } from './camera/session.js';
import {
  type ActionResult,
  type CalibrationProfile,
  type MappedScreenProfile,
  RobotArmError,
  SCREEN_DRIFT_DETECTION_ENABLED,
  type ScreenAction,
  type ScreenPoint,
  type VisionBinding,
  assertScreenMapping,
  calibrationAccepted,
  sameVisionMapping,
} from './contracts.js';
import { controllerRuntime } from './controller-runtime.js';
import type { ArmController } from './controller.js';

let cameras: CameraSessionManager | undefined;
export interface RobotArmDeviceOptions {
  arm: ArmController;
  camera: string;
  id?: string;
  /** Independent correction for one of several screens observed by the camera. */
  screenId?: string;
  /** @internal Injected camera ownership for hosts and tests. */
  cameraManager?: CameraSessionManager;
  /** @internal Resolve the legacy installation tool as well as a shared selection. */
  sharedTool?: boolean;
}
interface DeviceContext {
  screen: MappedScreenProfile;
  calibration: CalibrationProfile;
  vision: VisionBinding;
  key: string;
}
function assertScreenPoint(
  point: ScreenPoint | undefined,
  width: number,
  height: number,
  label: string,
): void {
  if (
    !point ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 0 ||
    point.y < 0 ||
    point.x > width - 1 ||
    point.y > height - 1
  )
    throw new RobotArmError(
      'INVALID_ACTION',
      `${label} must be inside the ${width} × ${height} screen`,
      422,
    );
}
function assertScreenAction(
  action: ScreenAction,
  screen: MappedScreenProfile,
): void {
  if (!action || typeof action !== 'object')
    throw new RobotArmError('INVALID_ACTION', 'Screen action is required', 422);
  const duration = 'durationMs' in action ? action.durationMs : undefined;
  if (
    duration !== undefined &&
    (!Number.isFinite(duration) || duration <= 0 || duration > 60000)
  )
    throw new RobotArmError(
      'INVALID_ACTION',
      'durationMs must be in (0,60000]',
      422,
    );
  switch (action.type) {
    case 'tap':
      assertScreenPoint(
        action.point,
        screen.pixelWidth,
        screen.pixelHeight,
        'Tap point',
      );
      return;
    case 'longPress':
      assertScreenPoint(
        action.point,
        screen.pixelWidth,
        screen.pixelHeight,
        'Long-press point',
      );
      return;
    case 'swipe':
    case 'dragAndDrop':
      assertScreenPoint(
        action.from,
        screen.pixelWidth,
        screen.pixelHeight,
        'Gesture start',
      );
      assertScreenPoint(
        action.to,
        screen.pixelWidth,
        screen.pixelHeight,
        'Gesture end',
      );
      if (action.from.x === action.to.x && action.from.y === action.to.y)
        throw new RobotArmError(
          'INVALID_ACTION',
          'Gesture start and end must differ',
          422,
        );
      return;
    default:
      throw new RobotArmError(
        'UNSUPPORTED_ACTION',
        'Unsupported screen action',
        422,
      );
  }
}
/** A physical touchscreen: camera and accepted calibration, sharing one arm. */
export class RobotArmDevice {
  readonly id: string;
  private readonly ownerId = randomUUID();
  private readonly lifetime = new AbortController();
  private readonly cameras: CameraSessionManager;
  private session?: CameraSession;
  private opening?: Promise<void>;
  private closing?: Promise<void>;
  private destroyed = false;
  private context?: DeviceContext;
  private readonly pending = new Set<Promise<unknown>>();
  constructor(private readonly options: RobotArmDeviceOptions) {
    if (!options.camera?.trim()) throw new Error('Camera identity is required');
    this.id = options.id ?? options.camera;
    if (!options.cameraManager) cameras ??= new CameraSessionManager();
    this.cameras = options.cameraManager ?? cameras!;
  }
  async connect(): Promise<void> {
    this.assertAlive();
    if (this.session) return;
    this.opening ??= (async () => {
      await this.options.arm.connect();
      this.assertAlive();
      const session = await this.cameras.acquire(
        this.options.camera,
        this.ownerId,
        this.options.screenId,
      );
      if (this.destroyed) {
        await this.cameras.release(this.options.camera, this.ownerId);
        throw new Error('Device is destroyed');
      }
      this.session = session;
    })().finally(() => {
      this.opening = undefined;
    });
    return this.opening;
  }
  private assertAlive(): void {
    if (this.destroyed) throw new Error('Device is destroyed');
  }
  private async resolveContext(): Promise<DeviceContext> {
    await this.connect();
    this.assertAlive();
    const store = controllerRuntime(this.options.arm).profileStore;
    const saved = store.deviceBinding(this.id);
    if (!saved || saved.cameraId !== this.options.camera)
      throw new RobotArmError(
        'CALIBRATION_REQUIRED',
        'Calibrate this device before running tasks',
      );
    store.assertCurrentCalibrationTool(saved, this.options.sharedTool);
    if (
      this.context &&
      saved.calibrationProfileId !== this.context.calibration.id
    )
      throw new RobotArmError(
        'EXECUTION_CONTEXT_CHANGED',
        'Device calibration was replaced; recreate the Device before running tasks',
      );
    if (this.context) {
      const current = this.context;
      const vision = await this.session!.binding({
        cameraId: this.options.camera,
        width: current.screen.pixelWidth,
        height: current.screen.pixelHeight,
      });
      if (
        !sameVisionMapping(vision, current.vision) ||
        store.contextKey(
          current.calibration,
          current.calibration.id,
          vision,
        ) !== current.key
      )
        throw new RobotArmError(
          'EXECUTION_CONTEXT_CHANGED',
          'Device geometry or camera correction changed; reload the accepted calibration',
        );
      return current;
    }
    const profiles = store.list();
    const candidates: DeviceContext[] = [];
    for (const calibration of profiles.calibrations) {
      if (
        calibration.id !== saved.calibrationProfileId ||
        !calibrationAccepted(calibration)
      )
        continue;
      const robot = profiles.robots.find(
        (p) => p.id === calibration.robotProfileId,
      );
      if (
        robot?.adapterId !== this.options.arm.id ||
        robot.connectionIdentity !== this.options.arm.connectionIdentity
      )
        continue;
      const screen = profiles.screens.find(
        (p) => p.id === calibration.screenProfileId,
      );
      if (!screen?.phoneMapping) continue;
      const tool = profiles.tools.find(
        (p) => p.id === calibration.toolProfileId,
      );
      if (
        !tool ||
        calibration.robotGeometryRevision !== robot.geometryRevision ||
        calibration.toolGeometryRevision !== tool.geometryRevision ||
        calibration.screenGeometryRevision !== screen.geometryRevision
      )
        continue;
      assertScreenMapping(screen);
      const vision = await this.session!.binding({
        cameraId: this.options.camera,
        width: screen.pixelWidth,
        height: screen.pixelHeight,
      });
      if (
        !sameVisionMapping(saved.vision, vision) ||
        screen.phoneMapping.visionFingerprint !== vision.fingerprint
      )
        continue;
      assertScreenMapping(screen);
      candidates.push({
        screen,
        calibration,
        vision,
        key: store.contextKey(calibration, calibration.id, vision),
      });
    }
    if (candidates.length !== 1)
      throw new RobotArmError(
        'CALIBRATION_REQUIRED',
        candidates.length
          ? 'Multiple accepted calibrations match this camera; select the current calibration'
          : 'Calibrate this device before running tasks',
      );
    this.context = candidates[0];
    return this.context;
  }
  private async snapshot() {
    const context = await this.resolveContext();
    const snapshot = await this.session!.snapshot({
      cameraId: this.options.camera,
      width: context.screen.pixelWidth,
      height: context.screen.pixelHeight,
    });
    this.assertAlive();
    if (
      SCREEN_DRIFT_DETECTION_ENABLED &&
      snapshot.binding.validity?.state === 'invalid'
    )
      throw new RobotArmError(
        'CALIBRATION_MISMATCH',
        'The saved screen outline no longer matches the camera view. Recalibrate before moving.',
        409,
      );
    if (!sameVisionMapping(snapshot.binding, context.vision))
      throw new RobotArmError(
        'VISION_BINDING_CHANGED',
        'Camera correction changed during screenshot',
      );
    await this.resolveContext();
    return snapshot;
  }
  /**
   * Execute one absolute touch gesture on this Device's accepted screen.
   *
   * Callers supply screen pixels only. Calibration, camera mapping and the
   * execution context are resolved here, so a stale client binding cannot be
   * used to move the arm against another screen.
   */
  async perform(
    action: ScreenAction,
    signal?: AbortSignal,
  ): Promise<ActionResult> {
    this.assertAlive();
    signal?.throwIfAborted();
    const request = structuredClone(action);
    const pending = (async () => {
      const context = await this.resolveContext();
      this.assertAlive();
      assertScreenAction(request, context.screen);
      return this.options.arm.executeForDevice(
        this.ownerId,
        {
          robotProfileId: context.calibration.robotProfileId,
          toolProfileId: context.calibration.toolProfileId,
          screenProfileId: context.screen.id,
          calibrationProfileId: context.calibration.id,
          requestId: randomUUID(),
          contextKey: context.key,
          action: request,
        },
        async () => (await this.snapshot()).binding,
        signal,
      );
    })();
    this.pending.add(pending);
    void pending
      .finally(() => this.pending.delete(pending))
      .catch(() => undefined);
    return pending;
  }
  /** @internal Preview the saved calibration with the real touch canvas. */
  async drawLogo(canvas: () => LogoCanvasSession): Promise<void> {
    this.assertAlive();
    const operation = (async () => {
      const { calibration, key } = await this.resolveContext();
      this.assertAlive();
      return this.options.arm.drawLogoForDevice(
        this.ownerId,
        {
          robotProfileId: calibration.robotProfileId,
          toolProfileId: calibration.toolProfileId,
          screenProfileId: calibration.screenProfileId,
          calibrationProfileId: calibration.id,
          requestId: randomUUID(),
          contextKey: key,
        },
        async () => (await this.snapshot()).binding,
        canvas,
        this.lifetime.signal,
      );
    })();
    this.pending.add(operation);
    try {
      await operation;
    } finally {
      this.pending.delete(operation);
    }
  }

  /** Run the manager's calibration interaction under this screen's queue ownership. */
  async withCalibration(
    interaction: (signal: AbortSignal) => Promise<CalibrationProfile>,
    signal: AbortSignal,
  ): Promise<CalibrationProfile> {
    this.assertAlive();
    const operation = (async () => {
      await this.connect();
      this.assertAlive();
      return this.options.arm.calibrateForDevice(
        this.ownerId,
        async (signal) => {
          const result = await interaction(signal);
          const accepted = controllerRuntime(
            this.options.arm,
          ).profileStore.deviceBinding(this.id);
          if (!accepted || accepted.calibrationProfileId !== result.id)
            throw new RobotArmError(
              'CALIBRATION_INVALID',
              'Calibration interaction did not publish an accepted result',
            );
          this.context = undefined;
          return result;
        },
        signal,
      );
    })();
    this.pending.add(operation);
    try {
      return await operation;
    } finally {
      this.pending.delete(operation);
    }
  }
  /** Explicitly enable the arm with this Device's accepted tool and payload. */
  async enable(options: {
    confirmed: boolean;
    signal?: AbortSignal;
  }): Promise<void> {
    this.assertAlive();
    if (options.confirmed !== true)
      throw new RobotArmError(
        'CONFIRMATION_REQUIRED',
        'Confirm the tool configuration and clear workspace before enabling the arm',
        400,
      );
    const operation = this.options.arm.enableForDevice(
      this.ownerId,
      async () => {
        const context = await this.resolveContext();
        this.assertAlive();
        const tool = controllerRuntime(this.options.arm).profileStore.getTool(
          context.calibration.toolProfileId,
        );
        return {
          robotProfileId: context.calibration.robotProfileId,
          toolProfileId: tool.id,
          toolRevision: tool.revision,
        };
      },
      AbortSignal.any([
        this.lifetime.signal,
        ...(options.signal ? [options.signal] : []),
      ]),
    );
    this.pending.add(operation);
    try {
      await operation;
    } finally {
      this.pending.delete(operation);
    }
  }

  /** Current accepted calibration; returns a copy and validates this Device's camera binding. */
  async getCalibration(): Promise<CalibrationProfile> {
    return structuredClone((await this.resolveContext()).calibration);
  }
  /** Current screen settings for this Device's accepted calibration. */
  async configuration() {
    const context = await this.resolveContext();
    return structuredClone({
      screen: controllerRuntime(this.options.arm).profileStore.getScreen(
        context.screen.id,
      ),
      calibration: context.calibration,
    });
  }

  /** @internal Let a host-owned Device resolve the current accepted binding again. */
  refreshCalibrationContext(): void {
    this.assertAlive();
    this.context = undefined;
  }

  private async configure<T>(
    work: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
    safeTarget?: string,
  ): Promise<T> {
    this.assertAlive();
    const pending = this.options.arm.configureForDevice(
      this.ownerId,
      work,
      AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]),
      safeTarget,
    );
    this.pending.add(pending);
    try {
      return await pending;
    } finally {
      this.pending.delete(pending);
    }
  }

  async updateMotionSettings(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    const allowed = [
      'revision',
      'actionSpeed',
      'actionAcceleration',
      'pressDepthMm',
      'safeHeightMm',
      'contactMs',
      'swipeEndpointHoldMs',
      'longPressMs',
      'dragHoldMs',
      'successorStartLeadMs',
      'releaseSpeedFactor',
      'releaseAccelerationFactor',
    ];
    if (Object.keys(input).some((key) => !allowed.includes(key)))
      throw new Error('Only screen motion settings may be changed');
    return this.configure(async (abort) => {
      const { screen } = await this.configuration();
      if (input.revision !== screen.revision)
        throw new Error('Screen settings changed. Reload before saving.');
      abort.throwIfAborted();
      const result = await controllerRuntime(this.options.arm).putScreen({
        ...screen,
        ...input,
      });
      this.context = undefined;
      return result;
    }, signal);
  }

  async safePosition(
    input: {
      mode: 'return' | 'record';
      revision: number;
      calibrationId: string;
      confirmed: boolean;
    },
    signal?: AbortSignal,
  ) {
    if (input.confirmed !== true || !['return', 'record'].includes(input.mode))
      throw new Error('Confirm the safe position operation');
    return this.configure(
      async (abort) => {
        const { calibration: c } = await this.configuration();
        if (input.calibrationId !== c.id || input.revision !== c.revision)
          throw new Error('Safe position changed. Reload before retrying.');
        const runtime = controllerRuntime(this.options.arm);
        let stopping: Promise<void> | undefined;
        const cancel = () => {
          stopping = this.options.arm.stopInterruptedWork();
          void stopping.catch(() => undefined);
        };
        abort.addEventListener('abort', cancel, { once: true });
        try {
          abort.throwIfAborted();
          return await runtime.safePosition({
            robotProfileId: c.robotProfileId,
            toolProfileId: c.toolProfileId,
            screenProfileId: c.screenProfileId,
            calibrationProfileId: c.id,
            revision: c.revision,
            requestId: randomUUID(),
            mode: input.mode,
          });
        } finally {
          abort.removeEventListener('abort', cancel);
          this.context = undefined;
          await stopping;
        }
      },
      signal,
      input.calibrationId,
    );
  }

  /** Register a directional route. This only validates; the next action on target performs the transfer. */
  async configureTransferTo(
    target: RobotArmDevice,
    options: {
      waypoints: import('./contracts.js').CartesianPose[];
      confirmed: boolean;
      signal?: AbortSignal;
    },
  ): Promise<void> {
    this.assertAlive();
    target.assertAlive();
    options.signal?.throwIfAborted();
    if (target.options.arm !== this.options.arm || target.id === this.id)
      throw new RobotArmError(
        'INVALID_TRANSFER',
        'Transfer requires different Devices sharing the same Controller',
      );
    const [from, to] = await Promise.all([
      this.resolveContext(),
      target.resolveContext(),
    ]);
    this.assertAlive();
    target.assertAlive();
    const operation = this.options.arm.configureTransfer(
      this.ownerId,
      {
        fromCalibrationId: from.calibration.id,
        fromCalibrationRevision: from.calibration.revision,
        toCalibrationId: to.calibration.id,
        toCalibrationRevision: to.calibration.revision,
        waypoints: options.waypoints,
        confirmed: options.confirmed,
      },
      AbortSignal.any([
        this.lifetime.signal,
        target.lifetime.signal,
        ...(options.signal ? [options.signal] : []),
      ]),
    );
    this.pending.add(operation);
    target.pending.add(operation);
    try {
      await operation;
    } finally {
      this.pending.delete(operation);
      target.pending.delete(operation);
    }
  }
  async screenshotBase64(): Promise<string> {
    return (await this.snapshot()).base64;
  }
  async size(): Promise<{ width: number; height: number }> {
    const { screen } = await this.resolveContext();
    return { width: screen.pixelWidth, height: screen.pixelHeight };
  }
  async destroy(): Promise<void> {
    this.destroyed = true;
    this.lifetime.abort(new Error('Device work cancelled'));
    this.closing ??= (async () => {
      this.options.arm.cancelDevice(this.ownerId);
      await this.opening?.catch(() => undefined);
      await Promise.allSettled(this.pending);
      await this.cameras.release(this.options.camera, this.ownerId);
      this.session = undefined;
      this.context = undefined;
      this.options.arm.assertDeviceStopped(this.ownerId);
    })();
    return this.closing;
  }
}
