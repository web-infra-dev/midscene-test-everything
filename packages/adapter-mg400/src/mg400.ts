import { randomUUID } from 'node:crypto';
import { type Socket, createConnection } from 'node:net';
import {
  type CartesianPose,
  type JogTarget,
  type LinearSequenceOptions,
  type LinearSequenceTarget,
  type MotionHandle,
  type MotionOptions,
  type MotionResult,
  PayloadApplicationTracker,
  type RobotArmAdapter,
  type RobotArmCapabilities,
  RobotArmError,
  type RobotArmFeedbackStatus,
  type RobotDriver,
  type RobotKinematics,
  type RobotState,
  type RobotStatus,
  SCREEN_TILT_LIMIT_DEGREES,
  type SampleQuality,
  type SequenceFeedback,
  type ToolPayload,
  assertPose,
  assertSpeed,
  createLinearMotionSequence,
  createMotionHandle,
  distance,
  isRobotArmError,
  quaternionDistance,
  robotSetupDefaults,
  validateMotionOptions,
  yawQuaternion,
} from '@midscene/arm-kit/adapter-development';
import { prepareMg400TcpConnection } from './mg400-control-channel.js';

import { getDebug } from '@midscene/shared/logger';
import { Mg400ControllerClient } from './mg400-controller.js';
import { mg400Faults } from './mg400-faults.js';
import { MG400_HTTP_PORT } from './mg400-http.js';
import {
  MG400_DRAG_MODE,
  MG400_PAUSE_MODE,
  isMg400Mode,
  isMg400ModeEnabled,
  isMg400ModeMoving,
  isMg400ModePaused,
} from './mg400-modes.js';
import {
  Mg400MotionSettingsClient,
  mg400MotionSettingsPort,
} from './mg400-motion-settings.js';
import { Mg400RealtimeChannel } from './mg400-realtime.js';
export {
  Mg400ControllerClient,
  parseMg400ExchangeState,
  buildMg400ClearAlarmRequest,
  type Mg400ControllerState,
  type Mg400ExchangeState,
  type Mg400ClearAlarmRequest,
} from './mg400-controller.js';
export {
  MG400_REALTIME_FRAME_LENGTH,
  MG400_REALTIME_TEST_VALUE,
  Mg400RealtimeFrameError,
  Mg400RealtimeFramer,
  decodeMg400RealtimeFrame,
  type Mg400RealtimeFeedback,
} from './mg400-realtime.js';
export {
  MG400_DRAG_MODE,
  MG400_ENABLED_MODES,
  MG400_KNOWN_MODES,
  MG400_MOVING_MODES,
  MG400_PAUSE_MODE,
  isMg400Mode,
  isMg400ModeEnabled,
  isMg400ModeMoving,
  isMg400ModePaused,
} from './mg400-modes.js';
/** End-effector payload applied through explicit enable, not connection options. */
export interface Mg400Payload {
  /** End-effector mass in kg. */
  massKg: number;
  /** Optional moment of inertia in kg*m^2. */
  inertiaKgM2?: number;
}
/** MG400 rated payload mass in kg, as encoded by the reference. */
export const MG400_MAX_PAYLOAD_KG = 0.75;
export interface Mg400Options {
  host: string;
  httpPort?: number;
  /** Studio's HTTP transaction by default; TCP must be explicitly selected. */
  clearFaultsTransport?: 'studio' | 'tcp';
  clearFaultsTimeoutMs?: number;
  dashboardPort?: number;
  motionPort?: number;
  /** 30004 fixed-length feedback port; 0 disables the optional push channel. */
  feedbackPort?: number;
  /** Age at which a push frame stops being trusted as current state. */
  feedbackStaleAfterMs?: number;
  commandTimeoutMs?: number;
  motionTimeoutMs?: number;
  /**
   * How long `enable()` waits for the controller to confirm it is enabled.
   * Brake release can take several seconds, so this is deliberately longer than
   * the window used by the other lifecycle commands.
   */
  enableTimeoutMs?: number;
  /**
   * Ask the controller whether a target is reachable (`InverseSolution`) before
   * sending the motion. Default true. This is an optimisation, not a safety
   * interlock: a firmware without `InverseSolution`, a timeout or a transport
   * error lets the motion through unchecked.
   */
  verifyReachability?: boolean;
  /**
   * How long a dashboard state sample may be reused before `getState()`
   * re-queries the controller, in milliseconds. Default 200. `0` disables the
   * cache and the background poller entirely, so every read is fresh.
   *
   * Bounded on purpose: the runtime's `stable()` polls `getState()` every 50 ms,
   * and each uncached read costs `RobotMode()` + `GetErrorID()` + `GetPose()`.
   * A fault can therefore lag a real controller fault by at most this interval.
   * Anything that gates a physical action or asserts a transition succeeded
   * reads fresh regardless (see `confirm()`, `move()`), so this bound only
   * affects continuous observation, never a go/no-go decision. A sample also
   * yields early to the 30004 stream (see `isSampleReusable`).
   */
  statePollIntervalMs?: number;
  /** Reported whenever the effective actual-state source changes. */
  onFeedbackStatus?: (status: RobotArmFeedbackStatus) => void;
}
const DEFAULTS = {
  httpPort: MG400_HTTP_PORT,
  clearFaultsTransport: 'studio',
  clearFaultsTimeoutMs: 5000,
  dashboardPort: 29999,
  motionPort: 30003,
  feedbackPort: 30004,
  feedbackStaleAfterMs: 1000,
  commandTimeoutMs: 2000,
  motionTimeoutMs: 60000,
  enableTimeoutMs: 15000,
  verifyReachability: true,
  statePollIntervalMs: 200,
} as const;
/** How long every lifecycle command except `enable()` gets to confirm. */
const LIFECYCLE_TIMEOUT_MS = 5000;
/**
 * Idle poll intervals without a state read before the poller stops itself. This
 * keeps a bench nobody is watching from issuing dashboard commands forever,
 * while a caller polling at 50 ms still gets the full interval's freshness.
 */
const STATE_POLL_IDLE_INTERVALS = 3;
/** How long `emergencyStop()` waits for the controller to report no motion. */
const EMERGENCY_STOP_CONFIRM_MS = 5000;
/** `MoveJog` acknowledgement window; the controller answers in milliseconds. */
const JOG_COMMAND_TIMEOUT_MS = 1200;
/** How long `RobotMode()` may keep reporting JOG after a release. */
const JOG_STOP_CONFIRM_MS = 1500;
/**
 * Backoff for reopening channels the controller closed on its own. DobotStudio
 * takes the command channel while it is in `tp` mode and hands it back when the
 * operator returns to TCP mode; without this the service stayed offline until
 * it was restarted.
 */
const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 5000;
const logMg400 = getDebug('robot-arm:mg400', { console: true });
/**
 * `axisID` values from the TCP/IP protocol manual: X/Y/Z/R for Cartesian axes
 * and J1..J4 for joints, each with an explicit direction suffix.
 */
function jogAxis(target: JogTarget): string {
  const direction = target.direction > 0 ? '+' : '-';
  if ('axis' in target) return `${target.axis.toUpperCase()}${direction}`;
  // Runtime joint indices are zero-based; the protocol names joints from J1.
  return `J${target.joint + 1}${direction}`;
}
function formatMg400Number(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(6)));
}
export function buildMg400PayloadCommand(payload: Mg400Payload): string {
  const args = [formatMg400Number(payload.massKg)];
  if (payload.inertiaKgM2 !== undefined)
    args.push(formatMg400Number(payload.inertiaKgM2));
  return `SetPayLoad(${args.join(',')})`;
}
export function validateMg400Payload(payload: Mg400Payload): void {
  if (
    !Number.isFinite(payload.massKg) ||
    payload.massKg < 0 ||
    payload.massKg > MG400_MAX_PAYLOAD_KG
  )
    throw new RobotArmError(
      'INVALID_CONFIG',
      `MG400 payload massKg must be a finite number in [0, ${MG400_MAX_PAYLOAD_KG}]`,
      undefined,
      { massKg: payload.massKg },
    );
  if (
    payload.inertiaKgM2 !== undefined &&
    (!Number.isFinite(payload.inertiaKgM2) || payload.inertiaKgM2 < 0)
  )
    throw new RobotArmError(
      'INVALID_CONFIG',
      'MG400 payload inertiaKgM2 must be a finite number greater than or equal to 0',
      undefined,
      { inertiaKgM2: payload.inertiaKgM2 },
    );
}
export function parseMg400Response(line: string, command: string): string {
  const m = line
    .trim()
    .match(/^(-?\d+)\s*,\s*\{([\s\S]*)\}\s*,\s*([A-Za-z]\w*)\([\s\S]*\)\s*;$/);
  if (!m || m[3] !== command.slice(0, command.indexOf('(')))
    throw new RobotArmError(
      'PROTOCOL_ERROR',
      'Malformed or mismatched MG400 response',
      502,
      { command, response: line },
    );
  if (Number(m[1]) !== 0)
    throw new RobotArmError('VENDOR_ERROR', `MG400 rejected ${command}`, 409, {
      vendorCode: Number(m[1]),
      command,
      response: line,
    });
  return m[2];
}
function tuple(body: string, count: number): number[] {
  const values = body.split(',').map((v) => Number(v.trim()));
  if (
    values.length !== count ||
    body.split(',').some((v) => v.trim() === '') ||
    values.some((v) => !Number.isFinite(v)) ||
    body.trim() === ''
  )
    throw new RobotArmError(
      'PROTOCOL_ERROR',
      'Invalid MG400 numeric tuple',
      502,
      { body },
    );
  return values;
}
/** A keyed field such as `x:1` or `j2=2`, anchored so `max:` cannot match `x:`. */
function keyedField(key: string): string {
  return `(?:^|[,{])\\s*${key}\\s*[:=]\\s*(-?[\\d.]+)`;
}
function keyedValues(body: string, keys: string[]): number[] | undefined {
  const text = body.trim().replace(/^\{/, '').replace(/\}$/, '');
  const pattern = new RegExp(keys.map(keyedField).join('[\\s\\S]*?'), 'i').exec(
    text,
  );
  if (!pattern) return undefined;
  const values = pattern.slice(1, keys.length + 1).map(Number);
  return values.every((value) => Number.isFinite(value)) ? values : undefined;
}
/**
 * Strict four-joint reply parser for inverse kinematics. GetAngle has its own
 * explicitly bounded wire-format compatibility below.
 */
export function parseMg400Joints(body: string): number[] {
  return (
    keyedValues(body, ['j1', 'j2', 'j3', 'j4']) ??
    tuple(body.trim().replace(/^\{/, '').replace(/\}$/, ''), 4)
  );
}
/** Normalize only GetAngle's observed six-field, zero-padded reply to four joints. */
export function parseMg400GetAngle(body: string): number[] {
  const original = body.trim();
  const text =
    original.startsWith('{') && original.endsWith('}')
      ? original.slice(1, -1).trim()
      : original;
  const fields = text ? text.split(',').map((field) => field.trim()) : [];
  const fail = (reason: string): never => {
    throw new RobotArmError(
      'PROTOCOL_ERROR',
      `MG400 GetAngle(): ${reason} (received ${fields.length} fields)`,
      502,
      { command: 'GetAngle()', body, fieldCount: fields.length, reason },
    );
  };
  const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  if (fields.some((field) => /[:=]/.test(field))) {
    if (fields.length !== 4) fail('expected exactly four keyed joint fields');
    return fields.map((field, index) => {
      const match = new RegExp(`^j${index + 1}\\s*[:=]\\s*(.+)$`, 'i').exec(
        field,
      );
      if (
        !match ||
        !numeric.test(match[1]) ||
        !Number.isFinite(Number(match[1]))
      )
        fail(`invalid J${index + 1} field`);
      return Number(match![1]);
    });
  }
  if (fields.length !== 4 && fields.length !== 6)
    fail('expected four numbers or six numbers with zero padding');
  const values = fields.map((field, index) => {
    if (!numeric.test(field) || !Number.isFinite(Number(field)))
      fail(`field ${index + 1} must be a finite number`);
    return Number(field);
  });
  if (values.length === 6 && (values[4] !== 0 || values[5] !== 0))
    fail('fields 5 and 6 must both be zero');
  return values.slice(0, 4);
}
/**
 * Parse a `GetPose()` reply body. Accepts the flat four-number tuple and the
 * keyed `{x:…,y:…,z:…,r:…}` form the reference also handles.
 */
export function parseMg400Pose(body: string): CartesianPose {
  const [x, y, z, r] =
    keyedValues(body, ['x', 'y', 'z', 'r']) ??
    tuple(body.trim().replace(/^\{/, '').replace(/\}$/, ''), 4);
  return {
    frame: 'base',
    positionMm: { x, y, z },
    orientation: yawQuaternion(r),
  };
}
/**
 * Error-code group counts the MG400 dialect uses. The controller groups codes by
 * subsystem and the exact count varies by firmware revision, so the reference
 * accepts all three known shapes and rejects anything else rather than guessing.
 */
export const MG400_ERROR_ID_GROUP_COUNTS: readonly number[] = [5, 6, 7];
export interface Mg400ErrorIdReport {
  /** Error-code groups exactly as the controller reported them. */
  groups: number[][];
  /** Every non-zero code, flattened. Zero means "no error" in each slot. */
  codes: number[];
}
function decodeMg400ErrorGroups(
  data: unknown,
  payload: string,
): Mg400ErrorIdReport {
  const integers = (values: unknown[]): number[] =>
    values.map((value) => {
      if (typeof value !== 'number' || !Number.isInteger(value))
        throw new RobotArmError(
          'PROTOCOL_ERROR',
          'MG400 fault codes must be integers',
          502,
          { body: payload },
        );
      return value;
    });
  if (!Array.isArray(data))
    throw new RobotArmError(
      'PROTOCOL_ERROR',
      'MG400 fault payload must be an array',
      502,
      { body: payload },
    );
  // `[]` is an empty report, not a malformed one: some firmware answers it when
  // nothing is wrong. It is treated as a single empty group.
  if (data.length === 0) return { groups: [[]], codes: [] };
  const groups = data.every((entry) => Array.isArray(entry))
    ? (data as unknown[][]).map(integers)
    : [integers(data)];
  if (groups.length > 1 && !MG400_ERROR_ID_GROUP_COUNTS.includes(groups.length))
    throw new RobotArmError(
      'PROTOCOL_ERROR',
      `MG400 GetErrorID() returned ${groups.length} error-code groups; expected ${MG400_ERROR_ID_GROUP_COUNTS.join(', ')}`,
      502,
      { body: payload, groupCount: groups.length },
    );
  return { groups, codes: groups.flat().filter((code) => code !== 0) };
}
/**
 * Parse a complete `GetErrorID()` reply line.
 *
 * The generic {@link parseMg400Response} is deliberately strict and stays that
 * way: a rejected motion or lifecycle command must still surface its negative
 * vendor code, and `ErrorID,{…},MovL();` must never be accepted. Only this one
 * query tolerates the three shapes the controller is known to use:
 *
 * ```text
 * 0,{[[-1],[],[],[],[]]},GetErrorID();
 * ErrorID,{[[-1],[],[],[],[]]},GetErrorID();   // some firmware omits the code
 * 0,{[-1,0]},GetErrorID();                     // a single flat group
 * ```
 *
 * The trailing semicolon is optional because the reference implementation
 * treats it as such.
 */
export function parseMg400ErrorIdResponse(line: string): Mg400ErrorIdReport {
  const response = line.replace(/^\uFEFF/, '').trim();
  if (!/^(?:-?\d+\s*,|ErrorID\s*,)/i.test(response))
    throw new RobotArmError(
      'PROTOCOL_ERROR',
      'MG400 GetErrorID() reply does not start with a response code or ErrorID',
      502,
      { response },
    );
  if (!/,\s*GetErrorID\(\)\s*;?\s*$/i.test(response))
    throw new RobotArmError(
      'PROTOCOL_ERROR',
      'MG400 GetErrorID() reply does not echo the GetErrorID command',
      502,
      { response },
    );
  const open = response.indexOf('{');
  const close = response.lastIndexOf('}');
  if (open < 0 || close <= open)
    throw new RobotArmError(
      'PROTOCOL_ERROR',
      'MG400 GetErrorID() reply has no braced payload',
      502,
      { response },
    );
  const payload = response.slice(open + 1, close).trim();
  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch (error) {
    throw new RobotArmError('PROTOCOL_ERROR', 'Invalid MG400 fault JSON', 502, {
      body: payload,
      cause: String(error),
    });
  }
  return decodeMg400ErrorGroups(data, payload);
}
/** Rz in degrees for a four-axis pose, shared by motion and reachability. */
export function mg400RzDegrees(pose: CartesianPose): number {
  const q = pose.orientation;
  return (Math.atan2(2 * q.w * q.z, 1 - 2 * q.z * q.z) * 180) / Math.PI;
}
/**
 * The controller's own inverse-kinematics query for exactly the pose we are
 * about to command. It is the only honest reachability oracle available: the
 * reference encodes the MG400 joint limits but no Cartesian envelope, and
 * deriving one would need forward kinematics plus an unverified radius, which
 * has no place in a pre-dispatch check.
 */
export function buildMg400ReachabilityCommand(pose: CartesianPose): string {
  const p = pose.positionMm;
  return `InverseSolution(${formatMg400Number(p.x)},${formatMg400Number(p.y)},${formatMg400Number(p.z)},${formatMg400Number(mg400RzDegrees(pose))},0,0)`;
}
/** Diagnostics for the optional pre-dispatch reachability query. */
export interface Mg400ReachabilityStatus {
  /** Times the controller confirmed the target before the motion was sent. */
  verified: number;
  /** Times the controller rejected the target, so no motion was sent. */
  rejected: number;
  /** Times no verdict was available and the motion was sent unchecked. */
  unchecked: number;
  /** Why the most recent check produced no verdict. */
  lastSkipReason?: string;
}
/**
 * Map the six-value 30004 tool vector to the four-axis XYZ+R pose. The first
 * three values are XYZ; the fourth is R in degrees (the last two are padding).
 * This raw TCP vector is not an authoritative Base/Tool0 flange pose, even
 * when the feedback frame reports User0/Tool0.
 */
export function mg400PoseFromToolVector(
  toolVectorActual: readonly number[],
): CartesianPose {
  if (toolVectorActual.length < 6)
    throw new RobotArmError(
      'PROTOCOL_ERROR',
      'MG400 realtime tool vector must contain six values',
      502,
    );
  const [x, y, z] = toolVectorActual;
  return {
    frame: 'base',
    positionMm: { x, y, z },
    orientation: yawQuaternion(toolVectorActual[3]),
  };
}
export function buildMg400MotionCommand(
  name: 'MovL' | 'MovJ',
  pose: CartesianPose,
  options: MotionOptions = {},
): string {
  assertPose(pose);
  const q = pose.orientation;
  if (Math.abs(q.x) > 1e-6 || Math.abs(q.y) > 1e-6)
    throw new RobotArmError(
      'ORIENTATION_UNSUPPORTED',
      'MG400 supports XYZ + Rz only',
      422,
    );
  const speed = options.speed ?? { kind: 'ratio', value: 0.1 };
  assertSpeed(speed);
  if (speed.kind !== 'ratio')
    throw new RobotArmError(
      'UNSUPPORTED_SPEED',
      'MG400 SpeedL/SpeedJ are ratios, not mm/s',
      422,
    );
  const acceleration = options.acceleration ?? { kind: 'ratio', value: 0.1 };
  if (
    acceleration.kind !== 'ratio' ||
    !Number.isFinite(acceleration.value) ||
    acceleration.value <= 0 ||
    acceleration.value > 1
  )
    throw new RobotArmError(
      'INVALID_ACCELERATION',
      'Acceleration must be a ratio (0,1]',
    );
  if (speed.value < 0.01 || acceleration.value < 0.01)
    throw new RobotArmError(
      'MOTION_PARAMETER_LIMIT',
      'MG400 minimum ratio is 0.01; adjust the configured base parameters',
      422,
    );
  const r = mg400RzDegrees(pose);
  const p = pose.positionMm;
  const l = name === 'MovL';
  return `${name}(${p.x},${p.y},${p.z},${r},User=0,Tool=0,${l ? 'SpeedL' : 'SpeedJ'}=${Math.max(1, Math.round(speed.value * 100))},${l ? 'AccL' : 'AccJ'}=${Math.max(1, Math.round(acceleration.value * 100))},CP=0)`;
}
/** One in-flight response per channel. A timeout quarantines the socket; never reuse a late reply. */
class TextChannel {
  private epoch = 0;
  private socket?: Socket;
  private opening?: Promise<void>;
  private cancelOpening?: (error: unknown) => void;
  private buffer = '';
  private serial: Promise<unknown> = Promise.resolve();
  private pending?: {
    command: string;
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
    parse: (line: string, command: string) => unknown;
  };
  constructor(
    private host: string,
    private port: number,
    private timeoutMs: number,
    private onUnexpectedClose?: () => void,
  ) {}
  get connected() {
    return Boolean(
      this.socket && !this.socket.destroyed && !this.socket.connecting,
    );
  }
  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    if (this.opening) return this.opening;
    const epoch = this.epoch;
    const opening: Promise<void> = new Promise<void>((resolve, reject) => {
      this.cancelOpening = reject;
      const socket = createConnection({ host: this.host, port: this.port });
      this.socket = socket;
      this.buffer = '';
      socket.setEncoding('utf8');
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(
          new RobotArmError(
            'CONNECTION_TIMEOUT',
            'MG400 connection timed out',
            504,
          ),
        );
      }, this.timeoutMs);
      socket.once('connect', () => {
        clearTimeout(timeout);
        if (epoch !== this.epoch || this.socket !== socket) {
          reject(
            new RobotArmError(
              'QUERY_INTERRUPTED',
              'Connection was isolated',
              409,
            ),
          );
          return;
        }
        resolve();
      });
      socket.on('data', (chunk: string) => {
        if (this.socket !== socket) return;
        this.buffer += chunk;
        if (this.buffer.length > 65536) {
          this.close(
            new RobotArmError('PROTOCOL_ERROR', 'Oversized MG400 reply', 502),
          );
          return;
        }
        let index = this.buffer.indexOf(';');
        while (index >= 0) {
          const line = this.buffer.slice(0, index + 1);
          this.buffer = this.buffer.slice(index + 1);
          const p = this.pending;
          this.pending = undefined;
          if (!p) {
            this.close(
              new RobotArmError(
                'PROTOCOL_ERROR',
                'Unexpected MG400 reply',
                502,
              ),
            );
            return;
          }
          clearTimeout(p.timer);
          try {
            p.resolve(p.parse(line, p.command));
          } catch (e) {
            p.reject(e);
          }
          index = this.buffer.indexOf(';');
        }
      });
      socket.on('error', (e) => {
        clearTimeout(timeout);
        reject(new RobotArmError('DISCONNECTED', e.message, 503));
        if (this.socket === socket)
          this.close(new RobotArmError('DISCONNECTED', e.message, 503));
      });
      socket.on('close', () => {
        clearTimeout(timeout);
        reject(
          new RobotArmError('DISCONNECTED', 'MG400 connection closed', 503),
        );
        if (this.socket === socket) this.close();
      });
    }).finally(() => {
      if (this.opening === opening) {
        this.opening = undefined;
        this.cancelOpening = undefined;
      }
    });
    this.opening = opening;
    return opening;
  }
  send(command: string, timeoutMs = this.timeoutMs): Promise<string> {
    return this.sendWith(parseMg400Response, command, timeoutMs);
  }
  /**
   * Send a command whose reply cannot go through the strict generic parser.
   * `GetErrorID()` is the only such command today: some firmware prefixes the
   * reply with `ErrorID,` instead of a response code.
   */
  sendWith<T>(
    parse: (line: string, command: string) => T,
    command: string,
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    const epoch = this.epoch;
    const work = this.serial.then(() => {
      if (epoch !== this.epoch)
        throw new RobotArmError(
          'QUERY_INTERRUPTED',
          'Command belongs to an isolated channel',
          409,
        );
      if (!this.connected)
        throw new RobotArmError(
          'DISCONNECTED',
          'MG400 channel requires explicit reconnect',
          503,
        );
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            this.close(
              new RobotArmError(
                'COMMAND_TIMEOUT',
                'MG400 command completion is unknown',
                504,
                { command },
              ),
            ),
          timeoutMs,
        );
        // The channel holds one pending request without knowing its type, so the
        // value handed back is the one this call's own parser produced for this
        // call's own command.
        this.pending = {
          command,
          resolve: (value) => resolve(value as T),
          reject,
          timer,
          parse,
        };
        this.socket!.write(command);
      });
    });
    this.serial = work.catch(() => undefined);
    return work;
  }
  /**
   * Send a command whose acknowledgement is not a contract, then drop the
   * channel. `MoveJog()` while the arm moves is the case: its reply arrives late
   * and, if the channel is reused, is matched against the next request and looks
   * like protocol corruption. Closing here means the late reply is discarded
   * with the socket instead of poisoning an unrelated query.
   */
  async writeAndClose(command: string): Promise<void> {
    await this.connect();
    // Queue behind any in-flight command. A renewal issued just before the
    // release must reach the controller *before* the stop; writing straight to
    // the socket let a queued `MoveJog(axis)` land after it and keep the arm
    // moving with nobody holding the button.
    const work = this.serial.then(async () => {
      const socket = this.socket;
      if (!socket) throw new RobotArmError('DISCONNECTED', 'No channel', 503);
      // `end()` flushes and sends FIN. Destroying right after the write can
      // reset the connection while the controller still has the command unread.
      await new Promise<void>((resolve, reject) => {
        socket.write(`${command}\n`, (error) => {
          if (error) {
            reject(error);
            return;
          }
          socket.end(() => resolve());
        });
      });
      this.close(undefined, true);
    });
    this.serial = work.catch(() => undefined);
    return work;
  }
  close(
    error: unknown = new RobotArmError(
      'DISCONNECTED',
      'MG400 channel closed',
      503,
    ),
    intentional = false,
  ): void {
    const wasOpen = Boolean(this.socket || this.opening || this.pending);
    this.epoch++;
    this.cancelOpening?.(error);
    this.cancelOpening = undefined;
    this.opening = undefined;
    const socket = this.socket;
    this.socket = undefined;
    this.buffer = '';
    const p = this.pending;
    this.pending = undefined;
    if (p) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    socket?.destroy();
    if (wasOpen && !intentional) this.onUnexpectedClose?.();
  }
}
export class Mg400Adapter implements RobotArmAdapter {
  private readonly controller: Mg400ControllerClient;
  private readonly motionSettings: Mg400MotionSettingsClient;
  private lastFaultSampleAt = 0;
  private sequenceOwner?: object;
  private releaseSequence?: () => void;
  readonly id = 'dobot-mg400';
  readonly name = 'Dobot MG400';
  readonly connectionIdentity: string;
  /**
   * `workspace` is deliberately left undefined. The reference encodes the MG400
   * joint limits (J1 ±160, J2 −25…85, J3 −25…105, J4 ±360) but no Cartesian
   * envelope anywhere, and deriving one needs forward kinematics plus a radius
   * nobody has measured. Publishing an invented box here would put an unverified
   * number in a safety path, so the only Cartesian bound enforced is the
   * operator-approved one in the Robot Profile, and reachability is asked of the
   * controller instead (`verifyReachability`).
   */
  readonly contractVersion = 1 as const;
  readonly kinematics: RobotKinematics = {
    schematic: {
      width: 440,
      height: 260,
      image: `data:image/svg+xml,${encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 260"><g fill="#edf1f7" stroke="#65748a" stroke-width="3"><path d="M48 239h87l-8-24H57Z M71 213v-49q0-19 21-19h18v68Z"/><path d="m100 157 102-87 143 50" fill="none" stroke-width="20" stroke-linecap="round"/><path d="M345 120v40m-15 0h30m-15 0v24" fill="none" stroke-width="7"/><path d="m113 173 102-87 130 45-13 16-130-45-102 87Z" fill="none" stroke-dasharray="5 4"/></g></svg>',
      )}`,
      markers: [
        { x: 90, y: 205 },
        { x: 100, y: 157 },
        { x: 202, y: 70 },
        { x: 345, y: 120 },
      ],
    },
    jointCount: 4,
    joints: [
      [-160, 160],
      [-25, 85],
      [-25, 105],
      [-360, 360],
    ].map(([min, max], i) => ({
      name: `J${i + 1}`,
      type: 'revolute',
      unit: 'degrees',
      limits: {
        min,
        max,
        source: 'MG400 reference joint limits; verify on installed controller',
      },
    })),
    cartesianDof: ['x', 'y', 'z', 'rz'],
    orientation: 'yaw',
    fixedOrientation: { x: 0, y: 0, z: 0, w: 1 },
    screenNormalToleranceDegrees: SCREEN_TILT_LIMIT_DEGREES,
  };
  readonly setupDefaults = robotSetupDefaults('mg400');
  readonly readinessPolicy = { maxStateAgeMs: 1000, required: [] };
  readonly driver: RobotDriver;
  readonly motionLimits: NonNullable<RobotArmAdapter['motionLimits']>;
  private sampleSequence = 0;
  private lastCommandAt = 0;
  private softwarePaused = false;
  private safetyPriority = 0;
  private kinematicSupport: Record<
    'forward' | 'inverse',
    'unknown' | 'supported' | 'unsupported'
  > = { forward: 'unknown', inverse: 'unknown' };
  readonly payloadRequiresDisabled = true;
  readonly payloadLimits = {
    massKg: { min: 0, max: MG400_MAX_PAYLOAD_KG },
    inertiaKgM2: { min: 0 },
  };
  private readonly solveForward = async (values: number[]) =>
    parseMg400Pose(
      await this.dashboard.send(`PositiveSolution(${values.join(',')},0,0)`),
    );
  private readonly solveInverse = async (pose: CartesianPose) =>
    parseMg400Joints(
      await this.dashboard.send(buildMg400ReachabilityCommand(pose)),
    );
  private readonly motionCapabilities: RobotArmCapabilities = {
    jointCount: 4,
    orientation: 'yaw',
    fixedOrientation: { x: 0, y: 0, z: 0, w: 1 },
    ptp: true,
    linear: true,
    dragMode: true,
    stop: true,
    speedModes: ['ratio'],
    screenNormalToleranceDegrees: SCREEN_TILT_LIMIT_DEGREES,
  };
  private dashboard: TextChannel;
  private motion: TextChannel;
  /** True between `MoveJog(axisID)` and a confirmed release. */
  private jogActive = false;
  /**
   * The controller resets the connection that carried `MoveJog` when the jog
   * ends. That close is expected and must not be read as a lost robot.
   */
  private jogReleasing = false;
  private feedback: Mg400RealtimeChannel;
  private generation = 0;
  private safetyGeneration = 0;
  private active = false;
  /**
   * Stop or emergency-stop work in flight. Automatic reconnection must not
   * reopen channels underneath a safety control that is closing and replacing
   * them itself; unlike `safetyPriority`, this is cleared even when the control
   * fails, so a later retry is free to reconnect.
   */
  private safetyControls = 0;
  private stopOutcome: Promise<void> = Promise.resolve();
  private poseDialect: 'plain' | 'named' | 'kinematic' = 'plain';
  private getAnglePaddingLogged = false;
  /**
   * Every option resolved to a concrete value. `onFeedbackStatus` is a callback
   * rather than configuration. Payload belongs to explicit enable and is not part
   * of these connection options.
   */
  private config: Required<Omit<Mg400Options, 'onFeedbackStatus'>>;
  private readonly payloadApplication = new PayloadApplicationTracker();
  private connectionReady = false;
  private connectionOpening?: Promise<void>;
  /**
   * Whether an unexpected channel loss should be repaired automatically. It
   * starts armed, `disconnect()` disarms it so shutdown never reopens a
   * controller channel, and `connect()` arms it again for the next loss.
   */
  private reconnectDesired = true;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  /** Set only after a connection was actually established once. */
  private hasConnected = false;
  private lastControllerClock?: bigint;
  private payloadEvidence() {
    const frame = this.feedback.current();
    if (frame) {
      if (
        this.lastControllerClock !== undefined &&
        frame.controllerTimestampMs < this.lastControllerClock
      ) {
        this.payloadApplication.invalidate('controller-restarted');
        this.generation++;
        this.controller.interrupt();
        this.motionSettings.interrupt();
        this.connectionReady = false;
        this.invalidateStateSample();
      }
      this.lastControllerClock = frame.controllerTimestampMs;
    }
    const evidence = this.payloadApplication.read();
    if (
      this.connectionReady &&
      frame?.enabled &&
      frame.loadKg >= 0 &&
      frame.loadKg <= MG400_MAX_PAYLOAD_KG
    ) {
      // Initial adoption needs a stationary arm. Once confirmed, normal motion
      // can retain that evidence while fresh feedback still reports the load.
      if (
        evidence.status === 'confirmed' ||
        (frame.mode === 5 &&
          !frame.running &&
          !frame.pauseCmdFlag &&
          !frame.dragStatus)
      )
        this.payloadApplication.observeReadback(frame.loadKg, frame.receivedAt);
    } else if (evidence.applied?.source === 'controller-readback') {
      this.payloadApplication.invalidate('readback-unavailable');
    }
    return this.payloadApplication.read();
  }
  /**
   * Bounded dashboard state sample; see `statePollIntervalMs`. `frameAt` records
   * which push frame the sample was built from, so a newer frame or a stream
   * that went stale can invalidate it.
   */
  private stateSample?: { state: RobotState; at: number; frameAt?: number };
  /** In-flight dashboard refresh, shared so concurrent readers cannot stack. */
  private stateRefresh?: Promise<RobotState>;
  private statePollTimer?: ReturnType<typeof setTimeout>;
  /**
   * When something last asked for state. The poller runs only while this is
   * recent, so an idle bench issues no dashboard commands at all.
   */
  private lastStateDemandAt = 0;
  private readonly reachability: Mg400ReachabilityStatus = {
    verified: 0,
    rejected: 0,
    unchecked: 0,
  };
  constructor(options: Mg400Options) {
    if ('payload' in options)
      throw new RobotArmError(
        'INVALID_CONFIG',
        'Connection options no longer accept payload. Configure it in Setup or pass it to enable(payload).',
      );
    if (!options.host)
      throw new RobotArmError('INVALID_CONFIG', 'MG400 host is required');
    this.config = { ...DEFAULTS, ...options };
    this.connectionIdentity = `${options.host}:${this.config.dashboardPort}:${this.config.motionPort}`;
    for (const port of [
      this.config.dashboardPort,
      this.config.motionPort,
      this.config.httpPort,
    ])
      if (!Number.isInteger(port) || port <= 0 || port > 65535)
        throw new RobotArmError('INVALID_CONFIG', 'Invalid MG400 port');
    if (!['studio', 'tcp'].includes(this.config.clearFaultsTransport))
      throw new RobotArmError(
        'INVALID_CONFIG',
        'Invalid MG400 clear-fault transport',
      );
    if (
      !Number.isInteger(this.config.clearFaultsTimeoutMs) ||
      this.config.clearFaultsTimeoutMs <= 0
    )
      throw new RobotArmError(
        'INVALID_CONFIG',
        'Invalid MG400 clear-fault timeout',
      );
    this.motionSettings = new Mg400MotionSettingsClient(
      mg400MotionSettingsPort(
        options.host,
        { port: this.config.httpPort, timeoutMs: this.config.commandTimeoutMs },
        async () => {
          const state = await this.getStateFresh();
          if (
            !state.connected ||
            state.enabled ||
            state.moving ||
            state.dragMode ||
            state.paused ||
            this.softwarePaused ||
            state.faults.length
          )
            throw new RobotArmError(
              'CONTROLLER_SETTINGS_NOT_IDLE',
              'Disable the robot and clear faults before changing controller motion settings',
              409,
            );
        },
      ),
      this.connectionIdentity,
    );
    this.controller = new Mg400ControllerClient(options.host, {
      port: this.config.httpPort,
      timeoutMs: this.config.commandTimeoutMs,
    });
    if (
      !Number.isInteger(this.config.feedbackPort) ||
      this.config.feedbackPort < 0 ||
      this.config.feedbackPort > 65535
    )
      throw new RobotArmError('INVALID_CONFIG', 'Invalid MG400 feedback port');
    if (
      !Number.isInteger(this.config.enableTimeoutMs) ||
      this.config.enableTimeoutMs <= 0
    )
      throw new RobotArmError('INVALID_CONFIG', 'Invalid MG400 enable timeout');
    if (
      !Number.isInteger(this.config.statePollIntervalMs) ||
      this.config.statePollIntervalMs < 0
    )
      throw new RobotArmError(
        'INVALID_CONFIG',
        'Invalid MG400 state poll interval',
      );
    const constraints = {
      speed: { ratio: { min: 0.01, max: 1 } },
      acceleration: { ratio: { min: 0.01, max: 1 } },
    };
    this.motionLimits = {
      linear: constraints,
      linearSequence: constraints,
      ptp: constraints,
      joints: constraints,
    };
    const arm = this;
    this.driver = {
      readControllerState: () => this.controller.readState(),
      readMotionSettings: () => this.motionSettings.read(),
      updateMotionSettings: (request) => this.motionSettings.update(request),
      readPose: (options) => this.readPoseSample(options?.fresh ?? false),
      readJoints: async () => {
        const values = await this.readMeasuredJoints();
        return { ...this.pollSample(), values };
      },
      moveLinear: (p, o) => this.moveLinear(p, o),
      beginLinearSequence: (targets, options) =>
        this.beginSequence(targets, options),
      movePtp: (p, o) => this.movePtp(p, o),
      moveJoints: (v, o) => this.moveJoints(v, o),
      stop: () => this.stop(),
      enable: () => this.enable(),
      enableWithPayload: (payload) => this.enable(payload),
      appliedPayload: () => this.payloadEvidence().applied,
      applyPayload: (payload) => this.applyPayload(payload),
      readPayloadApplication: () => this.payloadEvidence(),
      disable: () => this.disable(),
      clearFaults: () => this.clearFaults(),
      enterDragMode: () => this.enterDragMode(),
      exitDragMode: () => this.exitDragMode(),
      startJog: (target) => this.startJog(target),
      stopJog: () => this.stopJog(),
      pause: () => this.pause(),
      resume: () => this.resume(),
      emergencyStop: () => this.emergencyStop(),
      get forwardKinematics() {
        return arm.kinematicSupport.forward === 'supported'
          ? arm.solveForward
          : undefined;
      },
      get inverseKinematics() {
        return arm.kinematicSupport.inverse === 'supported'
          ? arm.solveInverse
          : undefined;
      },
      connect: () => this.connect(),
      disconnect: () => this.disconnect(),
      getState: (o) => this.readStatus(o?.fresh ?? false),
    };
    this.dashboard = new TextChannel(
      options.host,
      this.config.dashboardPort,
      this.config.commandTimeoutMs,
      () => {
        if (this.jogReleasing) {
          logMg400('dashboard channel reset by the controller after a jog');
          return;
        }
        logMg400(`dashboard channel closed (jog=${this.jogActive})`);
        this.connectionLost();
      },
    );
    this.motion = new TextChannel(
      options.host,
      this.config.motionPort,
      this.config.commandTimeoutMs,
      () => {
        logMg400(`motion channel closed (jog=${this.jogActive})`);
        this.connectionLost();
      },
    );
    this.feedback = new Mg400RealtimeChannel({
      host: options.host,
      port: this.config.feedbackPort,
      staleAfterMs: this.config.feedbackStaleAfterMs,
      onStatusChange: options.onFeedbackStatus,
    });
  }
  private connectionLost(): void {
    this.connectionReady = false;
    this.generation++;
    this.controller.interrupt();
    this.motionSettings.interrupt();
    this.payloadApplication.invalidate('connection-lost');
    this.invalidateStateSample();
    this.stopStatePoller();
    // Isolate both command channels together; the second old socket's close
    // notification must not invalidate a newly established connection.
    this.dashboard.close(undefined, true);
    this.motion.close(undefined, true);
    this.jogActive = false;
    this.feedback.close();
    this.scheduleReconnect();
  }
  private clearReconnect(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }
  /**
   * Reopen the channels after the controller closed them without being asked.
   * DobotStudio owns the command channel in `tp` mode and can drop this
   * service's sockets while it does; switching back to `tcp` used to require a
   * service restart before state and motion worked again.
   *
   * A refuted attempt is retried with backoff, which also covers the controller
   * refusing commands until the mode switch settles. An in-flight motion or
   * safety control owns the channels while it settles, so the retry waits
   * instead of opening a competing socket underneath it.
   */
  private scheduleReconnect(): void {
    if (!this.reconnectDesired || !this.hasConnected) return;
    if (this.reconnectTimer || this.connectionReady) return;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt,
      RECONNECT_MAX_DELAY_MS,
    );
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.reconnectDesired || this.connectionReady) return;
      if (this.active || this.safetyControls > 0) {
        this.scheduleReconnect();
        return;
      }
      void this.connect().then(
        () => {
          if (this.connectionReady) this.reconnectAttempt = 0;
          else this.scheduleReconnect();
        },
        () => this.scheduleReconnect(),
      );
    }, delay);
    // Never hold the process open just to retry a diagnostic connection.
    this.reconnectTimer.unref?.();
  }
  async connect() {
    this.reconnectDesired = true;
    if (this.connectionOpening) return this.connectionOpening;
    if (
      this.connectionReady &&
      this.dashboard.connected &&
      this.motion.connected
    ) {
      await this.getStateFresh();
      this.reconnectAttempt = 0;
      this.clearReconnect();
      return;
    }
    const opening = this.openConnection();
    this.connectionOpening = opening;
    try {
      await opening;
    } finally {
      if (this.connectionOpening === opening)
        this.connectionOpening = undefined;
    }
  }
  private async openConnection() {
    this.connectionReady = false;
    if (this.payloadApplication.read().status !== 'unconfirmed')
      this.payloadApplication.invalidate('connection-lost');
    this.getAnglePaddingLogged = false;
    const generation = this.generation;
    const check = () => {
      if (generation !== this.generation)
        throw new RobotArmError(
          'QUERY_INTERRUPTED',
          'Connection interrupted by safety control',
          409,
        );
    };
    try {
      await this.dashboard.connect();
      check();
      await this.motion.connect();
      check();
      // 30004 is a preferred source, never a prerequisite: the adapter opens it
      // best-effort and keeps working through dashboard polling without it.
      this.feedback.start();
      let initialState: RobotState;
      try {
        initialState = await this.getState();
      } catch (error) {
        if (!isRobotArmError(error) || error.details?.vendorCode !== -1)
          throw error;
        check();
        // A vendor refusal identifies a reachable controller that needs TCP/IP preparation.
        this.feedback.close();
        this.dashboard.close(undefined, true);
        this.motion.close(undefined, true);
        this.invalidateStateSample();
        await prepareMg400TcpConnection(this.config.host, {
          checkConnection: check,
          port: this.config.dashboardPort,
          httpPort: this.config.httpPort,
          timeoutMs: this.config.commandTimeoutMs,
        });
        check();
        await this.dashboard.connect();
        check();
        await this.motion.connect();
        check();
        this.feedback.start();
        initialState = await this.getStateFresh();
      }
      check();
      await this.negotiateKinematics(generation);
      check();
      if (initialState.enabled && !this.feedback.current()) {
        try {
          await this.feedback.waitForFrame(1000);
        } catch (error) {
          if (!isRobotArmError(error) || error.code !== 'FEEDBACK_UNAVAILABLE')
            throw error;
        }
        check();
      }
      this.connectionReady = true;
      this.payloadEvidence();
      check();
      this.hasConnected = true;
      this.reconnectAttempt = 0;
      this.clearReconnect();
    } catch (e) {
      // Diagnose before closing: the feedback frame captured here is the only
      // evidence of what the controller was doing when it refused the query.
      const failure = this.describeConnectFailure(e);
      if (generation !== this.generation) throw e;
      this.feedback.close();
      this.dashboard.close(undefined, true);
      this.motion.close(undefined, true);
      // A previously established controller may still be handing the channel
      // back; keep trying even when this particular attempt was refused.
      this.scheduleReconnect();
      throw failure;
    }
  }
  /** Explain a TCP command rejection without advertising another mode. */
  private describeConnectFailure(error: unknown): unknown {
    if (!isRobotArmError(error) || error.details?.vendorCode !== -1)
      return error;
    const frame = this.feedback.current();
    return new RobotArmError(
      error.code,
      `${error.message}; the controller is not serving TCP clients (vendor code -1). TCP/IP development is the only supported connection.`,
      error.status,
      {
        ...error.details,
        ...(frame
          ? {
              mode: frame.mode,
              errorActive: frame.errorActive,
              enabled: frame.enabled,
            }
          : {}),
      },
    );
  }
  private async negotiateKinematics(generation: number): Promise<void> {
    const check = () => {
      if (generation !== this.generation)
        throw new RobotArmError(
          'QUERY_INTERRUPTED',
          'Capability negotiation interrupted by safety control',
          409,
        );
    };
    const joints = await this.readMeasuredJoints();
    check();
    const pose = await this.readMeasuredPose();
    check();
    const probe = async (
      kind: 'forward' | 'inverse',
      command: string,
      parse: (body: string) => unknown,
    ) => {
      try {
        check();
        parse(await this.dashboard.send(command));
        check();
        this.kinematicSupport[kind] = 'supported';
      } catch (error) {
        const code =
          error instanceof RobotArmError
            ? error.details?.vendorCode
            : undefined;
        if (code === -30001) this.kinematicSupport[kind] = 'unsupported';
        else if (typeof code === 'number' && code < 0)
          this.kinematicSupport[kind] = 'supported';
        else {
          this.kinematicSupport[kind] = 'unknown';
          throw error;
        }
      }
    };
    await probe(
      'forward',
      `PositiveSolution(${joints.join(',')},0,0)`,
      parseMg400Pose,
    );
    await probe(
      'inverse',
      buildMg400ReachabilityCommand(pose),
      parseMg400Joints,
    );
  }
  async disconnect() {
    this.reconnectDesired = false;
    this.hasConnected = false;
    this.reconnectAttempt = 0;
    this.clearReconnect();
    this.connectionReady = false;
    this.payloadApplication.invalidate('disconnected');
    this.generation++;
    this.controller.interrupt();
    this.motionSettings.interrupt();
    this.releaseSequence?.();
    this.stopStatePoller();
    this.invalidateStateSample();
    this.feedback.close();
    this.dashboard.close(undefined, true);
    this.motion.close(undefined, true);
    this.jogActive = false;
  }
  /**
   * Firmware can stream a TCP vector that disagrees with GetPose and forward
   * kinematics even with User0/Tool0 selected. Never compare it with Base
   * targets or use it to time contact. Sequence handoffs query Base poses.
   */
  latestToolVectorSample():
    | { pose: CartesianPose; receivedAt: number }
    | undefined {
    return undefined;
  }
  private async beginSequence(
    targets: readonly LinearSequenceTarget[],
    options: LinearSequenceOptions,
  ) {
    targets = structuredClone(targets);
    options = { ...options };
    if (this.active)
      throw new RobotArmError('BUSY', 'MG400 has an outstanding motion', 409);
    const owner = {};
    const generation = this.generation;
    this.sequenceOwner = owner;
    this.active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let released = false;
    let faultAt = 0;
    let latest: SequenceFeedback | undefined;
    let poseTimer: ReturnType<typeof setTimeout> | undefined;
    let poseReading = false;
    const readSequencePose = async () => {
      if (poseReading || released) return;
      poseReading = true;
      try {
        const sample = await this.readPoseSample(true);
        control();
        if (!released)
          latest = {
            sampleId: sample.sampleId,
            connectionGeneration: generation,
            receivedAt: Date.parse(sample.receivedAt),
            pose: sample.pose,
          };
      } catch (error) {
        if (!released) faultError = error;
      } finally {
        poseReading = false;
        if (!released && generation === this.generation)
          poseTimer = setTimeout(() => void readSequencePose(), 10);
      }
    };
    let faultError: unknown;
    const control = () => {
      if (
        generation !== this.generation ||
        this.sequenceOwner !== owner ||
        options.signal?.aborted
      )
        throw new RobotArmError(
          'ACTION_STOPPED',
          'MG400 sequence was interrupted',
          409,
        );
    };
    const release = () => {
      released = true;
      if (timer) clearTimeout(timer);
      if (poseTimer) clearTimeout(poseTimer);
      if (this.sequenceOwner === owner) {
        this.sequenceOwner = undefined;
        this.releaseSequence = undefined;
        this.active = false;
      }
    };
    this.releaseSequence = release;
    const assertIdle = (state: RobotState) => {
      if (
        !state.connected ||
        !state.enabled ||
        state.moving ||
        state.paused ||
        state.dragMode ||
        state.faults.length ||
        this.softwarePaused
      )
        throw new RobotArmError(
          'ROBOT_FAULT',
          'MG400 sequence requires enabled, idle, fault-free state',
          409,
        );
    };
    const pollFaults = async () => {
      const started = Date.now();
      try {
        const state = await this.getStateFresh();
        control();
        if (
          !state.connected ||
          !state.enabled ||
          state.paused ||
          state.dragMode ||
          state.faults.length ||
          this.softwarePaused
        )
          faultError = new RobotArmError(
            'ROBOT_FAULT',
            'MG400 is no longer ready during the sequence',
            409,
            { faults: state.faults, mode: state.mode },
          );
        faultAt = Date.now();
      } catch (error) {
        if (!released)
          faultError =
            isRobotArmError(error) && error.code === 'ROBOT_FAULT'
              ? error
              : new RobotArmError(
                  'SEQUENCE_FAULT_QUERY_FAILED',
                  'MG400 fault monitoring failed',
                  503,
                  { cause: String(error) },
                );
      } finally {
        if (!released && generation === this.generation)
          timer = setTimeout(
            () => void pollFaults(),
            Math.max(0, 100 - (Date.now() - started)),
          );
      }
    };
    try {
      for (const target of targets) {
        buildMg400MotionCommand('MovL', target.pose, target.options);
        validateMotionOptions(target.options, this.motionLimits.linear!, 4);
        await this.checkReachability(target.pose);
        control();
      }
      assertIdle(await this.getStateFresh());
      control();
      faultAt = this.lastFaultSampleAt;
      // GetPose(User=0,Tool=0), or measured-joint FK, is authoritative.
      // Never use the incompatible 30004 TCP vector to time a handoff.
      await readSequencePose();
      if (faultError) throw faultError;
      const sequence = createLinearMotionSequence(targets, options, {
        check: (controlOnly) => {
          control();
          if (controlOnly) return;
          if (faultError) throw faultError;
          if (Date.now() - faultAt > 200)
            throw new RobotArmError(
              'SEQUENCE_FAULT_STATE_STALE',
              'MG400 fault state is older than 200 ms',
              409,
            );
          const frame = this.feedback.current();
          if (
            frame &&
            (!frame.enabled ||
              frame.dragStatus !== 0 ||
              frame.pauseCmdFlag ||
              ![5, 7, 8].includes(frame.mode) ||
              this.softwarePaused)
          )
            throw new RobotArmError(
              'ROBOT_FAULT',
              'MG400 sequence interrupted by controller state',
              409,
            );
        },
        feedback: () => latest,
        submit: async (target, terminal) => {
          control();
          if (terminal) {
            assertIdle(await this.getStateFresh());
            await this.checkReachability(target.pose);
            control();
          }
          this.invalidateStateSample();
          this.lastCommandAt = Date.now();
          const submittedAt = this.lastCommandAt;
          await this.motion.send(
            buildMg400MotionCommand('MovL', target.pose, target.options),
          );
          control();
          return { id: randomUUID(), acceptedAt: Date.now(), submittedAt };
        },
        terminal: async (target) => {
          control();
          await this.motion.send(
            'Sync()',
            Math.min(options.timeoutMs, this.config.motionTimeoutMs),
          );
          control();
          const state = await this.getStateFresh();
          control();
          assertIdle(state);
          const measured = {
            pose: state.pose ?? (await this.readMeasuredPose()),
          };
          control();
          if (
            distance(measured.pose.positionMm, target.pose.positionMm) > 0.5 ||
            quaternionDistance(
              measured.pose.orientation,
              target.pose.orientation,
            ) > 0.01
          )
            throw new RobotArmError(
              'POSE_UNSTABLE',
              'MG400 sequence tail did not reach its target',
              504,
            );
          // A fresh authoritative check permits a conservative release even if
          // the earlier handoff monitor failed. It does not restore fast mode.
          faultAt = this.lastFaultSampleAt;
          faultError = undefined;
          return {
            status: 'completed',
            completedAt: new Date().toISOString(),
            pose: measured.pose,
          };
        },
        stopped: () => this.sequenceOwner !== owner,
        release,
      });
      timer = setTimeout(() => void pollFaults(), 100);
      return sequence;
    } catch (error) {
      release();
      throw error;
    }
  }
  /** State flags may use 30004; Cartesian poses always use explicit Base/Tool0. */
  feedbackStatus(): RobotArmFeedbackStatus {
    const sample = this.stateSample;
    return {
      ...this.feedback.status(),
      poseSource: 'polling',
      poseReason:
        'Querying explicit Base/Tool0 flange pose; realtime TCP coordinates are not trusted',
      // How stale a state read may be is part of the same diagnostic picture as
      // how stale a push frame may be, so it is reported here rather than
      // hidden inside the cache. Absent when caching is disabled: callers then
      // never receive the sample.
      ...(sample && this.config.statePollIntervalMs > 0
        ? { stateSampleAgeMs: Date.now() - sample.at }
        : {}),
    };
  }
  /** Diagnostics for the optional pre-dispatch reachability query. */
  reachabilityStatus(): Mg400ReachabilityStatus {
    return { ...this.reachability };
  }
  /**
   * Best-effort diagnostic wait for a usable 30004 frame. `connect()` never
   * calls this, so a controller without a usable stream is not a failure.
   */
  waitForRealtimeFrame(timeoutMs = 2000): Promise<void> {
    return this.feedback.waitForFrame(timeoutMs).then(() => undefined);
  }
  private pollSample(): SampleQuality {
    return {
      sampleId: `poll-${++this.sampleSequence}`,
      receivedAt: new Date().toISOString(),
      source: 'polling',
      stale: false,
    };
  }
  private async readPoseSample(_fresh: boolean) {
    const pose = await this.readMeasuredPose();
    return { ...this.pollSample(), pose };
  }
  async getPose(): Promise<CartesianPose> {
    // Same rule as the state reads: a jog owns the kinematics path, and a query
    // during the release would both be slow and look like a lost connection.
    if ((this.jogActive || this.jogReleasing) && this.stateSample?.state.pose)
      return structuredClone(this.stateSample.state.pose);
    return (await this.readPoseSample(false)).pose;
  }
  private async readStatus(fresh: boolean): Promise<RobotStatus> {
    const s = fresh ? await this.getStateFresh() : await this.getState();
    const quality = { ...this.pollSample(), receivedAt: s.updatedAt };
    return {
      connection: s.connected ? 'connected' : 'disconnected',
      authority: 'unknown',
      power: 'unknown',
      enablement: s.enabled ? 'enabled' : 'disabled',
      motion:
        this.softwarePaused || s.paused
          ? 'paused'
          : s.moving
            ? 'moving'
            : 'idle',
      operationMode: s.dragMode ? 'backdrive' : 'automatic',
      emergencyStop: 'unknown',
      protectiveStop: 'unknown',
      faults: s.faults,
      quality,
      pose: s.pose ? { ...quality, pose: s.pose } : undefined,
      vendorMode: s.mode,
    };
  }
  private readMeasuredJoints(): Promise<number[]> {
    return this.dashboard.sendWith((response, command) => {
      const body = parseMg400Response(response, command);
      try {
        const joints = parseMg400GetAngle(body);
        if (body.split(',').length === 6 && !this.getAnglePaddingLogged) {
          this.getAnglePaddingLogged = true;
          logMg400(
            'GetAngle six-field zero padding accepted; using four joints.',
            {
              connectionIdentity: this.connectionIdentity,
              command,
              response,
            },
          );
        }
        return joints;
      } catch (error) {
        if (isRobotArmError(error))
          throw new RobotArmError(error.code, error.message, error.status, {
            ...error.details,
            command,
            response,
          });
        throw error;
      }
    }, 'GetAngle()');
  }
  /** Dashboard pose query, used whenever no fresh 30004 frame is available. */
  private async readMeasuredPose(): Promise<CartesianPose> {
    // Four-axis firmware answers `GetPose()` with the flat four-value tuple and
    // rejects the named User/Tool form with -30001; the six-axis-compatible
    // envelope is the other way round. Probe once, then stay on what worked.
    while (this.poseDialect === 'plain' || this.poseDialect === 'named') {
      const named = this.poseDialect === 'named';
      try {
        return parseMg400Pose(
          await this.dashboard.send(
            named ? 'GetPose(User=0,Tool=0)' : 'GetPose()',
          ),
        );
      } catch (e) {
        if (!(e instanceof RobotArmError) || e.details?.vendorCode !== -30001)
          throw e;
        this.poseDialect = named ? 'kinematic' : 'named';
      }
    }
    // Older firmware: query measured joints and controller forward kinematics in
    // Base/Tool0. The joints reply may be a flat tuple or the keyed {j1..j4} form.
    const joints = await this.readMeasuredJoints();
    return parseMg400Pose(
      await this.dashboard.send(`PositiveSolution(${joints.join(',')},0,0)`),
    );
  }
  /**
   * Bounded state read. Returns the cached dashboard sample while it is still
   * valid, otherwise re-queries. Callers that gate a physical action or assert a
   * transition must use `getStateFresh()` instead.
   */
  async getState(): Promise<RobotState> {
    // A jog — including the moment its connection is being replaced — must not
    // surface as a lost robot: the console would drop to its disconnected screen
    // and lose the jog panel the operator is holding.
    if (this.jogActive || this.jogReleasing) return this.readStateDuringJog();
    this.requireConnected();
    const interval = this.config.statePollIntervalMs;
    // Marking demand here (and in getStateFresh) is what lets the poller run
    // only while something is actually reading state.
    this.lastStateDemandAt = Date.now();
    const sample = this.stateSample;
    if (interval > 0 && sample && this.isSampleReusable(sample)) {
      // A reader is back, so make sure the refresh chain is alive even if it
      // stopped itself while the bench was idle.
      this.ensureStatePoller();
      // Cloned so a caller cannot mutate the sample every other reader sees.
      return structuredClone(sample.state);
    }
    return interval > 0 ? this.refreshState() : this.readFreshState();
  }
  /**
   * A sample is only reusable while it is both young enough and still describes
   * the same push-frame situation it was built from. Two cases invalidate it:
   *
   * - a 30004 frame arrived afterwards, which is fresher than the sample and is
   *   what `getPose()` reads directly, so reusing the sample would make
   *   `getState()` disagree with `getPose()`;
   * - the stream that produced it has since gone stale, so the sample rests on
   *   data the source no longer vouches for.
   *
   * With no push channel at all both sides are `undefined` and only the interval
   * applies, which is the case the cache exists for.
   */
  private isSampleReusable(sample: { at: number; frameAt?: number }): boolean {
    if (Date.now() - sample.at > this.config.statePollIntervalMs) return false;
    return sample.frameAt === this.feedback.current()?.receivedAt;
  }
  /**
   * State read that always consults the controller, never a sample that predates
   * the caller's command. Used by the transition predicates and the motion gate,
   * because those decisions must not be satisfiable from a cached "no faults".
   */
  private async getStateFresh(): Promise<RobotState> {
    this.requireConnected();
    this.lastStateDemandAt = Date.now();
    return this.readFreshState(true);
  }
  private requireConnected(): void {
    if (!this.dashboard.connected || !this.motion.connected)
      throw new RobotArmError(
        'DISCONNECTED',
        'MG400 TCP channels are disconnected',
        503,
      );
  }
  /** Query the controller and publish the result as the new sample. */
  /**
   * State while a jog runs. Pose kinematics can be slow enough during a jog to
   * time out the shared channel, so the sample is served from cache; a cheap
   * `RobotMode()` keeps the dashboard channel warm without querying kinematics.
   */
  private async readStateDuringJog(): Promise<RobotState> {
    await this.dashboard.send('RobotMode()').catch(() => undefined);
    if (this.stateSample) return structuredClone(this.stateSample.state);
    throw new RobotArmError(
      'STATE_UNAVAILABLE',
      'No controller sample while jogging',
      503,
    );
  }
  private async readFreshState(forcePolling = false): Promise<RobotState> {
    const generation = this.generation;
    if (this.jogActive || this.jogReleasing) return this.readStateDuringJog();
    const state = await this.queryState(forcePolling);
    if (generation !== this.generation)
      throw new RobotArmError(
        'QUERY_INTERRUPTED',
        'State query belongs to an older control generation',
        409,
      );
    // Captured after the query: a frame that arrived mid-query is newer than
    // what the query saw, so recording it makes the sample expire sooner rather
    // than appear fresher than it is.
    this.stateSample = {
      state,
      at: Date.now(),
      frameAt: this.feedback.current()?.receivedAt,
    };
    this.ensureStatePoller();
    return structuredClone(state);
  }
  /**
   * Share one in-flight refresh between concurrent readers. The poller and a
   * caller asking at the same moment must not stack three identical queries.
   */
  private refreshState(): Promise<RobotState> {
    if (!this.stateRefresh) {
      const work = this.readFreshState();
      this.stateRefresh = work;
      const settle = () => {
        if (this.stateRefresh === work) this.stateRefresh = undefined;
      };
      void work.then(settle, settle);
    }
    return this.stateRefresh;
  }
  private invalidateStateSample(): void {
    this.stateSample = undefined;
  }
  /** Arm the next background refresh; no-op when disabled or disconnected. */
  private ensureStatePoller(): void {
    const interval = this.config.statePollIntervalMs;
    if (interval <= 0 || this.statePollTimer) return;
    if (!this.dashboard.connected || !this.motion.connected) return;
    this.statePollTimer = setTimeout(() => {
      this.statePollTimer = undefined;
      void this.pollStateOnce();
    }, interval);
    // Never hold the process open for a diagnostic refresh.
    this.statePollTimer.unref?.();
  }
  private stopStatePoller(): void {
    if (!this.statePollTimer) return;
    clearTimeout(this.statePollTimer);
    this.statePollTimer = undefined;
  }
  private async pollStateOnce(): Promise<void> {
    const interval = this.config.statePollIntervalMs;
    // Demand-gated: stop refreshing once nothing has asked for state for a few
    // intervals, so an idle bench costs no dashboard traffic at all. The next
    // `getState()` re-arms the chain. A failed refresh is diagnostics only; the
    // next read surfaces the error to whoever actually needs state.
    if (
      Date.now() - this.lastStateDemandAt >
      interval * STATE_POLL_IDLE_INTERVALS
    )
      return;
    try {
      await this.refreshState();
    } catch {
      // Ignored on purpose.
    }
    this.ensureStatePoller();
  }
  private async queryState(forcePolling = false): Promise<RobotState> {
    const payloadGeneration = this.payloadEvidence().generation;
    // A fresh 30004 frame supplies mode and motion flags, never Base poses.
    // Faults always come from GetErrorID(): the four-axis realtime safety bits
    // and ErrorStatus are not a trustworthy fault source.
    const candidate = forcePolling ? undefined : this.feedback.current();
    const feedback =
      candidate && candidate.receivedAt >= this.lastCommandAt
        ? candidate
        : undefined;
    let mode: number;
    if (feedback) mode = feedback.mode;
    else {
      const body = await this.dashboard.send('RobotMode()');
      mode = Number(body);
      if (!isMg400Mode(mode))
        throw new RobotArmError('PROTOCOL_ERROR', 'Unknown MG400 mode', 502, {
          body,
        });
    }
    // Dedicated parser: this one query tolerates the `ErrorID,` prefix that some
    // firmware uses. Every other command keeps the strict generic parser.
    const fault = await this.dashboard.sendWith(
      parseMg400ErrorIdResponse,
      'GetErrorID()',
      this.config.commandTimeoutMs,
    );
    this.lastFaultSampleAt = Date.now();
    // Mode 9 with no error codes is genuinely broken. Mode 10 is only paused: it
    // is enabled and carries no fault, and reporting it as one used to make
    // `Clear faults` impossible to satisfy, because ClearError() cannot leave
    // the paused state on its own.
    const enabled = feedback ? feedback.enabled : isMg400ModeEnabled(mode);
    if (!enabled) this.payloadApplication.observeDisabled(payloadGeneration);
    return {
      connected: true,
      enabled,
      moving: feedback ? feedback.running : isMg400ModeMoving(mode),
      dragMode: feedback ? feedback.dragStatus !== 0 : mode === MG400_DRAG_MODE,
      mode: String(mode),
      paused: isMg400ModePaused(mode),
      pose: await this.readMeasuredPose(),
      faults: mg400Faults(fault.groups, mode),
      updatedAt: new Date().toISOString(),
    };
  }
  /** Poll `getState()` until `predicate` holds, or fail the confirmation. */
  private async confirm(
    label: string,
    predicate: (s: RobotState) => boolean,
    timeoutMs = LIFECYCLE_TIMEOUT_MS,
    pollMs = 50,
    check = () => {},
  ): Promise<void> {
    const end = Date.now() + timeoutMs;
    let lastState: RobotState | undefined;
    while (Date.now() < end) {
      check();
      // Fresh on purpose: a transition must never be confirmed from a sample
      // that predates the command that was just sent. This is what stops
      // `enable()` or `clearFaults()` from reading a cached "no faults".
      const s = await this.getStateFresh();
      lastState = s;
      check();
      if (predicate(s)) return;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new RobotArmError(
      'STATE_UNCONFIRMED',
      `MG400 did not confirm ${label}`,
      504,
      { command: label, lastState },
    );
  }
  private async transition(
    command: string,
    predicate: (s: RobotState) => boolean,
    timeoutMs = LIFECYCLE_TIMEOUT_MS,
    pollMs = 50,
    check = () => {},
  ): Promise<void> {
    // Drop the sample before the command lands so nothing can serve a
    // pre-command view of the controller afterwards.
    this.invalidateStateSample();
    this.lastCommandAt = Date.now();
    check();
    await this.dashboard.send(command);
    check();
    await this.confirm(command, predicate, timeoutMs, pollMs, check);
  }
  enable(payload?: ToolPayload): Promise<void> {
    return this.configurePayload(payload, false);
  }
  applyPayload(payload: ToolPayload): Promise<void> {
    return this.configurePayload(payload, true);
  }
  private async configurePayload(
    payload: ToolPayload | undefined,
    applyOnly: boolean,
  ): Promise<void> {
    payload = payload === undefined ? undefined : { ...payload };
    if (payload !== undefined) validateMg400Payload(payload);
    const generation = this.generation;
    const safetyGeneration = this.safetyGeneration;
    let payloadGeneration: number | undefined;
    const check = () => {
      if (generation !== this.generation)
        throw new RobotArmError(
          'ACTION_STOPPED',
          'Payload application interrupted by safety control',
          409,
        );
      if (payloadGeneration !== undefined)
        this.payloadApplication.check(payloadGeneration);
    };
    if (payload) {
      const state = await this.getStateFresh();
      check();
      // RunQueuedCmd can stay high in idle mode 5. Gate on actual state and
      // locally owned motion instead of treating that flag as queue occupancy.
      if (
        (applyOnly ? !state.enabled : state.enabled) ||
        state.moving ||
        state.dragMode ||
        state.paused ||
        state.faults.length ||
        (applyOnly && this.active)
      )
        throw new RobotArmError(
          applyOnly ? 'PAYLOAD_REQUIRES_IDLE' : 'PAYLOAD_REQUIRES_DISABLED',
          applyOnly
            ? 'Keep the enabled robot stationary, fault-free and out of drag or pause before syncing tool payload.'
            : 'Disable the stationary robot before applying a tool payload.',
          409,
        );
    }
    if (payload) payloadGeneration = this.payloadApplication.begin();
    else this.payloadApplication.invalidate('not-applied');
    this.invalidateStateSample();
    let submitted = false;
    try {
      check();
      submitted = true;
      // EnableRobot is immediate; SetPayLoad is queued and requires enablement.
      if (!applyOnly)
        await this.transition(
          payload
            ? `EnableRobot(${formatMg400Number(payload.massKg)})`
            : 'EnableRobot()',
          (s) => s.enabled && !s.faults.length && !s.paused,
          this.config.enableTimeoutMs,
          250,
          check,
        );
      check();
      if (payload && (applyOnly || payload.inertiaKgM2 !== undefined)) {
        this.invalidateStateSample();
        this.lastCommandAt = Date.now();
        await this.dashboard.send(buildMg400PayloadCommand(payload));
        check();
        await this.motion.send('Sync()', this.config.enableTimeoutMs);
        check();
        const state = await this.getStateFresh();
        check();
        if (
          !state.enabled ||
          state.moving ||
          state.paused ||
          state.faults.length
        )
          throw new RobotArmError(
            'PAYLOAD_UNCONFIRMED',
            'MG400 payload queue did not complete in a ready state.',
            409,
          );
      }
      if (payload) this.payloadApplication.confirm(payloadGeneration!, payload);
    } catch (error) {
      if (
        payloadGeneration !== undefined &&
        this.payloadApplication.read().generation === payloadGeneration
      )
        this.payloadApplication.invalidate('application-failed');
      // A Sync timeout quarantines its socket and advances the connection
      // generation. That alone does not prove the controller cleared its queue.
      // Reopen the independent Stop path, unless another safety action/session
      // shutdown already superseded this application.
      const timedOut =
        isRobotArmError(error) && error.code === 'COMMAND_TIMEOUT';
      if (
        payload &&
        submitted &&
        (generation === this.generation ||
          (timedOut &&
            safetyGeneration === this.safetyGeneration &&
            this.reconnectDesired))
      ) {
        try {
          await this.stop();
        } catch (stopError) {
          throw new RobotArmError(
            'PAYLOAD_APPLICATION_FAILED',
            'Enable/payload application failed and Stop could not be confirmed.',
            502,
            { cause: String(error), stopError: String(stopError) },
          );
        }
      }
      throw error;
    }
  }
  async disable() {
    this.payloadApplication.invalidate('disabled');
    await this.stop();
    await this.transition('DisableRobot()', (s) => !s.enabled && !s.moving);
  }
  async clearFaults(): Promise<void> {
    this.requireConnected();
    const generation = this.generation;
    const check = () => {
      if (generation !== this.generation)
        throw new RobotArmError(
          'ACTION_STOPPED',
          'MG400 clear-faults interrupted by a session or safety change',
          409,
        );
    };
    const end = Date.now() + this.config.clearFaultsTimeoutMs;
    this.invalidateStateSample();
    this.lastCommandAt = Date.now();
    let receipt: unknown;
    try {
      if (this.config.clearFaultsTransport === 'studio')
        receipt = await this.controller.clearAlarms(
          this.config.clearFaultsTimeoutMs,
        );
      else receipt = await this.dashboard.send('ClearError()');
      check();
      await this.confirm(
        'clear faults',
        (s) => !s.faults.length,
        Math.max(0, end - Date.now()),
        50,
        check,
      );
    } catch (error) {
      check();
      if (isRobotArmError(error))
        throw new RobotArmError(error.code, error.message, error.status, {
          ...error.details,
          transport: this.config.clearFaultsTransport,
          command:
            this.config.clearFaultsTransport === 'studio'
              ? 'ClearAlarms'
              : 'ClearError()',
          receipt,
        });
      throw error;
    }
  }
  enterDragMode() {
    return this.transition('StartDrag()', (s) => s.dragMode);
  }
  /**
   * Continuous manual jog (`MoveJog(axisID)`), per the TCP/IP protocol manual:
   * the arm keeps jogging until `MoveJog()` arrives.
   *
   * The command goes out on the dashboard channel, which carries the immediate
   * commands. Sending it on the queued-motion channel made the controller reset
   * that connection right after acknowledging, which looked like a lost robot.
   */
  async startJog(target: JogTarget) {
    this.requireConnected();
    const axis = jogAxis(target);
    // A state refresh already in flight can time out against the jogging
    // controller and take the dashboard channel down with it.
    await this.stateRefresh?.catch(() => undefined);
    // A timeout means the acknowledgement is unknown, not that the arm did
    // not start. Keep release enabled so the runtime watchdog can stop it.
    this.jogActive = true;
    await this.dashboard.send(`MoveJog(${axis})`, JOG_COMMAND_TIMEOUT_MS);
    logMg400(`jog started ${axis}`);
  }
  /**
   * Stop the jog. `MoveJog()` is documented to stop the arm, but its reply is
   * not evidence that it did, so the release is written without waiting and
   * confirmed from `RobotMode()`, which the controller keeps answering. An
   * unconfirmed stop is an error, never a silent success.
   */
  async stopJog() {
    // Nothing to release: do not spend a command on a jog this adapter never
    // started, and do not disturb a stop that is already in flight.
    if (!this.jogActive) return;
    this.jogReleasing = true;
    try {
      // The release reply arrives late; it is dropped with the connection so it
      // cannot be matched against the confirmation query.
      await this.dashboard.writeAndClose('MoveJog()');
      // The controller also resets this connection when the jog ends, so the
      // confirmation needs a fresh one rather than the socket that just went.
      await this.reopenDashboard();
      if (await this.jogStopped()) {
        this.jogActive = false;
        logMg400('jog stopped and confirmed');
        return;
      }
      await this.dashboard.writeAndClose('MoveJog()');
      await this.reopenDashboard();
      if (await this.jogStopped()) {
        this.jogActive = false;
        logMg400('jog stopped on the second release');
        return;
      }
      throw new RobotArmError(
        'JOG_UNCONFIRMED',
        'Controller is still jogging after MoveJog()',
        409,
      );
    } finally {
      this.jogReleasing = false;
    }
  }
  private async reopenDashboard(): Promise<void> {
    this.dashboard.close(undefined, true);
    await this.dashboard.connect();
  }
  private async jogStopped(timeoutMs = JOG_STOP_CONFIRM_MS): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      // `send()` hands back the reply body, not the whole line.
      const body = String(await this.dashboard.send('RobotMode()'));
      const mode = Number(body.match(/-?\d+/)?.[0]);
      // Cartesian jogs report a plain moving mode rather than JOG, so "not
      // jogging" is not the same as "stopped": ask whether anything moves.
      if (isMg400Mode(mode) && !isMg400ModeMoving(mode)) return true;
      logMg400(`jog still moving after release (mode=${mode})`);
      if (Date.now() >= end) return false;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  async exitDragMode() {
    // An operator may already have exited with the physical drag button. Some
    // firmware rejects StopDrag in normal mode, so use measured controller
    // state rather than the calibration's saved flag.
    const exited = (state: RobotState) =>
      state.connected &&
      !state.dragMode &&
      !state.moving &&
      !state.paused &&
      !state.faults.length &&
      ['4', '5'].includes(state.mode);
    const state = await this.getStateFresh();
    if (!state.dragMode) {
      if (exited(state)) return;
      throw new RobotArmError(
        'DRAG_UNCONFIRMED',
        'Cannot confirm an idle controller outside Drag Mode',
        409,
        { mode: state.mode },
      );
    }
    try {
      await this.transition('StopDrag()', exited);
    } catch (error) {
      // A physical exit can also race the query above. Only an explicit vendor
      // rejection can be reconciled; timeouts and transport errors still fail.
      if (
        isRobotArmError(error) &&
        error.details?.vendorCode === -1 &&
        exited(await this.getStateFresh())
      )
        return;
      throw error;
    }
  }
  async pause() {
    this.softwarePaused = true;
    await this.stop();
  }
  async resume() {
    await this.stop();
    if ((await this.getStateFresh()).paused)
      await this.transition('Continue()', (s) => s.paused === false);
    this.softwarePaused = false;
  }
  private async safetyCommand(
    command: string,
    priority: number,
  ): Promise<boolean> {
    if (priority < this.safetyPriority) return false;
    this.safetyPriority = priority;
    this.lastCommandAt = Date.now();
    this.stopStatePoller();
    this.dashboard.close(
      new RobotArmError(
        'QUERY_INTERRUPTED',
        'Query interrupted by safety control',
        409,
      ),
      true,
    );
    await this.dashboard.connect();
    if (priority < this.safetyPriority) return false;
    await this.dashboard.send(command);
    return true;
  }
  async emergencyStop(): Promise<void> {
    this.safetyGeneration++;
    this.payloadApplication.invalidate('emergency-stop');
    this.generation++;
    this.controller.interrupt();
    this.motionSettings.interrupt();
    this.invalidateStateSample();
    this.safetyControls++;
    this.stopOutcome = (async () => {
      await this.safetyCommand('EmergencyStop()', 3);
      // Release a pending Sync() exactly as stop() does, so the motion channel
      // is not stuck until its motion timeout and `active` clears. Best effort:
      // a channel problem must not turn a dispatched emergency stop into a
      // failure.
      try {
        this.motion.close(undefined, true);
        await this.motion.connect();
      } catch {
        // Ignored: the confirmation below is the real assertion.
      }
      const end = Date.now() + EMERGENCY_STOP_CONFIRM_MS;
      let lastError: unknown;
      // Confirm with actual state queried after dispatch; never reuse a pre-command frame.
      while (Date.now() < end) {
        try {
          if (!(await this.getStateFresh()).moving) {
            this.safetyPriority = 0;
            this.releaseSequence?.();
            return;
          }
        } catch (error) {
          lastError = error;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      // Dispatch failure or unconfirmable stop fails. An
      // operator must not be told the arm stopped when it cannot be confirmed.
      throw new RobotArmError(
        'EMERGENCY_STOP_UNCONFIRMED',
        'MG400 still reports motion after EmergencyStop()',
        504,
        lastError ? { cause: String(lastError) } : undefined,
      );
    })().finally(() => {
      this.safetyControls--;
    });
    this.stopOutcome.catch(() => undefined);
    return this.stopOutcome;
  }
  async stop(): Promise<void> {
    const safetyGeneration = ++this.safetyGeneration;
    if (this.payloadApplication.read().status === 'applying')
      this.payloadApplication.invalidate('application-interrupted');
    const generation = ++this.generation;
    this.controller.interrupt();
    this.motionSettings.interrupt();
    const current = () => {
      if (generation === this.generation) return true;
      if (safetyGeneration !== this.safetyGeneration) return false;
      throw new RobotArmError(
        'STOP_UNCONFIRMED',
        'Controller continuity was lost while confirming Stop',
        503,
      );
    };
    this.invalidateStateSample();
    this.safetyControls++;
    this.stopOutcome = (async () => {
      if (!(await this.safetyCommand('ResetRobot()', 2)) || !current()) return;
      this.motion.close(undefined, true);
      await this.motion.connect();
      const end = Date.now() + 5000;
      let previous: CartesianPose | undefined;
      let count = 0;
      let previousId: string | undefined;
      while (Date.now() < end) {
        if (!current()) return;
        // Fresh state and distinct measured samples must confirm stationary motion.
        const s = await this.getStateFresh();
        const sample = await this.readPoseSample(true);
        if (!current()) return;
        if (sample.sampleId === previousId) {
          await new Promise((r) => setTimeout(r, 50));
          continue;
        }
        const p = sample.pose;
        previousId = sample.sampleId;
        if (
          !s.moving &&
          previous &&
          distance(p.positionMm, previous.positionMm) < 0.1 &&
          quaternionDistance(p.orientation, previous.orientation) < 0.005
        )
          count++;
        else count = 0;
        if (count >= 2) {
          this.safetyPriority = 0;
          this.releaseSequence?.();
          return;
        }
        previous = p;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new RobotArmError(
        'STOP_UNCONFIRMED',
        'MG400 ResetRobot did not confirm stopped pose',
        504,
      );
    })().finally(() => {
      this.safetyControls--;
    });
    this.stopOutcome = this.stopOutcome.catch((error) => {
      if (generation === this.generation)
        this.payloadApplication.invalidate('stop-unconfirmed');
      throw error;
    });
    this.stopOutcome.catch(() => undefined);
    return this.stopOutcome;
  }
  async moveJoints(values: number[], options: MotionOptions) {
    const generation = this.generation;
    if (
      values.length !== 4 ||
      values.some(
        (v, i) =>
          !Number.isFinite(v) ||
          v < this.kinematics.joints[i].limits!.min ||
          v > this.kinematics.joints[i].limits!.max,
      )
    )
      throw new RobotArmError(
        'JOINT_LIMIT',
        'MG400 joint target outside limits',
      );
    const pose = (await this.readPoseSample(true)).pose;
    if (generation !== this.generation)
      throw new RobotArmError(
        'ACTION_STOPPED',
        'Joint motion interrupted before submission',
        409,
      );
    const checked = buildMg400MotionCommand('MovJ', pose, options);
    const params = checked.slice(checked.indexOf('SpeedJ='), -1);
    return this.move(
      'MovJ',
      pose,
      options,
      `JointMovJ(${values.join(',')},${params})`,
      values,
    );
  }
  moveLinear(p: CartesianPose, o?: MotionOptions) {
    return this.move('MovL', p, o);
  }
  movePtp(p: CartesianPose, o?: MotionOptions) {
    return this.move('MovJ', p, o);
  }
  /** Explicit unsupported firmware may skip IK; all communication failures block motion. */
  private async checkReachability(pose: CartesianPose): Promise<void> {
    if (!this.config.verifyReachability) return;
    if (this.kinematicSupport.inverse === 'unsupported') {
      this.reachability.unchecked++;
      this.reachability.lastSkipReason =
        'InverseSolution unsupported by negotiated firmware capability';
      return;
    }
    if (this.kinematicSupport.inverse !== 'supported')
      throw new RobotArmError(
        'CAPABILITY_UNRESOLVED',
        'IK support has not been established; no motion submitted',
        409,
      );
    const command = buildMg400ReachabilityCommand(pose);
    try {
      parseMg400Joints(await this.dashboard.send(command));
      this.reachability.verified++;
      this.reachability.lastSkipReason = undefined;
    } catch (error) {
      const vendorCode =
        error instanceof RobotArmError ? error.details?.vendorCode : undefined;
      if (vendorCode === -30001) {
        this.kinematicSupport.inverse = 'unsupported';
        this.reachability.unchecked++;
        this.reachability.lastSkipReason =
          'InverseSolution explicitly unsupported by firmware';
        return;
      }
      if (typeof vendorCode === 'number' && vendorCode < 0) {
        this.reachability.rejected++;
        throw new RobotArmError(
          'UNREACHABLE_TARGET',
          'Controller rejected target; no motion sent',
          422,
          { command, vendorCode },
        );
      }
      throw error;
    }
  }
  private async move(
    name: 'MovL' | 'MovJ',
    pose: CartesianPose,
    options?: MotionOptions,
    jointCommand?: string,
    jointTarget?: number[],
  ): Promise<MotionHandle> {
    validateMotionOptions(
      options ?? {
        speed: { kind: 'ratio', value: 0.1 },
        acceleration: { kind: 'ratio', value: 0.1 },
      },
      this.motionLimits[
        jointCommand ? 'joints' : name === 'MovL' ? 'linear' : 'ptp'
      ]!,
      4,
    );
    const command =
      jointCommand ?? buildMg400MotionCommand(name, pose, options);
    // Screen contact asks for a single fresh arrival sample: Sync already proves
    // the motion finished, and every further sample is spent with the tool
    // already pressing the glass.
    const arrivalSamples = options?.arrivalSamples ?? 2;
    if (this.active)
      throw new RobotArmError('BUSY', 'MG400 has an outstanding motion', 409);
    this.active = true;
    const generation = this.generation;
    let dispatchAttempted = false;
    try {
      // Fresh on purpose: dispatching a motion is a physical go/no-go decision,
      // so it must not be taken from a bounded sample that may predate a fault.
      const s = await this.getStateFresh();
      if (
        !s.enabled ||
        s.moving ||
        s.dragMode ||
        s.paused ||
        this.softwarePaused ||
        s.faults.length
      )
        throw new RobotArmError(
          'NOT_READY',
          'MG400 must be enabled, idle and fault-free',
          409,
        );
      if (generation !== this.generation)
        throw new RobotArmError(
          'ACTION_STOPPED',
          'Motion was stopped before dispatch',
          409,
        );
      // Ask the controller whether the target exists before committing to it, so
      // an unreachable point is a clean refusal rather than a controller fault
      // that strands the session in recovery.
      if (!jointCommand) await this.checkReachability(pose);
      // The query above is a network round trip; a stop may have landed during
      // it, in which case the motion must not go out.
      if (generation !== this.generation)
        throw new RobotArmError(
          'ACTION_STOPPED',
          'Motion was stopped before dispatch',
          409,
        );
      this.invalidateStateSample();
      this.lastCommandAt = Date.now();
      const submittedAt = this.lastCommandAt;
      dispatchAttempted = true;
      await this.motion.send(command);
      const terminal = (async (): Promise<MotionResult> => {
        try {
          await this.motion.send('Sync()', this.config.motionTimeoutMs);
          if (generation !== this.generation) {
            await this.stopOutcome;
            return { status: 'stopped', completedAt: new Date().toISOString() };
          }
          // The dashboard mode can lag behind the motion-channel Sync reply.
          // Wait only for that transition; never retry the physical command.
          const stateDeadline =
            Date.now() + Math.min(this.config.motionTimeoutMs, 1000);
          while (true) {
            const state = await this.getStateFresh();
            if (generation !== this.generation) {
              await this.stopOutcome;
              return {
                status: 'stopped',
                completedAt: new Date().toISOString(),
              };
            }
            const unsafe =
              state.faults.length > 0 ||
              !state.enabled ||
              state.dragMode ||
              state.paused ||
              this.softwarePaused;
            if (unsafe || (state.moving && Date.now() >= stateDeadline))
              throw new RobotArmError(
                'MOTION_INTERRUPTED',
                `MG400 state after Sync is not ready (mode=${state.mode}, moving=${state.moving}, enabled=${state.enabled}, faults=${state.faults.length})`,
                409,
                { command, state },
              );
            if (!state.moving) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          const deadline =
            Date.now() + Math.min(this.config.motionTimeoutMs, 5000);
          let count = 0;
          let previous: CartesianPose | number[] | undefined;
          let previousId: string | undefined;
          // First fresh sample inside the arrival tolerance. It is earlier
          // evidence than the two-sample terminal confirmation, so screen
          // timing can anchor a press window to it.
          let arrivedAt: number | undefined;
          while (Date.now() < deadline) {
            if (generation !== this.generation) {
              await this.stopOutcome;
              return {
                status: 'stopped',
                completedAt: new Date().toISOString(),
              };
            }
            const sample = jointTarget
              ? {
                  ...this.pollSample(),
                  values: await this.readMeasuredJoints(),
                }
              : await this.readPoseSample(true);
            const current = 'values' in sample ? sample.values : sample.pose;
            const close = Array.isArray(current)
              ? current.every((v, i) => Math.abs(v - jointTarget![i]) <= 0.5)
              : distance(current.positionMm, pose.positionMm) <= 0.5 &&
                quaternionDistance(current.orientation, pose.orientation) <=
                  0.01;
            const stationary =
              previous &&
              (Array.isArray(current) && Array.isArray(previous)
                ? current.every(
                    (v, i) => Math.abs(v - (previous as number[])[i]) < 0.1,
                  )
                : !Array.isArray(current) &&
                  !Array.isArray(previous) &&
                  distance(current.positionMm, previous.positionMm) < 0.1 &&
                  quaternionDistance(
                    current.orientation,
                    previous.orientation,
                  ) < 0.005);
            if (sample.sampleId !== previousId) {
              if (close && arrivedAt === undefined) arrivedAt = Date.now();
              count =
                close && (arrivalSamples === 1 || stationary) ? count + 1 : 0;
              previous = current;
              previousId = sample.sampleId;
            }
            if (count >= arrivalSamples)
              return {
                status: 'completed',
                completedAt: new Date().toISOString(),
                arrivedAt,
                submittedAt,
                ...(Array.isArray(current) ? {} : { pose: current }),
              };
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw new RobotArmError(
            'POSE_UNSTABLE',
            'MG400 target did not stabilize after Sync',
            504,
          );
        } catch (e) {
          if (generation !== this.generation) {
            await this.stopOutcome;
            return { status: 'stopped', completedAt: new Date().toISOString() };
          }
          throw e;
        } finally {
          this.active = false;
        }
      })();
      return createMotionHandle(randomUUID(), terminal);
    } catch (e) {
      this.active = false;
      if (!dispatchAttempted && isRobotArmError(e))
        throw new RobotArmError(e.code, e.message, e.status, {
          ...e.details,
          beforeMotionSubmission: true,
        });
      throw e;
    }
  }
}
export const DOBOT_MG400_DEFAULTS = Object.freeze(DEFAULTS);
