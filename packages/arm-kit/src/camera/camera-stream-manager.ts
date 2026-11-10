import { randomUUID } from 'node:crypto';
import {
  CameraStream,
  DEFAULT_STARTUP_TIMEOUT_MS,
  DEFAULT_STOP_TIMEOUT_MS,
} from './camera-stream.js';
import { RobotVisionError } from './errors.js';
import type {
  CameraBackend,
  CameraStreamInfo,
  CameraStreamOptions,
  ResolvedCameraStreamOptions,
} from './types.js';

export class CameraStreamManager {
  private readonly streams = new Map<string, CameraStream>();

  constructor(
    private readonly backend: CameraBackend,
    private readonly maxStreams = 8,
    private readonly startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
    private readonly stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
  ) {}

  async create(options: CameraStreamOptions): Promise<CameraStream> {
    if (this.streams.size >= this.maxStreams) {
      throw new RobotVisionError(
        'INVALID_ARGUMENT',
        `Maximum stream count reached: ${this.maxStreams}`,
      );
    }
    const resolved = this.resolveOptions(options);
    // One stream per physical device. Two streams on one camera show the same
    // picture twice and compete for the device, and a client that loses track of
    // its own state would otherwise be able to open them without noticing.
    const existing = this.findByDevice(resolved.deviceId);
    if (existing) {
      throw new RobotVisionError(
        'STREAM_ALREADY_EXISTS',
        `Device ${resolved.deviceId} already has stream ${existing.id}`,
      );
    }
    const stream = new CameraStream(
      randomUUID(),
      this.backend,
      resolved,
      this.startupTimeoutMs,
      this.stopTimeoutMs,
    );
    this.streams.set(stream.id, stream);
    try {
      await stream.start();
      return stream;
    } catch (error) {
      this.streams.delete(stream.id);
      throw error;
    }
  }

  get(id: string): CameraStream {
    const stream = this.streams.get(id);
    if (!stream) {
      throw new RobotVisionError(
        'STREAM_NOT_FOUND',
        `Camera stream not found: ${id}`,
      );
    }
    return stream;
  }

  list(): CameraStreamInfo[] {
    return [...this.streams.values()].map((stream) => stream.getInfo());
  }

  /** The stream already open on a device, if any. */
  findByDevice(deviceId: string): CameraStream | undefined {
    for (const stream of this.streams.values()) {
      if (stream.deviceId === deviceId) return stream;
    }
    return undefined;
  }

  async delete(id: string): Promise<void> {
    const stream = this.get(id);
    this.streams.delete(id);
    await stream.stop();
  }

  async close(): Promise<void> {
    const streams = [...this.streams.values()];
    this.streams.clear();
    await Promise.allSettled(streams.map((stream) => stream.stop()));
  }

  private resolveOptions(
    options: CameraStreamOptions,
  ): ResolvedCameraStreamOptions {
    const deviceId = String(options.deviceId || '').trim();
    if (!deviceId) {
      throw new RobotVisionError('INVALID_ARGUMENT', 'deviceId is required');
    }
    return {
      deviceId,
      width: this.resolveInteger(options.width, 1920, 'width', 1, 7680),
      height: this.resolveInteger(options.height, 1080, 'height', 1, 4320),
      fps: this.resolveInteger(options.fps, 30, 'fps', 1, 120),
      verticalFlip: options.verticalFlip === true,
      horizontalFlip: options.horizontalFlip === true,
    };
  }

  /**
   * Applies mirrored capture to a running stream by restarting its capture
   * process, and returns the updated stream. The picture filters cannot change
   * while the process runs, so this is a restart; the stream id is kept so
   * clients do not have to re-create their stream or re-find its card.
   *
   * Returns `undefined` when the device has no stream, which is not an error:
   * the setting then applies the next time the camera is opened.
   */
  async applyCaptureOptions(
    deviceId: string,
    patch: { verticalFlip?: boolean; horizontalFlip?: boolean },
  ): Promise<CameraStream | undefined> {
    const stream = this.findByDevice(deviceId);
    if (!stream) return undefined;
    const current = stream.getOptions();
    const next = {
      ...current,
      verticalFlip: patch.verticalFlip ?? current.verticalFlip,
      horizontalFlip: patch.horizontalFlip ?? current.horizontalFlip,
    };
    if (
      next.verticalFlip === current.verticalFlip &&
      next.horizontalFlip === current.horizontalFlip
    ) {
      return stream;
    }
    await stream.restart(next);
    return stream;
  }

  /**
   * Brings a freshly created stream in line with the camera's stored profile.
   *
   * `POST /streams` builds the stream from the request body, and a client that
   * does not know about a stored setting would otherwise open a stream that
   * ignores it. Callers that do not have the profile at hand leave the fields
   * out, which means "no override".
   */
  async applyProfileMirroring(
    deviceId: string,
    mirroring: { verticalFlip?: boolean; horizontalFlip?: boolean },
  ): Promise<CameraStream> {
    const stream = this.findByDevice(deviceId);
    if (!stream) {
      throw new RobotVisionError(
        'STREAM_NOT_FOUND',
        `No stream is open on device ${deviceId}`,
      );
    }
    const current = stream.getOptions();
    const verticalFlip = mirroring.verticalFlip ?? current.verticalFlip;
    const horizontalFlip = mirroring.horizontalFlip ?? current.horizontalFlip;
    if (
      verticalFlip === current.verticalFlip &&
      horizontalFlip === current.horizontalFlip
    ) {
      return stream;
    }
    await stream.restart({ ...current, verticalFlip, horizontalFlip });
    return stream;
  }

  private resolveInteger(
    value: number | undefined,
    fallback: number,
    name: string,
    min: number,
    max: number,
  ): number {
    const resolved = value ?? fallback;
    if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
      throw new RobotVisionError(
        'INVALID_ARGUMENT',
        `${name} must be an integer between ${min} and ${max}`,
      );
    }
    return resolved;
  }
}
