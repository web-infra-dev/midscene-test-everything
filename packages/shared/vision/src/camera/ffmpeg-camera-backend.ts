import { spawn } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import { basename } from 'node:path';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { RobotVisionError } from './errors.js';
import { JpegProcessCameraSource } from './jpeg-process-camera-source.js';
import type {
  CameraBackend,
  CameraBackendName,
  CameraDevice,
  CameraHardwareControl,
  ResolvedCameraStreamOptions,
} from './types.js';
import { filterPhysicalCameras } from './virtual-camera-filter.js';
import { WindowsDshowHardwareControl } from './windows-dshow-control.js';

type SpawnProcess = typeof spawn;

export interface FfmpegCameraBackendOptions {
  ffmpegPath?: string;
  platform?: NodeJS.Platform;
  spawnProcess?: SpawnProcess;
  /**
   * Enumerate virtual cameras as well. Off by default, and can also be enabled
   * with `ROBOT_VISION_INCLUDE_VIRTUAL_DEVICES=true`.
   */
  includeVirtualDevices?: boolean;
  /**
   * Ask DirectShow for the camera's own MJPEG samples and copy them to the
   * pipe instead of decoding and re-encoding every frame. Off by default: it
   * only works when the device really delivers complete JPEG frames, and it
   * cannot be combined with the mirroring filters. Enable with
   * `ROBOT_VISION_FFMPEG_COPY_INPUT=true`.
   */
  copyMjpegInput?: boolean;
}

interface DeviceDescriptor extends CameraDevice {
  input: string;
  avfoundationDeviceId?: string;
  ambiguousName?: boolean;
  uid?: string;
  serial?: string;
  driver?: string;
  sysfsPath?: string;
}

const toCameraDevice = ({
  id,
  name,
  backend,
  controlIndex,
}: DeviceDescriptor): CameraDevice => ({
  id,
  name,
  backend,
  ...(controlIndex !== undefined ? { controlIndex } : {}),
});

const removeFfmpegPrefix = (line: string): string =>
  line.replace(/^\[[^\]]+\]\s*/u, '').trim();

export function parseDshowDevices(output: string): DeviceDescriptor[] {
  const devices: DeviceDescriptor[] = [];
  let readingVideoDevices = false;
  let pendingDevice: DeviceDescriptor | undefined;

  for (const line of output.split(/\r?\n/u)) {
    const normalized = removeFfmpegPrefix(line);

    // FFmpeg 4.1 (the Windows binary bundled by @ffmpeg-installer) groups
    // devices under explicit video/audio section headers and omits the
    // `(video)` suffix. Newer FFmpeg builds append `(video)` to each device
    // instead, so support both formats.
    if (normalized.startsWith('DirectShow video devices')) {
      readingVideoDevices = true;
      pendingDevice = undefined;
      continue;
    }
    if (normalized.startsWith('DirectShow audio devices')) {
      readingVideoDevices = false;
      pendingDevice = undefined;
      continue;
    }

    const videoDeviceMatch = normalized.match(/^"(.+)"\s+\(video\)$/u);
    const sectionDeviceMatch = normalized.match(/^"(.+)"$/u);
    const deviceMatch =
      videoDeviceMatch ??
      (readingVideoDevices ? sectionDeviceMatch : undefined);
    if (deviceMatch) {
      pendingDevice = {
        id: `dshow:${deviceMatch[1]}`,
        name: deviceMatch[1],
        backend: 'dshow',
        controlIndex: devices.length,
        input: deviceMatch[1],
      };
      devices.push(pendingDevice);
      continue;
    }

    // Do not let an audio device's alternative name attach to the previous
    // video device when parsing the suffix-based format.
    if (normalized.match(/^".+"\s+\(audio\)$/u)) {
      pendingDevice = undefined;
      continue;
    }

    const alternativeMatch = normalized.match(/^Alternative name\s+"(.+)"$/u);
    if (alternativeMatch && pendingDevice) {
      pendingDevice.id = `dshow:${alternativeMatch[1]}`;
      pendingDevice.input = alternativeMatch[1];
    }
  }

  return devices;
}

export function parseAvfoundationDevices(output: string): DeviceDescriptor[] {
  const devices: DeviceDescriptor[] = [];
  let readingVideoDevices = false;
  const nameCounts = new Map<string, number>();

  for (const line of output.split(/\r?\n/u)) {
    const normalized = removeFfmpegPrefix(line);
    if (normalized.includes('AVFoundation video devices:')) {
      readingVideoDevices = true;
      continue;
    }
    if (normalized.includes('AVFoundation audio devices:')) {
      readingVideoDevices = false;
      continue;
    }
    if (!readingVideoDevices) continue;

    const deviceMatch = normalized.match(/^\[(\d+)\]\s+(.+)$/u);
    if (!deviceMatch) continue;
    const [, index, label] = deviceMatch;
    const identity = label.match(
      /^(.*?) \[uid:([^\]]+)\](?: \[serial:([^\]]+)\])?$/u,
    );
    const name = identity?.[1] ?? label;
    const uid = identity?.[2];
    const serial = identity?.[3];
    const occurrence = (nameCounts.get(name) ?? 0) + 1;
    nameCounts.set(name, occurrence);
    devices.push({
      // AVFoundation indices can change between enumeration and capture (or
      // after a camera is plugged in). Keep the hardware name in the identity.
      id: `avfoundation:name:${encodeURIComponent(name)}${occurrence > 1 ? `:${occurrence}` : ''}`,
      name,
      backend: 'avfoundation',
      input: index,
      ...(uid ? { uid } : {}),
      ...(serial ? { serial } : {}),
    });
  }

  const serialCounts = new Map<string, number>();
  const uidCounts = new Map<string, number>();
  for (const device of devices) {
    if (device.serial) {
      serialCounts.set(
        device.serial,
        (serialCounts.get(device.serial) ?? 0) + 1,
      );
    }
    if (device.uid) {
      uidCounts.set(device.uid, (uidCounts.get(device.uid) ?? 0) + 1);
    }
  }

  for (const device of devices) {
    if (device.serial && serialCounts.get(device.serial) === 1) {
      device.id = `avfoundation:serial:${encodeURIComponent(device.serial)}`;
      device.avfoundationDeviceId = `serial:${device.serial}`;
    } else if (device.uid) {
      if (uidCounts.get(device.uid) !== 1) {
        throw new RobotVisionError(
          'STREAM_FAILED',
          `AVFoundation reported a duplicate device UID: ${device.uid}`,
        );
      }
      device.id = `avfoundation:uid:${encodeURIComponent(device.uid)}`;
      device.avfoundationDeviceId = `uid:${device.uid}`;
    } else if ((nameCounts.get(device.name) ?? 0) > 1) {
      // Old FFmpeg versions cannot select by UID. An index can open the wrong
      // camera after devices reorder, so refuse to capture this ambiguous name.
      device.ambiguousName = true;
    } else if (!device.name.includes(':')) {
      device.input = device.name;
    }
  }

  return devices;
}

export class FfmpegCameraBackend implements CameraBackend {
  private readonly ffmpegPath: string;
  private readonly platform: NodeJS.Platform;
  private readonly spawnProcess: SpawnProcess;
  private readonly includeVirtualDevices: boolean;
  private readonly copyMjpegInput: boolean;
  private deviceCache = new Map<string, DeviceDescriptor>();

  constructor(options: FfmpegCameraBackendOptions = {}) {
    this.ffmpegPath =
      options.ffmpegPath ||
      process.env.ROBOT_VISION_FFMPEG_PATH ||
      ffmpegInstaller.path;
    this.platform = options.platform ?? process.platform;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.includeVirtualDevices =
      options.includeVirtualDevices ??
      process.env.ROBOT_VISION_INCLUDE_VIRTUAL_DEVICES === 'true';
    this.copyMjpegInput =
      options.copyMjpegInput ??
      process.env.ROBOT_VISION_FFMPEG_COPY_INPUT === 'true';

    if (!this.ffmpegPath || !existsSync(this.ffmpegPath)) {
      throw new RobotVisionError(
        'FFMPEG_NOT_FOUND',
        `FFmpeg executable not found: ${this.ffmpegPath || '(empty path)'}`,
      );
    }
  }

  async listDevices(): Promise<CameraDevice[]> {
    let devices: DeviceDescriptor[];
    if (this.platform === 'win32') {
      const output = await this.runProbe([
        '-hide_banner',
        '-list_devices',
        'true',
        '-f',
        'dshow',
        '-i',
        'dummy',
      ]);
      if (!/DirectShow (?:video|audio) devices\b/u.test(output)) {
        const detail = output.trim().replace(/\s+/gu, ' ').slice(-2000);
        throw new RobotVisionError(
          'STREAM_FAILED',
          `FFmpeg did not return a DirectShow device list${detail ? `: ${detail}` : ''}`,
        );
      }
      devices = parseDshowDevices(output);
    } else if (this.platform === 'darwin') {
      const output = await this.runProbe([
        '-hide_banner',
        '-f',
        'avfoundation',
        '-list_devices',
        'true',
        '-i',
        '',
      ]);
      devices = parseAvfoundationDevices(output);
    } else if (this.platform === 'linux') {
      devices = await this.listLinuxDevices();
    } else {
      throw new RobotVisionError(
        'UNSUPPORTED_PLATFORM',
        `Unsupported platform: ${this.platform}`,
      );
    }

    // `/devices` only exposes physical cameras unless explicitly told not to.
    const physicalDevices = filterPhysicalCameras(devices, {
      includeVirtual: this.includeVirtualDevices,
    });
    this.deviceCache = new Map(
      physicalDevices.map((device) => [device.id, device]),
    );
    return physicalDevices.map(toCameraDevice);
  }

  async openStream(
    options: ResolvedCameraStreamOptions,
  ): Promise<JpegProcessCameraSource> {
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
    if (device.ambiguousName) {
      throw new RobotVisionError(
        'STREAM_FAILED',
        `Cannot safely open ${device.name}: multiple AVFoundation devices have this name, but this FFmpeg does not expose a device UID. Use an FFmpeg build with -video_device_id support via ROBOT_VISION_FFMPEG_PATH.`,
      );
    }

    const args = this.buildCaptureArgs(device, options);
    const child = this.spawnProcess(this.ffmpegPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return new JpegProcessCameraSource(child, 'FFmpeg camera process');
  }

  async openHardwareControl(
    deviceId: string,
  ): Promise<CameraHardwareControl | undefined> {
    if (this.platform !== 'win32') return undefined;
    let device = this.deviceCache.get(deviceId);
    if (!device) {
      await this.listDevices();
      device = this.deviceCache.get(deviceId);
    }
    if (!device || device.backend !== 'dshow') return undefined;
    if (device.controlIndex === undefined)
      throw new RobotVisionError(
        'STREAM_FAILED',
        `DirectShow control index is unavailable for ${device.name}`,
      );
    const control = new WindowsDshowHardwareControl(
      device.id,
      device.controlIndex,
      device.name,
    );
    await control.open();
    return control;
  }

  private buildCaptureArgs(
    device: DeviceDescriptor,
    options: ResolvedCameraStreamOptions,
  ): string[] {
    const commonInput = [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-framerate',
      String(options.fps),
      '-video_size',
      `${options.width}x${options.height}`,
    ];
    // Copying the camera's own MJPEG samples skips a decode and a re-encode per
    // frame. Filters would force a decode, and only DirectShow exposes its
    // compressed samples reliably, so every other case keeps the encoder.
    const wantCopy =
      this.copyMjpegInput &&
      device.backend === 'dshow' &&
      !options.horizontalFlip &&
      !options.verticalFlip;
    let input: string[];
    if (device.backend === 'dshow') {
      input = [
        ...commonInput,
        ...(wantCopy ? ['-vcodec', 'mjpeg'] : []),
        '-f',
        'dshow',
        '-i',
        `video=${device.input}`,
      ];
    } else if (device.backend === 'avfoundation') {
      input = [
        ...commonInput,
        '-f',
        'avfoundation',
        ...(device.avfoundationDeviceId
          ? ['-video_device_id', device.avfoundationDeviceId]
          : []),
        '-i',
        device.avfoundationDeviceId ? ':none' : `${device.input}:none`,
      ];
    } else {
      input = [...commonInput, '-f', 'v4l2', '-i', device.input];
    }

    // Mirroring has to happen inside FFmpeg so the JPEG the rest of the stack
    // sees is already flipped: the screen detector and the perspective
    // transformer both work on these frames and would otherwise disagree with
    // what the operator sees. vflip is top-to-bottom and hflip is left-to-right,
    // which is what the reference project's `vertical_flip` / `horizontal_flip`
    // mean (OpenCV `flip(frame, 0)` / `flip(frame, 1)`).
    const filters: string[] = [];
    if (options.horizontalFlip) filters.push('hflip');
    if (options.verticalFlip) filters.push('vflip');

    if (wantCopy) {
      // Filters would force a decode, so `wantCopy` already excludes mirroring.
      return [...input, '-an', '-f', 'image2pipe', '-c:v', 'copy', 'pipe:1'];
    }

    return [
      ...input,
      ...(filters.length > 0 ? ['-vf', filters.join(',')] : []),
      '-an',
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      // Do not add `-vsync 0` (or `-fps_mode passthrough`, which is the same
      // thing and is missing from the bundled FFmpeg 4.4 anyway). Passthrough
      // hands the capture timestamps to the encoder unchanged, and AVFoundation
      // reports the same timestamp twice often enough to matter: the first
      // frames after start-up, a burst after the capture stalled, or a device
      // that switches its active format. `mjpeg` then aborts the whole process
      // with "Invalid pts (n) <= last (n)". With the default frame rate
      // handling a repeated timestamp costs one duplicated or dropped frame
      // instead of the stream.
      //
      // Two encoder threads are plenty for 1080p MJPEG. Slice threading with
      // the default thread count spawned ~46 threads per camera, and two
      // cameras then competed with the preview workers for schedulers.
      '-thread_type',
      'slice',
      '-threads',
      '2',
      '-q:v',
      '3',
      'pipe:1',
    ];
  }

  private async runProbe(args: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = this.spawnProcess(this.ffmpegPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let output = '';
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(
          new RobotVisionError(
            'STREAM_FAILED',
            'Timed out while enumerating camera devices',
          ),
        );
      }, 10_000);
      timeout.unref();
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(
          new RobotVisionError(
            'STREAM_FAILED',
            `Failed to enumerate camera devices: ${error.message}`,
            error,
          ),
        );
      });
      child.once('close', () => {
        clearTimeout(timeout);
        resolve(output);
      });
    });
  }

  private async listLinuxDevices(): Promise<DeviceDescriptor[]> {
    const entries = await fs.readdir('/dev').catch((error) => {
      throw new RobotVisionError(
        'STREAM_FAILED',
        `Failed to enumerate /dev video devices: ${String(error)}`,
        error,
      );
    });
    const videoEntries = entries
      .filter((entry) => /^video\d+$/u.test(entry))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    return Promise.all(
      videoEntries.map((entry) => this.describeLinuxDevice(entry)),
    );
  }

  /**
   * Reads the sysfs metadata of a V4L2 device. The card label and driver make
   * loopback devices (`v4l2loopback`, `akvcam`, `vivid`, ...) detectable even
   * when they use a custom name. Missing sysfs entries are not an error: the
   * device is then treated as physical.
   */
  private async describeLinuxDevice(entry: string): Promise<DeviceDescriptor> {
    const sysfsRoot = `/sys/class/video4linux/${entry}`;
    const [label, driver, sysfsPath] = await Promise.all([
      this.readSysfsText(`${sysfsRoot}/name`),
      this.readSysfsLink(`${sysfsRoot}/device/driver`),
      this.readSysfsLink(sysfsRoot),
    ]);
    return {
      id: `v4l2:/dev/${entry}`,
      name: label || `/dev/${entry}`,
      backend: 'v4l2' as CameraBackendName,
      input: `/dev/${entry}`,
      driver,
      sysfsPath,
    };
  }

  private async readSysfsText(path: string): Promise<string | undefined> {
    return fs
      .readFile(path, 'utf8')
      .then((content) => content.trim() || undefined)
      .catch(() => undefined);
  }

  private async readSysfsLink(path: string): Promise<string | undefined> {
    return fs
      .readlink(path)
      .then((target) => basename(target) || undefined)
      .catch(() => undefined);
  }
}
