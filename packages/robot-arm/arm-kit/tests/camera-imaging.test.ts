import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  CameraControlMode,
  CameraControlProperty,
  CameraControlValue,
  CameraHardwareControl,
} from '@midscene/robotics-vision/camera/types';
import { describe, expect, it } from '@rstest/core';
import sharp from 'sharp';
import {
  CALIBRATION_EXPOSURE_REGION,
  classifyExposureExtreme,
  exposureTargetDirection,
  measureExposure,
  measureFocus,
  measureTone,
  measureWhiteBalance,
} from '../src/camera/imaging-metrics.js';
import {
  CameraImagingController,
  cameraImagingFile,
} from '../src/camera/imaging.js';
import type { CameraCorrection } from '../src/contracts.js';

class FakeCameraControl implements CameraHardwareControl {
  readonly deviceId = 'camera';
  readonly setCalls: Array<{
    property: CameraControlProperty;
    value: number;
    mode: CameraControlMode;
  }> = [];
  values: Record<CameraControlProperty, CameraControlValue> = {
    exposure: {
      property: 'exposure',
      value: -5,
      mode: 'auto',
      min: -11,
      max: -2,
      step: 1,
      default: -5,
      supportsAuto: true,
      supportsManual: true,
    },
    focus: {
      property: 'focus',
      value: 100,
      mode: 'auto',
      min: 0,
      max: 250,
      step: 5,
      default: 100,
      supportsAuto: true,
      supportsManual: true,
    },
    gain: {
      property: 'gain',
      value: 0,
      mode: 'manual',
      min: 0,
      max: 255,
      step: 1,
      default: 0,
      supportsAuto: false,
      supportsManual: true,
    },
    brightness: {
      property: 'brightness',
      value: 128,
      mode: 'manual',
      min: 0,
      max: 255,
      step: 1,
      default: 128,
      supportsAuto: false,
      supportsManual: true,
    },
    contrast: {
      property: 'contrast',
      value: 128,
      mode: 'manual',
      min: 0,
      max: 255,
      step: 1,
      default: 128,
      supportsAuto: false,
      supportsManual: true,
    },
    whiteBalance: {
      property: 'whiteBalance',
      value: 4000,
      mode: 'auto',
      min: 2000,
      max: 6500,
      step: 1,
      default: 4000,
      supportsAuto: true,
      supportsManual: true,
    },
  };

  async read() {
    return structuredClone(this.values);
  }

  async set(
    property: CameraControlProperty,
    value: number,
    mode: CameraControlMode,
  ) {
    this.setCalls.push({ property, value, mode });
    this.values[property] = { ...this.values[property], value, mode };
  }

  async close() {}
}

async function calibrationPattern(warm = false) {
  const levels = [245, 221, 184, 143, 103, 65, 23].map((value) => ({
    r: warm ? Math.min(255, value * 1.12) : value,
    g: value,
    b: warm ? value * 0.82 : value,
  }));
  const strips = levels
    .map(
      ({ r, g, b }, index) =>
        `<rect x="${Math.floor((index * 400) / 7)}" y="584" width="${Math.ceil(
          400 / 7,
        )}" height="192" fill="rgb(${Math.round(r)},${Math.round(g)},${Math.round(
          b,
        )})"/>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800"><rect width="400" height="800" fill="#cfcfcf"/><rect y="144" width="400" height="416" fill="url(#checker)"/><defs><pattern id="checker" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="black"/><rect x="8" y="8" width="8" height="8" fill="black"/></pattern></defs>${strips}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 100 }).toBuffer();
}

describe('camera imaging', () => {
  it('rejects neutral patches with a clipped colour channel', async () => {
    const strips = Array.from({ length: 7 }, (_, index) => {
      const offset = index * 2;
      return `<rect x="${Math.floor((index * 400) / 7)}" y="584" width="${Math.ceil(
        400 / 7,
      )}" height="192" fill="rgb(${220 + offset},245,255)"/>`;
    }).join('');
    const jpeg = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800"><rect width="400" height="800" fill="#cfcfcf"/>${strips}</svg>`,
      ),
    )
      .jpeg({ quality: 100 })
      .toBuffer();
    const correction: CameraCorrection = {
      points: {
        topLeft: { x: 0, y: 0 },
        topRight: { x: 399, y: 0 },
        bottomRight: { x: 399, y: 799 },
        bottomLeft: { x: 0, y: 799 },
      },
      sourceWidth: 400,
      sourceHeight: 800,
      rotation: 0,
    };

    await expect(
      measureWhiteBalance(jpeg, [{ screenId: 'screen', correction }]),
    ).resolves.toBeUndefined();
  });

  it('measures neutral white balance and a monotonic seven-step tone chart', async () => {
    const correction: CameraCorrection = {
      points: {
        topLeft: { x: 0, y: 0 },
        topRight: { x: 399, y: 0 },
        bottomRight: { x: 399, y: 799 },
        bottomLeft: { x: 0, y: 799 },
      },
      sourceWidth: 400,
      sourceHeight: 800,
      rotation: 0,
    };
    const screens = [{ screenId: 'screen', correction }];
    const neutral = await calibrationPattern(false);
    const warm = await calibrationPattern(true);

    const neutralBalance = await measureWhiteBalance(neutral, screens);
    const warmBalance = await measureWhiteBalance(warm, screens);
    const tone = await measureTone(neutral, screens);

    expect(neutralBalance?.score).toBeLessThan(
      warmBalance?.score ?? Number.POSITIVE_INFINITY,
    );
    expect(tone).toMatchObject({ monotonic: true });
    expect(tone?.spread).toBeGreaterThan(150);
  });
  it.each(['no control bridge', 'fixed focus', 'bridge failure'] as const)(
    'distinguishes %s from supported imaging',
    async (scenario) => {
      const control = new FakeCameraControl();
      if (scenario === 'fixed focus')
        control.values.focus.supportsManual = false;
      const imaging = new CameraImagingController(
        { id: 'camera', name: 'Camera', backend: 'dshow' },
        {} as never,
        tmpdir(),
        undefined,
        async () => {
          if (scenario === 'bridge failure')
            throw new Error('Driver unavailable');
          return scenario === 'fixed focus' ? control : undefined;
        },
      );
      imaging.registerScreen('screen', () => ({
        points: {
          topLeft: { x: 0, y: 0 },
          topRight: { x: 99, y: 0 },
          bottomRight: { x: 99, y: 199 },
          bottomLeft: { x: 0, y: 199 },
        },
        sourceWidth: 100,
        sourceHeight: 200,
        rotation: 0,
      }));
      await imaging.releaseForCorrection();
      expect(imaging.status().state).toBe(
        scenario === 'bridge failure' ? 'error' : 'unsupported',
      );
      if (scenario === 'bridge failure') {
        await expect(imaging.calibrate()).rejects.toThrow('Driver unavailable');
        expect(imaging.status().state).toBe('error');
      } else {
        await expect(imaging.calibrate()).resolves.toMatchObject({
          state: 'unsupported',
        });
        expect(control.setCalls).toEqual([]);
      }
      await imaging.close();
    },
  );

  it('samples only the white calibration tile for exposure convergence', async () => {
    const jpeg = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800">' +
          '<rect width="400" height="800" fill="black"/>' +
          '<rect x="24" y="656" width="84" height="104" fill="white"/>' +
          '</svg>',
      ),
    )
      .jpeg({ quality: 100 })
      .toBuffer();
    const correction: CameraCorrection = {
      points: {
        topLeft: { x: 0, y: 0 },
        topRight: { x: 399, y: 0 },
        bottomRight: { x: 399, y: 799 },
        bottomLeft: { x: 0, y: 799 },
      },
      sourceWidth: 400,
      sourceHeight: 800,
      rotation: 0,
    };
    const screens = [{ screenId: 'screen', correction }];

    const full = await measureExposure(jpeg, screens);
    const calibration = await measureExposure(jpeg, screens, {
      region: CALIBRATION_EXPOSURE_REGION,
    });

    expect(full.selected.mean).toBeLessThan(80);
    expect(calibration.selected.mean).toBeGreaterThan(220);
  });

  it('matches the service overexposure and underexposure thresholds', () => {
    const base = {
      mean: 120,
      stddev: 20,
      brightRatio: 0.5,
      darkRatio: 0.1,
      p95: 180,
      p99: 205,
      overExposedRatio: 0,
      underExposedRatio: 0,
      hiTileRatio: 0,
      hiComponentCount: 0,
      hiComponentLargestShare: 0,
    };
    expect(
      classifyExposureExtreme({
        ...base,
        p95: 240,
        p99: 250,
        overExposedRatio: 0.25,
      }),
    ).toBe('too-bright');
    expect(
      classifyExposureExtreme({
        ...base,
        mean: 205,
        brightRatio: 0.95,
      }),
    ).toBe('too-bright');
    expect(
      classifyExposureExtreme({
        ...base,
        mean: 120,
        p95: 235,
        overExposedRatio: 0.03,
        hiTileRatio: 0.4,
        hiComponentCount: 2,
        hiComponentLargestShare: 0.6,
      }),
    ).toBe('too-bright');
    expect(
      classifyExposureExtreme({
        ...base,
        mean: 65,
        p95: 110,
        p99: 135,
        darkRatio: 0.25,
      }),
    ).toBe('too-dark');
    expect(
      classifyExposureExtreme({
        ...base,
        mean: 65,
        p95: 111,
        p99: 135,
        darkRatio: 0.25,
      }),
    ).toBeUndefined();
    expect(
      exposureTargetDirection({
        ...base,
        mean: 120,
        p99: 236,
        overExposedRatio: 0,
      }),
    ).toBe('too-bright');
    expect(
      exposureTargetDirection({
        ...base,
        mean: 181,
        p99: 205,
        overExposedRatio: 0,
      }),
    ).toBe('too-bright');
    expect(
      exposureTargetDirection({
        ...base,
        mean: 89,
        p99: 205,
        overExposedRatio: 0,
      }),
    ).toBe('too-dark');
    expect(
      exposureTargetDirection(
        {
          ...base,
          mean: 29,
          p99: 205,
          overExposedRatio: 0,
        },
        true,
      ),
    ).toBe('too-dark');
    expect(
      exposureTargetDirection(
        {
          ...base,
          mean: 30,
          p99: 205,
          overExposedRatio: 0,
        },
        true,
      ),
    ).toBeUndefined();
  });

  it('ranks a sharp focus chart above a blurred chart', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800">' +
      '<rect width="400" height="800" fill="white"/>' +
      '<text x="20" y="80" font-size="34" font-family="monospace" fill="black">FOCUS 0123456789</text>' +
      '<rect y="120" width="400" height="500" fill="url(#checker)"/>' +
      '<defs><pattern id="checker" width="16" height="16" patternUnits="userSpaceOnUse">' +
      '<rect width="8" height="8" fill="black"/><rect x="8" y="8" width="8" height="8" fill="black"/>' +
      '</pattern></defs></svg>';
    const sharpJpeg = await sharp(Buffer.from(svg))
      .greyscale()
      .jpeg({ quality: 95 })
      .toBuffer();
    const blurredJpeg = await sharp(sharpJpeg)
      .blur(3)
      .jpeg({ quality: 95 })
      .toBuffer();
    const correction: CameraCorrection = {
      points: {
        topLeft: { x: 0, y: 0 },
        topRight: { x: 399, y: 0 },
        bottomRight: { x: 399, y: 799 },
        bottomLeft: { x: 0, y: 799 },
      },
      sourceWidth: 400,
      sourceHeight: 800,
      rotation: 0,
    };
    const screens = [{ screenId: 'screen', correction }];
    const sharpScore = (await measureFocus(sharpJpeg, screens)).score;
    const blurredScore = (await measureFocus(blurredJpeg, screens)).score;

    expect(sharpScore).toBeGreaterThan(blurredScore);
    expect(
      exposureTargetDirection({
        mean: 50,
        stddev: 10,
        brightRatio: 0.2,
        darkRatio: 0.7,
        p95: 80,
        p99: 100,
        overExposedRatio: 0,
        underExposedRatio: 0.6,
        hiTileRatio: 0,
        hiComponentCount: 0,
        hiComponentLargestShare: 0,
      }),
    ).toBe('too-dark');
  });

  it('retries the control bridge and keeps a locked focus during exposure changes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'camera-imaging-'));
    const jpeg = await calibrationPattern();
    const darkJpeg = await sharp({
      create: {
        width: 400,
        height: 800,
        channels: 3,
        background: { r: 8, g: 8, b: 8 },
      },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
    let currentJpeg = jpeg;
    const actualFps = 30;
    let frameId = 1;
    const correction: CameraCorrection = {
      points: {
        topLeft: { x: 0, y: 0 },
        topRight: { x: 399, y: 0 },
        bottomRight: { x: 399, y: 799 },
        bottomLeft: { x: 0, y: 799 },
      },
      sourceWidth: 400,
      sourceHeight: 800,
      rotation: 0,
    };
    const stream = {
      getInfo: () => ({
        state: 'running',
        width: 400,
        height: 800,
        fps: 30,
        frameId,
        hasFrame: true,
        actualFps,
      }),
      getFrame: async () => ({
        id: ++frameId,
        capturedAt: Date.now(),
        jpeg: currentJpeg,
      }),
    };
    const control = new FakeCameraControl();
    let factoryCalls = 0;
    const imaging = new CameraImagingController(
      { id: 'camera', name: 'Camera', backend: 'dshow' },
      stream as never,
      directory,
      undefined,
      async () => {
        factoryCalls++;
        return control;
      },
    );
    imaging.registerScreen('screen', () => correction);
    try {
      const status = await imaging.calibrate();
      expect(factoryCalls).toBe(1);
      expect(status.state).toBe('ready');
      expect(control.values.focus.mode).toBe('manual');
      expect(control.values.exposure.mode).toBe('manual');
      expect(control.values.brightness.mode).toBe('manual');
      expect(control.values.contrast.mode).toBe('manual');
      expect(control.values.whiteBalance.mode).toBe('manual');
      expect(control.values.gain.mode).toBe('manual');
      expect(
        control.setCalls.some(
          (call) => call.property === 'exposure' && call.mode === 'auto',
        ),
      ).toBe(false);
      expect(
        (imaging as unknown as { monitor?: unknown }).monitor,
      ).toBeUndefined();
      const focusBefore = control.values.focus.value;
      const brightnessBefore = control.values.brightness.value;
      const gainBefore = control.values.gain.value;
      control.values.exposure = {
        ...control.values.exposure,
        value: -8,
        mode: 'manual',
      };
      control.setCalls.length = 0;
      currentJpeg = darkJpeg;
      const controller = imaging as unknown as {
        lastSampleAt: number;
        lastAdjustAt: number;
        monitorExposure(): Promise<void>;
      };
      controller.lastSampleAt = 0;
      controller.lastAdjustAt = 0;
      await controller.monitorExposure();
      controller.lastSampleAt = 0;
      controller.lastAdjustAt = 0;
      await controller.monitorExposure();
      expect(control.values.exposure.value).not.toBe(-8);
      expect(
        control.setCalls.every((call) => call.property === 'exposure'),
      ).toBe(true);
      expect(control.values.exposure.mode).toBe('manual');
      expect(control.values.brightness.value).toBe(brightnessBefore);
      expect(control.values.brightness.mode).toBe('manual');
      expect(control.values.gain.value).toBe(gainBefore);
      expect(control.values.gain.mode).toBe('manual');
      expect(control.values.focus).toMatchObject({
        value: focusBefore,
        mode: 'manual',
      });
      control.setCalls.length = 0;
      await (
        imaging as unknown as {
          applyExposureAdjustment(
            metrics: Record<string, number>,
            direction: 'too-dark',
            background: boolean,
          ): Promise<boolean>;
        }
      ).applyExposureAdjustment(
        {
          mean: 20,
          stddev: 5,
          brightRatio: 0.1,
          darkRatio: 0.8,
          p95: 30,
          p99: 50,
          overExposedRatio: 0,
          underExposedRatio: 0.8,
          hiTileRatio: 0,
          hiComponentCount: 0,
          hiComponentLargestShare: 0,
        },
        'too-dark',
        true,
      );
      expect(
        control.setCalls.every((call) => call.property === 'exposure'),
      ).toBe(true);
      expect(control.values.focus).toMatchObject({
        value: focusBefore,
        mode: 'manual',
      });
      expect(control.values.exposure.mode).toBe('manual');
      expect(control.values.brightness.value).toBe(brightnessBefore);
      expect(control.values.gain.value).toBe(gainBefore);

      await imaging.releaseForCorrection();
      expect(imaging.status().state).toBe('released');
      expect(control.values.focus.mode).toBe('auto');
      expect(control.values.exposure.mode).toBe('auto');
      expect(control.values.brightness.mode).toBe('manual');
      expect(control.values.contrast.mode).toBe('manual');
      expect(control.values.whiteBalance.mode).toBe('auto');
      expect(control.values.gain.mode).toBe('manual');

      currentJpeg = jpeg;
      const retuned = await imaging.calibrate();
      expect(retuned.state).toBe('ready');
      expect(control.values.focus.mode).toBe('manual');
      expect(control.values.exposure.mode).toBe('manual');
      expect(control.values.brightness.mode).toBe('manual');
      expect(control.values.contrast.mode).toBe('manual');
      expect(control.values.whiteBalance.mode).toBe('manual');
      expect(control.values.gain.mode).toBe('manual');
      expect(
        (imaging as unknown as { monitor?: unknown }).monitor,
      ).toBeUndefined();
    } finally {
      await imaging.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('calibrates an AVFoundation-style camera without Windows tone controls', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'camera-imaging-'));
    const jpeg = await calibrationPattern();
    const correction: CameraCorrection = {
      points: {
        topLeft: { x: 0, y: 0 },
        topRight: { x: 399, y: 0 },
        bottomRight: { x: 399, y: 799 },
        bottomLeft: { x: 0, y: 799 },
      },
      sourceWidth: 400,
      sourceHeight: 800,
      rotation: 0,
    };
    const stream = {
      getInfo: () => ({
        state: 'running',
        width: 400,
        height: 800,
        fps: 30,
        frameId: 1,
        hasFrame: true,
        actualFps: 30,
      }),
      getFrame: async () => ({
        id: 1,
        capturedAt: Date.now(),
        jpeg,
      }),
    };
    const control = new FakeCameraControl();
    control.values = {
      focus: {
        property: 'focus',
        value: 0.35,
        mode: 'auto',
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.35,
        supportsAuto: true,
        supportsManual: true,
      },
      exposure: {
        property: 'exposure',
        value: -6,
        mode: 'auto',
        min: -12,
        max: -1,
        step: 1,
        default: -6,
        supportsAuto: true,
        supportsManual: true,
      },
      gain: {
        property: 'gain',
        value: 100,
        mode: 'auto',
        min: 100,
        max: 1600,
        step: 1,
        default: 100,
        supportsAuto: true,
        supportsManual: true,
      },
      whiteBalance: {
        property: 'whiteBalance',
        value: 5_000,
        mode: 'auto',
        min: 2_000,
        max: 10_000,
        step: 100,
        default: 5_000,
        supportsAuto: true,
        supportsManual: true,
      },
      brightness: {
        property: 'brightness',
        value: 0,
        mode: 'auto',
        min: 0,
        max: 0,
        step: 1,
        default: 0,
        supportsAuto: false,
        supportsManual: false,
      },
      contrast: {
        property: 'contrast',
        value: 0,
        mode: 'auto',
        min: 0,
        max: 0,
        step: 1,
        default: 0,
        supportsAuto: false,
        supportsManual: false,
      },
    };
    const imaging = new CameraImagingController(
      { id: 'camera', name: 'macOS Camera', backend: 'avfoundation' },
      stream as never,
      directory,
      control,
    );
    imaging.registerScreen('screen', () => correction);
    try {
      const status = await imaging.calibrate();
      expect(status.state).toBe('ready');
      expect(control.values.focus.mode).toBe('manual');
      expect(control.values.exposure.mode).toBe('manual');
      expect(control.values.whiteBalance.mode).toBe('manual');
      expect(
        control.setCalls.some(
          (call) =>
            call.property === 'brightness' || call.property === 'contrast',
        ),
      ).toBe(false);
    } finally {
      await imaging.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('waits for both saved screens before restoring focus and exposure', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'camera-imaging-'));
    const control = new FakeCameraControl();
    const correction: CameraCorrection = {
      points: {
        topLeft: { x: 0, y: 0 },
        topRight: { x: 399, y: 0 },
        bottomRight: { x: 399, y: 799 },
        bottomLeft: { x: 0, y: 799 },
      },
      sourceWidth: 400,
      sourceHeight: 800,
      rotation: 0,
    };
    const screenIds = ['screen', 'second-screen'];
    const file = cameraImagingFile(directory, control.deviceId);
    await writeFile(
      file,
      JSON.stringify({
        version: 4,
        cameraId: control.deviceId,
        rois: screenIds.map((screenId) => ({
          screenId,
          fingerprint: createHash('sha256')
            .update(JSON.stringify([screenId, correction]))
            .digest('hex'),
        })),
        focus: { value: 45, score: 1 },
        exposure: { value: -8 },
        calibratedAt: new Date().toISOString(),
      }),
    );
    const stream = {
      getInfo: () => ({ state: 'running', fps: 30 }),
      getFrame: async () => ({ jpeg: Buffer.alloc(0) }),
    };
    const imaging = new CameraImagingController(
      { id: control.deviceId, name: 'Camera', backend: 'dshow' },
      stream as never,
      directory,
      control,
    );
    try {
      await imaging.load();
      imaging.registerScreen(screenIds[0], () => correction);
      await imaging.resumeStored();
      expect(imaging.status().state).toBe('idle');
      expect(control.setCalls).toHaveLength(0);
      await expect(readFile(file, 'utf8')).resolves.toContain('second-screen');

      imaging.registerScreen(screenIds[1], () => correction);
      await imaging.resumeStored();

      expect(imaging.status()).toMatchObject({
        state: 'ready',
        focus: 45,
        exposure: -8,
      });
      expect(control.values.focus).toMatchObject({
        value: 45,
        mode: 'manual',
      });
      expect(control.values.exposure).toMatchObject({
        value: -8,
        mode: 'manual',
      });

      await imaging.clearPerspectiveBinding();

      expect(imaging.status().state).toBe('released');
      expect(control.values.focus.mode).toBe('auto');
      expect(control.values.exposure.mode).toBe('auto');
      await expect(readFile(file, 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await imaging.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('invalidates a persisted v5 profile with clipped white balance', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'camera-imaging-'));
    const control = new FakeCameraControl();
    const correction: CameraCorrection = {
      points: {
        topLeft: { x: 0, y: 0 },
        topRight: { x: 399, y: 0 },
        bottomRight: { x: 399, y: 799 },
        bottomLeft: { x: 0, y: 799 },
      },
      sourceWidth: 400,
      sourceHeight: 800,
      rotation: 0,
    };
    const screenId = 'screen';
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([screenId, correction]))
      .digest('hex');
    await writeFile(
      cameraImagingFile(directory, control.deviceId),
      JSON.stringify({
        version: 5,
        cameraId: control.deviceId,
        rois: [{ screenId, fingerprint }],
        focus: { value: 45, score: 1 },
        exposure: { value: -8 },
        whiteBalance: { value: 2000 },
        brightness: { value: 120 },
        contrast: { value: 160 },
        calibratedAt: new Date().toISOString(),
      }),
    );
    const imaging = new CameraImagingController(
      { id: control.deviceId, name: 'Camera', backend: 'dshow' },
      { getInfo: () => ({ state: 'running', fps: 30 }) } as never,
      directory,
      control,
    );
    try {
      await imaging.load();
      imaging.registerScreen(screenId, () => correction);
      await imaging.resumeStored();
      expect(imaging.status().state).toBe('idle');
      expect(control.setCalls).toEqual([]);
    } finally {
      await imaging.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('restores the full camera profile and releases it to the original modes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'camera-imaging-'));
    const control = new FakeCameraControl();
    const correction: CameraCorrection = {
      points: {
        topLeft: { x: 0, y: 0 },
        topRight: { x: 399, y: 0 },
        bottomRight: { x: 399, y: 799 },
        bottomLeft: { x: 0, y: 799 },
      },
      sourceWidth: 400,
      sourceHeight: 800,
      rotation: 0,
    };
    const screenId = 'screen';
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([screenId, correction]))
      .digest('hex');
    const file = cameraImagingFile(directory, control.deviceId);
    await writeFile(
      file,
      JSON.stringify({
        version: 6,
        cameraId: control.deviceId,
        rois: [{ screenId, fingerprint }],
        focus: { value: 45, score: 1 },
        exposure: { value: -8 },
        gain: { value: 16 },
        whiteBalance: { value: 4800 },
        brightness: { value: 132 },
        contrast: { value: 136 },
        original: {
          focus: { value: 100, mode: 'auto' },
          exposure: { value: -5, mode: 'auto' },
          gain: { value: 0, mode: 'manual' },
          whiteBalance: { value: 4000, mode: 'auto' },
          brightness: { value: 128, mode: 'manual' },
          contrast: { value: 128, mode: 'manual' },
        },
        calibratedAt: new Date().toISOString(),
      }),
    );
    const stream = {
      getInfo: () => ({ state: 'running', fps: 30 }),
      getFrame: async () => ({ jpeg: Buffer.alloc(0) }),
    };
    const imaging = new CameraImagingController(
      { id: control.deviceId, name: 'Camera', backend: 'dshow' },
      stream as never,
      directory,
      control,
    );
    try {
      await imaging.load();
      imaging.registerScreen(screenId, () => correction);
      await imaging.resumeStored();
      expect(control.values).toMatchObject({
        focus: { value: 45, mode: 'manual' },
        exposure: { value: -8, mode: 'manual' },
        gain: { value: 16, mode: 'manual' },
        whiteBalance: { value: 4800, mode: 'manual' },
        brightness: { value: 132, mode: 'manual' },
        contrast: { value: 136, mode: 'manual' },
      });

      await imaging.releaseForCorrection();
      expect(control.values).toMatchObject({
        focus: { value: 100, mode: 'auto' },
        exposure: { value: -5, mode: 'auto' },
        gain: { value: 0, mode: 'manual' },
        whiteBalance: { value: 4000, mode: 'auto' },
        brightness: { value: 128, mode: 'manual' },
        contrast: { value: 128, mode: 'manual' },
      });
    } finally {
      await imaging.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('raises gain only after the frame-safe exposure range cannot reach target', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'camera-imaging-'));
    const control = new FakeCameraControl();
    control.values.gain = {
      property: 'gain',
      value: 100,
      mode: 'manual',
      min: 100,
      max: 1600,
      step: 1,
      default: 100,
      supportsAuto: false,
      supportsManual: true,
    };
    control.values.exposure = {
      ...control.values.exposure,
      value: -8,
      mode: 'manual',
    };
    const stream = {
      getInfo: () => ({
        state: 'running',
        width: 400,
        height: 800,
        fps: 30,
        frameId: 1,
        hasFrame: true,
        actualFps: 30,
      }),
      getFrame: async () => ({
        id: 1,
        capturedAt: Date.now(),
        jpeg: Buffer.alloc(0),
      }),
    };
    const imaging = new CameraImagingController(
      { id: 'camera', name: 'Camera', backend: 'dshow' },
      stream as never,
      directory,
      control,
    );
    const correction: CameraCorrection = {
      points: {
        topLeft: { x: 0, y: 0 },
        topRight: { x: 399, y: 0 },
        bottomRight: { x: 399, y: 799 },
        bottomLeft: { x: 0, y: 799 },
      },
      sourceWidth: 400,
      sourceHeight: 800,
      rotation: 0,
    };
    const controller = imaging as unknown as {
      currentCalibrationExposureReading(): Promise<{
        selected: {
          mean: number;
          stddev: number;
          brightRatio: number;
          darkRatio: number;
          p95: number;
          p99: number;
          overExposedRatio: number;
          underExposedRatio: number;
          hiTileRatio: number;
          hiComponentCount: number;
          hiComponentLargestShare: number;
        };
        updatedAt: number;
      }>;
      optimizeExposureAndGain(
        screens: Array<{ screenId: string; correction: CameraCorrection }>,
      ): Promise<{ value: number; gain?: number }>;
    };
    controller.currentCalibrationExposureReading = async () => {
      const mean = Math.min(
        254,
        96 +
          (control.values.exposure.value + 11) * 4 +
          (control.values.gain.value - 100) * 1.35,
      );
      return {
        selected: {
          mean,
          stddev: 8,
          brightRatio: 0.8,
          darkRatio: 0.05,
          p95: Math.min(255, mean + 10),
          p99: Math.min(255, mean + 20),
          overExposedRatio: Math.max(0, (mean - 245) / 20),
          underExposedRatio: Math.max(0, (175 - mean) / 175),
          hiTileRatio: 0,
          hiComponentCount: 0,
          hiComponentLargestShare: 0,
        },
        updatedAt: Date.now(),
      };
    };
    try {
      const result = await controller.optimizeExposureAndGain([
        { screenId: 'screen', correction },
      ]);
      expect(result.value).toBe(-5);
      expect(result.gain).toBeGreaterThan(100);
      expect(control.values.exposure).toMatchObject({
        value: -5,
        mode: 'manual',
      });
      expect(control.values.gain.mode).toBe('manual');
    } finally {
      await imaging.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 10_000);

  it('applies the service exposure direction within the safe exposure window', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'camera-imaging-'));
    const control = new FakeCameraControl();
    control.values.exposure = {
      ...control.values.exposure,
      value: -2,
      mode: 'manual',
    };
    const stream = {
      getInfo: () => ({
        state: 'running',
        width: 400,
        height: 800,
        fps: 30,
        frameId: 1,
        hasFrame: true,
        actualFps: 30,
      }),
      getFrame: async () => ({
        id: 1,
        capturedAt: Date.now(),
        jpeg: Buffer.alloc(0),
      }),
    };
    const imaging = new CameraImagingController(
      { id: 'camera', name: 'Camera', backend: 'dshow' },
      stream as never,
      directory,
      control,
    );
    const brightMetrics = {
      mean: 245,
      stddev: 5,
      brightRatio: 1,
      darkRatio: 0,
      p95: 254,
      p99: 254,
      overExposedRatio: 0.95,
      underExposedRatio: 0,
      hiTileRatio: 0.8,
      hiComponentCount: 1,
      hiComponentLargestShare: 0.9,
    };
    const darkMetrics = {
      ...brightMetrics,
      mean: 20,
      brightRatio: 0.1,
      darkRatio: 0.8,
      p95: 30,
      p99: 50,
      overExposedRatio: 0,
      underExposedRatio: 0.8,
      hiTileRatio: 0,
    };
    const controller = imaging as unknown as {
      applyExposureAdjustment(
        metrics: Record<string, number>,
        direction: 'too-bright' | 'too-dark',
        background: boolean,
      ): Promise<boolean>;
    };
    try {
      expect(
        await controller.applyExposureAdjustment(
          brightMetrics,
          'too-bright',
          true,
        ),
      ).toBe(true);
      expect(control.values.exposure.value).toBe(-8);
      expect(control.values.focus.mode).toBe('auto');
      expect(control.values.brightness.value).toBe(128);
      expect(control.values.gain.value).toBe(0);

      control.setCalls.length = 0;
      expect(
        await controller.applyExposureAdjustment(darkMetrics, 'too-dark', true),
      ).toBe(true);
      expect(control.values.exposure.value).toBe(-6);
      expect(
        control.setCalls.every((call) => call.property === 'exposure'),
      ).toBe(true);
      expect(control.values.brightness.value).toBe(128);
      expect(control.values.gain.value).toBe(0);

      control.values.exposure = {
        ...control.values.exposure,
        value: -10,
        mode: 'manual',
      };
      expect(
        await controller.applyExposureAdjustment(
          brightMetrics,
          'too-bright',
          true,
        ),
      ).toBe(true);
      expect(control.values.exposure.value).toBe(-11);

      control.values.exposure = {
        ...control.values.exposure,
        value: -2,
        mode: 'manual',
      };
      expect(
        await controller.applyExposureAdjustment(darkMetrics, 'too-dark', true),
      ).toBe(true);
      expect(control.values.exposure.value).toBe(-5);

      control.values.exposure = {
        ...control.values.exposure,
        value: -5,
        mode: 'manual',
      };
      expect(
        await controller.applyExposureAdjustment(darkMetrics, 'too-dark', true),
      ).toBe(false);
      expect(control.values.exposure.value).toBe(-5);
    } finally {
      await imaging.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 10_000);

  it('converges calibration exposure from overexposed ROI samples', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'camera-imaging-'));
    const control = new FakeCameraControl();
    control.values.exposure = {
      ...control.values.exposure,
      value: -5,
      mode: 'manual',
    };
    const stream = {
      getInfo: () => ({
        state: 'running',
        width: 400,
        height: 800,
        fps: 30,
        frameId: 1,
        hasFrame: true,
        actualFps: 30,
      }),
      getFrame: async () => ({
        id: 1,
        capturedAt: Date.now(),
        jpeg: Buffer.alloc(0),
      }),
    };
    const imaging = new CameraImagingController(
      { id: 'camera', name: 'Camera', backend: 'dshow' },
      stream as never,
      directory,
      control,
    );
    const metrics = {
      mean: 250,
      stddev: 3,
      brightRatio: 1,
      darkRatio: 0,
      p95: 255,
      p99: 255,
      overExposedRatio: 1,
      underExposedRatio: 0,
      hiTileRatio: 1,
      hiComponentCount: 1,
      hiComponentLargestShare: 1,
    };
    const controller = imaging as unknown as {
      currentCalibrationExposureReading(): Promise<{
        selected: typeof metrics;
        updatedAt: number;
      }>;
      convergeExposureForCalibration(): Promise<void>;
    };
    controller.currentCalibrationExposureReading = async () => ({
      selected: metrics,
      updatedAt: Date.now(),
    });
    try {
      await controller.convergeExposureForCalibration();
      expect(control.values.exposure).toMatchObject({
        value: -11,
        mode: 'manual',
      });
      expect(
        control.setCalls.some(
          (call) => call.property === 'exposure' && call.mode === 'auto',
        ),
      ).toBe(false);
    } finally {
      await imaging.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 10_000);

  it('keeps background exposure changes limited to extreme samples', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'camera-imaging-'));
    const control = new FakeCameraControl();
    control.values.exposure = {
      ...control.values.exposure,
      value: -6,
      mode: 'manual',
    };
    const stream = {
      getInfo: () => ({
        state: 'running',
        width: 400,
        height: 800,
        fps: 30,
        frameId: 1,
        hasFrame: true,
        actualFps: 30,
      }),
      getFrame: async () => ({
        id: 1,
        capturedAt: Date.now(),
        jpeg: Buffer.alloc(0),
      }),
    };
    const imaging = new CameraImagingController(
      { id: 'camera', name: 'Camera', backend: 'dshow' },
      stream as never,
      directory,
      control,
    );
    const metrics = {
      mean: 181,
      stddev: 20,
      brightRatio: 0.8,
      darkRatio: 0.05,
      p95: 239,
      p99: 240,
      overExposedRatio: 0.1,
      underExposedRatio: 0,
      hiTileRatio: 0.23,
      hiComponentCount: 3,
      hiComponentLargestShare: 0.7,
    };
    const controller = imaging as unknown as {
      applied: boolean;
      lastAdjustAt: number;
      lastSampleAt: number;
      currentExposureReading(): Promise<{
        selected: typeof metrics;
        updatedAt: number;
      }>;
      monitorExposure(): Promise<void>;
    };
    controller.applied = true;
    controller.currentExposureReading = async () => ({
      selected: metrics,
      updatedAt: Date.now(),
    });
    control.setCalls.length = 0;
    try {
      controller.lastSampleAt = 0;
      controller.lastAdjustAt = 0;
      await controller.monitorExposure();
      controller.lastSampleAt = 0;
      controller.lastAdjustAt = 0;
      await controller.monitorExposure();
      expect(control.values.exposure.value).toBe(-6);
      expect(control.setCalls).toHaveLength(0);
    } finally {
      await imaging.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps the hardware exposure range open and follows the frame budget', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'camera-imaging-'));
    const control = new FakeCameraControl();
    control.values.exposure = {
      ...control.values.exposure,
      value: -5,
      mode: 'manual',
    };
    const stream = {
      getInfo: () => ({
        state: 'running',
        width: 400,
        height: 800,
        fps: 10,
        frameId: 1,
        hasFrame: true,
        actualFps: 10,
      }),
      getFrame: async () => ({
        id: 1,
        capturedAt: Date.now(),
        jpeg: Buffer.alloc(0),
      }),
    };
    const imaging = new CameraImagingController(
      { id: 'camera', name: 'Camera', backend: 'dshow' },
      stream as never,
      directory,
      control,
    );
    try {
      expect(
        await (
          imaging as unknown as {
            applyExposureAdjustment(
              metrics: Record<string, number>,
              direction: 'too-dark',
              background: boolean,
            ): Promise<boolean>;
          }
        ).applyExposureAdjustment(
          {
            mean: 50,
            stddev: 10,
            brightRatio: 0.2,
            darkRatio: 0.6,
            p95: 90,
            p99: 110,
            overExposedRatio: 0,
            underExposedRatio: 0.3,
            hiTileRatio: 0,
            hiComponentCount: 0,
            hiComponentLargestShare: 0,
          },
          'too-dark',
          true,
        ),
      ).toBe(true);
      expect(control.values.exposure.value).toBe(-4);
      expect(control.values.focus.mode).toBe('auto');
      expect(control.values.brightness.value).toBe(128);
      expect(control.values.gain.value).toBe(0);
    } finally {
      await imaging.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
