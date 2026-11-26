import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CalibrationPageLayout } from '../assisted-contracts.js';
import type {
  CalibrationVision,
  CalibrationVisionOptions,
} from '../calibration/camera/vision.js';
import {
  type CameraCorrection,
  RobotArmError,
  SCREEN_DRIFT_DETECTION_ENABLED,
  type VisionBinding,
  type VisionSnapshot,
} from '../contracts.js';
import {
  detectCalibrationMarkers,
  detectCalibrationMarkersInSource,
} from './calibration-markers.js';
import { CameraStreamManager } from './camera-stream-manager.js';
import {
  DEFAULT_STARTUP_TIMEOUT_MS,
  DEFAULT_STOP_TIMEOUT_MS,
} from './camera-stream.js';
import type { CameraStream } from './camera-stream.js';
import {
  CameraImagingController,
  type CameraImagingStatus,
  removeCameraImagingScreen,
} from './imaging.js';
import { cameraBackend } from './index.js';
import { jpegSize } from './jpeg-size.js';
import {
  PerspectiveMonitor,
  validatePerspectiveFrame,
} from './perspective-monitor.js';
import { PerspectiveTransformer } from './perspective-transformer.js';
import { checkPerspectiveValidity } from './perspective-validity.js';
import { rectifiedPreviewPool } from './rectified-preview-pool.js';
import {
  type RectifiedPreviewOptions,
  transformRectifiedPreview,
} from './rectified-preview-transform.js';
import type {
  CameraBackend,
  CameraDevice,
  PerspectiveReferenceFrame,
} from './types.js';
import { measuredPerspectiveTarget, validateQuad } from './vision-geometry.js';
import type { PerspectiveTarget } from './vision-types.js';

export type { CameraCorrection } from '../contracts.js';

export interface StoredCameraPerspective {
  correction: CameraCorrection;
  target?: PerspectiveTarget;
  applied?: false;
}

/** Camera-only previews read the same file the Device later restores. */
export function cameraPerspectiveFile(
  directory: string,
  cameraId: string,
  screenId?: string,
): string {
  return path.join(
    directory,
    `${createHash('sha256')
      .update(screenId ? JSON.stringify([cameraId, screenId]) : cameraId)
      .digest('hex')}.json`,
  );
}

export function validateCameraCorrection(correction: CameraCorrection): void {
  if (
    !correction ||
    !Number.isInteger(correction.sourceWidth) ||
    !Number.isInteger(correction.sourceHeight) ||
    correction.sourceWidth < 1 ||
    correction.sourceHeight < 1 ||
    ![0, 90, 180, 270].includes(correction.rotation)
  )
    throw new Error('Invalid camera correction');
  validateQuad(correction.points);
  for (const point of Object.values(correction.points))
    if (
      point.x < 0 ||
      point.x >= correction.sourceWidth ||
      point.y < 0 ||
      point.y >= correction.sourceHeight
    )
      throw new Error('Camera corner lies outside the source image');
}

export function validatePerspectiveTarget(target: PerspectiveTarget): void {
  if (
    !target ||
    !Number.isInteger(target.width) ||
    !Number.isInteger(target.height) ||
    target.width < 1 ||
    target.height < 1 ||
    target.width > 7680 ||
    target.height > 7680 ||
    ![0, 90, 180, 270].includes(target.rotation)
  )
    throw new Error('Invalid perspective target');
}

/** Read a correction without opening the camera, for list responses. */
export async function readCameraPerspective(
  directory: string,
  cameraId: string,
  screenId?: string,
): Promise<StoredCameraPerspective | undefined> {
  let raw: string;
  try {
    raw = await readFile(
      cameraPerspectiveFile(directory, cameraId, screenId),
      'utf8',
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const data = JSON.parse(raw);
  if (data.cameraId !== cameraId)
    throw new Error('Stored camera identity does not match');
  validateCameraCorrection(data.correction);
  if (data.perspectiveTarget) validatePerspectiveTarget(data.perspectiveTarget);
  return {
    correction: data.correction,
    ...(data.applied === false ? { applied: false as const } : {}),
    ...(data.perspectiveTarget ? { target: data.perspectiveTarget } : {}),
  };
}

/** Camera, current image correction and identity used by Device and calibration. */
export class CameraSession implements CalibrationVision {
  private correction?: CameraCorrection;
  private savedPerspective = false;
  private target?: PerspectiveTarget;
  private writeChain = Promise.resolve();
  private readonly transformer = new PerspectiveTransformer();
  /**
   * One in-flight rectification per (frame buffer, output). A new frame brings
   * new buffers, so this never grows beyond the frames still held by the stream.
   */
  private readonly rectifiedFrames = new WeakMap<
    Buffer,
    Map<string, Promise<Buffer>>
  >();
  /** Bumped whenever the applied perspective changes. */
  private correctionVersion = 0;
  /** Supplied by the calibration host for this screen while its phone is paired. */
  referenceFrame?: () => PerspectiveReferenceFrame | undefined;
  private readonly perspective = new PerspectiveMonitor({
    file: () => `${this.correctionFile}.validity.json`,
    key: () => this.fingerprint(0, 0),
    correction: () => this.getCorrection(),
    referenceFrame: () => this.referenceFrame?.(),
    frame: async () => {
      if (this.stream.getInfo().state !== 'running')
        throw new RobotArmError('VISION_UNAVAILABLE', 'Camera is not running');
      return this.stream.getFrame({ timeoutMs: 2_000 });
    },
  });
  constructor(
    readonly camera: CameraDevice,
    readonly stream: CameraStream,
    private readonly directory: string,
    private readonly screenId?: string,
    private readonly imaging?: CameraImagingController,
  ) {}
  private get imagingScopeId() {
    return this.screenId ?? this.camera.id;
  }
  private get correctionFile() {
    return cameraPerspectiveFile(this.directory, this.camera.id, this.screenId);
  }
  async load(): Promise<void> {
    const stored = await readCameraPerspective(
      this.directory,
      this.camera.id,
      this.screenId,
    );
    if (!stored) return;
    this.savedPerspective = true;
    if (stored.applied === false) return;
    this.correction = stored.correction;
    this.correctionVersion += 1;
    if (stored.target) this.target = stored.target;
    if (SCREEN_DRIFT_DETECTION_ENABLED) await this.perspective.load();
  }
  async forScreen(screenId: string): Promise<CameraSession> {
    const scoped = new CameraSession(
      this.camera,
      this.stream,
      this.directory,
      screenId,
      this.imaging,
    );
    await scoped.load();
    this.imaging?.registerScreen(screenId, () => scoped.getCorrection());
    return scoped;
  }
  /**
   * A camera-level perspective, loaded independently of whichever screen is
   * currently active. A 3D build that renders several screens at once must not
   * inherit the console's active perspective.
   */
  async forCamera(): Promise<CameraSession> {
    const scoped = new CameraSession(this.camera, this.stream, this.directory);
    await scoped.load();
    return scoped;
  }
  hasSavedPerspective(): boolean {
    return this.savedPerspective;
  }
  deleteSavedPerspective(): Promise<void> {
    const operation = this.writeChain.then(async () => {
      if (this.correction)
        throw new RobotArmError(
          'BUSY',
          'Clear the applied perspective before deleting it.',
          409,
        );
      await this.imaging?.clearScreenBinding(this.imagingScopeId);
      await rm(this.correctionFile, { force: true });
      this.savedPerspective = false;
    });
    this.writeChain = operation.catch(() => undefined);
    return operation;
  }
  getCorrection(): CameraCorrection | undefined {
    return this.correction && structuredClone(this.correction);
  }
  getPerspectiveTarget(): PerspectiveTarget | undefined {
    return this.target && structuredClone(this.target);
  }
  async setCorrection(
    input: CameraCorrection,
    options: { preserveImaging?: boolean } = {},
  ): Promise<void> {
    validateCameraCorrection(input);
    const correction = structuredClone(input);
    if (!options.preserveImaging)
      await this.imaging?.clearScreenBinding(this.imagingScopeId);
    await this.writePerspective(correction, this.target);
    if (options.preserveImaging)
      await this.imaging?.rebindPerspective(
        this.screenId ?? this.camera.id,
        correction,
      );
  }
  /**
   * Releases the applied perspective. The screen keeps its identity — name,
   * page link, marker slot, saved size — so the same glass can be recalibrated;
   * only the framing the camera was applying is dropped.
   */
  async clearCorrection(): Promise<void> {
    await this.imaging?.clearScreenBinding(this.imagingScopeId);
    const operation = this.writeChain.then(async () => {
      if (!this.correction) return;
      await this.persistPerspective(this.correction, this.target, false);
      this.correction = undefined;
      this.correctionVersion += 1;
      this.target = undefined;
      await this.perspective.reset();
    });
    this.writeChain = operation.catch(() => undefined);
    return operation;
  }
  async setPerspective(
    input: CameraCorrection,
    target: PerspectiveTarget,
    options: { preserveImaging?: boolean } = {},
  ): Promise<void> {
    validateCameraCorrection(input);
    validatePerspectiveTarget(target);
    if (!options.preserveImaging)
      await this.imaging?.clearScreenBinding(this.imagingScopeId);
    await this.writePerspective(
      structuredClone(input),
      structuredClone(target),
    );
    if (options.preserveImaging)
      await this.imaging?.rebindPerspective(
        this.screenId ?? this.camera.id,
        input,
      );
  }
  private writePerspective(
    correction: CameraCorrection,
    target?: PerspectiveTarget,
  ): Promise<void> {
    const operation = this.writeChain.then(async () => {
      await this.persistPerspective(correction, target, true);
      this.savedPerspective = true;
      this.correction = correction;
      this.correctionVersion += 1;
      this.target = target;
      await this.perspective.reset();
    });
    this.writeChain = operation.catch(() => undefined);
    return operation;
  }
  private async persistPerspective(
    correction: CameraCorrection,
    target: PerspectiveTarget | undefined,
    applied: boolean,
  ) {
    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.correctionFile}.${randomUUID()}.tmp`;
    await writeFile(
      temporary,
      JSON.stringify({
        cameraId: this.camera.id,
        correction,
        ...(applied ? {} : { applied: false }),
        ...(target ? { perspectiveTarget: target } : {}),
      }),
      { mode: 0o600 },
    );
    await rename(temporary, this.correctionFile);
  }

  /** Delete the correction and evidence without waiting for the camera stream. */
  async clearPerspective(): Promise<void> {
    await this.imaging?.clearScreenBinding(this.imagingScopeId);
    const operation = this.writeChain.then(async () => {
      await rm(this.correctionFile, { force: true });
      this.savedPerspective = false;
      this.correction = undefined;
      this.correctionVersion += 1;
      this.target = undefined;
      await this.perspective.reset();
    });
    this.writeChain = operation.catch(() => undefined);
    return operation;
  }
  async rawFrame(): Promise<Buffer> {
    const info = this.stream.getInfo();
    if (info.state !== 'running' && info.state !== 'starting')
      throw new RobotArmError(
        'VISION_UNAVAILABLE',
        info.error ?? 'Camera is not running',
      );
    return (await this.stream.getFrame({ fresh: true, timeoutMs: 5000 })).jpeg;
  }

  withMarkerImaging<T>(capture: () => Promise<T>): Promise<T> {
    return this.imaging?.withMarkerImaging(capture) ?? capture();
  }

  /** Entry point for capture workflows that need a fresh exposure precheck. */
  async prepareCaptureExposure(): Promise<void> {
    await this.imaging?.beforeCapture(this.imagingScopeId);
  }
  async withReducedVisibilityExposure<T>(
    capture: (exposure: { previous: number; reduced: number }) => Promise<T>,
  ): Promise<T | undefined> {
    return this.imaging?.withReducedVisibilityExposure(capture);
  }
  async binding(options: CalibrationVisionOptions): Promise<VisionBinding> {
    if (options.cameraId !== this.camera.id)
      throw new RobotArmError(
        'VISION_BINDING_CHANGED',
        'Camera identity changed',
      );
    if (
      ![options.width, options.height].every(
        (n) => Number.isInteger(n) && n > 0 && n <= 4096,
      )
    )
      throw new Error('Invalid screenshot dimensions');
    const correction = this.correction;
    if (!correction)
      throw new RobotArmError(
        'MAPPING_REQUIRED',
        'Correct the camera image before calibration',
      );
    const fingerprint = this.fingerprint(options.width, options.height);
    return {
      cameraId: this.camera.id,
      cameraName: this.camera.name,
      perspectiveProfileKey: this.screenId ?? this.camera.id,
      fingerprint,
      width: options.width,
      height: options.height,
      validity: this.getPerspectiveValidity(),
    };
  }
  private fingerprint(width: number, height: number) {
    return createHash('sha256')
      .update(
        JSON.stringify([
          this.camera.id,
          this.correction,
          this.stream.getOptions(),
          width,
          height,
        ]),
      )
      .digest('hex');
  }
  isBindingCurrent(binding: VisionBinding): boolean {
    return Boolean(
      this.correction &&
        this.getPerspectiveValidity()?.state !== 'invalid' &&
        binding.cameraId === this.camera.id &&
        binding.fingerprint === this.fingerprint(binding.width, binding.height),
    );
  }
  getPerspectiveValidity() {
    return SCREEN_DRIFT_DETECTION_ENABLED
      ? this.perspective.summary()
      : undefined;
  }
  checkPerspective(options?: { signal?: AbortSignal; maxAgeMs?: number }) {
    options?.signal?.throwIfAborted();
    return SCREEN_DRIFT_DETECTION_ENABLED
      ? this.perspective.check(options)
      : Promise.resolve(undefined);
  }
  async assertPerspectiveCurrent() {
    if (SCREEN_DRIFT_DETECTION_ENABLED) return this.perspective.assertCurrent();
    if (!this.correction)
      throw new RobotArmError(
        'MAPPING_REQUIRED',
        'Correct the camera image before calibration',
        409,
      );
    const frame = this.stream.currentFrame;
    if (!frame)
      throw new RobotArmError('VISION_UNAVAILABLE', 'No current camera frame');
    validatePerspectiveFrame(frame, this.correction);
  }
  async checkCorrection(
    correction: CameraCorrection,
    jpeg?: Buffer,
    allowMismatch = false,
    pageLayout?: CalibrationPageLayout,
  ) {
    validateCameraCorrection(correction);
    const image = jpeg ?? (await this.rawFrame());
    const size = jpegSize(image);
    if (
      size.width !== correction.sourceWidth ||
      size.height !== correction.sourceHeight
    )
      throw new RobotArmError(
        'VISION_BINDING_CHANGED',
        'Camera image dimensions changed; repeat correction',
        409,
      );
    if (!SCREEN_DRIFT_DETECTION_ENABLED) return undefined;
    const result = await checkPerspectiveValidity({
      jpeg: image,
      points: correction.points,
      sourceWidth: size.width,
      sourceHeight: size.height,
      rotation: correction.rotation,
      pageLayout:
        pageLayout ?? (jpeg ? undefined : this.referenceFrame?.()?.pageLayout),
    });
    if (!allowMismatch && result.state === 'invalid')
      throw new RobotArmError(
        'CALIBRATION_MISMATCH',
        'The saved screen outline no longer matches the camera view. Recalibrate before moving.',
        409,
      );
    return result;
  }
  async correctedFrame(
    correction: CameraCorrection,
    options: { width: number; height: number },
    source?: Buffer,
  ) {
    validateCameraCorrection(correction);
    const jpeg = source ?? (await this.rawFrame());
    this.checkSourceSize(jpeg, correction);
    return this.transformer.transform(jpeg, {
      points: correction.points,
      rotation: correction.rotation,
      targetWidth: options.width,
      targetHeight: options.height,
    });
  }

  private checkSourceSize(jpeg: Buffer, correction: CameraCorrection) {
    const size = jpegSize(jpeg);
    if (
      size.width !== correction.sourceWidth ||
      size.height !== correction.sourceHeight
    )
      throw new RobotArmError(
        'VISION_BINDING_CHANGED',
        'Camera image dimensions changed; repeat correction',
      );
  }
  /** Older corrections may only store the quad and its rotation. */
  getRectifiedPreviewTarget(): PerspectiveTarget | undefined {
    const correction = this.correction;
    if (!correction) return undefined;
    if (this.target) return structuredClone(this.target);
    const { rotation } = correction;
    return {
      ...measuredPerspectiveTarget(correction.points, rotation),
      rotation,
    };
  }

  /** Rectify the frame received by the live preview without requesting another. */
  async rectifiedFrame(
    jpeg: Buffer,
    options: RectifiedPreviewOptions = {},
  ): Promise<Buffer> {
    const request = this.rectifiedPreviewRequest(options);
    return transformRectifiedPreview(jpeg, request, this.transformer);
  }
  /**
   * Move CPU-bound live preview rectification off the HTTP event-loop thread.
   *
   * Several consumers (stage preview, calibration preview, 3D twin) rectify the
   * same frame for the same screen. They share one in-flight job per
   * (frame, output) pair: the cache is keyed by the JPEG buffer itself, so it
   * follows the frame through the stream and is released with it.
   */
  async rectifiedPreviewFrame(
    jpeg: Buffer,
    options: RectifiedPreviewOptions = {},
  ): Promise<Buffer> {
    const request = this.rectifiedPreviewRequest(options);
    const key = [
      // A correction can change between frames; a rectification computed with
      // the previous corners must not be reused for the new outline.
      this.correctionVersion,
      request.target.width,
      request.target.height,
      request.target.rotation,
      options.maxSide ?? '',
      options.maxPixels ?? '',
      options.sampling ?? '',
    ].join(':');
    let byKey = this.rectifiedFrames.get(jpeg);
    if (!byKey) {
      byKey = new Map();
      this.rectifiedFrames.set(jpeg, byKey);
    }
    const pending = byKey.get(key);
    if (pending) return pending;
    const job = rectifiedPreviewPool.transform(jpeg, request);
    byKey.set(key, job);
    job.catch(() => {
      if (byKey.get(key) === job) byKey.delete(key);
    });
    return job;
  }
  private rectifiedPreviewRequest(options: RectifiedPreviewOptions = {}) {
    const correction = this.correction;
    const target = this.getRectifiedPreviewTarget();
    if (!correction || !target)
      throw new RobotArmError(
        'MAPPING_REQUIRED',
        'Save perspective correction before viewing the corrected preview',
        409,
      );
    return { correction, target, options };
  }
  async snapshot(options: CalibrationVisionOptions): Promise<VisionSnapshot> {
    // correctedFrame already requests a fresh frame and verifies its dimensions.
    if (SCREEN_DRIFT_DETECTION_ENABLED) await this.assertPerspectiveCurrent();
    await this.imaging?.beforeCapture(this.imagingScopeId);
    const before = await this.binding(options);
    const correction = this.getCorrection()!;
    const image = await this.correctedFrame(correction, options);
    const after = await this.binding(options);
    if (before.fingerprint !== after.fingerprint)
      throw new RobotArmError(
        'VISION_BINDING_CHANGED',
        'Camera correction changed during screenshot',
      );
    return {
      base64: image.toString('base64'),
      width: options.width,
      height: options.height,
      binding: after,
    };
  }
  detectMarkers: CalibrationVision['detectMarkers'] = detectCalibrationMarkers;

  async detectMarkersInSource(
    binding: VisionBinding,
    layout: CalibrationPageLayout,
  ) {
    const correction = this.getCorrection();
    const jpeg = await this.rawFrame();
    if (!correction || !this.isBindingCurrent(binding))
      throw new RobotArmError(
        'VISION_BINDING_CHANGED',
        'Camera correction changed during marker detection',
        409,
      );
    this.checkSourceSize(jpeg, correction);
    return detectCalibrationMarkersInSource(jpeg, layout, {
      points: correction.points,
      rotation: correction.rotation,
      targetWidth: binding.width,
      targetHeight: binding.height,
    });
  }

  async calibrateImaging(): Promise<CameraImagingStatus> {
    if (!this.imaging)
      throw new RobotArmError(
        'VISION_UNAVAILABLE',
        'Camera imaging controller is unavailable',
        409,
      );
    return this.imaging.calibrate(this.imagingScopeId);
  }

  async calibrateScreens(
    screenIds: readonly string[],
    calibrationToken?: string,
  ): Promise<CameraImagingStatus> {
    if (!this.imaging)
      throw new RobotArmError(
        'VISION_UNAVAILABLE',
        'Camera imaging controller is unavailable',
        409,
      );
    return this.imaging.calibrateScreens(screenIds, calibrationToken);
  }

  beginScreensImaging(screenIds: readonly string[]) {
    return this.imaging?.beginScreensCalibration(screenIds);
  }

  failScreensImaging(
    token: string | undefined,
    screenIds: readonly string[],
    error: unknown,
  ) {
    if (token) this.imaging?.failScreensCalibration(token, screenIds, error);
  }

  async activateImaging(): Promise<CameraImagingStatus> {
    if (!this.imaging)
      throw new RobotArmError(
        'VISION_UNAVAILABLE',
        'Camera imaging controller is unavailable',
        409,
      );
    return this.imaging.activateScreen(this.imagingScopeId);
  }

  imagingStatus(): CameraImagingStatus {
    return (
      this.imaging?.status(this.imagingScopeId) ?? { state: 'unsupported' }
    );
  }

  async releaseImaging(): Promise<void> {
    await this.imaging?.releaseForCorrection(this.imagingScopeId);
  }
}

/** Reference-counted camera leases: releasing one Device never closes another's camera. */
export class CameraSessionManager {
  private readonly streams: CameraStreamManager;
  private readonly sessions = new Map<string, CameraSession>();
  private readonly screenSessions = new Map<string, CameraSession>();
  private readonly imaging = new Map<string, CameraImagingController>();
  private readonly operations = new Map<string, Promise<unknown>>();
  private closing?: Promise<void>;
  private readonly owners = new Map<string, Set<string>>();
  private closed = false;
  constructor(
    private readonly backend: CameraBackend = cameraBackend(),
    private readonly directory = path.resolve(
      process.env.MIDSCENE_ARM_DATA_DIR || '.midscene/arm-kit',
      'cameras',
    ),
    streamStopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
  ) {
    this.streams = new CameraStreamManager(
      backend,
      8,
      DEFAULT_STARTUP_TIMEOUT_MS,
      streamStopTimeoutMs,
    );
  }
  activeCameraIds(): string[] {
    return [...this.sessions.keys()];
  }
  /** Directory that owns correction and screen manifest files. */
  get dataDirectory(): string {
    return this.directory;
  }
  private serialize<T>(
    cameraId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const pending = (this.operations.get(cameraId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(operation);
    this.operations.set(cameraId, pending);
    void pending
      .finally(() => {
        if (this.operations.get(cameraId) === pending)
          this.operations.delete(cameraId);
      })
      .catch(() => undefined);
    return pending;
  }
  /** List responses need the saved target without opening the camera. */
  async persistedPerspective(
    cameraId: string,
    screenId?: string,
  ): Promise<StoredCameraPerspective | undefined> {
    try {
      const stored = await readCameraPerspective(
        this.directory,
        cameraId,
        screenId,
      );
      return stored?.applied === false ? undefined : stored;
    } catch {
      return undefined;
    }
  }
  /** Clear one screen correction without starting the camera. */
  clearPerspective(cameraId: string, screenId?: string): Promise<void> {
    // Deliberately outside serialize(): a camera that is still opening or
    // closing must not delay a clear, nor block the next acquire behind it.
    const session = screenId
      ? this.screenSessions.get(JSON.stringify([cameraId, screenId]))
      : this.sessions.get(cameraId);
    if (session) return session.clearPerspective();
    const file = cameraPerspectiveFile(this.directory, cameraId, screenId);
    return Promise.all([
      rm(file, { force: true }),
      rm(`${file}.validity.json`, { force: true }),
      removeCameraImagingScreen(this.directory, cameraId, screenId ?? cameraId),
    ]).then(() => undefined);
  }
  /** Apply one screen's saved camera parameters without opening a new stream. */
  activateScreen(
    cameraId: string,
    screenId: string,
  ): Promise<CameraImagingStatus> {
    return this.serialize(cameraId, async () => {
      const imaging = this.imaging.get(cameraId);
      if (!imaging)
        throw new RobotArmError(
          'VISION_UNAVAILABLE',
          'Camera is not running',
          409,
        );
      return imaging.activateScreen(screenId);
    });
  }
  acquire(
    cameraId: string,
    ownerId: string,
    screenId?: string,
  ): Promise<CameraSession> {
    return this.serialize(cameraId, async () => {
      if (this.closed) throw new Error('Camera manager is closed');
      const owners = this.owners.get(cameraId) ?? new Set<string>();
      if (owners.has(ownerId))
        throw new Error('Device already owns this camera');
      let session = this.sessions.get(cameraId);
      if (session) {
        const state = session.stream.getInfo().state;
        // A previous release may have timed out while the capture process was
        // still shutting down. Never hand that dead session to a new viewer.
        if (state === 'stopped' || state === 'failed') {
          await this.imaging
            .get(cameraId)
            ?.close()
            .catch(() => undefined);
          this.imaging.delete(cameraId);
          await this.streams.delete(session.stream.id).catch(() => undefined);
          this.sessions.delete(cameraId);
          for (const key of this.screenSessions.keys())
            if (JSON.parse(key)[0] === cameraId)
              this.screenSessions.delete(key);
          session = undefined;
        }
      }
      if (!session) {
        session = await this.open(cameraId);
        if (this.closed) {
          await this.streams.delete(session.stream.id);
          throw new Error('Camera manager is closed');
        }
        this.sessions.set(cameraId, session);
      }
      if (screenId) {
        const key = JSON.stringify([cameraId, screenId]);
        let scoped = this.screenSessions.get(key);
        if (!scoped) {
          try {
            scoped = await session.forScreen(screenId);
            if (this.closed) throw new Error('Camera manager is closed');
          } catch (error) {
            if (!owners.size) {
              await this.streams.delete(session.stream.id);
              this.sessions.delete(cameraId);
            }
            throw error;
          }
          this.screenSessions.set(key, scoped);
        }
        session = scoped;
      }
      owners.add(ownerId);
      this.owners.set(cameraId, owners);
      return session;
    });
  }
  private async open(id: string): Promise<CameraSession> {
    const camera = (await this.backend.listDevices()).find(
      (entry) => entry.id === id,
    );
    if (!camera) throw new Error(`Camera not found: ${id}`);
    const stream = await this.streams.create({
      deviceId: id,
      ...camera.defaultCaptureSettings,
    });
    try {
      let control;
      try {
        control = await this.backend.openHardwareControl?.(id);
      } catch {
        control = undefined;
      }
      const imaging = new CameraImagingController(
        camera,
        stream,
        this.directory,
        control,
        () =>
          this.backend.openHardwareControl?.(id) ?? Promise.resolve(undefined),
      );
      await imaging.load();
      const session = new CameraSession(
        camera,
        stream,
        this.directory,
        undefined,
        imaging,
      );
      await session.load();
      imaging.registerScreen(camera.id, () => session.getCorrection());
      await imaging.reopenAfterRestart();
      this.imaging.set(id, imaging);
      return session;
    } catch (error) {
      await this.streams.delete(stream.id);
      throw error;
    }
  }
  release(cameraId: string, ownerId: string): Promise<void> {
    return this.serialize(cameraId, async () => {
      const owners = this.owners.get(cameraId);
      if (!owners?.delete(ownerId) || owners.size) return;
      const session = this.sessions.get(cameraId);
      try {
        if (session) {
          await this.imaging
            .get(cameraId)
            ?.close()
            .catch(() => undefined);
          this.imaging.delete(cameraId);
          await this.streams.delete(session.stream.id).catch(() => undefined);
        }
      } finally {
        // Clear the ownership records even when the capture process refused to
        // exit, so the next acquire can open a fresh stream.
        this.owners.delete(cameraId);
        this.sessions.delete(cameraId);
        for (const key of this.screenSessions.keys())
          if (JSON.parse(key)[0] === cameraId) this.screenSessions.delete(key);
      }
    });
  }
  close(): Promise<void> {
    this.closed = true;
    this.closing ??= (async () => {
      await Promise.allSettled(this.operations.values());
      await this.streams.close();
      await Promise.allSettled(
        [...this.imaging.values()].map((controller) => controller.close()),
      );
      this.imaging.clear();
      this.sessions.clear();
      this.screenSessions.clear();
      this.owners.clear();
      await rectifiedPreviewPool.close();
    })();
    return this.closing;
  }
}
