import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { RobotVisionError } from './errors.js';
import { JpegProcessCameraSource } from './jpeg-process-camera-source.js';
import { buildCameraApp, openCameraApp } from './macos-camera-app.js';
import { MacosCameraHardwareControl } from './macos-camera-control.js';
import type {
  CameraBackend,
  CameraDevice,
  CameraHardwareControl,
  CameraSource,
  ResolvedCameraStreamOptions,
} from './types.js';
import { filterPhysicalCameras } from './virtual-camera-filter.js';

const execFileAsync = promisify(execFile);

interface NativeDevice {
  uid: string;
  name: string;
  deviceType?: string;
  formats: { width: number; height: number; minFps: number; maxFps: number }[];
}

function defaultCaptureSettings(device: NativeDevice) {
  const modes = device.formats.flatMap((format) => {
    // The API uses nominal integer FPS; AVFoundation clamps to the exact range
    // (for example 29.97/59.94 FPS) before configuring the hardware duration.
    const minFps = Math.max(1, Math.ceil(format.minFps - 0.15));
    const maxFps = Math.min(120, Math.floor(format.maxFps + 0.15));
    if (minFps > maxFps) return [];
    return [
      {
        width: format.width,
        height: format.height,
        fps: Math.max(minFps, Math.min(30, maxFps)),
      },
    ];
  });
  modes.sort(
    (a, b) =>
      b.width * b.height - a.width * a.height ||
      Math.abs(a.fps - 30) - Math.abs(b.fps - 30) ||
      b.width - a.width,
  );
  // Keep default capture around 1080p even when a camera advertises 4K/8K.
  // If every mode is larger, use the smallest supported resolution.
  const smallest = modes.at(-1);
  const preferred =
    modes.find((mode) => mode.width <= 1920 && mode.height <= 1080) ??
    modes.find(
      (mode) =>
        mode.width === smallest?.width && mode.height === smallest?.height,
    );
  if (!preferred) {
    throw new RobotVisionError(
      'STREAM_FAILED',
      `No supported capture mode for macOS camera: ${device.name}`,
    );
  }
  return preferred;
}

export interface MacosCameraBackendOptions {
  /** Precompiled helper, primarily for deployments without a Swift compiler. */
  helperPath?: string;
  includeVirtualDevices?: boolean;
  cameraAppDirectory?: string;
}

/**
 * AVFoundation capture uses the device UID and its exact activeFormat. FFmpeg's
 * AVFoundation demuxer only lists duplicate C922 names and can select a 5 FPS
 * format even when a 30 FPS format at the same size exists.
 */
export class MacosCameraBackend implements CameraBackend {
  private readonly includeVirtualDevices: boolean;
  private readonly helperPath?: string;
  private readonly cameraAppDirectory?: string;
  private appPromise?: Promise<string>;
  private helperPromise?: Promise<string>;
  private deviceCache = new Map<string, Pick<NativeDevice, 'uid' | 'name'>>();

  constructor(options: MacosCameraBackendOptions = {}) {
    this.cameraAppDirectory = options.cameraAppDirectory;
    this.helperPath =
      options.helperPath || process.env.ROBOT_VISION_MACOS_CAMERA_HELPER_PATH;
    this.includeVirtualDevices =
      options.includeVirtualDevices ??
      process.env.ROBOT_VISION_INCLUDE_VIRTUAL_DEVICES === 'true';
  }

  async listDevices(): Promise<CameraDevice[]> {
    const helper = await this.getHelper();
    let output: string;
    try {
      ({ stdout: output } = await execFileAsync(helper, ['list'], {
        encoding: 'utf8',
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
      }));
    } catch (error) {
      throw new RobotVisionError(
        'STREAM_FAILED',
        `Failed to enumerate macOS cameras: ${String(error)}`,
        error,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch (error) {
      throw new RobotVisionError(
        'STREAM_FAILED',
        `Invalid macOS camera device list: ${String(error)}`,
        error,
      );
    }
    if (
      !Array.isArray(parsed) ||
      !parsed.every(
        (item) =>
          item &&
          typeof item.uid === 'string' &&
          item.uid.length > 0 &&
          typeof item.name === 'string' &&
          (item.deviceType === undefined ||
            (typeof item.deviceType === 'string' &&
              item.deviceType.length > 0)) &&
          Array.isArray(item.formats) &&
          item.formats.every(
            (format: NativeDevice['formats'][number]) =>
              format &&
              Number.isInteger(format.width) &&
              format.width > 0 &&
              Number.isInteger(format.height) &&
              format.height > 0 &&
              Number.isFinite(format.minFps) &&
              format.minFps > 0 &&
              Number.isFinite(format.maxFps) &&
              format.maxFps >= format.minFps,
          ),
      )
    ) {
      throw new RobotVisionError(
        'STREAM_FAILED',
        'macOS camera helper returned an invalid device list',
      );
    }
    const devices = parsed as NativeDevice[];
    const physical = filterPhysicalCameras(
      devices.map((device) => ({
        id: `avfoundation:uid:${encodeURIComponent(device.uid)}`,
        name: device.name,
        backend: 'avfoundation' as const,
        deviceType: device.deviceType,
        uid: device.uid,
        native: device,
      })),
      { includeVirtual: this.includeVirtualDevices },
    ).map(({ native, ...device }) => ({
      ...device,
      defaultCaptureSettings: defaultCaptureSettings(native),
    }));
    if (new Set(physical.map((device) => device.id)).size !== physical.length) {
      throw new RobotVisionError(
        'STREAM_FAILED',
        'AVFoundation reported duplicate camera UIDs',
      );
    }
    this.deviceCache = new Map(
      physical.map((device) => [
        device.id,
        { uid: device.uid, name: device.name },
      ]),
    );
    return physical.map(
      ({ id, name, backend, deviceType, defaultCaptureSettings }) => ({
        id,
        name,
        backend,
        deviceType,
        defaultCaptureSettings,
      }),
    );
  }

  async openStream(
    options: ResolvedCameraStreamOptions,
    signal?: AbortSignal,
  ): Promise<CameraSource> {
    let device = this.deviceCache.get(options.deviceId);
    if (!device) {
      await this.listDevices();
      device = this.deviceCache.get(options.deviceId);
    }
    if (!device) {
      throw new RobotVisionError(
        'DEVICE_NOT_FOUND',
        `Camera device not found: ${options.deviceId}`,
      );
    }
    const args = [
      'capture',
      device.uid,
      String(options.width),
      String(options.height),
      String(options.fps),
      String(options.horizontalFlip),
      String(options.verticalFlip),
    ];
    if (this.cameraAppDirectory && !this.helperPath) {
      return openCameraApp(await this.getCameraApp(), args, signal);
    }
    const child = spawn(await this.getHelper(), args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return new JpegProcessCameraSource(child, 'macOS camera process');
  }

  async openHardwareControl(
    deviceId: string,
  ): Promise<CameraHardwareControl | undefined> {
    const device = await this.cachedDevice(deviceId);
    if (!device) return undefined;
    const control = new MacosCameraHardwareControl(deviceId, device.uid, () =>
      this.controlExecutable(),
    );
    await control.open();
    return control;
  }

  private async cachedDevice(deviceId: string) {
    let device = this.deviceCache.get(deviceId);
    if (!device) {
      await this.listDevices();
      device = this.deviceCache.get(deviceId);
    }
    return device;
  }

  private getCameraApp(): Promise<string> {
    this.appPromise ??= buildCameraApp(this.cameraAppDirectory!).catch(
      (error) => {
        this.appPromise = undefined;
        throw error;
      },
    );
    return this.appPromise;
  }

  private async controlExecutable(): Promise<string> {
    if (this.cameraAppDirectory && !this.helperPath)
      return join(
        await this.getCameraApp(),
        'Contents',
        'MacOS',
        'MidsceneCamera',
      );
    return this.getHelper();
  }

  private getHelper(): Promise<string> {
    if (this.helperPath) {
      if (!existsSync(this.helperPath)) {
        throw new RobotVisionError(
          'STREAM_FAILED',
          `macOS camera helper not found: ${this.helperPath}`,
        );
      }
      return Promise.resolve(this.helperPath);
    }
    this.helperPromise ??= this.compileHelper();
    return this.helperPromise;
  }

  private async compileHelper(): Promise<string> {
    const source = fileURLToPath(
      new URL('../../native/macos-camera.swift', import.meta.url),
    );
    let contents: Buffer;
    try {
      contents = await fs.readFile(source);
    } catch (error) {
      throw new RobotVisionError(
        'STREAM_FAILED',
        `macOS camera helper source not found: ${source}`,
        error,
      );
    }
    const digest = createHash('sha256')
      .update(contents)
      .update(process.arch)
      .digest('hex')
      .slice(0, 16);
    const directory = join(
      tmpdir(),
      `midscene-robot-vision-${process.getuid?.() ?? 'user'}`,
    );
    const binary = join(directory, `macos-camera-${digest}`);
    if (existsSync(binary)) return binary;
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const candidate = `${binary}-${process.pid}`;
    try {
      await execFileAsync('/usr/bin/swiftc', ['-O', source, '-o', candidate], {
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      });
      await fs.rename(candidate, binary);
      return binary;
    } catch (error) {
      throw new RobotVisionError(
        'STREAM_FAILED',
        `Failed to compile macOS camera helper. Install Xcode Command Line Tools or set ROBOT_VISION_MACOS_CAMERA_HELPER_PATH: ${String(error)}`,
        error,
      );
    } finally {
      await fs.rm(candidate, { force: true }).catch(() => undefined);
    }
  }
}
