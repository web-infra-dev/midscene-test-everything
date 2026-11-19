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
  CALIBRATION_EXPOSURE_REGION,
  type ImagingScreen,
  type LumaMetrics,
  type ToneReading,
  type WhiteBalanceReading,
  classifyExposureExtreme,
  exposureCalibrationScore,
  exposureSeverity,
  exposureTargetDirection,
  isStructuredDarkUiHighlight,
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

interface StoredCameraImaging {
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

const SAMPLE_INTERVAL_MS = 1_500;
/** Two matching extreme samples trigger after roughly three seconds. */
const MONITOR_INTERVAL_MS = 1_500;
const ADJUST_COOLDOWN_MS = 3_000;
const SAMPLE_MAX_AGE_MS = 5_000;
const CONSECUTIVE_SAMPLES = 2;
const CAPTURE_SETTLE_MS = 300;
const CAPTURE_TIMEOUT_MS = 2_000;
const MAX_CAPTURE_ITERATIONS = 3;
const MAX_CALIBRATION_EXPOSURE_ITERATIONS = 6;
const MAX_STEP_UNITS = 3;
const CONTROL_SETTLE_MS = 120;
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

function quantizeControl(value: number, control: CameraControlValue) {
  const step = Math.max(1, Math.abs(control.step || 1));
  return clamp(
    control.min + Math.round((value - control.min) / step) * step,
    control.min,
    control.max,
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

export class CameraImagingController {
  private readonly registered = new Map<
    string,
    () => CameraCorrection | undefined
  >();
  private monitor?: ReturnType<typeof setInterval>;
  private statusValue: CameraImagingStatus = { state: 'idle' };
  private stored?: StoredCameraImaging;
  private applied = false;
  private adjusting = false;
  private captureInProgress = false;
  private lastAdjustAt = 0;
  private lastSampleAt = 0;
  private extremeDirection?: 'too-bright' | 'too-dark';
  private extremeCount = 0;
  private darkModeUntil = 0;
  private closed = false;

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

  status(): CameraImagingStatus {
    return { ...this.statusValue };
  }

  async load(): Promise<void> {
    try {
      const value = JSON.parse(
        await readFile(
          cameraImagingFile(this.directory, this.camera.id),
          'utf8',
        ),
      ) as StoredCameraImaging;
      if (
        !([1, 2, 3, 4, 5, 6] as const).includes(value.version) ||
        value.cameraId !== this.camera.id ||
        !Array.isArray(value.rois) ||
        !Number.isFinite(value.focus?.value) ||
        !Number.isFinite(value.exposure?.value)
      )
        return;
      // Version 5 could persist a clipped white-balance and tone result.
      if (value.version === 5) return;
      this.stored = value;
      this.statusValue = {
        state: 'idle',
        focus: value.focus.value,
        exposure: value.exposure.value,
        ...(value.gain ? { gain: value.gain.value } : {}),
        ...(value.whiteBalance
          ? { whiteBalance: value.whiteBalance.value }
          : {}),
        ...(value.brightness ? { brightness: value.brightness.value } : {}),
        ...(value.contrast ? { contrast: value.contrast.value } : {}),
        updatedAt: Date.parse(value.calibratedAt) || undefined,
      };
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
    this.statusValue = {
      state: 'unsupported',
      message: 'This camera does not expose focus and exposure controls',
      updatedAt: Date.now(),
    };
    return this.status();
  }

  private async readManualControls() {
    const controls = await this.getControls();
    if (!controls) return undefined;
    const { focus, exposure } = await controls.read();
    if (!focus?.supportsManual || !exposure?.supportsManual) return undefined;
    return { controls, values: { focus, exposure } };
  }

  async releaseForCorrection(): Promise<void> {
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
    this.statusValue = {
      state: 'released',
      message:
        'Camera imaging controls are released for perspective correction',
      updatedAt: Date.now(),
    };
  }

  async clearPerspectiveBinding(): Promise<void> {
    try {
      await this.releaseForCorrection();
    } finally {
      this.stored = undefined;
      await rm(cameraImagingFile(this.directory, this.camera.id), {
        force: true,
      });
    }
  }

  async resumeStored(): Promise<void> {
    if (!this.stored) return;
    const expected = new Map(
      this.stored.rois.map((roi) => [roi.screenId, roi.fingerprint]),
    );
    // Screen sessions reopen one at a time. A screen we have yet to load
    // provides no evidence that its saved perspective changed.
    for (const screenId of expected.keys()) {
      if (!this.registered.has(screenId)) return;
    }
    const currentRois = this.screens().map((screen) => ({
      screenId: screen.screenId,
      fingerprint: correctionFingerprint(screen),
    }));
    if (
      currentRois.length !== expected.size ||
      currentRois.some((roi) => expected.get(roi.screenId) !== roi.fingerprint)
    ) {
      await this.clearPerspectiveBinding();
      return;
    }
    try {
      const controls = await this.getControls();
      if (!controls) {
        this.setUnsupported();
        return;
      }
      await controls.set('exposure', this.stored.exposure.value, 'manual');
      await controls.set('focus', this.stored.focus.value, 'manual');
      for (const [property, value] of [
        ['gain', this.stored.gain?.value],
        ['whiteBalance', this.stored.whiteBalance?.value],
        ['brightness', this.stored.brightness?.value],
        ['contrast', this.stored.contrast?.value],
      ] as const) {
        if (value === undefined) continue;
        const control = (await controls.read())[property];
        if (control?.supportsManual)
          await controls.set(property, value, 'manual');
      }
      this.applied = true;
      this.statusValue = {
        state: 'ready',
        focus: this.stored.focus.value,
        exposure: this.stored.exposure.value,
        ...(this.stored.gain ? { gain: this.stored.gain.value } : {}),
        ...(this.stored.whiteBalance
          ? { whiteBalance: this.stored.whiteBalance.value }
          : {}),
        ...(this.stored.brightness
          ? { brightness: this.stored.brightness.value }
          : {}),
        ...(this.stored.contrast
          ? { contrast: this.stored.contrast.value }
          : {}),
        updatedAt: Date.now(),
      };
      // Exposure remains locked after restart. Automatic adjustment is reserved
      // for an explicit capture-button action.
    } catch (error) {
      this.statusValue = {
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now(),
      };
    }
  }

  async calibrate(): Promise<CameraImagingStatus> {
    const screens = this.screens();
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
        message: 'Optimizing camera image quality',
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
      const stored: StoredCameraImaging = {
        version: 6,
        cameraId: this.camera.id,
        rois: screens.map((screen) => ({
          screenId: screen.screenId,
          fingerprint: correctionFingerprint(screen),
        })),
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
        original: Object.fromEntries(
          Object.entries(original).flatMap(([property, control]) => {
            const value = storedControl(control);
            return value ? [[property as CameraControlProperty, value]] : [];
          }),
        ),
        calibratedAt: new Date().toISOString(),
      };
      await this.persist(stored);
      this.stored = stored;
      this.applied = true;
      this.statusValue = {
        state: 'ready',
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
      return this.status();
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

  private async restoreControls(
    controls: CameraHardwareControl,
    values: Partial<Record<CameraControlProperty, StoredCameraControl>>,
  ) {
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
      }
    }
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
    const step = Math.max(1, Math.abs(exposure.step || 1));
    const candidates = uniqueCandidates(
      Array.from(
        { length: Math.floor((window.max - window.min) / step) + 1 },
        (_, index) => window.min + index * step,
      ).concat(window.max),
    );
    let best:
      | {
          value: number;
          score: number;
          metrics: LumaMetrics;
        }
      | undefined;
    for (const value of candidates) {
      await controls.set('exposure', value, 'manual');
      await delay(CONTROL_SETTLE_MS);
      const reading = await this.currentCalibrationExposureReading();
      const score =
        exposureCalibrationScore(reading.selected) +
        distancePenalty(value, exposure.value, window, 0.02);
      if (
        !best ||
        score < best.score - 1e-9 ||
        (Math.abs(score - best.score) < 1e-9 &&
          Math.abs(value - exposure.value) <
            Math.abs(best.value - exposure.value))
      )
        best = { value, score, metrics: reading.selected };
    }
    if (!best)
      throw new RobotArmError(
        'VISION_UNAVAILABLE',
        'No exposure sample could be evaluated',
        409,
      );
    await controls.set('exposure', best.value, 'manual');

    let bestGain = gain?.value;
    if (
      gain?.supportsManual &&
      best.value === window.max &&
      (best.metrics.mean < 175 ||
        classifyExposureExtreme(best.metrics) === 'too-dark')
    ) {
      let bestGainScore = best.score;
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
      exposure: best.value,
      ...(bestGain !== undefined ? { gain: bestGain } : {}),
      message: 'Exposure and gain converged',
      updatedAt: Date.now(),
    };
    return { value: best.value, gain: bestGain };
  }

  private async searchWhiteBalance(screens: readonly ImagingScreen[]) {
    const controls = await this.ensureControls();
    const control = (await controls.read()).whiteBalance;
    if (!control?.supportsManual) return undefined;
    const initialReading = await measureWhiteBalance(
      await this.freshFrame(),
      screens,
    );
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
      await delay(CONTROL_SETTLE_MS);
      const reading = await measureWhiteBalance(
        await this.freshFrame(),
        screens,
      );
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
      await delay(CONTROL_SETTLE_MS);
      const reading = await measureWhiteBalance(
        await this.freshFrame(),
        screens,
      );
      if (!reading) continue;
      const score =
        reading.score + distancePenalty(value, control.default, control, 0.03);
      if (score < best.score - 1e-9) best = { value, score, reading };
    }
    if (best.reading.score > 0.08) {
      await this.restoreControls(controls, { whiteBalance: control });
      return undefined;
    }
    await controls.set('whiteBalance', best.value, 'manual');
    return { ...best.reading, value: best.value };
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
   * Reserved for an explicit capture-button exposure precheck.
   *
   * Do not call this from live preview polling. The calibrated exposure remains
   * locked until the operator explicitly requests a capture.
   */
  async beforeCapture(): Promise<void> {
    if (!this.applied || !this.controls) return;
    await this.ensureExposureForCapture();
  }

  private async searchFocus(
    focus: CameraControlValue,
    screens: readonly ImagingScreen[],
  ) {
    const step = Math.max(1, Math.abs(focus.step));
    const coarse = Math.max(
      step,
      Math.ceil((focus.max - focus.min) / 13 / step) * step,
    );
    const candidates = new Set<number>();
    for (let value = focus.min; value <= focus.max; value += coarse)
      candidates.add(value);
    candidates.add(focus.max);
    let best = { value: focus.value, score: -1 };
    for (const value of candidates) {
      await this.controls!.set('focus', value, 'manual');
      const score = await this.measureSettledFocus(screens);
      if (score > best.score) best = { value, score };
    }
    const from = clamp(best.value - coarse, focus.min, focus.max);
    const to = clamp(best.value + coarse, focus.min, focus.max);
    for (let value = from; value <= to; value += step) {
      await this.controls!.set('focus', value, 'manual');
      const score = await this.measureSettledFocus(screens);
      if (score > best.score) best = { value, score };
    }
    await this.controls!.set('focus', best.value, 'manual');
    await delay(180);
    const verification = await measureFocus(await this.freshFrame(), screens);
    return {
      value: best.value,
      score: verification.score,
      min: focus.min,
      max: focus.max,
    };
  }

  private async measureSettledFocus(screens: readonly ImagingScreen[]) {
    await delay(220);
    await this.freshFrame();
    await this.freshFrame();
    const scores: number[] = [];
    for (let index = 0; index < 3; index += 1)
      scores.push((await measureFocus(await this.freshFrame(), screens)).score);
    scores.sort((left, right) => left - right);
    return scores[1] ?? scores[0] ?? 0;
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
    return measureExposure(await this.freshFrame(), this.screens());
  }

  private async currentCalibrationExposureReading() {
    return measureExposure(await this.freshFrame(), this.screens(), {
      region: CALIBRATION_EXPOSURE_REGION,
    });
  }

  private async applyExposureAdjustment(
    metrics: LumaMetrics,
    direction: 'too-bright' | 'too-dark',
    background: boolean,
  ): Promise<boolean> {
    if (!this.controls || this.adjusting) return false;
    this.adjusting = true;
    try {
      const values = await this.controls.read();
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

      await this.controls.set('exposure', nextExposure, 'manual');
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
    } finally {
      this.adjusting = false;
    }
  }

  private async freshFrame() {
    const info = this.stream.getInfo();
    if (info.state !== 'running' && info.state !== 'starting')
      throw new RobotArmError(
        'VISION_UNAVAILABLE',
        info.error ?? 'Camera is not running',
      );
    return (await this.stream.getFrame({ fresh: true, timeoutMs: 3_000 })).jpeg;
  }

  private async persist(stored: StoredCameraImaging) {
    await mkdir(this.directory, { recursive: true });
    const file = cameraImagingFile(this.directory, this.camera.id);
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(stored, null, 2), {
      mode: 0o600,
    });
    await rename(temporary, file);
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
