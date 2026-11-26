import { Buffer } from 'node:buffer';
import {
  type Server as HttpServer,
  createServer as createHttpServer,
} from 'node:http';
import { type Server, type Socket, createServer } from 'node:net';
import type { RobotArmFeedbackStatus } from '@midscene/arm-kit/internal/contracts';
import {
  RobotArmError,
  evaluatePayloadApplication,
} from '@midscene/arm-kit/internal/contracts';
import { RobotDriverBoundary } from '@midscene/arm-kit/internal/kernel/driver-boundary';
import { pose } from '@midscene/arm-kit/internal/testkit/fixtures';
import { describe, expect, it, rstest } from '@rstest/core';
import {
  MG400_REALTIME_FRAME_LENGTH,
  Mg400RealtimeFramer,
  decodeMg400RealtimeFrame,
} from '../src/mg400-realtime.js';
import { Mg400Adapter, mg400PoseFromToolVector } from '../src/mg400.js';

/** Local protocol fixtures only; no connection to a physical robot. */
const TEST_VALUE = 0x0123456789abcdefn;
/** The dashboard deliberately disagrees with the frames the tests push. */
const DASHBOARD_POSE = '111,222,333,0';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(
  condition: () => boolean,
  timeoutMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await sleep(5);
  }
  throw new Error('Timed out waiting for the test condition');
}

interface FrameOptions {
  mode?: number;
  robotType?: number;
  messageSize?: number;
  testValue?: bigint;
  /** Flange x/y/z in millimetres plus Rz in degrees. */
  pose?: readonly [number, number, number, number];
  enabled?: boolean;
  running?: boolean;
  runQueuedCmd?: boolean;
  pauseCmdFlag?: boolean;
  dragStatus?: number;
  errorActive?: boolean;
  userId?: number;
  toolId?: number;
  timestamp?: bigint;
  loadKg?: number;
}

/** Build one documented 1440-byte little-endian 30004 frame. */
function feedbackFrame(options: FrameOptions = {}): Buffer {
  const frame = Buffer.alloc(MG400_REALTIME_FRAME_LENGTH);
  const [x, y, z, r] = options.pose ?? [0, 0, 0, 0];
  frame.writeUInt16LE(options.messageSize ?? MG400_REALTIME_FRAME_LENGTH, 0);
  frame.writeBigUInt64LE(BigInt(options.mode ?? 5), 24);
  frame.writeBigUInt64LE(options.timestamp ?? 1_700_000_000_000n, 32);
  frame.writeBigUInt64LE(options.testValue ?? TEST_VALUE, 48);
  frame.writeDoubleLE(100, 64);
  for (let index = 0; index < 6; index++)
    frame.writeDoubleLE(index, 432 + index * 8);
  frame.writeDoubleLE(x, 624);
  frame.writeDoubleLE(y, 632);
  frame.writeDoubleLE(z, 640);
  frame.writeDoubleLE(r, 648);
  frame.writeUInt8(options.userId ?? 0, 1012);
  frame.writeUInt8(options.toolId ?? 0, 1013);
  frame.writeUInt8(options.runQueuedCmd ? 1 : 0, 1014);
  frame.writeUInt8(options.pauseCmdFlag ? 1 : 0, 1015);
  frame.writeUInt8(options.enabled === false ? 0 : 1, 1026);
  frame.writeUInt8(options.dragStatus ?? 0, 1027);
  frame.writeUInt8(options.running ? 1 : 0, 1028);
  frame.writeUInt8(options.errorActive ? 1 : 0, 1029);
  frame.writeUInt8(options.robotType ?? 1, 1031);
  frame.writeDoubleLE(options.loadKg ?? 0.1, 1168);
  return frame;
}

/** Minimal valid `/protocol/exchange` snapshot for the HTTP alarm channel. */
function exchangeState(alarms: (number[] | null)[]) {
  return {
    controlMode: 'enable',
    coordinate: 'cartesian',
    jogMode: 'step',
    toolCoordinate: 0,
    userCoordinate: 0,
    alarms,
    outputs: [0, 0, 0, 0, 0, 0, 0, 0],
    jointCoordinate: [0, 0, 0, 0],
    cartesianCoordinate: [111, 222, 333, 0],
  };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('Port unavailable');
      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

/** `;`-delimited MG400 command channel, as used by the dashboard and motion ports. */
function textServer(
  sockets: Set<Socket>,
  commands: string[],
  reply: (command: string) => string,
  delayMs: number | ((command: string) => number) = 0,
  onCommand?: (command: string) => void,
): Server {
  return createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let end = buffer.indexOf(')');
      while (end >= 0) {
        const command = buffer.slice(0, end + 1);
        buffer = buffer.slice(end + 1);
        commands.push(command);
        onCommand?.(command);
        const write = () => {
          if (!socket.destroyed)
            socket.write(`0,{${reply(command)}},${command};`);
        };
        const delay =
          typeof delayMs === 'function' ? delayMs(command) : delayMs;
        if (delay > 0) setTimeout(write, delay);
        else write();
        end = buffer.indexOf(')');
      }
    });
  });
}

interface Bench {
  adapter: Mg400Adapter;
  commands: string[];
  httpRequests: { method: string; path: string }[];
  httpCompleted(): number;
  push(frame: Buffer): void;
  connectedFeedbackClients(): number;
  cleanup(): Promise<void>;
}

interface BenchOptions {
  onCommand?: (command: string) => void;
  /** Called when the motion channel receives a command, before its reply. */
  onMotionCommand?: (command: string) => void;
  /** Delay motion-channel replies, per command, so a pending command covers a gap. */
  motionReplyDelayMs?: number | ((command: string) => number);
  /** Command reply budget; long delayed-reply cases need more than the default. */
  commandTimeoutMs?: number;
  /** Sync/motion budget; long delayed-reply cases need more than the default. */
  motionTimeoutMs?: number;
  /** 'closed' binds and releases a port so that nothing listens on 30004. */
  feedbackPort?: 'listen' | 'closed';
  /** Alarm groups served by GET /protocol/exchange; a function runs per request. */
  httpAlarms?: (number[] | null)[] | (() => (number[] | null)[]);
  /** Bind and release the HTTP port so the alarm channel fails fast. */
  httpFail?: boolean;
  mode?: () => string;
  pose?: () => string;
  feedbackStaleAfterMs?: number;
  onFeedbackStatus?: (status: RobotArmFeedbackStatus) => void;
}

async function bench(options: BenchOptions = {}): Promise<Bench> {
  const commands: string[] = [];
  const httpRequests: { method: string; path: string }[] = [];
  let httpCompletedCount = 0;
  const sockets = new Set<Socket>();
  const feedbackClients = new Set<Socket>();
  const servers: Server[] = [];
  let http: HttpServer | undefined;
  const dashboard = textServer(sockets, commands, (command) => {
    options.onCommand?.(command);
    if (command.startsWith('RobotMode(')) return options.mode?.() ?? '4';
    if (command.startsWith('GetPose('))
      return options.pose?.() ?? DASHBOARD_POSE;
    if (command.startsWith('GetErrorID(')) return '[]';
    if (
      command.startsWith('GetAngle(') ||
      command.startsWith('InverseSolution(')
    )
      return '1,2,3,4';
    if (command.startsWith('PositiveSolution('))
      return options.pose?.() ?? DASHBOARD_POSE;
    return '';
  });
  const motion = textServer(
    sockets,
    commands,
    () => '',
    options.motionReplyDelayMs ?? 0,
    (command) => options.onMotionCommand?.(command),
  );
  servers.push(dashboard, motion);
  const dashboardPort = await listen(dashboard);
  const motionPort = await listen(motion);
  let feedbackPort: number;
  if (options.feedbackPort === 'closed') {
    const probe = createServer();
    feedbackPort = await listen(probe);
    await closeServer(probe);
  } else {
    const feedback = createServer((socket) => {
      feedbackClients.add(socket);
      socket.on('close', () => feedbackClients.delete(socket));
      socket.on('error', () => undefined);
    });
    servers.push(feedback);
    feedbackPort = await listen(feedback);
  }
  let httpPort: number;
  if (options.httpFail) {
    const probe = createHttpServer();
    httpPort = await listen(probe);
    await closeServer(probe);
  } else {
    http = createHttpServer((req, res) => {
      httpRequests.push({ method: req.method ?? '', path: req.url ?? '' });
      if (req.method !== 'GET' || req.url !== '/protocol/exchange') {
        res.statusCode = 404;
        res.end();
        return;
      }
      const alarms =
        typeof options.httpAlarms === 'function'
          ? options.httpAlarms()
          : (options.httpAlarms ?? []);
      res.setHeader('content-type', 'application/json');
      // Keep-alive would make the fake server wait for an idle socket on
      // close; alarm reads are short and one-shot.
      res.setHeader('connection', 'close');
      res.on('finish', () => {
        httpCompletedCount += 1;
      });
      res.end(JSON.stringify(exchangeState(alarms)));
    });
    httpPort = await listen(http);
  }
  const adapter = new Mg400Adapter({
    host: '127.0.0.1',
    dashboardPort,
    motionPort,
    feedbackPort,
    httpPort,
    commandTimeoutMs: options.commandTimeoutMs ?? 200,
    motionTimeoutMs: options.motionTimeoutMs ?? 1000,
    onFeedbackStatus: options.onFeedbackStatus,
    ...(options.feedbackStaleAfterMs === undefined
      ? {}
      : { feedbackStaleAfterMs: options.feedbackStaleAfterMs }),
  });
  return {
    adapter,
    commands,
    httpRequests,
    httpCompleted: () => httpCompletedCount,
    push(frame) {
      for (const socket of feedbackClients)
        if (!socket.destroyed) socket.write(frame);
    },
    connectedFeedbackClients: () => feedbackClients.size,
    async cleanup() {
      await adapter.disconnect();
      for (const socket of sockets) socket.destroy();
      for (const socket of feedbackClients) socket.destroy();
      if (http) {
        http.closeAllConnections();
        await closeServer(http);
      }
      await Promise.all(servers.map(closeServer));
    },
  };
}

describe('MG400 ordered motion sequence', () => {
  it('adopts matching load at idle with RunQueuedCmd set, without issuing enable', async () => {
    const b = await bench({ mode: () => '5', feedbackStaleAfterMs: 100 });
    try {
      await b.adapter.connect();
      await waitFor(() => b.connectedFeedbackClients() > 0);
      b.push(
        feedbackFrame({ loadKg: 0.20000000298023224, runQueuedCmd: true }),
      );
      const evidence = b.adapter.driver.readPayloadApplication!;
      await waitFor(() => evidence().status === 'confirmed');
      expect(evidence().applied).toMatchObject({
        payload: { massKg: 0.20000000298023224 },
        source: 'controller-readback',
      });
      expect(
        evaluatePayloadApplication({
          limits: { massKg: { min: 0, max: 0.75 } },
          payload: { massKg: 0.2 },
          snapshot: evidence(),
          connected: true,
          enabled: true,
        }).status,
      ).toBe('applied');
      expect(
        b.commands.some((command) =>
          /^(EnableRobot|DisableRobot|SetPayLoad)\(/.test(command),
        ),
      ).toBe(false);
      await waitFor(() => evidence().status === 'unconfirmed');
      expect(evidence().reason).toBe('readback-unavailable');
      b.push(feedbackFrame({ loadKg: 0.3, runQueuedCmd: true }));
      await waitFor(() => evidence().applied?.payload.massKg === 0.3);
    } finally {
      await b.cleanup();
    }
  });

  it('reconfirms an unchanged load after a transient state failure using a fresh idle frame', async () => {
    const b = await bench({ mode: () => '5', feedbackStaleAfterMs: 1000 });
    try {
      await b.adapter.connect();
      await waitFor(() => b.connectedFeedbackClients() > 0);
      const boundary = new RobotDriverBoundary(b.adapter);
      b.push(feedbackFrame({ loadKg: 0.2 }));
      await waitFor(
        () => boundary.payloadApplicationSnapshot()?.status === 'confirmed',
      );
      const previous = boundary.payloadApplicationSnapshot()!;
      const previousReadback = Date.parse(previous.applied!.confirmedAt);
      await waitFor(() => Date.now() > previousReadback);

      const getState = rstest.spyOn(b.adapter.driver, 'getState');
      getState.mockRejectedValueOnce(
        new RobotArmError('DISCONNECTED', 'State query interrupted', 503),
      );
      await expect(boundary.status()).rejects.toMatchObject({
        code: 'DISCONNECTED',
      });
      expect(boundary.payloadApplicationSnapshot()).toMatchObject({
        status: 'unconfirmed',
        reason: 'connection-lost',
      });

      b.push(feedbackFrame({ loadKg: 0.2, mode: 7, running: true }));
      await waitFor(
        () =>
          (b.adapter.latestMotionSample()?.receivedAt ?? 0) > previousReadback,
      );
      expect(boundary.payloadApplicationSnapshot()?.status).toBe('unconfirmed');

      b.push(feedbackFrame({ loadKg: 0.2, runQueuedCmd: true }));
      await waitFor(
        () => boundary.payloadApplicationSnapshot()?.status === 'confirmed',
      );
      const current = boundary.payloadApplicationSnapshot()!;
      expect(current.applied?.payload.massKg).toBe(0.2);
      expect(Date.parse(current.applied!.confirmedAt)).toBeGreaterThan(
        previousReadback,
      );
      expect(
        b.commands.some((command) =>
          /^(EnableRobot|DisableRobot|SetPayLoad)\(/.test(command),
        ),
      ).toBe(false);
    } finally {
      await b.cleanup();
    }
  });

  it('syncs payload at idle with RunQueuedCmd set without toggling enablement', async () => {
    const b = await bench({ mode: () => '5' });
    try {
      await b.adapter.connect();
      await waitFor(() => b.connectedFeedbackClients() > 0);
      b.push(
        feedbackFrame({
          pose: [123, 0, 100, 0],
          loadKg: 0.2,
          runQueuedCmd: true,
        }),
      );
      await b.adapter.waitForRealtimeFrame();
      await b.adapter.applyPayload({ massKg: 0.2, inertiaKgM2: 0.01 });
      expect(b.commands).toContain('SetPayLoad(0.2,0.01)');
      expect(b.commands).toContain('Sync()');
      expect(
        b.commands.some((command) =>
          /^(EnableRobot|DisableRobot)\(/.test(command),
        ),
      ).toBe(false);
      expect(b.adapter.driver.readPayloadApplication!().applied).toMatchObject({
        payload: { massKg: 0.2, inertiaKgM2: 0.01 },
        source: 'command-completion',
      });
    } finally {
      await b.cleanup();
    }
  });
  it.each([
    { mode: 7, running: true },
    { mode: 6, dragStatus: 1 },
    { mode: 10, pauseCmdFlag: true },
  ])(
    'rejects payload sync in active mode $mode even with RunQueuedCmd set',
    async (frame) => {
      const b = await bench({ mode: () => String(frame.mode) });
      try {
        await b.adapter.connect();
        await waitFor(() => b.connectedFeedbackClients() > 0);
        b.push(
          feedbackFrame({
            ...frame,
            pose: [123, 0, 100, 0],
            runQueuedCmd: true,
          }),
        );
        await b.adapter.waitForRealtimeFrame();
        await expect(
          b.adapter.applyPayload({ massKg: 0.2 }),
        ).rejects.toMatchObject({ code: 'PAYLOAD_REQUIRES_IDLE' });
        expect(
          b.commands.some((command) => command.startsWith('SetPayLoad(')),
        ).toBe(false);
      } finally {
        await b.cleanup();
      }
    },
  );
  it('invalidates completed payload evidence when the controller clock rolls back', async () => {
    let enabled = false;
    const b = await bench({
      mode: () => (enabled ? '5' : '4'),
      onCommand: (command) => {
        if (command.startsWith('EnableRobot(')) enabled = true;
      },
    });
    try {
      await b.adapter.connect();
      await waitFor(() => b.connectedFeedbackClients() > 0);
      await b.adapter.enable({ massKg: 0.1 });
      b.push(feedbackFrame({ timestamp: 200n, pose: [200, 0, 100, 0] }));
      await b.adapter.waitForRealtimeFrame();
      const evidence = b.adapter.driver.readPayloadApplication!;
      expect(evidence().status).toBe('confirmed');
      b.push(feedbackFrame({ timestamp: 1n, pose: [1, 0, 100, 0] }));
      await waitFor(() => evidence().reason === 'controller-restarted');
      expect(evidence()).toMatchObject({
        status: 'unconfirmed',
        reason: 'controller-restarted',
      });
    } finally {
      await b.cleanup();
    }
  });
  it('uses authoritative Base feedback for handoff when the raw TCP vector disagrees', async () => {
    const b = await bench({ mode: () => '5' });
    try {
      await b.adapter.connect();
      await waitFor(() => b.connectedFeedbackClients() > 0);
      b.push(
        feedbackFrame({ pose: [187.437838, -32.053043, 26.802143, -253.14] }),
      );
      await b.adapter.waitForRealtimeFrame();
      expect(b.adapter.latestToolVectorSample()).toBeUndefined();
      const commandCount = b.commands.length;
      const sequence = await b.adapter.driver.beginLinearSequence!(
        [
          {
            pose: pose(111, 222, 333),
            options: { speed: { kind: 'ratio', value: 0.1 } },
          },
        ],
        { timeoutMs: 1000 },
      );
      await sequence.submit(0);
      await sequence.waitForHandoff();
      await expect(sequence.finish()).resolves.toMatchObject({
        pose: pose(111, 222, 333),
      });
      expect(b.commands.slice(commandCount)).toContain('GetPose()');
      expect(b.commands.some((command) => command.startsWith('MovL('))).toBe(
        true,
      );
    } finally {
      await b.cleanup();
    }
  });
  it('keeps sequence handoff in Base when realtime feedback uses another User/Tool frame', async () => {
    const b = await bench({ mode: () => '5' });
    try {
      await b.adapter.connect();
      await waitFor(() => b.connectedFeedbackClients() > 0);
      b.push(feedbackFrame({ userId: 1 }));
      await b.adapter.waitForRealtimeFrame();
      const commandCount = b.commands.length;
      const sequence = await b.adapter.driver.beginLinearSequence!(
        [
          {
            pose: pose(111, 222, 333),
            options: { speed: { kind: 'ratio', value: 0.1 } },
          },
        ],
        { timeoutMs: 1000 },
      );
      await sequence.submit(0);
      await sequence.waitForHandoff();
      await expect(sequence.finish()).resolves.toMatchObject({
        pose: pose(111, 222, 333),
      });
      expect(b.commands.slice(commandCount)).toContain('GetPose()');
      expect(b.commands.some((command) => command.startsWith('MovL('))).toBe(
        true,
      );
    } finally {
      await b.cleanup();
    }
  });
});

describe('MG400 realtime fault monitoring during a sequence', () => {
  /** Hold the event loop so frames queued on the socket cannot be decoded. */
  function blockEventLoop(ms: number) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // Deliberately empty: this is the stall the freshness check must tolerate.
    }
  }

  async function connected(
    options: BenchOptions,
    hooks: { onMotion?: (command: string) => void },
  ) {
    const b = await bench({
      ...options,
      onMotionCommand: (command) => hooks.onMotion?.(command),
    });
    const connecting = b.adapter.connect();
    await waitFor(() => b.connectedFeedbackClients() === 1);
    b.push(feedbackFrame({ mode: 5 }));
    await connecting;
    return b;
  }

  async function sequenceFor(b: Bench) {
    // Start each case from a known-fresh frame so the measured gap is the one
    // the case introduces, not connection setup time.
    b.push(feedbackFrame({ mode: 5 }));
    await b.adapter.waitForRealtimeFrame(1000);
    return b.adapter.driver.beginLinearSequence!(
      [
        {
          pose: pose(111, 222, 333),
          options: { speed: { kind: 'ratio', value: 0.1 } },
        },
      ],
      { timeoutMs: 5000, realtimeFaultMonitoring: true },
    );
  }

  it('rides out a brief 30004 gap instead of aborting the sequence', async () => {
    // The reply is outstanding longer than the old 100/200 ms freshness gate,
    // with no new frame pushed during that time.
    const b = await connected(
      {
        mode: () => '5',
        feedbackStaleAfterMs: 250,
        motionReplyDelayMs: 350,
        commandTimeoutMs: 5000,
        motionTimeoutMs: 8000,
      },
      {},
    );
    try {
      const sequence = await sequenceFor(b);
      await sequence.submit(0);
      await sequence.waitForHandoff();
      // Refresh before the terminal Sync so this case measures only the gap
      // introduced while the motion reply was pending, not test scheduling.
      b.push(feedbackFrame({ mode: 5 }));
      await b.adapter.waitForRealtimeFrame(1000);
      await expect(sequence.finish()).resolves.toMatchObject({
        status: 'completed',
      });
    } finally {
      await b.cleanup();
    }
  });

  it('stops once the 30004 stream stays silent past its budget', async () => {
    const b = await connected(
      {
        mode: () => '5',
        feedbackStaleAfterMs: 5000,
        motionReplyDelayMs: 1400,
        commandTimeoutMs: 5000,
        motionTimeoutMs: 8000,
      },
      {},
    );
    try {
      const sequence = await sequenceFor(b);
      await expect(sequence.submit(0)).rejects.toMatchObject({
        code: 'SEQUENCE_FEEDBACK_LOST',
        details: { maxAgeMs: 1000 },
      });
    } finally {
      await b.cleanup();
    }
  });

  it('falls back to dashboard polling when 30004 never delivers a frame', async () => {
    const b = await bench({ feedbackPort: 'closed', mode: () => '5' });
    try {
      await b.adapter.connect();
      const sequence = await b.adapter.driver.beginLinearSequence!(
        [
          {
            pose: pose(111, 222, 333),
            options: { speed: { kind: 'ratio', value: 0.1 } },
          },
        ],
        { timeoutMs: 5000, realtimeFaultMonitoring: true },
      );
      await sequence.submit(0);
      await sequence.waitForHandoff();
      await expect(sequence.finish()).resolves.toMatchObject({
        status: 'completed',
      });
      expect(b.commands).toContain('GetErrorID()');
    } finally {
      await b.cleanup();
    }
  });

  it('confirms a 30004 alarm with the controller HTTP alarm groups', async () => {
    let alarms: (number[] | null)[] = [];
    const b = await connected(
      {
        mode: () => '5',
        feedbackStaleAfterMs: 5000,
        httpAlarms: () => alarms,
        motionReplyDelayMs: 1400,
        commandTimeoutMs: 5000,
        motionTimeoutMs: 8000,
      },
      {},
    );
    try {
      const sequence = await sequenceFor(b);
      await waitFor(() => b.httpCompleted() >= 1);
      expect(b.httpRequests).toContainEqual({
        method: 'GET',
        path: '/protocol/exchange',
      });
      alarms = [[70]];
      b.push(feedbackFrame({ mode: 7, running: true, errorActive: true }));
      await expect(sequence.submit(0)).rejects.toMatchObject({
        code: 'ROBOT_FAULT',
        details: {
          source: 'http-alarms',
          faults: [expect.objectContaining({ code: '70' })],
        },
      });
    } finally {
      await b.cleanup();
    }
  });

  it('detects a fault from the HTTP alarm layer without a 30004 error flag', async () => {
    let alarms: (number[] | null)[] = [];
    const b = await connected(
      {
        mode: () => '5',
        feedbackStaleAfterMs: 5000,
        httpAlarms: () => alarms,
        motionReplyDelayMs: 1400,
        commandTimeoutMs: 5000,
        motionTimeoutMs: 8000,
      },
      {},
    );
    try {
      const sequence = await sequenceFor(b);
      await waitFor(() => b.httpCompleted() >= 1);
      alarms = [[70]];
      await expect(sequence.submit(0)).rejects.toMatchObject({
        code: 'ROBOT_FAULT',
        details: {
          source: 'http-alarms',
          faults: [expect.objectContaining({ code: '70' })],
        },
      });
    } finally {
      await b.cleanup();
    }
  });

  it('fails safe on a 30004 alarm when the HTTP alarm channel is unavailable', async () => {
    const b = await connected(
      {
        mode: () => '5',
        feedbackStaleAfterMs: 5000,
        httpFail: true,
        motionReplyDelayMs: 1400,
        commandTimeoutMs: 5000,
        motionTimeoutMs: 8000,
      },
      {},
    );
    try {
      const sequence = await sequenceFor(b);
      b.push(feedbackFrame({ mode: 7, running: true, errorActive: true }));
      await expect(sequence.submit(0)).rejects.toMatchObject({
        code: 'ROBOT_FAULT',
        details: {
          source: '30004',
          errorActive: true,
          alarmReadError: expect.any(String),
        },
      });
    } finally {
      await b.cleanup();
    }
  });

  it('keeps drawing when only the HTTP alarm channel is unavailable', async () => {
    const b = await connected(
      {
        mode: () => '5',
        feedbackStaleAfterMs: 5000,
        httpFail: true,
      },
      {},
    );
    try {
      const sequence = await sequenceFor(b);
      await sequence.submit(0);
      await sequence.waitForHandoff();
      b.push(feedbackFrame({ mode: 5 }));
      await b.adapter.waitForRealtimeFrame(1000);
      await expect(sequence.finish()).resolves.toMatchObject({
        status: 'completed',
      });
    } finally {
      await b.cleanup();
    }
  });

  it('drains frames queued during a blocked event loop before judging', async () => {
    const hooks: { onMotion?: (command: string) => void } = {};
    const b = await connected(
      {
        mode: () => '5',
        feedbackStaleAfterMs: 5000,
        motionReplyDelayMs: (command) =>
          command.startsWith('MovL(') ? 1600 : 0,
        commandTimeoutMs: 5000,
        motionTimeoutMs: 8000,
      },
      hooks,
    );
    let scheduled = false;
    hooks.onMotion = () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        // Queue a fresh frame, then stall before the client can read it. When
        // the loop resumes, the monitor's timer runs before socket callbacks.
        b.push(feedbackFrame({ mode: 7, running: true }));
        blockEventLoop(1200);
      }, 200);
    };
    try {
      const sequence = await sequenceFor(b);
      await sequence.submit(0);
      await sequence.waitForHandoff();
      await expect(sequence.finish()).resolves.toMatchObject({
        status: 'completed',
      });
    } finally {
      await b.cleanup();
    }
  });
});

describe('MG400 30004 feedback codec', () => {
  it('decodes the documented little-endian field layout', () => {
    const decoded = decodeMg400RealtimeFrame(
      feedbackFrame({
        mode: 7,
        pose: [1, 2, 3, 4],
        running: true,
        dragStatus: 2,
        errorActive: true,
        loadKg: 0.25,
      }),
      12345,
    );
    expect(decoded).toMatchObject({
      mode: 7,
      robotType: 1,
      speedScaling: 100,
      userId: 0,
      toolId: 0,
      enabled: true,
      running: true,
      dragStatus: 2,
      errorActive: true,
      runQueuedCmd: false,
      pauseCmdFlag: false,
      receivedAt: 12345,
      loadKg: 0.25,
    });
    expect(decoded.toolVectorActual).toEqual([1, 2, 3, 4, 0, 0]);
    const rawPose = mg400PoseFromToolVector(decoded.toolVectorActual);
    expect(rawPose.orientation.z).toBeCloseTo(Math.sin((4 * Math.PI) / 360));
    expect(decoded.jointActualDegrees).toHaveLength(6);
    expect(() =>
      decodeMg400RealtimeFrame(feedbackFrame({ loadKg: Number.NaN })),
    ).toThrow('Load');
  });
  it('rejects length, MessageSize, TestValue, mode and RobotType violations', () => {
    expect(() => decodeMg400RealtimeFrame(Buffer.alloc(10))).toThrow(
      /expected 1440 bytes, received 10/,
    );
    expect(() =>
      decodeMg400RealtimeFrame(feedbackFrame({ messageSize: 100 })),
    ).toThrow(/MessageSize is 100/);
    expect(() =>
      decodeMg400RealtimeFrame(feedbackFrame({ testValue: 0n })),
    ).toThrow(/TestValue is 0x0/);
    expect(() => decodeMg400RealtimeFrame(feedbackFrame({ mode: 99 }))).toThrow(
      /unknown controller mode 99/,
    );
    expect(() =>
      decodeMg400RealtimeFrame(feedbackFrame({ robotType: 2 })),
    ).toThrow(/RobotType is 2, expected 1/);
  });
  it('keeps a partial tail and emits only complete frames', () => {
    const framer = new Mg400RealtimeFramer();
    const first = feedbackFrame({ mode: 5 });
    const second = feedbackFrame({ mode: 6, pose: [1, 2, 3, 4] });
    expect(framer.push(first.subarray(0, 100))).toEqual([]);
    expect(framer.bufferedBytes).toBe(100);
    const emitted = framer.push(
      Buffer.concat([first.subarray(100), second.subarray(0, 7)]),
    );
    expect(emitted).toHaveLength(1);
    expect(emitted[0].equals(first)).toBe(true);
    expect(framer.bufferedBytes).toBe(7);
    expect(framer.push(second.subarray(7))[0].equals(second)).toBe(true);
    expect(framer.bufferedBytes).toBe(0);
  });
});

describe('MG400 authoritative Base pose with 30004 state flags', () => {
  it('uses dashboard Base poses even when a fresh User0/Tool0 vector disagrees', async () => {
    const b = await bench({ pose: () => DASHBOARD_POSE, mode: () => '4' });
    try {
      await b.adapter.connect();
      await waitFor(() => b.connectedFeedbackClients() === 1);
      b.push(
        feedbackFrame({
          mode: 7,
          pose: [10, 20, 30, 45],
          running: true,
          dragStatus: 3,
        }),
      );
      await b.adapter.waitForRealtimeFrame(1000);

      expect(b.adapter.feedbackStatus()).toMatchObject({
        source: 'push',
        available: true,
      });
      const pose = await b.adapter.getPose();
      expect(pose.positionMm).toEqual({ x: 111, y: 222, z: 333 });
      expect(pose.orientation.z).toBe(0);
      const state = await b.adapter.getState();
      expect({
        enabled: state.enabled,
        moving: state.moving,
        dragMode: state.dragMode,
        mode: state.mode,
      }).toEqual({ enabled: true, moving: true, dragMode: true, mode: '7' });
      expect(state.pose?.positionMm).toEqual({ x: 111, y: 222, z: 333 });
      // Faults keep coming from GetErrorID(), never from the realtime flags.
      expect(state.faults).toEqual([]);
      expect(b.commands).toContain('GetErrorID()');
    } finally {
      await b.cleanup();
    }
  });
  it('rejects frames with a wrong layout or robot type without corrupting state', async () => {
    const b = await bench({ feedbackStaleAfterMs: 5000 });
    try {
      await b.adapter.connect();
      await waitFor(() => b.connectedFeedbackClients() === 1);
      b.push(feedbackFrame({ mode: 5, pose: [10, 20, 30, 45] }));
      await b.adapter.waitForRealtimeFrame(1000);

      b.push(
        feedbackFrame({ mode: 5, robotType: 2, pose: [900, 900, 900, 0] }),
      );
      b.push(
        feedbackFrame({ mode: 5, messageSize: 100, pose: [901, 901, 901, 0] }),
      );
      b.push(
        feedbackFrame({ mode: 5, testValue: 0n, pose: [902, 902, 902, 0] }),
      );
      await sleep(60);

      expect((await b.adapter.getPose()).positionMm).toEqual({
        x: 111,
        y: 222,
        z: 333,
      });
      expect((await b.adapter.getState()).pose?.positionMm).toEqual({
        x: 111,
        y: 222,
        z: 333,
      });
      expect(b.adapter.feedbackStatus()).toMatchObject({
        source: 'push',
        available: true,
      });
      expect(b.adapter.feedbackStatus().lastError).toMatch(/RobotType is 2/);
    } finally {
      await b.cleanup();
    }
  });
  it('reassembles a frame split across chunks and ignores a partial frame', async () => {
    const b = await bench({ pose: () => DASHBOARD_POSE });
    try {
      await b.adapter.connect();
      await waitFor(() => b.connectedFeedbackClients() === 1);
      const frame = feedbackFrame({
        mode: 6,
        pose: [10, 20, 30, 90],
        dragStatus: 1,
      });
      b.push(frame.subarray(0, 700));
      await sleep(60);
      // A partial frame is not feedback: the dashboard fallback still answers.
      expect((await b.adapter.getPose()).positionMm).toEqual({
        x: 111,
        y: 222,
        z: 333,
      });
      expect(b.adapter.feedbackStatus().source).toBe('polling');
      b.push(frame.subarray(700, 1000));
      await sleep(20);
      b.push(frame.subarray(1000));
      await b.adapter.waitForRealtimeFrame(1000);
      expect((await b.adapter.getPose()).positionMm).toEqual({
        x: 111,
        y: 222,
        z: 333,
      });
      expect((await b.adapter.getState()).dragMode).toBe(true);
    } finally {
      await b.cleanup();
    }
  });
  it('does not require 30004: connect and state survive a closed feedback port', async () => {
    const b = await bench({
      feedbackPort: 'closed',
      mode: () => '5',
      pose: () => '7,8,9,0',
    });
    try {
      await expect(b.adapter.connect()).resolves.toBeUndefined();
      const pose = await b.adapter.getPose();
      expect(pose.positionMm).toEqual({ x: 7, y: 8, z: 9 });
      const state = await b.adapter.getState();
      expect(state).toMatchObject({
        connected: true,
        enabled: true,
        moving: false,
        dragMode: false,
        mode: '5',
      });
      expect(state.pose?.positionMm).toEqual({ x: 7, y: 8, z: 9 });
      expect(b.adapter.feedbackStatus()).toMatchObject({
        source: 'polling',
        available: false,
      });
      expect(b.adapter.feedbackStatus().reason).toMatch(/is not connected/);
      await expect(b.adapter.waitForRealtimeFrame(150)).rejects.toMatchObject({
        code: 'FEEDBACK_UNAVAILABLE',
      });
    } finally {
      await b.cleanup();
    }
  });
  it('does not require frames: a silent 30004 connection still connects', async () => {
    const b = await bench({ mode: () => '5', pose: () => '7,8,9,0' });
    try {
      await b.adapter.connect();
      await waitFor(() => b.connectedFeedbackClients() === 1);
      expect(b.adapter.feedbackStatus()).toMatchObject({
        source: 'polling',
        available: true,
      });
      expect(b.adapter.feedbackStatus().reason).toMatch(/no valid/);
      expect((await b.adapter.getPose()).positionMm).toEqual({
        x: 7,
        y: 8,
        z: 9,
      });
      expect((await b.adapter.getState()).mode).toBe('5');
    } finally {
      await b.cleanup();
    }
  });
  it('falls back to dashboard polling once the newest frame goes stale', async () => {
    const b = await bench({
      mode: () => '5',
      pose: () => DASHBOARD_POSE,
      feedbackStaleAfterMs: 250,
    });
    try {
      await b.adapter.connect();
      await waitFor(() => b.connectedFeedbackClients() === 1);
      b.push(feedbackFrame({ mode: 7, pose: [10, 20, 30, 45], running: true }));
      await b.adapter.waitForRealtimeFrame(1000);
      expect(b.adapter.feedbackStatus().source).toBe('push');
      expect((await b.adapter.getPose()).positionMm).toEqual({
        x: 111,
        y: 222,
        z: 333,
      });

      await waitFor(
        () => b.adapter.feedbackStatus().source === 'polling',
        2000,
      );
      expect(b.adapter.feedbackStatus()).toMatchObject({
        source: 'polling',
        // The socket is still connected; only the frame aged out.
        available: true,
      });
      expect(b.adapter.feedbackStatus().reason).toMatch(/staleness window/);
      expect((await b.adapter.getPose()).positionMm).toEqual({
        x: 111,
        y: 222,
        z: 333,
      });
      const state = await b.adapter.getState();
      expect({ mode: state.mode, moving: state.moving }).toEqual({
        mode: '5',
        moving: false,
      });
    } finally {
      await b.cleanup();
    }
  });
  it('reports a downgrade when 30004 is unreachable without failing connect', async () => {
    const reports: RobotArmFeedbackStatus[] = [];
    const b = await bench({
      feedbackPort: 'closed',
      onFeedbackStatus: (status) => reports.push(status),
    });
    try {
      await b.adapter.connect();
      expect(reports.length).toBeGreaterThan(0);
      expect(reports.every((status) => status.source === 'polling')).toBe(true);
      expect(reports.at(-1)?.available).toBe(false);
      expect(reports.at(-1)?.reason).toMatch(/is not connected/);
    } finally {
      await b.cleanup();
    }
  });
  it('reports the push upgrade once and one staleness downgrade', async () => {
    const reports: RobotArmFeedbackStatus[] = [];
    const b = await bench({
      feedbackStaleAfterMs: 250,
      onFeedbackStatus: (status) => reports.push(status),
    });
    try {
      await b.adapter.connect();
      await waitFor(() => b.connectedFeedbackClients() === 1);
      b.push(feedbackFrame({ mode: 5, pose: [10, 20, 30, 45] }));
      await b.adapter.waitForRealtimeFrame(1000);
      expect(reports.filter((status) => status.source === 'push')).toHaveLength(
        1,
      );
      // Wait for the reported downgrade itself, not just the derived status:
      // the staleness watchdog is a timer and races a polling read.
      await waitFor(() => reports.at(-1)?.source === 'polling', 2000);
      expect(reports.filter((status) => status.source === 'push')).toHaveLength(
        1,
      );
      expect(reports.at(-1)?.reason).toMatch(/staleness window/);
    } finally {
      await b.cleanup();
    }
  });
  it('disables the push channel without opening a socket', async () => {
    const adapter = new Mg400Adapter({
      host: '127.0.0.1',
      dashboardPort: 1,
      motionPort: 2,
      feedbackPort: 0,
    });
    expect(adapter.feedbackStatus()).toMatchObject({
      source: 'polling',
      available: false,
    });
    expect(adapter.feedbackStatus().reason).toMatch(/disabled/);
    await adapter.disconnect();
  });
});

describe('MG400 coordinate and sample identity guards', () => {
  it('keeps the hardware regression pose and yaw on the dashboard source for reads and arrival', async () => {
    const b = await bench({
      mode: () => '5',
      pose: () => '367.086939,8.009841,-33.128422,-342.292480',
    });
    try {
      await b.adapter.connect();
      await waitFor(() => b.connectedFeedbackClients() === 1);
      b.push(
        feedbackFrame({
          pose: [187.437838, -32.053043, 26.802143, -253.141655],
        }),
      );
      await b.adapter.waitForRealtimeFrame();
      const target = await b.adapter.getPose();
      expect(target.positionMm).toEqual({
        x: 367.086939,
        y: 8.009841,
        z: -33.128422,
      });
      expect(target.orientation.z).toBeCloseTo(
        Math.sin((-342.29248 * Math.PI) / 360),
      );
      expect(b.adapter.feedbackStatus()).toMatchObject({
        source: 'push',
        poseSource: 'polling',
      });
      const handle = await b.adapter.moveLinear(target, {
        speed: { kind: 'ratio', value: 0.1 },
      });
      expect(await handle.wait()).toMatchObject({
        status: 'completed',
        pose: target,
      });
      expect(b.commands).toContain('Sync()');
      expect(
        b.commands.some((command) =>
          command.startsWith('MovL(367.086939,8.009841,-33.128422,'),
        ),
      ).toBe(true);
    } finally {
      await b.cleanup();
    }
  });

  it('reads the measured dashboard pose when realtime feedback uses another user or tool frame', async () => {
    const b = await bench();
    try {
      await b.adapter.connect();
      await waitFor(() => b.connectedFeedbackClients() === 1);
      b.push(feedbackFrame({ userId: 2, toolId: 1, pose: [1, 2, 3, 0] }));
      await b.adapter.waitForRealtimeFrame();
      expect((await b.adapter.getPose()).positionMm).toEqual({
        x: 111,
        y: 222,
        z: 333,
      });
      // This fixture supports the four-axis plain query dialect. The result
      // must still come from the dashboard, never the mismatched TCP vector.
      expect(b.commands).toContain('GetPose()');
    } finally {
      await b.cleanup();
    }
  });
  it('queries a fresh Base pose for every sample even with repeated controller timestamps', async () => {
    const b = await bench();
    try {
      await b.adapter.connect();
      await waitFor(() => b.connectedFeedbackClients() === 1);
      b.push(feedbackFrame({ pose: [1, 2, 3, 0] }));
      await b.adapter.waitForRealtimeFrame();
      const measured = b.adapter.driver.readPose!;
      const first = await measured({ fresh: true });
      const next = await measured({ fresh: true });
      expect(first.source).toBe('polling');
      expect(next.source).toBe('polling');
      expect(next.sampleId).not.toBe(first.sampleId);
    } finally {
      await b.cleanup();
    }
  });
});
