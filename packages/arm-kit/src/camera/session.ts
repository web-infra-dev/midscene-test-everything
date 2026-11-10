import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  CalibrationVision,
  CalibrationVisionOptions,
} from '../calibration/camera/vision.js';
import {
  type CameraCorrection,
  RobotArmError,
  type VisionBinding,
  type VisionSnapshot,
} from '../contracts.js';
import { detectCalibrationMarkers } from './calibration-markers.js';
import { CameraStreamManager } from './camera-stream-manager.js';
import {
  DEFAULT_STARTUP_TIMEOUT_MS,
  DEFAULT_STOP_TIMEOUT_MS,
} from './camera-stream.js';
import type { CameraStream } from './camera-stream.js';
import { cameraBackend } from './index.js';
import { jpegSize } from './jpeg-size.js';
import { PerspectiveMonitor } from './perspective-monitor.js';
import { PerspectiveTransformer } from './perspective-transformer.js';
import { checkPerspectiveValidity } from './perspective-validity.js';
import type { CameraBackend, CameraDevice, CameraFrame } from './types.js';
import { validateQuad } from './vision-geometry.js';
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
  /** Supplied by the calibration host for this screen while its phone is paired. */
  referenceFrame?: () => CameraFrame | undefined;
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
  ) {}
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
    if (stored.target) this.target = stored.target;
    await this.perspective.load();
  }
  async forScreen(screenId: string): Promise<CameraSession> {
    const scoped = new CameraSession(
      this.camera,
      this.stream,
      this.directory,
      screenId,
    );
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
  setCorrection(input: CameraCorrection): Promise<void> {
    validateCameraCorrection(input);
    const correction = structuredClone(input);
    return this.writePerspective(correction, this.target);
  }
  /**
   * Releases the applied perspective. The screen keeps its identity — name,
   * page link, marker slot, saved size — so the same glass can be recalibrated;
   * only the framing the camera was applying is dropped.
   */
  async clearCorrection(): Promise<void> {
    const operation = this.writeChain.then(async () => {
      if (!this.correction) return;
      await this.persistPerspective(this.correction, this.target, false);
      this.correction = undefined;
      this.target = undefined;
      await this.perspective.reset();
    });
    this.writeChain = operation.catch(() => undefined);
    return operation;
  }
  setPerspective(
    input: CameraCorrection,
    target: PerspectiveTarget,
  ): Promise<void> {
    validateCameraCorrection(input);
    validatePerspectiveTarget(target);
    return this.writePerspective(
      structuredClone(input),
      structuredClone(target),
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
  clearPerspective(): Promise<void> {
    const operation = this.writeChain.then(async () => {
      await rm(this.correctionFile, { force: true });
      this.savedPerspective = false;
      this.correction = undefined;
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
      validity: this.perspective.summary(),
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
        this.perspective.summary()?.state !== 'invalid' &&
        binding.cameraId === this.camera.id &&
        binding.fingerprint === this.fingerprint(binding.width, binding.height),
    );
  }
  getPerspectiveValidity() {
    return this.perspective.summary();
  }
  checkPerspective(options?: { signal?: AbortSignal; maxAgeMs?: number }) {
    return this.perspective.check(options);
  }
  assertPerspectiveCurrent() {
    return this.perspective.assertCurrent();
  }
  async checkCorrection(
    correction: CameraCorrection,
    jpeg?: Buffer,
    allowMismatch = false,
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
    const result = await checkPerspectiveValidity({
      jpeg: image,
      points: correction.points,
      sourceWidth: size.width,
      sourceHeight: size.height,
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
  ) {
    validateCameraCorrection(correction);
    const jpeg = await this.rawFrame();
    const size = jpegSize(jpeg);
    if (
      size.width !== correction.sourceWidth ||
      size.height !== correction.sourceHeight
    )
      throw new RobotArmError(
        'VISION_BINDING_CHANGED',
        'Camera image dimensions changed; repeat correction',
      );
    return this.transformer.transform(jpeg, {
      points: correction.points,
      rotation: correction.rotation,
      targetWidth: options.width,
      targetHeight: options.height,
    });
  }
  /** Older corrections may only store the quad and its rotation. */
  getRectifiedPreviewTarget(): PerspectiveTarget | undefined {
    const correction = this.correction;
    if (!correction) return undefined;
    if (this.target) return structuredClone(this.target);
    const { topLeft, topRight, bottomRight, bottomLeft } = correction.points;
    const width =
      (Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y) +
        Math.hypot(
          bottomRight.x - bottomLeft.x,
          bottomRight.y - bottomLeft.y,
        )) /
      2;
    const height =
      (Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y) +
        Math.hypot(bottomRight.x - topRight.x, bottomRight.y - topRight.y)) /
      2;
    const { rotation } = correction;
    const sideways = rotation === 90 || rotation === 270;
    const bounded = (size: number) =>
      Math.min(4096, Math.max(2, Math.round(size)));
    return {
      width: bounded(sideways ? height : width),
      height: bounded(sideways ? width : height),
      rotation,
    };
  }

  /** Rectify the frame received by the live preview without requesting another. */
  async rectifiedFrame(
    jpeg: Buffer,
    options: {
      maxSide?: number;
      maxPixels?: number;
      sampling?: 'bilinear' | 'nearest';
    } = {},
  ): Promise<Buffer> {
    const correction = this.correction;
    const target = this.getRectifiedPreviewTarget();
    if (!correction || !target)
      throw new RobotArmError(
        'MAPPING_REQUIRED',
        'Save perspective correction before viewing the corrected preview',
        409,
      );
    const size = jpegSize(jpeg);
    if (
      size.width !== correction.sourceWidth ||
      size.height !== correction.sourceHeight
    )
      throw new RobotArmError(
        'VISION_BINDING_CHANGED',
        'Camera image dimensions changed; repeat correction',
        409,
      );
    let width = target.width;
    let height = target.height;
    let scale = 1;
    if (options.maxSide)
      scale = Math.min(scale, options.maxSide / Math.max(width, height));
    if (options.maxPixels)
      scale = Math.min(scale, Math.sqrt(options.maxPixels / (width * height)));
    if (scale < 1) {
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }
    return this.transformer.transform(jpeg, {
      points: correction.points,
      // The preview target already describes the intended output orientation.
      rotation: target.rotation,
      targetWidth: width,
      targetHeight: height,
      sampling: options.sampling,
    });
  }
  async snapshot(options: CalibrationVisionOptions): Promise<VisionSnapshot> {
    await this.assertPerspectiveCurrent();
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
}

/** Reference-counted camera leases: releasing one Device never closes another's camera. */
export class CameraSessionManager {
  private readonly streams: CameraStreamManager;
  private readonly sessions = new Map<string, CameraSession>();
  private readonly screenSessions = new Map<string, CameraSession>();
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
    ]).then(() => undefined);
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
      const session = new CameraSession(camera, stream, this.directory);
      await session.load();
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
        if (session)
          await this.streams.delete(session.stream.id).catch(() => undefined);
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
      this.sessions.clear();
      this.screenSessions.clear();
      this.owners.clear();
    })();
    return this.closing;
  }
}
