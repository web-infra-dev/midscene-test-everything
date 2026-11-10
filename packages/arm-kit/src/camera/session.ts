import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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
import type { CameraStream } from './camera-stream.js';
import { cameraBackend } from './index.js';
import { jpegSize } from './jpeg-size.js';
import { PerspectiveMonitor } from './perspective-monitor.js';
import { PerspectiveTransformer } from './perspective-transformer.js';
import { checkPerspectiveValidity } from './perspective-validity.js';
import type { CameraBackend, CameraDevice } from './types.js';
import { validateQuad } from './vision-geometry.js';
import type { PerspectiveTarget } from './vision-types.js';

export type { CameraCorrection } from '../contracts.js';
/** Camera, current image correction and identity used by Device and calibration. */
export class CameraSession implements CalibrationVision {
  private correction?: CameraCorrection;
  private target?: PerspectiveTarget;
  private writeChain = Promise.resolve();
  private readonly transformer = new PerspectiveTransformer();
  private readonly perspective = new PerspectiveMonitor({
    file: () => `${this.correctionFile}.validity.json`,
    key: () => this.fingerprint(0, 0),
    correction: () => this.getCorrection(),
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
    return path.join(
      this.directory,
      `${createHash('sha256')
        .update(
          this.screenId
            ? JSON.stringify([this.camera.id, this.screenId])
            : this.camera.id,
        )
        .digest('hex')}.json`,
    );
  }
  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.correctionFile, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    const data = JSON.parse(raw);
    if (data.cameraId !== this.camera.id)
      throw new Error('Stored camera identity does not match');
    this.validate(data.correction);
    this.correction = data.correction;
    if (data.perspectiveTarget) {
      this.validateTarget(data.perspectiveTarget);
      this.target = data.perspectiveTarget;
    }
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
  getCorrection(): CameraCorrection | undefined {
    return this.correction && structuredClone(this.correction);
  }
  getPerspectiveTarget(): PerspectiveTarget | undefined {
    return this.target && structuredClone(this.target);
  }
  private validate(correction: CameraCorrection): void {
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
  private validateTarget(target: PerspectiveTarget): void {
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
  setCorrection(input: CameraCorrection): Promise<void> {
    this.validate(input);
    const correction = structuredClone(input);
    return this.writePerspective(correction, this.target);
  }
  setPerspective(
    input: CameraCorrection,
    target: PerspectiveTarget,
  ): Promise<void> {
    this.validate(input);
    this.validateTarget(target);
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
      await mkdir(this.directory, { recursive: true });
      const temporary = `${this.correctionFile}.${randomUUID()}.tmp`;
      await writeFile(
        temporary,
        JSON.stringify({
          cameraId: this.camera.id,
          correction,
          ...(target ? { perspectiveTarget: target } : {}),
        }),
        { mode: 0o600 },
      );
      await rename(temporary, this.correctionFile);
      this.correction = correction;
      this.target = target;
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
  async checkCorrection(correction: CameraCorrection, jpeg?: Buffer) {
    this.validate(correction);
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
    if (result.state === 'invalid')
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
    this.validate(correction);
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
  ) {
    this.streams = new CameraStreamManager(backend);
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
      if (session) await this.streams.delete(session.stream.id);
      this.owners.delete(cameraId);
      this.sessions.delete(cameraId);
      for (const key of this.screenSessions.keys())
        if (JSON.parse(key)[0] === cameraId) this.screenSessions.delete(key);
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
