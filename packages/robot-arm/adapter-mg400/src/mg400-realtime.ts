import { Buffer } from 'node:buffer';
import { type Socket, createConnection } from 'node:net';
import {
  RobotArmError,
  type RobotArmFeedbackStatus,
} from '@midscene/arm-kit/adapter-development';
import { isMg400Mode } from './mg400-modes.js';

/** MG400 30004 feedback is one fixed 1440-byte little-endian frame. */
export const MG400_REALTIME_FRAME_LENGTH = 1440;
/** Frame magic at byte 48; any other value is not 30004 feedback. */
export const MG400_REALTIME_TEST_VALUE = 0x0123456789abcdefn;
/** MG400 controllers report RobotType=1 on the feedback port. */
const MG400_REALTIME_ROBOT_TYPE = 1;
const DEFAULT_STALE_AFTER_MS = 1000;
const DEFAULT_CONNECT_TIMEOUT_MS = 2000;
const DEFAULT_RECONNECT_DELAY_MS = 500;
const DEFAULT_MAX_RECONNECT_DELAY_MS = 5000;

/**
 * One decoded 30004 frame. The MG400 manual reserves the bytes that the Nova2
 * layout uses for command and safety extensions, so they are never decoded
 * here; only the documented common layout is exposed.
 */
export interface Mg400RealtimeFeedback {
  readonly mode: number;
  readonly robotType: number;
  readonly controllerTimestampMs: bigint;
  readonly speedScaling: number;
  readonly jointActualDegrees: readonly number[];
  readonly toolVectorActual: readonly number[];
  readonly userId: number;
  readonly toolId: number;
  /** Can remain set while idle; this is not a motion or queue-occupancy signal. */
  readonly runQueuedCmd: boolean;
  readonly pauseCmdFlag: boolean;
  readonly enabled: boolean;
  readonly dragStatus: number;
  readonly running: boolean;
  readonly errorActive: boolean;
  /** Controller's configured end load in kg (not measured tool mass). */
  readonly loadKg: number;
  /** Local receive time, used for the staleness window. */
  readonly receivedAt: number;
}

export class Mg400RealtimeFrameError extends Error {
  constructor(message: string) {
    super(`Invalid MG400 realtime frame: ${message}`);
    this.name = 'Mg400RealtimeFrameError';
  }
}

function readDoubleVector(
  frame: Buffer,
  offset: number,
  length: number,
): readonly number[] {
  const values = Array.from({ length }, (_, index) =>
    frame.readDoubleLE(offset + index * 8),
  );
  if (values.some((value) => !Number.isFinite(value)))
    throw new Mg400RealtimeFrameError(
      `non-finite double vector at offset ${offset}`,
    );
  return Object.freeze(values);
}

function readFiniteDouble(
  frame: Buffer,
  offset: number,
  field: string,
): number {
  const value = frame.readDoubleLE(offset);
  if (!Number.isFinite(value))
    throw new Mg400RealtimeFrameError(`${field} is not finite`);
  return value;
}

/**
 * Decode one MG400 30004 frame. A frame that fails any guard is rejected as a
 * whole: the caller keeps the previous accepted frame.
 */
export function decodeMg400RealtimeFrame(
  frame: Buffer,
  receivedAt = Date.now(),
): Mg400RealtimeFeedback {
  if (frame.length !== MG400_REALTIME_FRAME_LENGTH)
    throw new Mg400RealtimeFrameError(
      `expected ${MG400_REALTIME_FRAME_LENGTH} bytes, received ${frame.length}`,
    );
  const messageSize = frame.readUInt16LE(0);
  if (messageSize !== MG400_REALTIME_FRAME_LENGTH)
    throw new Mg400RealtimeFrameError(
      `MessageSize is ${messageSize}, expected ${MG400_REALTIME_FRAME_LENGTH}`,
    );
  const testValue = frame.readBigUInt64LE(48);
  if (testValue !== MG400_REALTIME_TEST_VALUE)
    throw new Mg400RealtimeFrameError(
      `TestValue is 0x${testValue.toString(16)}`,
    );
  const rawMode = frame.readBigUInt64LE(24);
  const mode = Number(rawMode);
  if (!Number.isSafeInteger(mode))
    throw new Mg400RealtimeFrameError(`invalid numeric mode ${rawMode}`);
  if (!isMg400Mode(mode))
    throw new Mg400RealtimeFrameError(`unknown controller mode ${mode}`);
  const robotType = frame.readUInt8(1031);
  if (robotType !== MG400_REALTIME_ROBOT_TYPE)
    throw new Mg400RealtimeFrameError(
      `RobotType is ${robotType}, expected ${MG400_REALTIME_ROBOT_TYPE}`,
    );
  return Object.freeze({
    mode,
    robotType,
    controllerTimestampMs: frame.readBigUInt64LE(32),
    speedScaling: readFiniteDouble(frame, 64, 'SpeedScaling'),
    jointActualDegrees: readDoubleVector(frame, 432, 6),
    toolVectorActual: readDoubleVector(frame, 624, 6),
    userId: frame.readUInt8(1012),
    toolId: frame.readUInt8(1013),
    runQueuedCmd: frame.readUInt8(1014) !== 0,
    pauseCmdFlag: frame.readUInt8(1015) !== 0,
    enabled: frame.readUInt8(1026) !== 0,
    dragStatus: frame.readUInt8(1027),
    running: frame.readUInt8(1028) !== 0,
    errorActive: frame.readUInt8(1029) !== 0,
    loadKg: readFiniteDouble(frame, 1168, 'Load'),
    receivedAt,
  });
}

/**
 * Split a TCP byte stream into fixed 1440-byte frames. Memory stays bounded
 * because every complete frame is emitted, so the retained tail is always
 * shorter than one frame.
 */
export class Mg400RealtimeFramer {
  private pending: Buffer = Buffer.alloc(0);
  push(chunk: Buffer): Buffer[] {
    if (chunk.length > 0) this.pending = Buffer.concat([this.pending, chunk]);
    const frames: Buffer[] = [];
    while (this.pending.length >= MG400_REALTIME_FRAME_LENGTH) {
      frames.push(
        Buffer.from(this.pending.subarray(0, MG400_REALTIME_FRAME_LENGTH)),
      );
      this.pending = this.pending.subarray(MG400_REALTIME_FRAME_LENGTH);
    }
    return frames;
  }
  reset(): void {
    this.pending = Buffer.alloc(0);
  }
  get bufferedBytes(): number {
    return this.pending.length;
  }
}

export interface Mg400RealtimeChannelOptions {
  host: string;
  /** 30004 by default; 0 disables the optional push channel entirely. */
  port: number;
  /** A frame older than this stops being trusted as current actual state. */
  staleAfterMs?: number;
  connectTimeoutMs?: number;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  /** Called whenever the reported feedback status actually changes. */
  onStatusChange?: (status: RobotArmFeedbackStatus) => void;
}

/**
 * Optional 30004 push reader. It is deliberately best-effort: it reconnects
 * with backoff on its own, and every failure only downgrades the reported
 * status. The adapter must keep working through dashboard polling without it.
 */
export class Mg400RealtimeChannel {
  private connectionEpoch = 0;
  get connectionGeneration(): number {
    return this.connectionEpoch;
  }
  private readonly host: string;
  private readonly port: number;
  private readonly staleAfterMs: number;
  private readonly connectTimeoutMs: number;
  private readonly reconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly onStatusChange?: (status: RobotArmFeedbackStatus) => void;
  private readonly framer = new Mg400RealtimeFramer();
  private socket?: Socket;
  private opening = false;
  private desired = false;
  private latest?: Mg400RealtimeFeedback;
  private lastError?: string;
  private decodeFailureReported = false;
  private reconnectAttempt = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private staleTimer?: ReturnType<typeof setTimeout>;
  private reportKey = '';
  constructor(options: Mg400RealtimeChannelOptions) {
    this.host = options.host;
    this.port = options.port;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.connectTimeoutMs =
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.reconnectDelayMs =
      options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
    this.maxReconnectDelayMs =
      options.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS;
    if (!Number.isInteger(this.port) || this.port < 0 || this.port > 65535)
      throw new RobotArmError('INVALID_CONFIG', 'Invalid MG400 feedback port');
    if (!Number.isFinite(this.staleAfterMs) || this.staleAfterMs < 1)
      throw new RobotArmError(
        'INVALID_CONFIG',
        'Invalid MG400 feedback staleness window',
      );
    this.onStatusChange = options.onStatusChange;
  }
  /** Disabled channels report a downgrade and never open a socket. */
  private get disabled(): boolean {
    return this.port === 0;
  }
  private get connected(): boolean {
    return Boolean(
      this.socket && !this.socket.destroyed && !this.socket.connecting,
    );
  }
  /** Newest frame, and only while the channel is connected and fresh. */
  current(): Mg400RealtimeFeedback | undefined {
    return this.isUsable() ? this.latest : undefined;
  }
  status(): RobotArmFeedbackStatus {
    const usable = this.isUsable();
    return {
      source: usable ? 'push' : 'polling',
      available: this.connected,
      lastFrameAt: this.latest
        ? new Date(this.latest.receivedAt).toISOString()
        : undefined,
      frameAgeMs: this.latest ? Date.now() - this.latest.receivedAt : undefined,
      reason: usable ? undefined : this.unusableReason(),
      lastError: this.lastError,
    };
  }
  /**
   * Start (or restart) the push channel. Never rejects and never blocks the
   * caller: a controller without a usable 30004 stream is a downgrade, not a
   * connection failure.
   */
  start(): void {
    if (this.disabled) return;
    this.desired = true;
    void this.ensureConnected().catch(() => undefined);
    this.report();
  }
  close(): void {
    this.desired = false;
    this.clearReconnectTimer();
    this.clearStaleWatchdog();
    this.teardownSocket();
    this.framer.reset();
    this.report();
  }
  /** Resolve once a fresh frame is available, or reject after the timeout. */
  async waitForFrame(timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const frame = this.current();
      if (frame) return frame;
      if (Date.now() >= deadline)
        throw new RobotArmError(
          'FEEDBACK_UNAVAILABLE',
          `No fresh MG400 feedback frame within ${timeoutMs}ms`,
          504,
          {
            source: 'polling',
            available: this.connected,
            reason: this.unusableReason(),
            lastError: this.lastError,
          },
        );
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  private isUsable(): boolean {
    return (
      this.desired &&
      this.connected &&
      this.latest !== undefined &&
      Date.now() - this.latest.receivedAt <= this.staleAfterMs
    );
  }
  private unusableReason(): string {
    if (this.disabled) return 'feedback port is disabled';
    if (!this.desired) return 'feedback channel is closed';
    if (!this.connected) return `feedback port ${this.port} is not connected`;
    if (!this.latest) return 'no valid 1440-byte frame received';
    return `the newest frame is older than the ${this.staleAfterMs}ms staleness window`;
  }
  private report(): void {
    if (!this.onStatusChange) return;
    const status = this.status();
    const key = [
      status.source,
      String(status.available),
      status.reason ?? '',
      status.lastError ?? '',
    ].join('|');
    if (key === this.reportKey) return;
    this.reportKey = key;
    try {
      this.onStatusChange(status);
    } catch {
      /* Reporting must never break the feedback channel. */
    }
  }
  private fail(error: unknown): void {
    this.lastError = error instanceof Error ? error.message : String(error);
    this.report();
  }
  private async ensureConnected(): Promise<void> {
    if (!this.desired || this.disabled) return;
    if (this.connected || this.opening) return;
    this.opening = true;
    let socket: Socket;
    try {
      socket = createConnection({ host: this.host, port: this.port });
    } catch (error) {
      this.opening = false;
      this.fail(error);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.connectionEpoch++;
    this.latest = undefined;
    this.framer.reset();
    socket.setNoDelay(true);
    await new Promise<void>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        this.fail(
          new RobotArmError(
            'CONNECTION_TIMEOUT',
            'MG400 feedback connection timed out',
            504,
          ),
        );
        socket.destroy();
      }, this.connectTimeoutMs);
      timer.unref();
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.opening = false;
        resolve();
      };
      socket.once('connect', () => {
        this.reconnectAttempt = 0;
        this.lastError = undefined;
        finish();
        this.report();
      });
      socket.on('data', (chunk: Buffer) => {
        if (this.socket === socket) this.consume(chunk);
      });
      socket.once('error', (error: Error) => this.fail(error));
      socket.once('close', () => {
        finish();
        if (this.socket !== socket) return;
        this.socket = undefined;
        this.framer.reset();
        this.clearStaleWatchdog();
        this.report();
        this.scheduleReconnect();
      });
    });
  }
  private consume(chunk: Buffer): void {
    for (const frame of this.framer.push(chunk)) {
      try {
        this.latest = decodeMg400RealtimeFrame(frame);
        this.decodeFailureReported = false;
        this.lastError = undefined;
        this.armStaleWatchdog();
        this.report();
      } catch (error) {
        // Keep the previous accepted frame; report the first failure of a run.
        if (this.decodeFailureReported) continue;
        this.decodeFailureReported = true;
        this.fail(error);
      }
    }
  }
  private scheduleReconnect(): void {
    if (!this.desired || this.disabled) return;
    if (this.reconnectTimer) return;
    const delay = Math.min(
      this.reconnectDelayMs * 2 ** this.reconnectAttempt,
      this.maxReconnectDelayMs,
    );
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.ensureConnected().catch(() => undefined);
    }, delay);
    this.reconnectTimer.unref();
  }
  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }
  /**
   * Report the downgrade when the newest frame ages past the window. The delay
   * is re-checked because a timer may land exactly on the window edge, where
   * the frame is still usable by the documented `older than` comparison.
   */
  private armStaleWatchdog(delayMs: number = this.staleAfterMs): void {
    this.clearStaleWatchdog();
    this.staleTimer = setTimeout(() => {
      this.staleTimer = undefined;
      if (!this.desired || !this.latest) return;
      const remaining =
        this.staleAfterMs - (Date.now() - this.latest.receivedAt);
      if (remaining >= 0) {
        this.armStaleWatchdog(remaining + 1);
        return;
      }
      this.report();
    }, delayMs);
    this.staleTimer.unref();
  }
  private clearStaleWatchdog(): void {
    if (!this.staleTimer) return;
    clearTimeout(this.staleTimer);
    this.staleTimer = undefined;
  }
  private teardownSocket(): void {
    const socket = this.socket;
    this.socket = undefined;
    socket?.destroy();
  }
}
