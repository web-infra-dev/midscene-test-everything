import { EventEmitter } from 'node:events';
import { RobotVisionError } from './errors.js';
import type {
  CameraBackend,
  CameraFrame,
  CameraStreamInfo,
  ResolvedCameraStreamOptions,
} from './types.js';

/** Frames kept for the measured frame rate. */
const FRAME_RATE_WINDOW = 60;

/**
 * How long a stream may sit in `starting` before it is declared failed. FFmpeg
 * starts successfully even when the camera is still held by another process, so
 * without this a blocked device stays `starting` forever and the console shows a
 * spinner that never resolves.
 */
export const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;

/**
 * A capture process normally exits within a few hundred milliseconds of
 * SIGTERM. Keep a hard bound anyway: waiting forever here blocks the camera's
 * serialized acquire/release queue, and every later preview and page reload
 * then hangs behind it.
 */
export const DEFAULT_STOP_TIMEOUT_MS = 4_000;

export class CameraStream extends EventEmitter {
  private source?: Awaited<ReturnType<CameraBackend['openStream']>>;
  private closingSource?: Promise<void>;
  private state: CameraStreamInfo['state'] = 'starting';
  private latestFrame?: CameraFrame;
  private error?: string;
  private readonly frameTimes: number[] = [];
  private startupTimer?: NodeJS.Timeout;
  private starting?: AbortController;

  constructor(
    public readonly id: string,
    private readonly backend: CameraBackend,
    private options: ResolvedCameraStreamOptions,
    private readonly startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
    private readonly stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
  ) {
    super();
  }

  /** The capture settings this stream currently runs with. */
  getOptions(): ResolvedCameraStreamOptions {
    return { ...this.options };
  }

  /**
   * Restarts the capture process with new options, keeping the stream id so
   * clients do not have to re-create the stream or re-find its card.
   *
   * The picture filters are fixed when the capture process starts, so changing
   * one means a restart rather than a live switch. The previous options are
   * restored when the restart fails, so a retry starts from a known-good
   * configuration instead of a half-applied one.
   */
  async restart(next: ResolvedCameraStreamOptions): Promise<void> {
    if (this.state === 'stopped') {
      throw new RobotVisionError(
        'STREAM_FAILED',
        'Cannot restart a stopped stream',
      );
    }
    const previous = this.options;
    // `releaseSource`, not `stop`: the stream lives on, so its frame listeners
    // (for example an open MJPEG preview) must survive the swap.
    if (!(await this.releaseSourceWithTimeout())) {
      const error = new RobotVisionError(
        'STREAM_FAILED',
        'Camera process did not stop; reopen the camera',
      );
      this.fail(error);
      throw error;
    }
    this.options = next;
    this.state = 'starting';
    this.error = undefined;
    this.latestFrame = undefined;
    try {
      await this.start();
    } catch (error) {
      this.options = previous;
      throw error;
    }
  }

  /** The device this stream captures from. */
  get deviceId(): string {
    return this.options.deviceId;
  }

  async start(): Promise<void> {
    const starting = new AbortController();
    this.starting = starting;
    try {
      const capture = this.getOptions();
      const source = await this.backend.openStream(capture, starting.signal);
      if (starting.signal.aborted) {
        await source.close();
        starting.signal.throwIfAborted();
      }
      this.source = source;
      source.on('frame', (jpeg: Buffer) => {
        if (this.source !== source || this.state === 'stopped') return;
        const frame: CameraFrame = {
          capture,
          id: (this.latestFrame?.id ?? 0) + 1,
          capturedAt: Date.now(),
          jpeg,
        };
        this.latestFrame = frame;
        this.state = 'running';
        this.clearStartupTimer();
        this.recordFrameTime(frame.capturedAt);
        this.emit('frame', frame);
      });
      source.on('error', (error: Error) => {
        if (this.source === source) this.fail(error);
      });
      source.on(
        'exit',
        ({ code, signal }: { code: number | null; signal: string | null }) => {
          if (this.source !== source) return;
          this.fail(
            new Error(
              `Camera process exited unexpectedly (code=${code}, signal=${signal})`,
            ),
          );
        },
      );
      // The process started, but the camera may already be held by another
      // process, in which case no frame ever arrives. Report that as a failure
      // so the operator sees a reason instead of an endless spinner.
      // Receivers awaiting a human connection can explicitly disable this deadline.
      if (this.startupTimeoutMs > 0) {
        this.startupTimer = setTimeout(() => {
          this.fail(
            new Error(
              `No frame arrived within ${this.startupTimeoutMs}ms; the camera may be in use by another process`,
            ),
          );
        }, this.startupTimeoutMs);
        // Do not keep the process alive just for this timer.
        this.startupTimer.unref?.();
      }
    } catch (error) {
      if (!starting.signal.aborted)
        this.fail(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      if (this.starting === starting) this.starting = undefined;
    }
  }

  getInfo(): CameraStreamInfo {
    const latestFrame = this.latestFrame;
    return {
      id: this.id,
      ...this.options,
      state: this.state,
      frameId: latestFrame?.id ?? 0,
      lastFrameAt: latestFrame?.capturedAt,
      error: this.error,
      hasFrame: Boolean(latestFrame),
      frameAgeMs: latestFrame ? Date.now() - latestFrame.capturedAt : undefined,
      actualFps: this.measureFps(),
    };
  }

  /** The latest frame already received when the phone reports its display. */
  get currentFrame(): CameraFrame | undefined {
    return this.state === 'running' ? this.latestFrame : undefined;
  }

  async getFrame(
    options: {
      fresh?: boolean;
      afterSequence?: number;
      timeoutMs?: number;
    } = {},
  ): Promise<CameraFrame> {
    const currentFrame = this.latestFrame;

    if (this.state === 'failed' || this.state === 'stopped') {
      throw new RobotVisionError(
        'STREAM_FAILED',
        this.error || `Camera stream is ${this.state}`,
      );
    }

    const afterFrameId = options.afterSequence ?? currentFrame?.id ?? 0;
    if (currentFrame && (!options.fresh || currentFrame.id > afterFrameId))
      return currentFrame;
    const timeoutMs = options.timeoutMs ?? 2_000;
    return new Promise<CameraFrame>((resolve, reject) => {
      const onFrame = (frame: CameraFrame) => {
        if (frame.id <= afterFrameId) return;
        cleanup();
        resolve(frame);
      };
      const onUnavailable = () => {
        cleanup();
        reject(
          new RobotVisionError(
            'STREAM_FAILED',
            this.error || `Camera stream is ${this.state}`,
          ),
        );
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new RobotVisionError(
            'NO_FRAME_AVAILABLE',
            `No camera frame arrived within ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timeout);
        this.off('frame', onFrame);
        this.off('stopped', onUnavailable);
        this.off('failed', onUnavailable);
      };
      this.on('frame', onFrame);
      this.once('stopped', onUnavailable);
      this.once('failed', onUnavailable);
    });
  }

  async stop(): Promise<void> {
    if (this.state === 'stopped') return;
    this.state = 'stopped';
    // Release long-lived preview responses before waiting for camera shutdown.
    this.emit('stopped');
    try {
      await this.releaseSourceWithTimeout();
    } finally {
      this.removeAllListeners();
    }
  }

  /**
   * Bounds every path that waits for a capture process to exit. A source that
   * never reports exit must not wedge this camera's serialized queue.
   */
  private async releaseSourceWithTimeout(): Promise<boolean> {
    const closing = this.releaseSource().then(
      () => true,
      () => false,
    );
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        closing,
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), this.stopTimeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Closes the capture process and clears its per-process state, but keeps this
   * stream's own listeners. A restart uses it so that a preview subscription
   * survives the swap; a stop uses `stop`, which drops the listeners too.
   */
  private async releaseSource(): Promise<void> {
    this.clearStartupTimer();
    this.starting?.abort(new Error('Camera stream closed'));
    if (this.closingSource) return this.closingSource;
    const source = this.source;
    this.source = undefined;
    if (!source) return;
    this.closingSource = Promise.resolve()
      .then(() => source.close())
      .finally(() => {
        this.closingSource = undefined;
      });
    await this.closingSource;
  }

  private fail(error: Error): void {
    if (this.state === 'stopped' || this.state === 'failed') return;
    this.clearStartupTimer();
    this.error = error.message;
    this.state = 'failed';
    this.emit('failed');
    // A startup timeout or process error must not leave FFmpeg holding the
    // camera; otherwise every later open fails until the process is killed.
    void this.releaseSource().catch(() => undefined);
  }

  private clearStartupTimer(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = undefined;
    }
  }

  private recordFrameTime(timestamp: number): void {
    this.frameTimes.push(timestamp);
    if (this.frameTimes.length > FRAME_RATE_WINDOW) {
      this.frameTimes.splice(0, this.frameTimes.length - FRAME_RATE_WINDOW);
    }
  }

  /**
   * Measures the frame rate over the recent frame window. Two samples are the
   * minimum that can express a rate; anything less reports `undefined` rather
   * than a fabricated zero.
   */
  private measureFps(): number | undefined {
    if (this.frameTimes.length < 2) return undefined;
    const first = this.frameTimes[0]!;
    const last = this.frameTimes[this.frameTimes.length - 1]!;
    const elapsed = last - first;
    if (elapsed <= 0) return undefined;
    return Math.round(((this.frameTimes.length - 1) / elapsed) * 10_000) / 10;
  }
}
