import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { CameraStream } from '@midscene/robotics-vision/camera/camera-stream';
import type {
  CameraControlMode,
  CameraControlProperty,
  CameraControlValue,
  CameraDevice,
  CameraHardwareControl,
} from '@midscene/robotics-vision/camera/types';
import type { CalibrationImagingStatus } from '../assisted-contracts.js';
import type { CameraCorrection } from '../contracts.js';
import { RobotArmError } from '../contracts.js';
import {
  type FocusReading,
  type ImagingScreen,
  type LumaMetrics,
  type ToneReading,
  type WhiteBalanceReading,
  classifyExposureExtreme,
  exposureCalibrationScore,
  exposureSeverity,
  exposureTargetDirection,
  isStructuredDarkUiHighlight,
  measureCalibrationExposure,
  measureExposure,
  measureFocus,
  measureTone,
  measureWhiteBalance,
} from './imaging-metrics.js';

export type CameraImagingStatus = CalibrationImagingStatus;

interface StoredCameraControl {
  value: number;
  mode: CameraControlMode;
}

interface StoredScreenImaging {
  screenId: string;
  fingerprint: string;
  focus: { value: number; score: number };
  exposure: { value: number };
  gain?: { value: number };
  whiteBalance?: { value: number };
  brightness?: { value: number };
  contrast?: { value: number };
  warnings?: string[];
  calibratedAt: string;
}

interface LegacyStoredCameraImaging {
  version: 1 | 2 | 3 | 4 | 5 | 6;
  cameraId: string;
  rois: Array<{ screenId: string; fingerprint: string }>;
  focus: { value: number; score: number };
  exposure: { value: number };
  gain?: { value: number };
  whiteBalance?: { value: number };
  brightness?: { value: number };
  contrast?: { value: number };
  original?: Partial<Record<CameraControlProperty, StoredCameraControl>>;
  calibratedAt: string;
}

interface StoredCameraImaging {
  version: 7;
  cameraId: string;
  screens: StoredScreenImaging[];
  original?: Partial<Record<CameraControlProperty, StoredCameraControl>>;
  calibratedAt: string;
}

type AnyStoredCameraImaging = StoredCameraImaging | LegacyStoredCameraImaging;

const SAMPLE_INTERVAL_MS = 1_500;
/** Two matching extreme samples trigger after roughly four seconds. */
const MONITOR_INTERVAL_MS = 2_000;
const ADJUST_COOLDOWN_MS = 3_000;
const SAMPLE_MAX_AGE_MS = 5_000;
const CONSECUTIVE_SAMPLES = 2;
const CAPTURE_SETTLE_MS = 300;
const CAPTURE_TIMEOUT_MS = 2_000;
const MAX_CAPTURE_ITERATIONS = 3;
const MAX_CALIBRATION_EXPOSURE_ITERATIONS = 6;
const MAX_STEP_UNITS = 3;
const CONTROL_SETTLE_MS = 120;
const MARKER_FOCUS_SETTLE_MS = 600;
const MARKER_EXPOSURE_ATTEMPTS = 3;
const WHITE_BALANCE_SETTLE_MS = 350;
const WHITE_BALANCE_SAMPLE_COUNT = 3;
const WHITE_BALANCE_MAX_SCORE = 0.08;
const FOCUS_SETTLE_MS = 180;
const FOCUS_LOCAL_RANGE_FRACTION = 0.04;
const FOCUS_LOCAL_OFFSETS = [0, -1, 1, -2, 2] as const;
const GAIN_CANDIDATES = [8, 16, 24, 32, 48, 64, 96] as const;
const GAIN_RANGE_FRACTIONS = [
  0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64,
] as const;
const BRIGHTNESS_OFFSETS = [-8, -4, 0, 4, 8] as const;
const CONTRAST_OFFSETS = [-16, -8, 0, 8, 16] as const;
const LOCAL_TONE_OFFSETS = [-1, 0, 1] as const;

function autoExposureNumberEnv(
  name: string,
  defaultValue: number,
  minValue: number,
  maxValue = Number.POSITIVE_INFINITY,
) {
  const parsed = Number(process.env[name] ?? defaultValue);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(minValue, Math.min(maxValue, parsed));
}

function resolveExposureWindow(exposure: CameraControlValue) {
  let configuredMin = autoExposureNumberEnv(
    'EXTERNAL_CAMERA_AUTO_EXPOSURE_MIN_VALUE',
    exposure.min,
    -1_000,
    1_000,
  );
  let configuredMax = autoExposureNumberEnv(
    'EXTERNAL_CAMERA_AUTO_EXPOSURE_MAX_VALUE',
    exposure.max,
    -1_000,
    1_000,
  );
  if (configuredMin > configuredMax) {
    configuredMin = exposure.min;
    configuredMax = exposure.max;
  }
  const min = Math.max(exposure.min, configuredMin);
  const max = Math.min(exposure.max, configuredMax);
  return min <= max ? { min, max } : undefined;
}

function resolveFrameSafeExposureWindow(
  exposure: CameraControlValue,
  fps: number,
) {
  const window = resolveExposureWindow(exposure);
  if (!window) return undefined;
  const framePeriodSeconds = 1 / Math.max(1, fps);
  const longestExposure = Math.floor(Math.log2(framePeriodSeconds) + 1e-9);
  const max = Math.min(window.max, longestExposure);
  return max >= window.min ? { min: window.min, max } : undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function uniqueCandidates(values: readonly number[]) {
  return [...new Set(values)];
}

function controlStep(control: CameraControlValue) {
  const step = Math.abs(control.step);
  return Number.isFinite(step) && step > 0
    ? step
    : Math.max(1e-6, (control.max - control.min) / 100);
}

function quantizeControl(value: number, control: CameraControlValue) {
  const step = controlStep(control);
  return clamp(
    control.min + Math.round((value - control.min) / step) * step,
    control.min,
    control.max,
  );
}

function controlCandidates(
  control: CameraControlValue,
  count: number,
  includeValue = true,
) {
  const span = control.max - control.min;
  const values =
    span > 0
      ? Array.from({ length: count }, (_, index) =>
          quantizeControl(
            control.min + (span * index) / Math.max(1, count - 1),
            control,
          ),
        )
      : [control.value];
  if (includeValue)
    values.push(
      quantizeControl(clamp(control.value, control.min, control.max), control),
    );
  return uniqueCandidates(values);
}

function localCandidates(
  control: CameraControlValue,
  value: number,
  stepMultiplier = 1,
) {
  const step = controlStep(control) * stepMultiplier;
  return FOCUS_LOCAL_OFFSETS.map((offset) =>
    quantizeControl(
      clamp(value + offset * step, control.min, control.max),
      control,
    ),
  );
}

function medianValue(values: readonly number[]) {
  if (!values.length) return undefined;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}

/** Automatic focus supplies the starting point; only inspect a small bracket. */
function localFocusCandidates(control: CameraControlValue) {
  const step = controlStep(control);
  const span = Math.max(0, control.max - control.min);
  const coarse = Math.max(
    step,
    Math.ceil((span * FOCUS_LOCAL_RANGE_FRACTION) / step) * step,
  );
  const center = clamp(control.value, control.min, control.max);
  return FOCUS_LOCAL_OFFSETS.map((offset) => {
    const value = clamp(center + offset * coarse, control.min, control.max);
    return control.min + Math.round((value - control.min) / step) * step;
  }).filter(
    (value, index, values) =>
      values.findIndex(
        (other) => Math.abs(other - value) <= Number.EPSILON * 10,
      ) === index,
  );
}

function gainCandidates(control: CameraControlValue) {
  const preferred = GAIN_CANDIDATES.filter(
    (value) => value >= control.min && value <= control.max,
  );
  if (preferred.length > 0) return preferred;
  const span = control.max - control.min;
  if (!(span > 0)) return [];
  return GAIN_RANGE_FRACTIONS.map((fraction) =>
    quantizeControl(control.min + span * fraction, control),
  );
}

function storedControl(
  control?: CameraControlValue,
): StoredCameraControl | undefined {
  return control ? { value: control.value, mode: control.mode } : undefined;
}

function distancePenalty(
  value: number,
  origin: number,
  range: { min: number; max: number },
  weight: number,
) {
  return (
    (Math.abs(value - origin) / Math.max(1, range.max - range.min)) * weight
  );
}

function correctionFingerprint(screen: ImagingScreen) {
  return createHash('sha256')
    .update(JSON.stringify([screen.screenId, screen.correction]))
    .digest('hex');
}

export function cameraImagingFile(directory: string, cameraId: string) {
  return path.join(
    directory,
    `${createHash('sha256').update(cameraId).digest('hex')}.imaging.json`,
  );
}

async function writeCameraImagingFile(
  directory: string,
  cameraId: string,
  stored: StoredCameraImaging,
) {
  await mkdir(directory, { recursive: true });
  const file = cameraImagingFile(directory, cameraId);
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(stored, null, 2), {
    mode: 0o600,
  });
  await rename(temporary, file);
}

export async function removeCameraImagingScreen(
  directory: string,
  cameraId: string,
  screenId: string,
) {
  const file = cameraImagingFile(directory, cameraId);
  let stored: AnyStoredCameraImaging;
  try {
    stored = JSON.parse(await readFile(file, 'utf8')) as AnyStoredCameraImaging;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (stored.cameraId !== cameraId) return;
  if (stored.version !== 7) {
    await rm(file, { force: true });
    return;
  }
  const screens = stored.screens.filter(
    (profile) => profile.screenId !== screenId,
  );
  if (!screens.length) {
    await rm(file, { force: true });
    return;
  }
  await writeCameraImagingFile(directory, cameraId, {
    ...stored,
    screens,
    calibratedAt: new Date().toISOString(),
  });
}

export class CameraImagingController {
  private readonly registered = new Map<
    string,
    () => CameraCorrection | undefined
  >();
  private monitor?: ReturnType<typeof setInterval>;
  private statusValue: CameraImagingStatus = { state: 'idle' };
  private stored?: StoredCameraImaging;
  private activeScreenId?: string;
  private applied = false;
  private adjusting = false;
  private captureInProgress = false;
  private lastAdjustAt = 0;
  private lastSampleAt = 0;
  private extremeDirection?: 'too-bright' | 'too-dark';
  private extremeCount = 0;
  private darkModeUntil = 0;
  private closed = false;
  private imagingOperation = Promise.resolve();
  private readonly markerImagingScope = new AsyncLocalStorage<true>();
  private calibratingScreens = new Set<string>();
  private pendingCalibrations = new Map<string, Set<string>>();
  private screenErrors = new Map<string, string>();
  private unsupported = false;

  constructor(
    readonly camera: CameraDevice,
    private readonly stream: CameraStream,
    private readonly directory: string,
    private controls?: CameraHardwareControl,
    private readonly controlFactory?: () => Promise<
      CameraHardwareControl | undefined
    >,
  ) {}

  registerScreen(
    screenId: string,
    correction: () => CameraCorrection | undefined,
  ) {
    this.registered.set(screenId, correction);
  }

  async rebindPerspective(screenId: string, correction: CameraCorrection) {
    if (!this.stored) return;
    const profile = this.stored.screens.find(
      (entry) => entry.screenId === screenId,
    );
    if (!profile) return;
    profile.fingerprint = correctionFingerprint({ screenId, correction });
    await this.persist(this.stored);
  }

  status(screenId?: string): CameraImagingStatus {
    const requested = screenId ?? this.activeScreenId;
    if (
      requested &&
      this.calibratingScreens.has(requested) &&
      !['idle', 'released', 'ready', 'unsupported'].includes(
        this.statusValue.state,
      )
    )
      return {
        ...this.statusValue,
        screenId: requested,
        active: requested === this.activeScreenId && this.applied,
      };
    if (requested && this.hasPendingCalibration(requested))
      return {
        state: 'exposure',
        screenId: requested,
        active: requested === this.activeScreenId && this.applied,
        message: 'Preparing the camera imaging pattern',
        updatedAt: Date.now(),
      };
    if (requested) {
      if (this.unsupported)
        return {
          state: 'unsupported',
          screenId: requested,
          active: false,
          message: 'This camera does not expose focus and exposure controls',
          updatedAt: Date.now(),
        };
      const error = this.screenErrors.get(requested);
      if (error)
        return {
          state: 'error',
          screenId: requested,
          active: false,
          message: error,
          updatedAt: Date.now(),
        };
      const correction = this.registered.get(requested)?.();
      const profile = this.stored?.screens.find(
        (entry) => entry.screenId === requested,
      );
      if (!correction)
        return {
          state: 'unconfigured',
          screenId: requested,
          active: false,
          message: 'No camera mapping is available for this screen',
          updatedAt: Date.now(),
        };
      if (
        !profile ||
        profile.fingerprint !==
          correctionFingerprint({ screenId: requested, correction })
      )
        return {
          state: 'unconfigured',
          screenId: requested,
          active: false,
          message: 'Calibrate camera imaging for this screen',
          updatedAt: Date.now(),
        };
      return {
        state: 'ready',
        screenId: requested,
        active: requested === this.activeScreenId && this.applied,
        focus: profile.focus.value,
        exposure: profile.exposure.value,
        ...(profile.gain ? { gain: profile.gain.value } : {}),
        ...(profile.whiteBalance
          ? { whiteBalance: profile.whiteBalance.value }
          : {}),
        ...(profile.brightness ? { brightness: profile.brightness.value } : {}),
        ...(profile.contrast ? { contrast: profile.contrast.value } : {}),
        message: profile.warnings?.length
          ? profile.warnings.join('; ')
          : undefined,
        updatedAt: Date.parse(profile.calibratedAt) || undefined,
      };
    }
    return {
      ...this.statusValue,
      ...(this.activeScreenId
        ? {
            screenId: this.activeScreenId,
            active: this.applied,
          }
        : {}),
    };
  }

  /** Mark background calibration active before waiting for phone patterns. */
  beginScreensCalibration(screenIds: readonly string[]) {
    const token = randomUUID();
    const requested = new Set(screenIds);
    this.pendingCalibrations.set(token, requested);
    this.unsupported = false;
    for (const screenId of requested) this.screenErrors.delete(screenId);
    this.statusValue = {
      state: 'exposure',
      message: 'Preparing the camera imaging pattern',
      updatedAt: Date.now(),
    };
    return token;
  }

  /** Publish failures that happen before `calibrateScreens()` is entered. */
  failScreensCalibration(
    token: string,
    screenIds: readonly string[],
    error: unknown,
  ) {
    const message = error instanceof Error ? error.message : String(error);
    this.pendingCalibrations.delete(token);
    for (const screenId of new Set(screenIds))
      this.screenErrors.set(screenId, message);
    this.statusValue = {
      state: 'error',
      message,
      updatedAt: Date.now(),
    };
  }

  private hasPendingCalibration(screenId: string) {
    for (const screens of this.pendingCalibrations.values())
      if (screens.has(screenId)) return true;
    return false;
  }

  async load(): Promise<void> {
    try {
      const value = JSON.parse(
        await readFile(
          cameraImagingFile(this.directory, this.camera.id),
          'utf8',
        ),
      ) as AnyStoredCameraImaging;
      if (
        !value ||
        typeof value !== 'object' ||
        value.cameraId !== this.camera.id
      )
        return;
      if (value.version === 7) {
        if (
          !Array.isArray(value.screens) ||
          value.screens.some(
            (screen) =>
              !screen ||
              typeof screen.screenId !== 'string' ||
              typeof screen.fingerprint !== 'string' ||
              !Number.isFinite(screen.focus?.value) ||
              !Number.isFinite(screen.exposure?.value) ||
              !screen.calibratedAt,
          )
        )
          return;
        this.stored = value;
        this.statusValue = { state: 'idle', updatedAt: Date.now() };
        return;
      }
      if (
        !([1, 2, 3, 4, 5, 6] as const).includes(value.version) ||
        !Array.isArray(value.rois) ||
        !Number.isFinite(value.focus?.value) ||
        !Number.isFinite(value.exposure?.value)
      )
        return;
      // Version 5 could persist a clipped white-balance and tone result.
      if (value.version === 5) return;
      const original = value.original;
      if (value.rois.length === 1) {
        const roi = value.rois[0]!;
        this.stored = {
          version: 7,
          cameraId: value.cameraId,
          screens: [
            {
              screenId: roi.screenId,
              fingerprint: roi.fingerprint,
              focus: { ...value.focus },
              exposure: { ...value.exposure },
              ...(value.gain ? { gain: { ...value.gain } } : {}),
              ...(value.whiteBalance
                ? { whiteBalance: { ...value.whiteBalance } }
                : {}),
              ...(value.brightness
                ? { brightness: { ...value.brightness } }
                : {}),
              ...(value.contrast ? { contrast: { ...value.contrast } } : {}),
              calibratedAt: value.calibratedAt,
            },
          ],
          ...(original ? { original } : {}),
          calibratedAt: value.calibratedAt,
        };
        await this.persist(this.stored);
      } else {
        // A shared multi-screen profile cannot be split into valid per-screen
        // values. Preserve the original state while requiring recalibration.
        this.stored = {
          version: 7,
          cameraId: value.cameraId,
          screens: [],
          ...(original ? { original } : {}),
          calibratedAt: value.calibratedAt,
        };
      }
      this.statusValue = { state: 'idle', updatedAt: Date.now() };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.statusValue = {
          state: 'error',
          message: error instanceof Error ? error.message : String(error),
          updatedAt: Date.now(),
        };
    }
  }

  private screens(): ImagingScreen[] {
    const screens: ImagingScreen[] = [];
    for (const [screenId, read] of this.registered) {
      const correction = read();
      if (correction) screens.push({ screenId, correction });
    }
    return screens;
  }

  private screenList(screenIds?: readonly string[]) {
    const requested = screenIds?.length ? new Set(screenIds) : undefined;
    return this.screens().filter(
      (screen) => !requested || requested.has(screen.screenId),
    );
  }

  private async preset(): Promise<{
    exposure: CameraControlValue;
    focus: CameraControlValue;
  }> {
    const controls = await this.ensureControls();
    const values = await controls.read();
    if (!values.exposure?.supportsManual || !values.focus?.supportsManual)
      throw new RobotArmError(
        'VISION_UNAVAILABLE',
        'This camera does not support automatic imaging control',
        409,
      );
    return {
      exposure: values.exposure,
      focus: values.focus,
    };
  }

  private async getControls(): Promise<CameraHardwareControl | undefined> {
    if (!this.controls && this.controlFactory) {
      try {
        this.controls = await this.controlFactory();
      } catch (error) {
        throw new RobotArmError(
          'VISION_UNAVAILABLE',
          `Camera imaging control failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          409,
        );
      }
    }
    return this.controls;
  }

  private async discardControls(controls: CameraHardwareControl) {
    if (this.controls === controls) this.controls = undefined;
    await controls.close().catch(() => undefined);
  }

  private async ensureControls(): Promise<CameraHardwareControl> {
    const controls = await this.getControls();
    if (controls) return controls;
    throw new RobotArmError(
      'VISION_UNAVAILABLE',
      'This camera does not expose imaging controls',
      409,
    );
  }

  private setUnsupported(): CameraImagingStatus {
    this.unsupported = true;
    this.statusValue = {
      state: 'unsupported',
      message: 'This camera does not expose focus and exposure controls',
      updatedAt: Date.now(),
    };
    return this.status();
  }

  private async readManualControls() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controls = await this.getControls();
      if (!controls) return undefined;
      try {
        const { focus, exposure } = await controls.read();
        if (!focus?.supportsManual || !exposure?.supportsManual)
          return undefined;
        return { controls, values: { focus, exposure } };
      } catch (error) {
        if (attempt > 0) throw error;
        await this.discardControls(controls);
      }
    }
    return undefined;
  }

  private runImagingOperation<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.imagingOperation.then(work);
    this.imagingOperation = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    return this.runImagingOperation(work);
  }

  /** Tune the painted marker scene before a screen ROI exists. */
  withMarkerImaging<T>(capture: () => Promise<T>): Promise<T> {
    if (this.markerImagingScope.getStore()) return capture();
    return this.runImagingOperation(() =>
      this.markerImagingScope.run(true, async () => {
        if (this.closed || this.captureInProgress || this.adjusting)
          return capture();
        this.captureInProgress = true;
        let restore: (() => Promise<void>) | undefined;
        try {
          try {
            const controls = await this.getControls();
            if (controls) {
              const { focus, exposure } = await controls.read();
              const original: Partial<
                Record<CameraControlProperty, StoredCameraControl>
              > = {};
              restore = async () => {
                if (await this.restoreControls(controls, original)) return;
                this.applied = false;
                this.stopMonitor();
                this.statusValue = {
                  state: 'error',
                  message:
                    'Could not restore camera controls after marker capture',
                  updatedAt: Date.now(),
                };
              };
              let focusStarted = 0;
              if (focus?.supportsAuto && focus.mode === 'manual') {
                original.focus = focus;
                await controls.set('focus', focus.value, 'auto');
                focusStarted = Date.now();
              }
              if (exposure?.supportsManual)
                await this.adjustMarkerExposure(controls, exposure, () => {
                  original.exposure = exposure;
                });
              if (focusStarted)
                await delay(
                  Math.max(
                    0,
                    MARKER_FOCUS_SETTLE_MS - (Date.now() - focusStarted),
                  ),
                );
            }
          } catch {
            // Unsupported or interrupted controls must still allow a marker scan.
            await restore?.();
            restore = undefined;
          }
          return await capture();
        } finally {
          await restore?.();
          this.captureInProgress = false;
        }
      }),
    );
  }

  private async adjustMarkerExposure(
    controls: CameraHardwareControl,
    exposure: CameraControlValue,
    beforeChange: () => void,
  ) {
    const window = resolveFrameSafeExposureWindow(
      exposure,
      this.stream.getInfo().fps,
    );
    if (!window) return;
    let value = exposure.value;
    let previousDirection = 0;
    let best = { value, score: Number.POSITIVE_INFINITY };
    for (let attempt = 0; attempt <= MARKER_EXPOSURE_ATTEMPTS; attempt++) {
      const { full } = await measureExposure(await this.freshFrame(750), []);
      // The white marker pages typically occupy the bright end of the frame.
      // Use a percentile so a small specular reflection does not drive exposure.
      const score = Math.abs(full.p95 - 205) + Math.max(0, full.p95 - 235);
      if (score < best.score) best = { value, score };
      const direction = full.p95 > 235 ? -1 : full.p95 < 155 ? 1 : 0;
      if (
        !direction ||
        (previousDirection && direction !== previousDirection) ||
        attempt === MARKER_EXPOSURE_ATTEMPTS
      )
        break;
      const next = clamp(
        value + direction * Math.max(1, Math.abs(exposure.step)),
        window.min,
        window.max,
      );
      if (next === value) break;
      beforeChange();
      await controls.set('exposure', next, 'manual');
      value = next;
      previousDirection = direction;
      await delay(CONTROL_SETTLE_MS);
    }
    if (best.value !== value) {
      await controls.set('exposure', best.value, 'manual');
      await delay(CONTROL_SETTLE_MS);
    }
  }

  releaseForCorrection(screenId?: string): Promise<void> {
    if (this.markerImagingScope.getStore())
      return this.releaseForCorrectionUnlocked(screenId);
    return this.runImagingOperation(() =>
      this.releaseForCorrectionUnlocked(screenId),
    );
  }

  private async releaseForCorrectionUnlocked(screenId?: string) {
    const scope = screenId ?? this.activeScreenId;
    if (scope && this.activeScreenId && scope !== this.activeScreenId) {
      this.screenErrors.delete(scope);
      return;
    }
    this.stopMonitor();
    this.applied = false;
    this.extremeDirection = undefined;
    this.extremeCount = 0;
    try {
      const reading = await this.readManualControls();
      if (!reading) {
        this.setUnsupported();
        return;
      }
      const { controls } = reading;
      const current = await controls.read();
      if (this.stored?.original) {
        await this.restoreControls(controls, this.stored.original);
      } else {
        if (current.focus?.supportsAuto)
          await controls.set('focus', current.focus.value, 'auto');
        if (current.exposure?.supportsAuto)
          await controls.set('exposure', current.exposure.value, 'auto');
        if (current.whiteBalance?.supportsAuto)
          await controls.set(
            'whiteBalance',
            current.whiteBalance.value,
            'auto',
          );
      }
    } catch (error) {
      this.statusValue = {
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now(),
      };
      return;
    }
    this.activeScreenId = undefined;
    this.statusValue = {
      state: 'released',
      message:
        'Camera imaging controls are released for perspective correction',
      updatedAt: Date.now(),
    };
  }

  async clearPerspectiveBinding(screenId?: string): Promise<void> {
    await this.clearScreenBinding(screenId ?? this.camera.id);
  }

  async clearScreenBinding(screenId: string): Promise<void> {
    if (this.markerImagingScope.getStore())
      return this.clearScreenBindingUnlocked(screenId);
    await this.enqueue(() => this.clearScreenBindingUnlocked(screenId));
  }

  private async clearScreenBindingUnlocked(screenId: string) {
    if (!this.stored) return;
    if (this.activeScreenId === screenId)
      await this.releaseForCorrectionUnlocked(screenId);
    this.stored.screens = this.stored.screens.filter(
      (profile) => profile.screenId !== screenId,
    );
    this.screenErrors.delete(screenId);
    this.calibratingScreens.delete(screenId);
    if (!this.stored.screens.length) {
      this.stored = undefined;
      await rm(cameraImagingFile(this.directory, this.camera.id), {
        force: true,
      });
      return;
    }
    this.stored.calibratedAt = new Date().toISOString();
    await this.persist(this.stored);
    if (this.activeScreenId === screenId && this.stored.screens.length === 0)
      this.activeScreenId = undefined;
  }

  async resumeStored(screenId?: string): Promise<void> {
    if (!this.stored?.screens.length) return;
    const profile =
      this.stored.screens.find((entry) => entry.screenId === screenId) ??
      this.stored.screens[0];
    if (profile) await this.activateScreen(profile.screenId);
  }

  async activateScreen(screenId: string): Promise<CameraImagingStatus> {
    return this.enqueue(async () => {
      await this.activateScreenUnlocked(screenId);
      return this.status(screenId);
    });
  }

  private async activateScreenUnlocked(screenId: string) {
    this.screenErrors.delete(screenId);
    if (this.activeScreenId === screenId && this.applied) return;
    if (this.activeScreenId && this.activeScreenId !== screenId) {
      this.stopMonitor();
      this.applied = false;
    }
    const correction = this.registered.get(screenId)?.();
    const profile = this.stored?.screens.find(
      (entry) => entry.screenId === screenId,
    );
    const valid =
      correction &&
      profile &&
      profile.fingerprint === correctionFingerprint({ screenId, correction });
    const controls = await this.getControls();
    if (!controls) {
      this.setUnsupported();
      return;
    }
    if (!valid) {
      this.activeScreenId = screenId;
      await this.releaseForCorrectionUnlocked(screenId);
      this.statusValue = {
        state: 'unconfigured',
        screenId,
        active: false,
        message: 'Calibrate camera imaging for this screen',
        updatedAt: Date.now(),
      };
      return;
    }
    try {
      await controls.set('exposure', profile.exposure.value, 'manual');
      await controls.set('focus', profile.focus.value, 'manual');
      for (const [property, value] of [
        ['gain', profile.gain?.value],
        ['whiteBalance', profile.whiteBalance?.value],
        ['brightness', profile.brightness?.value],
        ['contrast', profile.contrast?.value],
      ] as const) {
        if (value === undefined) continue;
        const control = (await controls.read())[property];
        if (control?.supportsManual)
          await controls.set(property, value, 'manual');
      }
      await delay(FOCUS_SETTLE_MS);
      this.activeScreenId = screenId;
      this.applied = true;
      this.extremeDirection = undefined;
      this.extremeCount = 0;
      this.darkModeUntil = 0;
      this.statusValue = {
        ...this.status(screenId),
        active: true,
        updatedAt: Date.now(),
      };
      this.startMonitor();
    } catch (error) {
      this.applied = false;
      this.screenErrors.set(
        screenId,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async calibrate(screenId?: string): Promise<CameraImagingStatus> {
    return this.calibrateScreens(screenId ? [screenId] : undefined);
  }

  async calibrateScreens(
    screenIds?: readonly string[],
    calibrationToken?: string,
  ): Promise<CameraImagingStatus> {
    return this.enqueue(async () => {
      const screens = this.screenList(screenIds);
      if (!screens.length)
        throw new RobotArmError(
          'MAPPING_REQUIRED',
          'Perspective correction is required before camera imaging calibration',
          409,
        );
      if (calibrationToken) this.pendingCalibrations.delete(calibrationToken);
      this.calibratingScreens = new Set(
        screens.map((screen) => screen.screenId),
      );
      for (const screenId of this.calibratingScreens)
        this.screenErrors.delete(screenId);
      try {
        return screens.length === 1
          ? await this.calibrateSingle(screens)
          : await this.calibrateMany(screens);
      } finally {
        this.calibratingScreens.clear();
        if (calibrationToken) this.pendingCalibrations.delete(calibrationToken);
      }
    });
  }

  private async calibrateSingle(
    screens: readonly ImagingScreen[],
  ): Promise<CameraImagingStatus> {
    if (!screens.length)
      throw new RobotArmError(
        'MAPPING_REQUIRED',
        'Perspective correction is required before camera imaging calibration',
        409,
      );
    const reading = await this.readManualControls().catch((error) => {
      this.statusValue = {
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now(),
      };
      throw error;
    });
    if (!reading) return this.setUnsupported();
    const { controls } = reading;
    this.unsupported = false;

    this.stopMonitor();
    this.applied = false;
    this.statusValue = {
      state: 'exposure',
      message: 'Calibrating exposure',
      updatedAt: Date.now(),
    };
    const original = await controls.read();
    const warnings: string[] = [];
    try {
      const preset = await this.preset();
      await controls.set(
        'exposure',
        clamp(preset.exposure.value, preset.exposure.min, preset.exposure.max),
        'manual',
      );
      await controls.set('focus', preset.focus.value, 'auto');
      if (original.gain?.supportsManual)
        await controls.set('gain', original.gain.default, 'manual');
      if (original.brightness?.supportsManual)
        await controls.set('brightness', original.brightness.default, 'manual');
      if (original.contrast?.supportsManual)
        await controls.set('contrast', original.contrast.default, 'manual');
      await delay(CONTROL_SETTLE_MS);

      const exposure = await this.optimizeExposureAndGain(screens);
      const gain = original.gain?.supportsManual
        ? (await controls.read()).gain
        : undefined;

      this.statusValue = {
        state: 'tone',
        exposure: exposure?.value,
        gain: gain?.value,
        message: 'Balancing brightness and contrast across all screens',
        updatedAt: Date.now(),
      };
      const tone = await this.tuneBrightnessAndContrast(screens);
      if (!tone) warnings.push('Brightness and contrast could not be measured');

      this.statusValue = {
        state: 'white-balance',
        exposure: exposure?.value,
        gain: gain?.value,
        message: 'Locking white balance from neutral screen patches',
        updatedAt: Date.now(),
      };
      const whiteBalance = await this.searchWhiteBalance(screens);
      if (!whiteBalance)
        warnings.push('White balance could not be measured from the screen');

      this.statusValue = {
        state: 'focus',
        exposure: exposure?.value,
        gain: gain?.value,
        ...(whiteBalance ? { whiteBalance: whiteBalance.value } : {}),
        message: 'Adjusting camera parameters across all screen ROIs',
        updatedAt: Date.now(),
      };
      const autoFocus = (await controls.read()).focus;
      if (!autoFocus) throw new Error('Focus control is unavailable');
      const autoFrame = await this.freshFrame();
      const baseline = await measureFocus(autoFrame, screens);
      const focus = await this.searchFocus(autoFocus, screens);
      const focusWarnings: string[] = [];
      if (focus.value === focus.min || focus.value === focus.max)
        focusWarnings.push(
          'The best shared focus lies at the hardware boundary',
        );
      if (baseline.score > 0 && focus.score < baseline.score * 0.9)
        focusWarnings.push(
          'The ROI did not improve over the automatic focus baseline',
        );
      warnings.push(...focusWarnings);

      let finalControls = await controls.read();
      if (finalControls.focus?.mode !== 'manual')
        await controls.set('focus', focus.value, 'manual');
      if (finalControls.exposure?.mode !== 'manual')
        await controls.set(
          'exposure',
          finalControls.exposure?.value ??
            exposure?.value ??
            preset.exposure.value,
          'manual',
        );
      const optionalProperties = [
        'gain',
        ...(whiteBalance ? (['whiteBalance'] as const) : []),
        ...(tone ? (['brightness', 'contrast'] as const) : []),
      ] as const;
      for (const property of optionalProperties) {
        const control = finalControls[property];
        if (control?.supportsManual && control.mode !== 'manual')
          await controls.set(property, control.value, 'manual');
      }
      finalControls = await controls.read();
      const finalFocus = finalControls.focus;
      const finalExposure = finalControls.exposure;
      if (!finalFocus || finalFocus.mode !== 'manual')
        throw new RobotArmError(
          'VISION_UNAVAILABLE',
          'The camera did not keep focus in manual mode after calibration',
          409,
        );
      if (!finalExposure || finalExposure.mode !== 'manual')
        throw new RobotArmError(
          'VISION_UNAVAILABLE',
          'The camera did not keep exposure in manual mode after calibration',
          409,
        );
      const finalTone = await measureTone(await this.freshFrame(), screens);
      if (finalTone && !finalTone.monotonic)
        warnings.push('The calibrated grayscale bars are not monotonic');
      if (finalTone && finalTone.white > 247)
        warnings.push('The white calibration bar remains clipped');
      const screen = screens[0]!;
      const profile: StoredScreenImaging = {
        screenId: screen.screenId,
        fingerprint: correctionFingerprint(screen),
        focus: { value: focus.value, score: focus.score },
        exposure: { value: finalExposure.value },
        ...(finalControls.gain
          ? { gain: { value: finalControls.gain.value } }
          : {}),
        ...(finalControls.whiteBalance
          ? { whiteBalance: { value: finalControls.whiteBalance.value } }
          : {}),
        ...(finalControls.brightness
          ? { brightness: { value: finalControls.brightness.value } }
          : {}),
        ...(finalControls.contrast
          ? { contrast: { value: finalControls.contrast.value } }
          : {}),
        warnings,
        calibratedAt: new Date().toISOString(),
      };
      const stored: StoredCameraImaging = {
        version: 7,
        cameraId: this.camera.id,
        screens: [
          ...(this.stored?.screens.filter(
            (entry) => entry.screenId !== screen.screenId,
          ) ?? []),
          profile,
        ],
        original:
          this.stored?.original ??
          Object.fromEntries(
            Object.entries(original).flatMap(([property, control]) => {
              const value = storedControl(control);
              return value ? [[property as CameraControlProperty, value]] : [];
            }),
          ),
        calibratedAt: new Date().toISOString(),
      };
      await this.persist(stored);
      this.stored = stored;
      this.activeScreenId = screen.screenId;
      this.applied = true;
      this.screenErrors.delete(screen.screenId);
      this.statusValue = {
        state: 'ready',
        screenId: screen.screenId,
        active: true,
        focus: focus.value,
        exposure: finalExposure.value,
        ...(finalControls.gain ? { gain: finalControls.gain.value } : {}),
        ...(finalControls.whiteBalance
          ? { whiteBalance: finalControls.whiteBalance.value }
          : {}),
        ...(finalControls.brightness
          ? { brightness: finalControls.brightness.value }
          : {}),
        ...(finalControls.contrast
          ? { contrast: finalControls.contrast.value }
          : {}),
        message: warnings.length
          ? `Camera imaging locked with warning: ${warnings.join('; ')}`
          : 'Focus, exposure, white balance and tone locked',
        updatedAt: Date.now(),
      };
      this.startMonitor();
      return this.status(screen.screenId);
    } catch (error) {
      try {
        await this.restoreControls(controls, original);
      } catch {
        // The primary calibration error is more actionable than rollback failure.
      }
      this.statusValue = {
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now(),
      };
      throw error;
    }
  }

  private async calibrateMany(
    screens: readonly ImagingScreen[],
  ): Promise<CameraImagingStatus> {
    const reading = await this.readManualControls().catch((error) => {
      this.statusValue = {
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now(),
      };
      throw error;
    });
    if (!reading) return this.setUnsupported();
    const { controls } = reading;
    this.unsupported = false;

    this.stopMonitor();
    this.applied = false;
    this.statusValue = {
      state: 'exposure',
      message: `Calibrating ${screens.length} screens together`,
      updatedAt: Date.now(),
    };
    const original = await controls.read();
    try {
      const preset = await this.preset();
      await controls.set(
        'exposure',
        clamp(preset.exposure.value, preset.exposure.min, preset.exposure.max),
        'manual',
      );
      await controls.set('focus', preset.focus.value, 'auto');
      if (original.gain?.supportsManual)
        await controls.set('gain', original.gain.default, 'manual');
      if (original.brightness?.supportsManual)
        await controls.set('brightness', original.brightness.default, 'manual');
      if (original.contrast?.supportsManual)
        await controls.set('contrast', original.contrast.default, 'manual');
      await delay(CONTROL_SETTLE_MS);

      const exposure = await this.optimizeExposureForScreens(screens);
      const exposureValues = screens.flatMap((screen) => {
        const result = exposure.get(screen.screenId);
        return result ? [result.exposure] : [];
      });
      const commonExposure =
        medianValue(exposureValues) ?? preset.exposure.value;
      await controls.set('exposure', commonExposure, 'manual');
      if (original.gain?.supportsManual)
        await controls.set('gain', original.gain.default, 'manual');

      this.statusValue = {
        state: 'tone',
        exposure: commonExposure,
        message: 'Scoring brightness and contrast for every screen',
        updatedAt: Date.now(),
      };
      const tone = await this.tuneToneForScreens(screens);
      const brightnessValues = screens.flatMap((screen) => {
        const result = tone.get(screen.screenId);
        return result?.brightness === undefined ? [] : [result.brightness];
      });
      const contrastValues = screens.flatMap((screen) => {
        const result = tone.get(screen.screenId);
        return result?.contrast === undefined ? [] : [result.contrast];
      });
      if (original.brightness?.supportsManual && brightnessValues.length)
        await controls.set(
          'brightness',
          medianValue(brightnessValues)!,
          'manual',
        );
      if (original.contrast?.supportsManual && contrastValues.length)
        await controls.set('contrast', medianValue(contrastValues)!, 'manual');

      this.statusValue = {
        state: 'white-balance',
        exposure: commonExposure,
        message: 'Scoring white balance for every screen',
        updatedAt: Date.now(),
      };
      const whiteBalance = await this.searchWhiteBalanceForScreens(screens);
      const whiteBalanceValues = screens.flatMap((screen) => {
        const value = whiteBalance.get(screen.screenId);
        return value === undefined ? [] : [value];
      });
      if (original.whiteBalance?.supportsManual && whiteBalanceValues.length)
        await controls.set(
          'whiteBalance',
          medianValue(whiteBalanceValues)!,
          'manual',
        );

      this.statusValue = {
        state: 'focus',
        exposure: commonExposure,
        message: 'Scoring focus across every screen ROI',
        updatedAt: Date.now(),
      };
      const focus = await this.searchFocusForScreens(screens);
      const focusValues = screens.flatMap((screen) => {
        const result = focus.get(screen.screenId);
        return result ? [result.value] : [];
      });
      const commonFocus = medianValue(focusValues);
      if (commonFocus !== undefined)
        await controls.set('focus', commonFocus, 'manual');

      const previousOriginal = this.stored?.original;
      const calibratedAt = new Date().toISOString();
      const profiles: StoredScreenImaging[] = screens.flatMap((screen) => {
        const exposureResult = exposure.get(screen.screenId);
        const focusResult = focus.get(screen.screenId);
        if (!exposureResult || !focusResult) return [];
        const toneResult = tone.get(screen.screenId);
        const whiteBalanceValue = whiteBalance.get(screen.screenId);
        const warnings: string[] = [];
        if (
          focusResult.value === focusResult.min ||
          focusResult.value === focusResult.max
        )
          warnings.push('The best focus lies at the hardware boundary');
        if (!toneResult)
          warnings.push('Brightness and contrast could not be measured');
        else if (!toneResult.monotonic)
          warnings.push('The calibrated grayscale bars are not monotonic');
        if (
          original.whiteBalance?.supportsManual &&
          whiteBalanceValue === undefined
        )
          warnings.push('White balance will use the automatic value');
        return [
          {
            screenId: screen.screenId,
            fingerprint: correctionFingerprint(screen),
            focus: {
              value: focusResult.value,
              score: focusResult.score,
            },
            exposure: { value: exposureResult.exposure },
            ...(original.gain?.supportsManual
              ? {
                  gain: {
                    value: exposureResult.gain ?? original.gain.default,
                  },
                }
              : {}),
            ...(whiteBalanceValue !== undefined
              ? { whiteBalance: { value: whiteBalanceValue } }
              : {}),
            ...(toneResult?.brightness !== undefined &&
            original.brightness?.supportsManual
              ? { brightness: { value: toneResult.brightness } }
              : {}),
            ...(toneResult?.contrast !== undefined &&
            original.contrast?.supportsManual
              ? { contrast: { value: toneResult.contrast } }
              : {}),
            ...(warnings.length ? { warnings } : {}),
            calibratedAt,
          },
        ];
      });
      const calibratedIds = new Set(
        profiles.map((profile) => profile.screenId),
      );
      for (const screen of screens)
        if (!calibratedIds.has(screen.screenId))
          this.screenErrors.set(
            screen.screenId,
            'Camera imaging did not produce a complete profile for this screen',
          );
      const stored: StoredCameraImaging = {
        version: 7,
        cameraId: this.camera.id,
        screens: [
          ...(this.stored?.screens.filter(
            (profile) => !calibratedIds.has(profile.screenId),
          ) ?? []),
          ...profiles,
        ],
        original:
          previousOriginal ??
          Object.fromEntries(
            Object.entries(original).flatMap(([property, control]) => {
              const value = storedControl(control);
              return value ? [[property as CameraControlProperty, value]] : [];
            }),
          ),
        calibratedAt,
      };
      await this.persist(stored);
      this.stored = stored;

      const activeId =
        this.activeScreenId && calibratedIds.has(this.activeScreenId)
          ? this.activeScreenId
          : profiles[0]?.screenId;
      if (!activeId) return this.status();
      await this.activateScreenUnlocked(activeId);
      return this.status(activeId);
    } catch (error) {
      try {
        await this.restoreControls(controls, this.stored?.original ?? original);
      } catch {
        // Keep the primary calibration error.
      }
      this.statusValue = {
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now(),
      };
      throw error;
    }
  }

  private async optimizeExposureForScreens(screens: readonly ImagingScreen[]) {
    const controls = await this.ensureControls();
    const values = await controls.read();
    const exposure = values.exposure;
    if (!exposure?.supportsManual)
      throw new RobotArmError(
        'VISION_UNAVAILABLE',
        'This camera does not support manual exposure control',
        409,
      );
    const gain = values.gain;
    if (gain?.supportsManual)
      await controls.set('gain', gain.default, 'manual');
    const window = resolveFrameSafeExposureWindow(
      exposure,
      this.stream.getInfo().fps,
    ) ?? { min: exposure.min, max: exposure.max };
    const seen = new Set<number>();
    const best = new Map<
      string,
      { exposure: number; score: number; metrics: LumaMetrics }
    >();
    const evaluate = async (value: number) => {
      const quantized = quantizeControl(value, exposure);
      const key = clamp(quantized, window.min, window.max);
      if (seen.has(key)) return;
      seen.add(key);
      await controls.set('exposure', key, 'manual');
      await delay(CONTROL_SETTLE_MS);
      const reading = await this.calibrationExposureForScreens(screens);
      for (const screen of reading.screenReadings) {
        const score =
          exposureCalibrationScore(screen.metrics) +
          distancePenalty(key, exposure.value, window, 0.02);
        const current = best.get(screen.screenId);
        if (!current || score < current.score - 1e-9)
          best.set(screen.screenId, {
            exposure: key,
            score,
            metrics: screen.metrics,
          });
      }
    };
    for (const value of controlCandidates(exposure, 9))
      if (value >= window.min && value <= window.max) await evaluate(value);

    const fine = uniqueCandidates(
      [...best.values()].flatMap((result) =>
        localCandidates(exposure, result.exposure),
      ),
    );
    for (const value of fine)
      if (value >= window.min && value <= window.max) await evaluate(value);

    if (gain?.supportsManual) {
      const dark = screens.filter((screen) => {
        const result = best.get(screen.screenId);
        return (
          result &&
          result.metrics.mean < 175 &&
          (result.exposure === window.max ||
            classifyExposureExtreme(result.metrics) === 'too-dark')
        );
      });
      if (dark.length) {
        await controls.set('exposure', window.max, 'manual');
        const gainBest = new Map<string, number>();
        for (const screen of dark) {
          const result = best.get(screen.screenId);
          if (result) gainBest.set(screen.screenId, result.score);
        }
        for (const gainValue of uniqueCandidates(gainCandidates(gain))) {
          await controls.set('gain', gainValue, 'manual');
          await delay(CONTROL_SETTLE_MS);
          const reading = await this.calibrationExposureForScreens(dark);
          for (const screen of reading.screenReadings) {
            const score =
              exposureCalibrationScore(screen.metrics) +
              distancePenalty(gainValue, gain.default, gain, 0.08);
            const previous = gainBest.get(screen.screenId);
            if (previous === undefined || score < previous - 1e-9) {
              gainBest.set(screen.screenId, score);
              const result = best.get(screen.screenId);
              if (result) {
                result.exposure = window.max;
                result.metrics = screen.metrics;
                result.score = score;
                (result as typeof result & { gain?: number }).gain = gainValue;
              }
            }
          }
        }
      }
    }
    return best as Map<
      string,
      {
        exposure: number;
        score: number;
        metrics: LumaMetrics;
        gain?: number;
      }
    >;
  }

  private calibrationExposureForScreens(screens: readonly ImagingScreen[]) {
    return this.freshFrame().then((jpeg) =>
      measureCalibrationExposure(jpeg, screens),
    );
  }

  private async tuneToneForScreens(screens: readonly ImagingScreen[]) {
    const controls = await this.ensureControls();
    const values = await controls.read();
    const brightness = values.brightness?.supportsManual
      ? values.brightness
      : undefined;
    const contrast = values.contrast?.supportsManual
      ? values.contrast
      : undefined;
    const result = new Map<
      string,
      {
        brightness?: number;
        contrast?: number;
        score: number;
        monotonic: boolean;
      }
    >();
    if (!brightness && !contrast) {
      const reading = await measureTone(await this.freshFrame(), screens);
      for (const screen of reading?.screens ?? [])
        result.set(screen.screenId, {
          score: screen.score,
          monotonic: screen.monotonic,
        });
      return result;
    }
    const brightnessCandidates = brightness
      ? uniqueCandidates(
          BRIGHTNESS_OFFSETS.map((offset) =>
            quantizeControl(brightness.default + offset, brightness),
          ),
        )
      : [0];
    const contrastCandidates = contrast
      ? uniqueCandidates(
          CONTRAST_OFFSETS.map((offset) =>
            quantizeControl(contrast.default + offset, contrast),
          ),
        )
      : [0];
    const seen = new Set<string>();
    const evaluate = async (brightnessValue: number, contrastValue: number) => {
      const key = `${brightnessValue}:${contrastValue}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (brightness)
        await controls.set('brightness', brightnessValue, 'manual');
      if (contrast) await controls.set('contrast', contrastValue, 'manual');
      await delay(CONTROL_SETTLE_MS);
      const reading = await measureTone(await this.freshFrame(), screens);
      for (const screen of reading?.screens ?? []) {
        const score =
          screen.score +
          (brightness
            ? distancePenalty(
                brightnessValue,
                brightness.default,
                brightness,
                0.1,
              )
            : 0) +
          (contrast
            ? distancePenalty(contrastValue, contrast.default, contrast, 0.12)
            : 0);
        const previous = result.get(screen.screenId);
        if (!previous || score < previous.score - 1e-9)
          result.set(screen.screenId, {
            ...(brightness ? { brightness: brightnessValue } : {}),
            ...(contrast ? { contrast: contrastValue } : {}),
            score,
            monotonic: screen.monotonic,
          });
      }
    };
    for (const brightnessValue of brightnessCandidates)
      for (const contrastValue of contrastCandidates)
        await evaluate(brightnessValue, contrastValue);

    const fine = new Map<string, { brightness?: number; contrast?: number }>();
    for (const entry of result.values()) {
      for (const brightnessOffset of LOCAL_TONE_OFFSETS) {
        for (const contrastOffset of LOCAL_TONE_OFFSETS) {
          const brightnessValue = brightness
            ? quantizeControl(
                (entry.brightness ?? brightness.default) + brightnessOffset * 4,
                brightness,
              )
            : 0;
          const contrastValue = contrast
            ? quantizeControl(
                (entry.contrast ?? contrast.default) + contrastOffset * 8,
                contrast,
              )
            : 0;
          fine.set(`${brightnessValue}:${contrastValue}`, {
            ...(brightness ? { brightness: brightnessValue } : {}),
            ...(contrast ? { contrast: contrastValue } : {}),
          });
        }
      }
    }
    for (const candidate of fine.values())
      await evaluate(candidate.brightness ?? 0, candidate.contrast ?? 0);
    return result;
  }

  private async searchWhiteBalanceForScreens(
    screens: readonly ImagingScreen[],
  ) {
    const controls = await this.ensureControls();
    const control = (await controls.read()).whiteBalance;
    if (!control?.supportsManual) return new Map<string, number>();
    const span = Math.max(control.step || 1, control.max - control.min);
    const best = new Map<string, { value: number; score: number }>();
    const seen = new Set<number>();
    const evaluate = async (value: number) => {
      const quantized = clamp(
        quantizeControl(value, control),
        control.min,
        control.max,
      );
      if (seen.has(quantized)) return;
      seen.add(quantized);
      await controls.set('whiteBalance', quantized, 'manual');
      const reading = await this.measureSettledWhiteBalance(screens);
      for (const screen of reading?.screens ?? []) {
        const score =
          screen.score +
          distancePenalty(quantized, control.default, control, 0.03);
        const previous = best.get(screen.screenId);
        if (!previous || score < previous.score - 1e-9)
          best.set(screen.screenId, { value: quantized, score });
      }
    };
    for (const value of controlCandidates(control, 5)) await evaluate(value);
    const fine = uniqueCandidates(
      [...best.values()].flatMap((entry) => [
        quantizeControl(entry.value - span / 8, control),
        quantizeControl(entry.value - span / 16, control),
        entry.value,
        quantizeControl(entry.value + span / 16, control),
        quantizeControl(entry.value + span / 8, control),
      ]),
    );
    for (const value of fine) await evaluate(value);
    const result = new Map<string, number>();
    for (const [screenId, entry] of best)
      if (entry.score <= WHITE_BALANCE_MAX_SCORE)
        result.set(screenId, entry.value);
    return result;
  }

  private async measureSettledFocusForScreens(
    screens: readonly ImagingScreen[],
  ) {
    await delay(FOCUS_SETTLE_MS);
    await this.freshFrame();
    const readings: FocusReading[] = [];
    for (let index = 0; index < 2; index += 1)
      readings.push(await measureFocus(await this.freshFrame(), screens));
    const result = new Map<string, { score: number; anisotropy: number }>();
    for (const screen of screens) {
      const entries = readings.flatMap((reading) => {
        const match = reading.screens.find(
          (entry) => entry.screenId === screen.screenId,
        );
        return match ? [match] : [];
      });
      if (!entries.length) continue;
      result.set(screen.screenId, {
        score:
          entries.reduce((sum, entry) => sum + entry.score, 0) / entries.length,
        anisotropy:
          entries.reduce((sum, entry) => sum + entry.anisotropy, 0) /
          entries.length,
      });
    }
    return result;
  }

  private async searchFocusForScreens(screens: readonly ImagingScreen[]) {
    const controls = await this.ensureControls();
    let focus = (await controls.read()).focus;
    if (!focus?.supportsManual)
      throw new RobotArmError(
        'VISION_UNAVAILABLE',
        'This camera does not support manual focus control',
        409,
      );
    await controls.set('focus', focus.value, 'auto');
    await delay(FOCUS_SETTLE_MS);
    focus = (await controls.read()).focus ?? focus;
    const best = new Map<
      string,
      { value: number; score: number; min: number; max: number }
    >();
    const seen = new Set<number>();
    const evaluate = async (value: number) => {
      const quantized = clamp(
        quantizeControl(value, focus),
        focus.min,
        focus.max,
      );
      if (seen.has(quantized)) return;
      seen.add(quantized);
      await controls.set('focus', quantized, 'manual');
      const reading = await this.measureSettledFocusForScreens(screens);
      for (const [screenId, entry] of reading) {
        const previous = best.get(screenId);
        if (!previous || entry.score > previous.score + 1e-9)
          best.set(screenId, {
            value: quantized,
            score: entry.score,
            min: focus.min,
            max: focus.max,
          });
      }
    };
    if (this.camera.backend === 'avfoundation') {
      // macOS focus is normalized to 0..1 with fractional steps. Reuse the
      // single-screen auto-focus bracket instead of scanning hardware extremes.
      for (const value of localFocusCandidates(focus)) await evaluate(value);
      return best;
    }
    for (const value of controlCandidates(focus, 9)) await evaluate(value);
    const span = Math.max(1, focus.max - focus.min);
    const fineStep = Math.max(
      Math.abs(focus.step || 1),
      Math.ceil(
        (span * FOCUS_LOCAL_RANGE_FRACTION) / Math.abs(focus.step || 1),
      ) * Math.abs(focus.step || 1),
    );
    const fine = uniqueCandidates(
      [...best.values()].flatMap((entry) =>
        FOCUS_LOCAL_OFFSETS.map((offset) =>
          quantizeControl(
            clamp(entry.value + offset * fineStep, focus.min, focus.max),
            focus,
          ),
        ),
      ),
    );
    for (const value of fine) await evaluate(value);
    return best;
  }

  private async restoreControls(
    controls: CameraHardwareControl,
    values: Partial<Record<CameraControlProperty, StoredCameraControl>>,
  ) {
    let restored = true;
    for (const [property, value] of Object.entries(values)) {
      if (!value) continue;
      try {
        await controls.set(
          property as CameraControlProperty,
          value.value,
          value.mode,
        );
      } catch {
        // Restore as many controls as the device still allows.
        restored = false;
      }
    }
    return restored;
  }

  private async optimizeExposureAndGain(screens: readonly ImagingScreen[]) {
    const controls = await this.ensureControls();
    const values = await controls.read();
    const exposure = values.exposure;
    if (!exposure?.supportsManual)
      throw new RobotArmError(
        'VISION_UNAVAILABLE',
        'This camera does not support manual exposure control',
        409,
      );
    const gain = values.gain;
    if (gain?.supportsManual)
      await controls.set('gain', gain.default, 'manual');
    const window = resolveFrameSafeExposureWindow(
      exposure,
      this.stream.getInfo().fps,
    ) ?? {
      min: exposure.min,
      max: exposure.max,
    };
    const initialExposure = clamp(exposure.value, window.min, window.max);
    if (initialExposure !== exposure.value)
      await controls.set('exposure', initialExposure, 'manual');
    await this.convergeExposureForCalibration();

    let bestGain = gain?.value;
    const currentExposure = (await controls.read()).exposure;
    if (!currentExposure)
      throw new RobotArmError(
        'VISION_UNAVAILABLE',
        'Exposure control disappeared during calibration',
        409,
      );
    const finalReading = await this.currentCalibrationExposureReading();
    const exposureScore =
      exposureCalibrationScore(finalReading.selected) +
      distancePenalty(currentExposure.value, exposure.value, window, 0.02);
    if (
      gain?.supportsManual &&
      currentExposure.value === window.max &&
      (finalReading.selected.mean < 175 ||
        classifyExposureExtreme(finalReading.selected) === 'too-dark')
    ) {
      let bestGainScore = exposureScore;
      for (const gainValue of uniqueCandidates(gainCandidates(gain))) {
        await controls.set('gain', gainValue, 'manual');
        await delay(CONTROL_SETTLE_MS);
        const reading = await this.currentCalibrationExposureReading();
        const score =
          exposureCalibrationScore(reading.selected) +
          distancePenalty(gainValue, gain.default, gain, 0.08);
        if (score < bestGainScore - 1e-9) {
          bestGainScore = score;
          bestGain = gainValue;
        }
      }
    }
    if (gain?.supportsManual)
      await controls.set('gain', bestGain ?? gain.default, 'manual');
    this.statusValue = {
      ...this.statusValue,
      state: 'exposure',
      exposure: currentExposure.value,
      ...(bestGain !== undefined ? { gain: bestGain } : {}),
      message: 'Exposure and gain converged',
      updatedAt: Date.now(),
    };
    return { value: currentExposure.value, gain: bestGain };
  }

  private async searchWhiteBalance(screens: readonly ImagingScreen[]) {
    const controls = await this.ensureControls();
    const control = (await controls.read()).whiteBalance;
    if (!control?.supportsManual) return undefined;
    const initialReading = await this.measureSettledWhiteBalance(screens);
    const step = Math.max(1, Math.abs(control.step || 1));
    const span = Math.max(step, control.max - control.min);
    const coarse = Array.from({ length: 5 }, (_, index) =>
      quantizeControl(control.min + (span * index) / 4, control),
    );
    let best:
      | { value: number; score: number; reading: WhiteBalanceReading }
      | undefined = initialReading && {
      value: control.value,
      score:
        initialReading.score +
        distancePenalty(control.value, control.default, control, 0.03),
      reading: initialReading,
    };
    for (const value of uniqueCandidates([control.value, ...coarse])) {
      await controls.set('whiteBalance', value, 'manual');
      const reading = await this.measureSettledWhiteBalance(screens);
      if (!reading) continue;
      const score =
        reading.score + distancePenalty(value, control.default, control, 0.03);
      if (
        !best ||
        score < best.score - 1e-9 ||
        (Math.abs(score - best.score) < 1e-9 &&
          Math.abs(value - control.default) <
            Math.abs(best.value - control.default))
      )
        best = { value, score, reading };
    }
    if (!best) {
      await this.restoreControls(controls, { whiteBalance: control });
      return undefined;
    }
    const fineSpan = span / 8;
    for (const value of uniqueCandidates([
      quantizeControl(best.value - fineSpan, control),
      quantizeControl(best.value - fineSpan / 2, control),
      best.value,
      quantizeControl(best.value + fineSpan / 2, control),
      quantizeControl(best.value + fineSpan, control),
    ])) {
      if (value < control.min || value > control.max) continue;
      await controls.set('whiteBalance', value, 'manual');
      const reading = await this.measureSettledWhiteBalance(screens);
      if (!reading) continue;
      const score =
        reading.score + distancePenalty(value, control.default, control, 0.03);
      if (score < best.score - 1e-9) best = { value, score, reading };
    }
    if (best.reading.score > WHITE_BALANCE_MAX_SCORE) {
      await this.restoreControls(controls, { whiteBalance: control });
      return undefined;
    }
    await controls.set('whiteBalance', best.value, 'manual');
    const verification = await this.measureSettledWhiteBalance(screens);
    if (!verification || verification.score > WHITE_BALANCE_MAX_SCORE) {
      await this.restoreControls(controls, { whiteBalance: control });
      return undefined;
    }
    return { ...verification, value: best.value };
  }

  private async measureSettledWhiteBalance(
    screens: readonly ImagingScreen[],
  ): Promise<WhiteBalanceReading | undefined> {
    await delay(WHITE_BALANCE_SETTLE_MS);
    // Discard the frame produced before the camera applied the new control.
    await this.freshFrame();
    const readings: WhiteBalanceReading[] = [];
    for (let index = 0; index < WHITE_BALANCE_SAMPLE_COUNT; index += 1) {
      const reading = await measureWhiteBalance(
        await this.freshFrame(),
        screens,
      );
      if (reading) readings.push(reading);
    }
    readings.sort((left, right) => left.score - right.score);
    return readings[Math.floor(readings.length / 2)];
  }

  private async tuneBrightnessAndContrast(screens: readonly ImagingScreen[]) {
    const controls = await this.ensureControls();
    const values = await controls.read();
    const brightness = values.brightness?.supportsManual
      ? values.brightness
      : undefined;
    const contrast = values.contrast?.supportsManual
      ? values.contrast
      : undefined;
    if (!brightness && !contrast)
      return measureTone(await this.freshFrame(), screens);

    const evaluate = async (brightnessValue: number, contrastValue: number) => {
      if (brightness)
        await controls.set('brightness', brightnessValue, 'manual');
      if (contrast) await controls.set('contrast', contrastValue, 'manual');
      await delay(CONTROL_SETTLE_MS);
      const reading = await measureTone(await this.freshFrame(), screens);
      if (!reading) return undefined;
      return {
        reading,
        score:
          reading.score +
          (brightness
            ? distancePenalty(
                brightnessValue,
                brightness.default,
                brightness,
                0.1,
              )
            : 0) +
          (contrast
            ? distancePenalty(contrastValue, contrast.default, contrast, 0.12)
            : 0),
        brightnessValue,
        contrastValue,
      };
    };

    let brightnessValue = brightness?.value ?? 0;
    let contrastValue = contrast?.value ?? 0;
    let best: Awaited<ReturnType<typeof evaluate>>;
    if (brightness) {
      for (const offset of BRIGHTNESS_OFFSETS) {
        const candidate = quantizeControl(
          brightness.value + offset,
          brightness,
        );
        const result = await evaluate(candidate, contrastValue);
        if (!result) continue;
        if (
          !best ||
          result.score < best.score - 1e-9 ||
          (Math.abs(result.score - best.score) < 1e-9 &&
            Math.abs(candidate - brightness.value) <
              Math.abs(best.brightnessValue - brightness.value))
        )
          best = result;
      }
      brightnessValue = best?.brightnessValue ?? brightness.value;
    }

    if (contrast) {
      for (const offset of CONTRAST_OFFSETS) {
        const candidate = quantizeControl(contrast.value + offset, contrast);
        const result = await evaluate(brightnessValue, candidate);
        if (!result) continue;
        if (
          !best ||
          result.score < best.score - 1e-9 ||
          (Math.abs(result.score - best.score) < 1e-9 &&
            Math.abs(candidate - contrast.value) <
              Math.abs(best.contrastValue - contrast.value))
        )
          best = result;
      }
      contrastValue = best?.contrastValue ?? contrast.value;
    }

    if (brightness && contrast) {
      const centerBrightness = best?.brightnessValue ?? brightnessValue;
      const centerContrast = best?.contrastValue ?? contrastValue;
      for (const brightnessOffset of LOCAL_TONE_OFFSETS) {
        for (const contrastOffset of LOCAL_TONE_OFFSETS) {
          const result = await evaluate(
            quantizeControl(
              centerBrightness + brightnessOffset * 4,
              brightness,
            ),
            quantizeControl(centerContrast + contrastOffset * 8, contrast),
          );
          if (result && (!best || result.score < best.score - 1e-9))
            best = result;
        }
      }
    }
    if (!best) return undefined;
    brightnessValue = best.brightnessValue;
    contrastValue = best.contrastValue;
    if (brightness) await controls.set('brightness', brightnessValue, 'manual');
    if (contrast) await controls.set('contrast', contrastValue, 'manual');
    return best.reading;
  }

  /**
   * Runs immediately before a requested still frame is read. Preview polling
   * never calls this path, so it cannot continuously disturb the locked camera.
   */
  async beforeCapture(screenId?: string): Promise<void> {
    // Marker capture already adjusted and locked the whole-frame image before
    // requesting its snapshot. Re-entering the queue here deadlocks the capture.
    if (this.markerImagingScope.getStore()) return;
    await this.enqueue(async () => {
      if (screenId && screenId !== this.activeScreenId)
        await this.activateScreenUnlocked(screenId);
      if (!this.applied || !this.controls) return;
      await this.ensureExposureForCapture();
    });
  }

  /** Shorten a locked exposure for a single image sequence and restore it. */
  async withReducedVisibilityExposure<T>(
    capture: (exposure: { previous: number; reduced: number }) => Promise<T>,
  ): Promise<T | undefined> {
    const controls = this.controls;
    if (
      !controls ||
      !this.applied ||
      this.closed ||
      this.adjusting ||
      this.captureInProgress
    )
      return undefined;
    this.captureInProgress = true;
    try {
      const original = (await controls.read().catch(() => undefined))?.exposure;
      if (!original?.supportsManual || original.mode !== 'manual')
        return undefined;
      const window = resolveFrameSafeExposureWindow(
        original,
        this.stream.getInfo().fps,
      );
      if (!window) return undefined;
      const reduced = Math.max(
        window.min,
        original.value - Math.max(1, Math.abs(original.step || 1)),
      );
      if (reduced >= original.value) return undefined;

      let applied: CameraControlValue | undefined;
      try {
        await controls.set('exposure', reduced, 'manual');
        applied = (await controls.read()).exposure;
      } catch {
        // Even a failed set or readback may have changed the hardware setting.
      }
      let outcome: { value?: T } | { error: unknown } = {};
      if (
        applied?.mode === 'manual' &&
        Number.isFinite(applied.value) &&
        applied.value < original.value
      ) {
        try {
          outcome = {
            value: await capture({
              previous: original.value,
              reduced: applied.value,
            }),
          };
        } catch (error) {
          outcome = { error };
        }
      }
      try {
        await controls.set('exposure', original.value, 'manual');
        const restored = (await controls.read()).exposure;
        if (restored?.mode !== 'manual' || restored.value !== original.value)
          throw new Error(
            'Exposure readback does not match the original setting',
          );
      } catch (error) {
        this.applied = false;
        this.stopMonitor();
        const message =
          'Camera exposure could not be restored after the visibility recheck.';
        this.statusValue = { state: 'error', message, updatedAt: Date.now() };
        throw new RobotArmError('VISION_UNAVAILABLE', message, 409, {
          exposure: original.value,
          cause: error instanceof Error ? error.message : String(error),
        });
      }
      if ('error' in outcome) throw outcome.error;
      return outcome.value;
    } finally {
      this.captureInProgress = false;
    }
  }

  private async searchFocus(
    focus: CameraControlValue,
    screens: readonly ImagingScreen[],
  ) {
    let best = {
      value: focus.value,
      score: Number.NEGATIVE_INFINITY,
      distance: Number.POSITIVE_INFINITY,
    };
    for (const value of localFocusCandidates(focus)) {
      await this.controls!.set('focus', value, 'manual');
      const score = await this.measureSettledFocus(screens);
      const distance = Math.abs(value - focus.value);
      if (
        score > best.score + 1e-9 ||
        (Math.abs(score - best.score) <= 1e-9 && distance < best.distance)
      )
        best = { value, score, distance };
    }
    await this.controls!.set('focus', best.value, 'manual');
    await delay(FOCUS_SETTLE_MS);
    const verification = await measureFocus(await this.freshFrame(), screens);
    return {
      value: best.value,
      score: verification.score,
      min: focus.min,
      max: focus.max,
    };
  }

  private async measureSettledFocus(screens: readonly ImagingScreen[]) {
    await delay(FOCUS_SETTLE_MS);
    await this.freshFrame();
    const scores: number[] = [];
    for (let index = 0; index < 2; index += 1)
      scores.push((await measureFocus(await this.freshFrame(), screens)).score);
    return scores.length
      ? scores.reduce((sum, value) => sum + value, 0) / scores.length
      : 0;
  }

  private async ensureExposureForCapture(): Promise<void> {
    if (!this.controls || this.captureInProgress || this.adjusting) return;
    this.captureInProgress = true;
    try {
      const initial = await this.currentExposureReading();
      const classification = classifyExposureExtreme(initial.selected);
      if (!classification) return;

      const started = Date.now();
      let previousDirection: 'too-bright' | 'too-dark' | undefined;
      for (let iteration = 0; iteration < MAX_CAPTURE_ITERATIONS; iteration++) {
        const reading = await this.currentExposureReading();
        const direction = exposureTargetDirection(
          reading.selected,
          Date.now() < this.darkModeUntil,
        );
        if (!direction) return;
        if (previousDirection && direction !== previousDirection) return;
        previousDirection = direction;
        const adjusted = await this.applyExposureAdjustment(
          reading.selected,
          direction,
          false,
        );
        if (!adjusted || Date.now() - started >= CAPTURE_TIMEOUT_MS) return;
        await delay(CAPTURE_SETTLE_MS);
      }
    } finally {
      this.captureInProgress = false;
    }
  }

  private async convergeExposureForCalibration(): Promise<void> {
    if (!this.controls || this.captureInProgress || this.adjusting) return;
    this.captureInProgress = true;
    try {
      let previousDirection: 'too-bright' | 'too-dark' | undefined;
      for (
        let iteration = 0;
        iteration < MAX_CALIBRATION_EXPOSURE_ITERATIONS;
        iteration++
      ) {
        const reading = await this.currentCalibrationExposureReading();
        const direction = classifyExposureExtreme(reading.selected);
        if (!direction) return;
        if (previousDirection && direction !== previousDirection) return;
        previousDirection = direction;
        const adjusted = await this.applyExposureAdjustment(
          reading.selected,
          direction,
          false,
        );
        if (!adjusted) return;
        await delay(CAPTURE_SETTLE_MS);
      }
    } finally {
      this.captureInProgress = false;
    }
  }

  private startMonitor() {
    this.stopMonitor();
    this.monitor = setInterval(() => {
      void this.monitorExposure().catch(() => undefined);
    }, MONITOR_INTERVAL_MS);
    this.monitor.unref?.();
  }

  private stopMonitor() {
    if (this.monitor) clearInterval(this.monitor);
    this.monitor = undefined;
  }

  private async monitorExposure() {
    if (
      this.closed ||
      !this.applied ||
      !this.activeScreenId ||
      this.calibratingScreens.size > 0 ||
      this.adjusting ||
      this.captureInProgress
    )
      return;
    const now = Date.now();
    if (now - this.lastSampleAt < SAMPLE_INTERVAL_MS) return;
    this.lastSampleAt = now;
    const reading = await this.currentExposureReading();
    if (now - reading.updatedAt > SAMPLE_MAX_AGE_MS) return;
    const darkModeActive = now < this.darkModeUntil;
    if (isStructuredDarkUiHighlight(reading.selected))
      this.darkModeUntil = now + 30_000;
    else if (
      darkModeActive &&
      reading.selected.mean <= 140 &&
      reading.selected.darkRatio >= 0.15
    )
      this.darkModeUntil = now + 30_000;
    else this.darkModeUntil = 0;
    const direction = classifyExposureExtreme(reading.selected);
    if (!direction) {
      this.extremeDirection = undefined;
      this.extremeCount = 0;
      return;
    }
    if (direction !== this.extremeDirection) {
      this.extremeDirection = direction;
      this.extremeCount = 1;
    } else {
      this.extremeCount++;
    }
    if (this.extremeCount < CONSECUTIVE_SAMPLES) return;
    if (now - this.lastAdjustAt < ADJUST_COOLDOWN_MS) return;
    await this.applyExposureAdjustment(reading.selected, direction, true);
  }

  private async currentExposureReading() {
    const active = this.activeScreenId
      ? this.screenList([this.activeScreenId])
      : [];
    return measureExposure(
      await this.freshFrame(),
      active.length ? active : this.screens(),
    );
  }

  private async currentCalibrationExposureReading() {
    return measureCalibrationExposure(await this.freshFrame(), this.screens());
  }

  private async applyExposureAdjustment(
    metrics: LumaMetrics,
    direction: 'too-bright' | 'too-dark',
    background: boolean,
  ): Promise<boolean> {
    const controls = this.controls;
    if (!controls || this.adjusting || (background && this.captureInProgress))
      return false;
    this.adjusting = true;
    try {
      const values = await controls.read();
      const exposure = values.exposure;
      if (!exposure?.supportsManual) return false;
      const window = resolveFrameSafeExposureWindow(
        exposure,
        this.stream.getInfo().fps,
      );
      if (!window) return false;
      const step = Math.max(1, Math.abs(exposure.step || 1));
      const stepUnits = Math.max(
        1,
        Math.min(step * exposureSeverity(metrics, direction), MAX_STEP_UNITS),
      );
      const signedStep = direction === 'too-bright' ? -stepUnits : stepUnits;
      const baseExposure = clamp(exposure.value, window.min, window.max);
      const nextExposure = clamp(
        baseExposure + signedStep,
        window.min,
        window.max,
      );
      if (nextExposure === exposure.value) return false;

      await controls.set('exposure', nextExposure, 'manual');
      this.lastAdjustAt = Date.now();
      this.extremeDirection = undefined;
      this.extremeCount = 0;
      this.statusValue = {
        ...this.statusValue,
        state: 'ready',
        exposure: nextExposure,
        message: background
          ? 'Exposure value adjusted automatically'
          : 'Exposure value converged before capture',
        updatedAt: Date.now(),
      };
      return true;
    } catch {
      await this.discardControls(controls);
      return false;
    } finally {
      this.adjusting = false;
    }
  }

  private async freshFrame(timeoutMs = 3_000) {
    const info = this.stream.getInfo();
    if (info.state !== 'running' && info.state !== 'starting')
      throw new RobotArmError(
        'VISION_UNAVAILABLE',
        info.error ?? 'Camera is not running',
      );
    return (await this.stream.getFrame({ fresh: true, timeoutMs })).jpeg;
  }

  private async persist(stored: StoredCameraImaging) {
    await writeCameraImagingFile(this.directory, this.camera.id, stored);
  }

  async reopenAfterRestart(): Promise<void> {
    await this.resumeStored();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopMonitor();
    await this.controls?.close().catch(() => undefined);
  }
}
