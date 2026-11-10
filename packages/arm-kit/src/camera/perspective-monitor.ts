import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import type {
  CameraCorrection,
  PerspectiveValidityCheck,
  PerspectiveValiditySummary,
} from '../contracts.js';
import { RobotArmError } from '../contracts.js';
import { jpegSize } from './jpeg-size.js';
import { PerspectiveValidityTracker } from './perspective-validity-tracker.js';
import { checkPerspectiveValidity } from './perspective-validity.js';
import type { CameraFrame } from './types.js';

const EVIDENCE_MAX_AGE_MS = 30 * 60_000;
const FRAME_MAX_AGE_MS = 2_000;
type Evidence = PerspectiveValidityCheck & { key: string };

function validateFrame(frame: CameraFrame, correction: CameraCorrection) {
  if (
    !Number.isFinite(frame.capturedAt) ||
    Date.now() - frame.capturedAt > FRAME_MAX_AGE_MS ||
    frame.capturedAt > Date.now() + 1000
  )
    throw new RobotArmError(
      'VISION_UNAVAILABLE',
      'A fresh camera frame is required to check the screen outline',
      409,
    );
  const size = jpegSize(frame.jpeg);
  if (
    size.width !== correction.sourceWidth ||
    size.height !== correction.sourceHeight
  )
    throw new RobotArmError(
      'VISION_BINDING_CHANGED',
      'Camera image dimensions changed; repeat correction',
      409,
    );
}

/** One screen's observed evidence, isolated from its measured correction. */
export class PerspectiveMonitor {
  private evidence?: Evidence;
  private tracker = new PerspectiveValidityTracker();
  private pending?: Promise<PerspectiveValidityCheck | undefined>;
  private writes = Promise.resolve();
  private revision = 0;
  private lastPersistedAt = 0;
  constructor(
    private readonly source: {
      file(): string;
      key(): string;
      correction(): CameraCorrection | undefined;
      frame(): Promise<CameraFrame>;
      referenceFrame(): CameraFrame | undefined;
    },
  ) {}
  async load() {
    try {
      const value = JSON.parse(await readFile(this.source.file(), 'utf8'));
      if (
        value.key === this.source.key() &&
        ['valid', 'invalid', 'unverified', 'suspected'].includes(
          value.validity?.state,
        ) &&
        Number.isFinite(value.validity?.driftRatio) &&
        Number.isFinite(Date.parse(value.checkedAt))
      ) {
        this.evidence = value;
        this.lastPersistedAt = Date.parse(value.checkedAt);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  forget() {
    this.revision++;
    this.evidence = undefined;
    this.tracker = new PerspectiveValidityTracker();
  }
  reset() {
    this.forget();
    return this.write(async () => {
      await rm(this.source.file(), { force: true });
    });
  }
  summary(): PerspectiveValiditySummary | undefined {
    const value = this.evidence;
    if (!value || value.key !== this.source.key()) return undefined;
    const ageMs = Math.max(0, Date.now() - Date.parse(value.checkedAt));
    const expired = ageMs > EVIDENCE_MAX_AGE_MS;
    return {
      // A confirmed mismatch is never cleared by a clock or an unreadable frame.
      state:
        expired && value.validity.state !== 'invalid'
          ? 'unverified'
          : value.validity.state,
      confidence: value.validity.confidence,
      reasonCode: value.validity.reasonCode,
      driftRatio: value.validity.driftRatio,
      checkedAt: value.checkedAt,
      ageMs,
      expired,
    };
  }
  private write(work: () => Promise<void>) {
    const task = this.writes.then(work);
    this.writes = task.catch(() => undefined);
    return task;
  }
  check(
    options: { signal?: AbortSignal; maxAgeMs?: number } = {},
  ): Promise<PerspectiveValidityCheck | undefined> {
    options.signal?.throwIfAborted();
    const key = this.source.key();
    const current = this.evidence;
    const reference = this.source.referenceFrame();
    const reusable =
      reference &&
      reference.id === current?.frameId &&
      reference.capturedAt === Date.parse(current.checkedAt) &&
      current?.key === key &&
      Date.now() - Date.parse(current.checkedAt) <= (options.maxAgeMs ?? 0);
    if (!reusable && !this.pending)
      this.pending = this.measure().finally(() => {
        this.pending = undefined;
      });
    const task = reusable ? Promise.resolve(current) : this.pending!;
    return task.then((value) => {
      options.signal?.throwIfAborted();
      if (key !== this.source.key())
        throw new RobotArmError(
          'VISION_BINDING_CHANGED',
          'Camera correction changed during outline verification',
          409,
        );
      return structuredClone(value);
    });
  }
  async assertCurrent() {
    const check = await this.check();
    if ((check?.validity.state ?? this.summary()?.state) === 'invalid')
      throw new RobotArmError(
        'CALIBRATION_MISMATCH',
        'The saved screen outline no longer matches the camera view. Recalibrate before moving.',
        409,
      );
  }
  private async measure(): Promise<PerspectiveValidityCheck | undefined> {
    const correction = this.source.correction();
    if (!correction)
      throw new RobotArmError(
        'MAPPING_REQUIRED',
        'Correct the camera image before calibration',
        409,
      );
    const key = this.source.key();
    const revision = this.revision;
    const latest = await this.source.frame();
    validateFrame(latest, correction);
    const frame = this.source.referenceFrame();
    if (!frame || Date.now() - frame.capturedAt > FRAME_MAX_AGE_MS) return;
    if (frame !== latest) validateFrame(frame, correction);
    const raw = await checkPerspectiveValidity({
      jpeg: frame.jpeg,
      points: correction.points,
      sourceWidth: correction.sourceWidth,
      sourceHeight: correction.sourceHeight,
    });
    if (revision !== this.revision || key !== this.source.key())
      throw new RobotArmError(
        'VISION_BINDING_CHANGED',
        'Camera correction changed during outline verification',
        409,
      );
    const previous = this.evidence?.key === key ? this.evidence : undefined;
    const validity = this.tracker.observe({
      cameraId: 'screen',
      key: JSON.stringify([key, frame.capture]),
      frameId: frame.id,
      at: frame.capturedAt,
      raw,
      previousMismatch:
        previous?.validity.state === 'invalid'
          ? {
              validity: previous.validity,
              at: Date.parse(previous.checkedAt),
              frameId: previous.frameId,
            }
          : undefined,
    });
    const value: Evidence = {
      key,
      validity,
      checkedAt: new Date(frame.capturedAt).toISOString(),
      frameId: frame.id,
    };
    if (
      previous &&
      previous.validity.state === validity.state &&
      previous.validity.reasonCode === validity.reasonCode &&
      Math.abs(previous.validity.driftRatio - validity.driftRatio) < 0.002 &&
      Date.now() - this.lastPersistedAt < 30_000
    ) {
      this.evidence = value;
      return value;
    }
    // Re-reading a cached frame must not count as recovery or refresh its timestamp.
    await this.write(async () => {
      if (revision !== this.revision || key !== this.source.key())
        throw new RobotArmError(
          'VISION_BINDING_CHANGED',
          'Camera correction changed during outline verification',
          409,
        );
      const temporary = `${this.source.file()}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
      await rename(temporary, this.source.file());
      if (revision !== this.revision || key !== this.source.key())
        throw new RobotArmError(
          'VISION_BINDING_CHANGED',
          'Camera correction changed during outline verification',
          409,
        );
      this.evidence = value;
      this.lastPersistedAt = Date.now();
    });
    return value;
  }
}
