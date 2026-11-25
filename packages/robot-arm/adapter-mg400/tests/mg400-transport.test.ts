import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { type Server, type Socket, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RobotKernel } from '@midscene/arm-kit/internal/kernel';
import { RobotDriverBoundary } from '@midscene/arm-kit/internal/kernel/driver-boundary';
import { RobotArmRuntime } from '@midscene/arm-kit/internal/runtime';
import { ProfileStore } from '@midscene/arm-kit/internal/runtime/profile-store';
import { executeContactPlan } from '@midscene/arm-kit/internal/screen-interaction/contact-executor';
import type { ScreenMotionHost } from '@midscene/arm-kit/internal/screen-interaction/service';
import { fixture, pose } from '@midscene/arm-kit/internal/testkit/fixtures';
import { describe, expect, it } from '@rstest/core';
import {
  DOBOT_MG400_DEFAULTS,
  Mg400Adapter,
  type Mg400Options,
  parseMg400ErrorIdResponse,
  parseMg400GetAngle,
  parseMg400Joints,
  parseMg400Pose,
  parseMg400Response,
  validateMg400Payload,
} from '../src/mg400.js';

/** Local protocol fixtures only; no connection to a physical robot. */
async function controller(
  options: {
    /** Delay before the controller *reports* enabled; the ACK stays immediate. */
    enableDelayMs?: number;
    /** Start paused (mode 10) and stay paused until Continue() arrives. */
    paused?: boolean;
    /** Report mode 9 (ERROR) rather than an enabled or disabled mode. */
    errorMode?: boolean;
    dragMode?: boolean;
    rejectStopDrag?: boolean;
    exitBeforeStopDrag?: boolean;
    /** Error codes GetErrorID() returns before any ClearError(). */
    errorCodes?: number[];
    persistentErrors?: boolean;
    delayHttpStateMs?: number;
    /** Error codes the controller reports after EmergencyStop(). */
    estopErrorCodes?: number[];
    syncDelayMs?: number;
    postSyncMovingMs?: number;
    postSyncDisabled?: boolean;
    postSyncFault?: boolean;
    /** Report physical arrival independently of the blocking Sync reply. */
    arrivalDelayMs?: number;
    freezeMeasuredPose?: boolean;
    rejectPayload?: boolean;
    rejectSync?: boolean;
    ignoreMode?: boolean;
    /** Answer GetErrorID() with `ErrorID,` instead of a numeric response code. */
    errorIdNamedPrefix?: boolean;
    /** How many error-code groups GetErrorID() reports. Default 5. */
    errorIdGroups?: number;
    /** Report one flat error-code group instead of nested per-subsystem groups. */
    flatErrorIds?: boolean;
    /** Answer GetPose() with -30001 so the kinematic fallback path is taken. */
    rejectNamedGetPose?: boolean;
    /** Answer GetAngle() with the keyed `{j1..j4}` form. */
    keyedGetAngle?: boolean;
    getAnglePadding?: number[];
    getAngleBody?: string;
    /** Answer PositiveSolution() with the keyed `{x,y,z,r}` form. */
    keyedPose?: boolean;
    /** Prefix a successful motion ACK with something other than a code. */
    motionReplyNamedPrefix?: boolean;
    holdResetReply?: boolean;
    /** Drop the first mode query after a jog release to exercise retry. */
    failJogStopConfirmationOnce?: boolean;
    /**
     * How the controller answers InverseSolution(): a joint tuple, a negative
     * vendor code, silence, or a malformed line.
     */
    inverseSolution?:
      | 'accept'
      | 'reject'
      | 'unsupported'
      | 'silent'
      | 'malformed';
    adapter?: Partial<Mg400Options>;
  } = {},
) {
  const sockets = new Set<Socket>();
  const commands: string[] = [];
  const batchWrites: string[] = [];
  const httpRequests: { method: string; body?: unknown }[] = [];
  let actual = [100, 0, 100, 0];
  let target = [...actual];
  let joints = [1, 2, 3, 4];
  let jointTarget: number[] | undefined;
  let enabled = false;
  let dragging = options.dragMode ?? false;
  let moving = false;
  let movingUntil = 0;
  let paused = options.paused ?? false;
  let errorMode = options.errorMode ?? false;
  let errorCodes = [...(options.errorCodes ?? [])];
  let epoch = 0;
  let blockMode = false;
  let delayModeMs = 0;
  let blockedMode = false;
  let heldDashboardReply:
    | { name: string; hold: (reply: () => void) => void }
    | undefined;
  let failJogConfirmation = false;
  let jogConfirmationFailed = false;
  const connections = { motion: 0, dashboard: 0 };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const server = (motion: boolean) =>
    createServer((socket) => {
      connections[motion ? 'motion' : 'dashboard']++;
      sockets.add(socket);
      socket.on('error', () => undefined);
      socket.on('close', () => sockets.delete(socket));
      let buffer = '';
      socket.on('data', (chunk) => {
        const chunkText = chunk.toString();
        // Three commands in one write means the adapter batched its state query.
        const batched = (chunkText.match(/\)/g)?.length ?? 0) > 1;
        if (!motion && batched) batchWrites.push(chunkText);
        buffer += chunkText;
        let end = buffer.indexOf(')');
        while (end >= 0) {
          const command = buffer.slice(0, end + 1);
          buffer = buffer.slice(end + 1);
          commands.push(command);
          const name = command.slice(0, command.indexOf('('));
          const reply = (payload = '') => {
            const write = () => {
              if (!socket.destroyed) socket.write(`0,{${payload}},${command};`);
            };
            if (!motion && heldDashboardReply?.name === name) {
              const { hold } = heldDashboardReply;
              heldDashboardReply = undefined;
              hold(write);
            } else write();
          };
          if (
            (name === 'SetPayLoad' && (!enabled || options.rejectPayload)) ||
            (name === 'Sync' && options.rejectSync)
          ) {
            if (!socket.destroyed) socket.write(`-1,{},${command};`);
            end = buffer.indexOf(')');
            continue;
          }
          if (motion) {
            if (name === 'JointMovJ') {
              jointTarget = command
                .slice(command.indexOf('(') + 1, -1)
                .split(',')
                .slice(0, 4)
                .map(Number);
              moving = true;
              reply();
            } else if (name === 'MovL' || name === 'MovJ') {
              target = command
                .slice(command.indexOf('(') + 1, -1)
                .split(',')
                .slice(0, 4)
                .map(Number);
              moving = true;
              if (options.arrivalDelayMs !== undefined) {
                const generation = epoch;
                const destination = [...target];
                const timer = setTimeout(() => {
                  timers.delete(timer);
                  if (generation === epoch) {
                    if (!options.freezeMeasuredPose) actual = destination;
                    moving = false;
                  }
                }, options.arrivalDelayMs);
                timers.add(timer);
              }
              // A dialect the Adapter must keep rejecting for anything but
              // GetErrorID(): an `ErrorID,` prefix on a motion ACK.
              if (options.motionReplyNamedPrefix && !socket.destroyed)
                socket.write(`ErrorID,{},${command};`);
              else reply();
            } else if (name === 'Sync') {
              const generation = epoch;
              const timer = setTimeout(() => {
                timers.delete(timer);
                if (generation === epoch) {
                  if (jointTarget) {
                    joints = [...jointTarget];
                    jointTarget = undefined;
                  } else actual = [...target];
                  moving = false;
                  movingUntil = Date.now() + (options.postSyncMovingMs ?? 0);
                  if (options.postSyncDisabled) enabled = false;
                  if (options.postSyncFault) errorCodes = [123];
                }
                reply();
              }, options.syncDelayMs ?? 100);
              timers.add(timer);
            } else reply();
          } else {
            if (name === 'MoveJog') {
              moving = command !== 'MoveJog()';
              if (
                !moving &&
                options.failJogStopConfirmationOnce &&
                !jogConfirmationFailed
              )
                failJogConfirmation = true;
              reply();
            } else if (name === 'RobotMode') {
              if (failJogConfirmation) {
                failJogConfirmation = false;
                jogConfirmationFailed = true;
                socket.destroy();
                return;
              }
              if (blockMode) {
                blockMode = false;
                blockedMode = true;
                end = buffer.indexOf(')');
                continue;
              }
              if (delayModeMs) {
                const wait = delayModeMs;
                delayModeMs = 0;
                const timer = setTimeout(() => {
                  timers.delete(timer);
                  reply('4');
                }, wait);
                timers.add(timer);
                end = buffer.indexOf(')');
                continue;
              }
              if (!options.ignoreMode)
                reply(
                  moving || Date.now() < movingUntil
                    ? '7'
                    : errorMode
                      ? '9'
                      : paused
                        ? '10'
                        : dragging
                          ? '6'
                          : enabled
                            ? '5'
                            : '4',
                );
            } else if (name === 'GetPose') {
              if (options.rejectNamedGetPose)
                socket.write(`-30001,{},${command};`);
              else if (options.keyedPose)
                reply(
                  `x:${actual[0]},y:${actual[1]},z:${actual[2]},r:${actual[3]}`,
                );
              else reply(actual.join(','));
            } else if (name === 'GetErrorID') {
              // The controller groups codes per subsystem; a flat answer and the
              // `ErrorID,` prefix are both dialects seen in the field.
              const groups = options.errorIdGroups ?? 5;
              const payload = options.flatErrorIds
                ? JSON.stringify(errorCodes)
                : JSON.stringify(
                    Array.from({ length: groups }, (_, index) =>
                      index === 0 ? errorCodes : [],
                    ),
                  );
              if (options.errorIdNamedPrefix)
                socket.write(`ErrorID,{${payload}},${command};`);
              else reply(payload);
            } else if (name === 'GetAngle')
              reply(
                options.getAngleBody ??
                  (options.keyedGetAngle
                    ? joints.map((v, i) => `j${i + 1}:${v}`).join(',')
                    : [...joints, ...(options.getAnglePadding ?? [])].join(
                        ',',
                      )),
              );
            else if (name === 'PositiveSolution')
              reply(
                options.keyedPose
                  ? 'x:11.5,y:-2.25,z:33.75,r:45'
                  : '11.5,-2.25,33.75,45',
              );
            else if (name === 'InverseSolution') {
              if (options.inverseSolution === 'unsupported')
                socket.write(`-30001,{},${command};`);
              else if (options.inverseSolution === 'reject')
                socket.write(`-1,{},${command};`);
              else if (enabled && options.inverseSolution === 'malformed')
                socket.write('not-a-response;');
              else if (!enabled || options.inverseSolution !== 'silent')
                reply('1,2,3,4');
              // 'silent' writes nothing, so the query times out.
            } else if (name === 'SetPayLoad') reply();
            else if (name === 'EnableRobot') {
              // The controller acknowledges immediately and reports the enabled
              // mode later, which is what a slow brake release looks like.
              reply();
              const engage = () => {
                enabled = true;
              };
              if (options.enableDelayMs) {
                const timer = setTimeout(() => {
                  timers.delete(timer);
                  engage();
                }, options.enableDelayMs);
                timers.add(timer);
              } else engage();
            } else if (name === 'DisableRobot') {
              enabled = false;
              reply();
            } else if (name === 'ResetRobot') {
              epoch++;
              moving = false;
              movingUntil = 0;
              if (!options.holdResetReply) reply();
            } else if (name === 'StartDrag') {
              dragging = true;
              reply();
            } else if (name === 'StopDrag') {
              if (options.exitBeforeStopDrag) dragging = false;
              if (!dragging || options.rejectStopDrag)
                socket.write(`-1,{},${command};`);
              else {
                dragging = false;
                reply();
              }
            } else if (name === 'ClearError') {
              if (!options.persistentErrors) {
                errorCodes = [];
                errorMode = false;
              }
              reply();
            } else if (name === 'Pause') {
              paused = true;
              reply();
            } else if (name === 'Continue') {
              paused = false;
              reply();
            } else if (name === 'EmergencyStop') {
              epoch++;
              moving = false;
              paused = false;
              errorCodes = [...(options.estopErrorCodes ?? [])];
              if (errorCodes.length > 0) errorMode = true;
              reply();
            } else reply();
          }
          end = buffer.indexOf(')');
        }
      });
    });
  const dashboard = server(false);
  const motion = server(true);
  const listen = (s: Server) =>
    new Promise<number>((resolve, reject) => {
      s.once('error', reject);
      s.listen(0, '127.0.0.1', () => {
        const a = s.address();
        if (!a || typeof a === 'string') throw new Error('Port unavailable');
        resolve(a.port);
      });
    });
  const dashboardPort = await listen(dashboard);
  const motionPort = await listen(motion);
  const http = createHttpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString();
      const body = text ? JSON.parse(text) : undefined;
      httpRequests.push({ method: req.method!, body });
      if (
        req.method === 'POST' &&
        body?.alarms === true &&
        !options.persistentErrors
      ) {
        errorCodes = [];
        errorMode = false;
      }
      const reply = () =>
        res.end(
          JSON.stringify({
            controlMode: enabled ? 'enable' : 'disable',
            coordinate: 'joint',
            jogMode: 'jog',
            toolCoordinate: 0,
            userCoordinate: 0,
            alarms: [errorCodes, [], [], [], [], null],
            outputs: [0, 1, 0, 0, 0, 0, 0, 0],
            jointCoordinate: joints,
            cartesianCoordinate: actual,
            prjState: paused ? 'paused' : 'stopped',
          }),
        );
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && options.delayHttpStateMs) {
        const timer = setTimeout(() => {
          timers.delete(timer);
          reply();
        }, options.delayHttpStateMs);
        timers.add(timer);
      } else reply();
    });
  });
  http.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  const httpPort = await listen(http);
  const adapter = new Mg400Adapter({
    host: '127.0.0.1',
    dashboardPort,
    motionPort,
    httpPort,
    // Nothing listens on 30004 here; the push channel has its own fixture.
    feedbackPort: 0,
    commandTimeoutMs: 500,
    motionTimeoutMs: 1000,
    ...options.adapter,
  });
  return {
    adapter,
    commands,
    batchWrites,
    connections,
    httpRequests,
    dropConnections() {
      for (const socket of sockets) socket.destroy();
    },
    setDrag(value: boolean) {
      dragging = value;
    },
    setEnabled(value: boolean) {
      enabled = value;
    },
    blockNextMode() {
      blockMode = true;
    },
    modeIsBlocked() {
      return blockedMode;
    },
    delayNextMode(ms: number) {
      delayModeMs = ms;
    },
    holdNextDashboardReply(name: 'GetPose' | 'GetErrorID') {
      let release: (() => void) | undefined;
      const requested = new Promise<void>((resolve) => {
        heldDashboardReply = {
          name,
          hold(reply) {
            release = reply;
            resolve();
          },
        };
      });
      return { requested, release: () => release?.() };
    },
    /** Make the controller faulty without going through the Adapter. */
    injectFault(code = -2) {
      errorCodes = [code];
    },
    async cleanup() {
      await adapter.disconnect();
      for (const t of timers) clearTimeout(t);
      for (const s of sockets) s.destroy();
      await Promise.all(
        [dashboard, motion, http].map(
          (s) =>
            new Promise<void>((resolve, reject) =>
              s.close((e) => (e ? reject(e) : resolve())),
            ),
        ),
      );
    },
  };
}

/** The structured error code a call rejects with. */
function codeOf(work: () => unknown): unknown {
  try {
    work();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  throw new Error('Expected the call to throw');
}
describe('MG400 transport boundary', () => {
  it('jogs with MoveJog and confirms the release from RobotMode', async () => {
    const f = await controller();
    try {
      await f.adapter.connect();
      await f.adapter.enable();
      await f.adapter.startJog({ axis: 'x', direction: 1 });
      // Direct adapter callers can select a different joint.
      await f.adapter.startJog({ joint: 3, direction: -1 });
      await f.adapter.stopJog();
      expect(f.commands).toContain('MoveJog(X+)');
      expect(f.commands).toContain('MoveJog(J4-)');
      expect(f.commands).toContain('MoveJog()');
      expect(f.commands).toContain('RobotMode()');
    } finally {
      await f.cleanup();
    }
  });
  it('retries a jog release when the first stop confirmation fails', async () => {
    const f = await controller({ failJogStopConfirmationOnce: true });
    try {
      await f.adapter.connect();
      await f.adapter.enable();
      await f.adapter.startJog({ axis: 'x', direction: 1 });
      await expect(f.adapter.stopJog()).rejects.toThrow();
      await f.adapter.stopJog();
      expect(
        f.commands.filter((command) => command === 'MoveJog()'),
      ).toHaveLength(2);
    } finally {
      await f.cleanup();
    }
  });
  it('waits for Sync and reads measured pose instead of caching the accepted target', async () => {
    const f = await controller();
    try {
      await f.adapter.connect();
      await f.adapter.enable();
      const target = pose(150, 10, 80);
      const handle = await f.adapter.moveLinear(target);
      expect((await f.adapter.getPose()).positionMm).not.toEqual(
        target.positionMm,
      );
      expect((await handle.wait()).status).toBe('completed');
      expect((await f.adapter.getPose()).positionMm).toEqual(target.positionMm);
      expect(f.commands).toContain('Sync()');
    } finally {
      await f.cleanup();
    }
  });
  it('waits for dashboard motion status to settle after Sync without resending motion', async () => {
    const f = await controller({ postSyncMovingMs: 150 });
    try {
      await f.adapter.connect();
      await f.adapter.enable();
      const handle = await f.adapter.moveLinear(pose(150, 10, 80));
      expect((await handle.wait()).status).toBe('completed');
      expect(f.commands.filter((c) => c.startsWith('MovL('))).toHaveLength(1);
    } finally {
      await f.cleanup();
    }
  });
  it('honors Stop while waiting for dashboard status after Sync', async () => {
    const f = await controller({ postSyncMovingMs: 5000 });
    try {
      await f.adapter.connect();
      await f.adapter.enable();
      const handle = await f.adapter.moveLinear(pose(150, 10, 80));
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline) {
        const sync = f.commands.indexOf('Sync()');
        if (sync >= 0 && f.commands.slice(sync + 1).includes('RobotMode()'))
          break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(f.commands.slice(f.commands.indexOf('Sync()') + 1)).toContain(
        'RobotMode()',
      );
      await f.adapter.stop();
      expect((await handle.wait()).status).toBe('stopped');
      expect(f.commands.filter((c) => c.startsWith('MovL('))).toHaveLength(1);
    } finally {
      await f.cleanup();
    }
  });
  it.each([
    { postSyncMovingMs: 5000 },
    { postSyncDisabled: true },
    { postSyncFault: true },
  ])('rejects an unready state after Sync: %j', async (options) => {
    const f = await controller(options);
    try {
      await f.adapter.connect();
      await f.adapter.enable();
      const handle = await f.adapter.moveLinear(pose(150, 10, 80));
      await expect(handle.wait()).rejects.toMatchObject({
        code: 'MOTION_INTERRUPTED',
        details: { state: expect.objectContaining({ connected: true }) },
      });
      expect(f.commands.filter((c) => c.startsWith('MovL('))).toHaveLength(1);
    } finally {
      await f.cleanup();
    }
  });
  it('Stop clears the queue through an independent dashboard channel', async () => {
    const f = await controller({ syncDelayMs: 1000 });
    try {
      await f.adapter.connect();
      await f.adapter.enable();
      const handle = await f.adapter.moveLinear(pose(150, 0, 80));
      await f.adapter.stop();
      expect((await handle.wait()).status).toBe('stopped');
      expect((await f.adapter.getState()).moving).toBe(false);
      expect(f.commands).toContain('ResetRobot()');
      expect((await f.adapter.getPose()).positionMm).toEqual({
        x: 100,
        y: 0,
        z: 100,
      });
    } finally {
      await f.cleanup();
    }
  });
  it('quarantines a timed-out channel instead of silently reusing it', async () => {
    const f = await controller({ ignoreMode: true });
    try {
      await expect(f.adapter.connect()).rejects.toMatchObject({
        code: 'COMMAND_TIMEOUT',
      });
      await expect(f.adapter.getState()).rejects.toMatchObject({
        code: 'DISCONNECTED',
      });
      expect(f.commands.filter((c) => c === 'RobotMode()')).toHaveLength(1);
    } finally {
      await f.cleanup();
    }
  });
  it('reports a motion Sync timeout as unknown completion without resending the move', async () => {
    const f = await controller({
      syncDelayMs: 500,
      adapter: { motionTimeoutMs: 80 },
    });
    try {
      await f.adapter.connect();
      await f.adapter.enable();
      const handle = await f.adapter.moveLinear(pose(150, 10, 80), {
        speed: { kind: 'ratio', value: 0.1 },
        traceCompletion: true,
      });
      await expect(handle.wait()).rejects.toMatchObject({
        code: 'COMMAND_TIMEOUT',
        details: {
          command: 'Sync()',
          completionTrace: {
            vendorCode: 0,
            acknowledgedAt: expect.any(Number),
            syncStartedAt: expect.any(Number),
            samples: expect.any(Array),
            finishedAt: expect.any(Number),
          },
        },
      });
      expect(
        f.commands.filter((command) => command.startsWith('MovL(')),
      ).toHaveLength(1);
    } finally {
      await f.cleanup();
    }
  });
});
describe('MG400 paused, error and payload handling', () => {
  it.each([{ massKg: 0.1 }, { massKg: 0.1, inertiaKgM2: 0.01 }])(
    'syncs %j on an already-enabled robot without toggling enablement',
    async (payload) => {
      const f = await controller();
      try {
        f.setEnabled(true);
        await f.adapter.connect();
        const kernel = new RobotKernel(f.adapter);
        await kernel.applyPayload(payload);
        expect(f.commands).toContain(
          payload.inertiaKgM2 === undefined
            ? 'SetPayLoad(0.1)'
            : 'SetPayLoad(0.1,0.01)',
        );
        expect(f.commands).toContain('Sync()');
        expect(
          f.commands.some((command) =>
            /^(EnableRobot|DisableRobot)\(/.test(command),
          ),
        ).toBe(false);
        expect(
          f.adapter.driver.readPayloadApplication!().applied,
        ).toMatchObject({ payload, source: 'command-completion' });
      } finally {
        await f.cleanup();
      }
    },
  );
  it.each([{}, { paused: true }, { errorCodes: [-2] }])(
    'rejects unsafe payload sync before dispatch: %j',
    async (options) => {
      const f = await controller(options);
      try {
        if ('paused' in options || 'errorCodes' in options) f.setEnabled(true);
        await f.adapter.connect();
        await expect(
          f.adapter.applyPayload({ massKg: 0.1 }),
        ).rejects.toMatchObject({ code: 'PAYLOAD_REQUIRES_IDLE' });
        expect(
          f.commands.some((command) => command.startsWith('SetPayLoad(')),
        ).toBe(false);
      } finally {
        await f.cleanup();
      }
    },
  );
  it('does not confirm an enabled payload sync interrupted by Stop', async () => {
    const f = await controller({ syncDelayMs: 500 });
    try {
      f.setEnabled(true);
      await f.adapter.connect();
      const result = f.adapter
        .applyPayload({ massKg: 0.1 })
        .catch((error: unknown) => error);
      const deadline = Date.now() + 1000;
      while (!f.commands.includes('Sync()') && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 5));
      expect(f.commands).toContain('Sync()');
      expect(f.adapter.driver.readPayloadApplication!().status).toBe(
        'applying',
      );
      await f.adapter.stop();
      expect(await result).toBeInstanceOf(Error);
      expect(f.adapter.driver.readPayloadApplication!().status).toBe(
        'unconfirmed',
      );
    } finally {
      await f.cleanup();
    }
  });
  it('retains completed payload across repeated connect, Stop channel replacement, pause and resume', async () => {
    const f = await controller();
    try {
      await f.adapter.connect();
      await f.adapter.enable({ massKg: 0.1 });
      const capability = f.adapter.driver.readPayloadApplication!;
      const before = capability();
      const negotiations = f.commands.filter((command) =>
        command.startsWith('InverseSolution('),
      ).length;
      await f.adapter.connect();
      await f.adapter.stop();
      await f.adapter.pause();
      await f.adapter.resume();
      expect(capability()).toEqual(before);
      expect(
        f.commands.filter((command) => command.startsWith('EnableRobot(')),
      ).toHaveLength(1);
      expect(
        f.commands.filter((command) => command.startsWith('InverseSolution(')),
      ).toHaveLength(negotiations);
    } finally {
      await f.cleanup();
    }
  });
  it('restores workstation recovery without reconnecting or reapplying the MG400 payload', async () => {
    const f = await controller();
    const profiles = await fixture();
    try {
      await profiles.store.putRobot({
        ...profiles.robot,
        adapterId: f.adapter.id,
        connectionIdentity: f.adapter.connectionIdentity,
      });
      const tool = await profiles.store.putTool({
        ...profiles.tool,
        payload: { massKg: 0.1 },
      });
      const runtime = new RobotArmRuntime({
        adapter: f.adapter,
        profileStore: profiles.store,
        auditStore: profiles.auditStore,
      });
      await runtime.initialize();
      await runtime.lifecycle('enable', {
        ...profiles.binding,
        toolRevision: tool.revision,
      });
      const before = (await runtime.state()).appliedPayload;
      await runtime.stop();
      const afterStopCommands = f.commands.length;
      await runtime.recover();
      const state = await runtime.readiness();
      expect(state.recoveryRequired).toBe(false);
      expect(state.payloadApplication?.status).toBe('applied');
      expect(state.appliedPayload).toEqual(before);
      expect(
        f.commands
          .slice(afterStopCommands)
          .some((command) =>
            /^(EnableRobot|DisableRobot|SetPayLoad|InverseSolution)\(/.test(
              command,
            ),
          ),
      ).toBe(false);
    } finally {
      await f.cleanup();
      await profiles.cleanup();
    }
  });
  it('does not restore confirmation after an unexpected channel loss and reconnect to the same controller', async () => {
    const f = await controller();
    try {
      await f.adapter.connect();
      await f.adapter.enable({ massKg: 0.1 });
      f.dropConnections();
      const evidence = f.adapter.driver.readPayloadApplication!;
      const deadline = Date.now() + 1000;
      while (evidence().status === 'confirmed' && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 5));
      expect(evidence()).toMatchObject({
        status: 'unconfirmed',
        reason: 'connection-lost',
      });
      await f.adapter.connect();
      expect(evidence().status).toBe('unconfirmed');
      expect((await f.adapter.getState()).enabled).toBe(true);
      expect(f.adapter.driver.appliedPayload!()).toBeUndefined();
    } finally {
      await f.cleanup();
    }
  });
  it('invalidates application on measured disable and emergency stop', async () => {
    const f = await controller();
    try {
      await f.adapter.connect();
      await f.adapter.enable({ massKg: 0.1 });
      f.setEnabled(false);
      await f.adapter.driver.getState({ fresh: true });
      const evidence = f.adapter.driver.readPayloadApplication!;
      expect(evidence()).toMatchObject({
        status: 'unconfirmed',
        reason: 'disabled',
      });
      await f.adapter.enable({ massKg: 0.1 });
      await f.adapter.emergencyStop();
      expect(evidence()).toMatchObject({
        status: 'unconfirmed',
        reason: 'emergency-stop',
      });
    } finally {
      await f.cleanup();
    }
  });
  it('does not retain application when Stop cannot be confirmed', async () => {
    const f = await controller({
      holdResetReply: true,
      adapter: { commandTimeoutMs: 100 },
    });
    try {
      await f.adapter.connect();
      await f.adapter.enable({ massKg: 0.1 });
      await expect(f.adapter.stop()).rejects.toThrow();
      expect(f.adapter.driver.readPayloadApplication!().status).toBe(
        'unconfirmed',
      );
      expect(f.adapter.driver.appliedPayload!()).toBeUndefined();
    } finally {
      await f.cleanup();
    }
  });
  it('reports mode 10 as paused and enabled rather than as a fault', async () => {
    const f = await controller({ paused: true });
    try {
      await f.adapter.connect();
      const state = await f.adapter.getState();
      expect(state.paused).toBe(true);
      expect(state.enabled).toBe(true);
      expect(state.moving).toBe(false);
      expect(state.faults).toEqual([]);
    } finally {
      await f.cleanup();
    }
  });
  it('still reports mode 9 with no error codes as a fault', async () => {
    const f = await controller({ errorMode: true });
    try {
      await f.adapter.connect();
      const state = await f.adapter.getState();
      expect(state.paused).toBe(false);
      expect(state.faults.map((fault) => fault.code)).toEqual(['-9']);
    } finally {
      await f.cleanup();
    }
  });
  it('clears faults without resuming a paused controller', async () => {
    const f = await controller({ paused: true });
    try {
      await f.adapter.connect();
      expect((await f.adapter.getState()).paused).toBe(true);
      await f.adapter.clearFaults();
      const state = await f.adapter.getState();
      expect(state.paused).toBe(true);
      expect(state.faults).toEqual([]);
      const resume = f.commands.indexOf('Continue()');
      expect(
        f.httpRequests.filter((req) => req.method === 'POST'),
      ).toHaveLength(1);
      expect(f.commands).not.toContain('ClearError()');
      expect(resume).toBe(-1);
    } finally {
      await f.cleanup();
    }
  });
  it('clears a fault through Studio exchange and verifies the TCP state too', async () => {
    const f = await controller({ errorMode: true, errorCodes: [70] });
    try {
      await f.adapter.connect();
      const kernel = new RobotKernel(f.adapter);
      expect((await kernel.controllerState()).raw.alarms).toEqual([
        [70],
        [],
        [],
        [],
        [],
        null,
      ]);
      await kernel.clearFaults();
      expect((await f.adapter.driver.getState({ fresh: true })).faults).toEqual(
        [],
      );
      expect(
        f.httpRequests.find((r) => r.method === 'POST')?.body,
      ).toMatchObject({
        controlMode: 'disable',
        alarms: true,
        outputs: { enable: false },
      });
      expect(f.commands.some((c) => /EnableRobot|Continue|Mov/.test(c))).toBe(
        false,
      );
    } finally {
      await f.cleanup();
    }
  });
  it('retains fault provenance and returns the remaining limit on clear failure', async () => {
    const f = await controller({
      errorMode: true,
      errorCodes: [70],
      persistentErrors: true,
      adapter: { clearFaultsTimeoutMs: 180 },
    });
    try {
      await f.adapter.connect();
      expect(
        (await f.adapter.driver.getState({ fresh: true })).faults,
      ).toMatchObject([
        {
          code: '70',
          recoverable: false,
          raw: { group: 0, axis: 4, kind: 'joint-limit' },
        },
      ]);
      await expect(f.adapter.clearFaults()).rejects.toMatchObject({
        code: 'STATE_UNCONFIRMED',
        details: {
          transport: 'studio',
          command: 'ClearAlarms',
          lastState: { raw: { alarms: [[70], [], [], [], [], null] } },
        },
      });
      expect(f.httpRequests.filter((r) => r.method === 'POST')).toHaveLength(1);
      expect(f.commands).not.toContain('ClearError()');
    } finally {
      await f.cleanup();
    }
  });
  it('cancels Studio clear before its delayed read can overwrite state after Stop', async () => {
    const f = await controller({ errorCodes: [70], delayHttpStateMs: 200 });
    try {
      await f.adapter.connect();
      const clear = expect(f.adapter.clearFaults()).rejects.toMatchObject({
        code: 'ACTION_STOPPED',
      });
      await expect.poll(() => f.httpRequests.length).toBe(1);
      await f.adapter.stop();
      await clear;
      expect(f.httpRequests.map((r) => r.method)).toEqual(['GET']);
      expect(f.commands).toContain('ResetRobot()');
    } finally {
      await f.cleanup();
    }
  });
  it('only uses ClearError when the TCP clear transport is explicitly selected', async () => {
    const f = await controller({
      errorCodes: [70],
      adapter: { clearFaultsTransport: 'tcp' },
    });
    try {
      await f.adapter.connect();
      await f.adapter.clearFaults();
      expect(f.commands).toContain('ClearError()');
      expect(f.httpRequests).toEqual([]);
    } finally {
      await f.cleanup();
    }
  });
  it('enables inside its own window, which defaults to 15000ms', async () => {
    expect(DOBOT_MG400_DEFAULTS.enableTimeoutMs).toBe(15000);
    const impatient = await controller({
      enableDelayMs: 1200,
      adapter: { enableTimeoutMs: 300 },
    });
    try {
      await impatient.adapter.connect();
      await expect(impatient.adapter.enable()).rejects.toMatchObject({
        code: 'STATE_UNCONFIRMED',
      });
    } finally {
      await impatient.cleanup();
    }
    const patient = await controller({
      enableDelayMs: 1200,
      adapter: { enableTimeoutMs: 5000 },
    });
    try {
      await patient.adapter.connect();
      await patient.adapter.enable();
      expect((await patient.adapter.getState()).enabled).toBe(true);
    } finally {
      await patient.cleanup();
    }
  });
  it('refuses to report a paused controller as successfully enabled', async () => {
    const f = await controller({
      paused: true,
      adapter: { enableTimeoutMs: 300 },
    });
    try {
      await f.adapter.connect();
      await expect(f.adapter.enable()).rejects.toMatchObject({
        code: 'STATE_UNCONFIRMED',
      });
      expect((await f.adapter.getState()).paused).toBe(true);
    } finally {
      await f.cleanup();
    }
  });
  it('enables with mass, applies queued inertia after enable, and waits for Sync completion', async () => {
    const withPayload = await controller();
    try {
      await withPayload.adapter.connect();
      await withPayload.adapter.enable({ massKg: 0.5, inertiaKgM2: 0.01 });
      const payload = withPayload.commands.indexOf('SetPayLoad(0.5,0.01)');
      expect(payload).toBeGreaterThanOrEqual(0);
      expect(withPayload.commands.indexOf('EnableRobot(0.5)')).toBeLessThan(
        payload,
      );
      expect(withPayload.commands.indexOf('Sync()')).toBeGreaterThan(payload);
      expect(withPayload.adapter.driver.appliedPayload?.()?.payload).toEqual({
        massKg: 0.5,
        inertiaKgM2: 0.01,
      });
    } finally {
      await withPayload.cleanup();
    }
    const without = await controller();
    try {
      await without.adapter.connect();
      await without.adapter.enable();
      expect(without.commands.some((c) => c.startsWith('SetPayLoad'))).toBe(
        false,
      );
    } finally {
      await without.cleanup();
    }
  });
  it('rejects an out-of-range payload instead of defaulting', () => {
    const host = { host: '127.0.0.1' };
    for (const payload of [
      { massKg: 0.9 },
      { massKg: 1.5 },
      { massKg: -0.1 },
      { massKg: Number.NaN },
      { massKg: 0.1, inertiaKgM2: -1 },
      { massKg: 0.1, inertiaKgM2: Number.POSITIVE_INFINITY },
    ])
      expect(codeOf(() => validateMg400Payload(payload))).toBe(
        'INVALID_CONFIG',
      );
    // The rated maximum itself is allowed.
    expect(() => validateMg400Payload({ massKg: 0.75 })).not.toThrow();
    expect(
      codeOf(
        () =>
          new Mg400Adapter({
            ...host,
            payload: { massKg: 0.1 },
          } as Mg400Options),
      ),
    ).toBe('INVALID_CONFIG');
  });
  it('mass-only enable does not guess inertia or submit a queued load command', async () => {
    const f = await controller();
    try {
      await f.adapter.connect();
      await f.adapter.enable({ massKg: 0.1 });
      expect(f.commands).toContain('EnableRobot(0.1)');
      expect(
        f.commands.some((command) => command.startsWith('SetPayLoad')),
      ).toBe(false);
      expect(f.adapter.driver.appliedPayload!()?.payload).toEqual({
        massKg: 0.1,
      });
      await expect(f.adapter.enable({ massKg: 0.2 })).rejects.toMatchObject({
        code: 'PAYLOAD_REQUIRES_DISABLED',
      });
      await f.adapter.disable();
      expect(f.adapter.driver.appliedPayload!()).toBeUndefined();
    } finally {
      await f.cleanup();
    }
  });
  it('does not report applied inertia until Sync completes', async () => {
    const f = await controller({ syncDelayMs: 250 });
    try {
      await f.adapter.connect();
      const enabling = f.adapter.enable({ massKg: 0.1, inertiaKgM2: 0.01 });
      enabling.catch(() => undefined);
      const deadline = Date.now() + 2000;
      while (!f.commands.includes('Sync()') && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 5));
      expect(f.commands).toContain('Sync()');
      expect(f.adapter.driver.appliedPayload!()).toBeUndefined();
      await enabling;
      expect(f.adapter.driver.appliedPayload!()).toBeDefined();
    } finally {
      await f.cleanup();
    }
  });
  it.each(['rejectPayload', 'rejectSync'] as const)(
    'rejects %s and leaves payload unconfirmed',
    async (failure) => {
      const f = await controller({ [failure]: true });
      try {
        await f.adapter.connect();
        await expect(
          f.adapter.enable({ massKg: 0.1, inertiaKgM2: 0.01 }),
        ).rejects.toMatchObject({ code: 'VENDOR_ERROR' });
        expect(f.commands).toContain('ResetRobot()');
        expect(f.adapter.driver.appliedPayload!()).toBeUndefined();
      } finally {
        await f.cleanup();
      }
    },
  );
  it('Sync timeout clears the queue and does not report an applied payload', async () => {
    const f = await controller({
      syncDelayMs: 500,
      adapter: { enableTimeoutMs: 80 },
    });
    try {
      await f.adapter.connect();
      await expect(
        f.adapter.enable({ massKg: 0.1, inertiaKgM2: 0.01 }),
      ).rejects.toThrow();
      expect(f.commands).toContain('ResetRobot()');
      expect(f.adapter.driver.appliedPayload!()).toBeUndefined();
    } finally {
      await f.cleanup();
    }
  });
  it('Stop interrupts pending inertia and prevents a later applied record', async () => {
    const f = await controller({ syncDelayMs: 500 });
    try {
      await f.adapter.connect();
      const enabling = f.adapter.enable({ massKg: 0.1, inertiaKgM2: 0.01 });
      enabling.catch(() => undefined);
      const deadline = Date.now() + 2000;
      while (!f.commands.includes('Sync()') && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 5));
      expect(f.commands).toContain('Sync()');
      await f.adapter.stop();
      await expect(enabling).rejects.toThrow();
      expect(f.adapter.driver.appliedPayload!()).toBeUndefined();
    } finally {
      await f.cleanup();
    }
  });
  it('pauses, resumes and emergency-stops with a confirming command each', async () => {
    const f = await controller();
    try {
      await f.adapter.connect();
      await f.adapter.enable();
      await f.adapter.pause();
      expect(f.commands).toContain('ResetRobot()');
      expect((await f.adapter.driver.getState({ fresh: true })).motion).toBe(
        'paused',
      );
      await f.adapter.resume();
      expect((await f.adapter.driver.getState({ fresh: true })).motion).toBe(
        'idle',
      );
      await f.adapter.emergencyStop();
      expect(f.commands).toContain('EmergencyStop()');
      expect((await f.adapter.getState()).moving).toBe(false);
    } finally {
      await f.cleanup();
    }
  });
  it('emergency-stops even when the controller then reports a fault code', async () => {
    const f = await controller({ estopErrorCodes: [-3] });
    try {
      await f.adapter.connect();
      await f.adapter.enable();
      await expect(f.adapter.emergencyStop()).resolves.toBeUndefined();
      const state = await f.adapter.getState();
      expect(state.moving).toBe(false);
      expect(state.faults.map((fault) => fault.code)).toContain('-3');
    } finally {
      await f.cleanup();
    }
  });
});

describe('MG400 firmware dialect tolerance', () => {
  it.each([
    ['1,2,3,4', [1, 2, 3, 4]],
    ['{1,2,3,4}', [1, 2, 3, 4]],
    [
      '2.171181,-0.465307,-10.172989,-2.134094,0.000000,0.000000',
      [2.171181, -0.465307, -10.172989, -2.134094],
    ],
    ['1,2,3,4,-0.000000,0e0', [1, 2, 3, 4]],
    ['j1:1,j2:2,j3:3,j4:4', [1, 2, 3, 4]],
    ['{J1=+1e-3,J2=-2,J3=.3,J4=4.}', [0.001, -2, 0.3, 4]],
  ])('normalizes the explicitly supported GetAngle body %s', (body, joints) => {
    expect(parseMg400GetAngle(body as string)).toEqual(joints);
  });
  it.each([
    '',
    '1,2,3',
    '1,2,3,4,0',
    '1,2,3,4,0,0,0',
    '1,2,3,4,0.000001,0',
    '1,2,3,4,0,-1',
    '1,,3,4',
    '1,2,3,NaN',
    '1,2,3,Infinity',
    '1,2,3,1e999',
    '1,2,3,4,,0',
    '1,2,3,4,0,Infinity',
    '1,2,3,0x10',
    'j1:1,j2:2,j3:3,j4:NaN',
    'j1:1,j2:2,j3:3,j4:4,j5:0,j6:0',
    'j1:1,j2:2,j3:3,j4:4garbage',
    'j1:1,j2:2,j2:3,j4:4',
  ])('rejects unknown or invalid GetAngle body %s', (body) => {
    expect(() => parseMg400GetAngle(body)).toThrowError(
      expect.objectContaining({
        code: 'PROTOCOL_ERROR',
        details: expect.objectContaining({ command: 'GetAngle()', body }),
      }),
    );
  });
  it('keeps inverse kinematics and Cartesian pose strict rather than truncating six fields', () => {
    expect(() => parseMg400Joints('1,2,3,4,0,0')).toThrow();
    expect(() => parseMg400Pose('1,2,3,4,0,0')).toThrow();
    expect(() =>
      parseMg400Response('-1,{1,2,3,4,0,0},GetAngle();', 'GetAngle()'),
    ).toThrowError(expect.objectContaining({ code: 'VENDOR_ERROR' }));
    expect(() =>
      parseMg400Response('0,{1,2,3,4,0,0},InverseSolution();', 'GetAngle()'),
    ).toThrowError(expect.objectContaining({ code: 'PROTOCOL_ERROR' }));
  });
  it('uses four joints through connection, FK fallback, state reads and measured motion completion', async () => {
    const f = await controller({
      getAnglePadding: [0, 0],
      rejectNamedGetPose: true,
    });
    try {
      await f.adapter.connect();
      const kernel = new RobotKernel(f.adapter);
      expect((await kernel.readJoints()).values).toEqual([1, 2, 3, 4]);
      expect((await f.adapter.getPose()).positionMm).toEqual({
        x: 11.5,
        y: -2.25,
        z: 33.75,
      });
      expect(
        f.commands.some(
          (command) => command === 'PositiveSolution(1,2,3,4,0,0)',
        ),
      ).toBe(true);
      await f.adapter.enable();
      const handle = await f.adapter.driver.moveJoints!([5, 6, 7, 8], {
        speed: { kind: 'ratio', value: 0.1 },
        acceleration: { kind: 'ratio', value: 0.1 },
      });
      expect((await handle.wait()).status).toBe('completed');
      expect((await kernel.readJoints()).values).toEqual([5, 6, 7, 8]);
      expect(
        f.commands.some((command) =>
          command.startsWith('JointMovJ(5,6,7,8,SpeedJ='),
        ),
      ).toBe(true);
    } finally {
      await f.cleanup();
    }
  });
  it('retains the full GetAngle reply and field count when initialization rejects nonzero padding', async () => {
    const f = await controller({ getAnglePadding: [0, 1] });
    try {
      await expect(f.adapter.connect()).rejects.toMatchObject({
        code: 'PROTOCOL_ERROR',
        details: {
          command: 'GetAngle()',
          response: '0,{1,2,3,4,0,1},GetAngle();',
          fieldCount: 6,
        },
      });
      await expect(f.adapter.getState()).rejects.toMatchObject({
        code: 'DISCONNECTED',
      });
      expect(f.commands).not.toContain('EnableRobot()');
    } finally {
      await f.cleanup();
    }
  });
  it('accepts an ErrorID-prefixed GetErrorID() reply', async () => {
    const f = await controller({
      errorIdNamedPrefix: true,
      errorCodes: [-2],
      errorIdGroups: 5,
    });
    try {
      await f.adapter.connect();
      const state = await f.adapter.getState();
      expect(state.faults.map((fault) => fault.code)).toEqual(['-2']);
    } finally {
      await f.cleanup();
    }
  });
  it('accepts a flat error-code group from an ErrorID-prefixed reply', () => {
    expect(
      parseMg400ErrorIdResponse('ErrorID,{[-2,0]},GetErrorID();').codes,
    ).toEqual([-2]);
    // The trailing semicolon is optional in the documented dialect.
    expect(parseMg400ErrorIdResponse('0,{[-2,0]},GetErrorID()').codes).toEqual([
      -2,
    ]);
  });
  it('rejects an unexpected error-code group count and names it', async () => {
    for (const groups of [4, 8]) {
      const reply = `0,{${JSON.stringify(
        Array.from({ length: groups }, (_, index) => (index === 0 ? [-2] : [])),
      )}},GetErrorID();`;
      let thrown: { code?: string; message?: string } | undefined;
      try {
        parseMg400ErrorIdResponse(reply);
      } catch (error) {
        thrown = error as { code?: string; message?: string };
      }
      expect(thrown?.code).toBe('PROTOCOL_ERROR');
      expect(thrown?.message).toContain(String(groups));
      // Through the adapter too. connect() performs the first state read, so
      // that is where a bad group count surfaces first.
      const f = await controller({ errorIdGroups: groups, errorCodes: [-2] });
      try {
        await expect(f.adapter.connect()).rejects.toMatchObject({
          code: 'PROTOCOL_ERROR',
          message: expect.stringContaining(String(groups)),
        });
      } finally {
        await f.cleanup();
      }
    }
  });
  it('still rejects an unknown prefix on a motion command', () => {
    // The tolerance is deliberately scoped to GetErrorID(): a motion ACK must
    // not be accepted just because some other command answers that way.
    expect(
      codeOf(() => parseMg400Response('ErrorID,{},MovL();', 'MovL()')),
    ).toBe('PROTOCOL_ERROR');
  });
  it('rejects a motion ACK with an unknown prefix end to end', async () => {
    const f = await controller({ motionReplyNamedPrefix: true });
    try {
      await f.adapter.connect();
      await f.adapter.enable();
      await expect(
        f.adapter.moveLinear(pose(150, 0, 80)),
      ).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
    } finally {
      await f.cleanup();
    }
  });
  it('accepts a keyed GetAngle() and a keyed pose on the kinematic path', async () => {
    const f = await controller({
      rejectNamedGetPose: true,
      keyedGetAngle: true,
      keyedPose: true,
    });
    try {
      await f.adapter.connect();
      // The named form is rejected with -30001, so the adapter switches to
      // GetAngle() + PositiveSolution() and must read both keyed replies.
      expect((await f.adapter.getPose()).positionMm).toEqual({
        x: 11.5,
        y: -2.25,
        z: 33.75,
      });
      expect(f.commands).toContain('GetAngle()');
      expect(f.commands.some((c) => c.startsWith('PositiveSolution('))).toBe(
        true,
      );
    } finally {
      await f.cleanup();
    }
  });
  it('parses keyed and flat joint and pose bodies directly', () => {
    expect(parseMg400Joints('j1:1,j2:2,j3:3,j4:4')).toEqual([1, 2, 3, 4]);
    expect(parseMg400Joints('1,2,3,4')).toEqual([1, 2, 3, 4]);
    expect(codeOf(() => parseMg400Joints('1,2,3'))).toBe('PROTOCOL_ERROR');
    expect(parseMg400Pose('x:1,y:2,z:3,r:90').positionMm).toEqual({
      x: 1,
      y: 2,
      z: 3,
    });
    // `max:` must not be mistaken for the `x` field.
    expect(codeOf(() => parseMg400Pose('max:1,y:2,z:3,r:4'))).toBe(
      'PROTOCOL_ERROR',
    );
  });
});

describe('MG400 reachability pre-check', () => {
  it('asks the controller before sending the motion', async () => {
    const f = await controller();
    try {
      await f.adapter.connect();
      await f.adapter.enable();
      const handle = await f.adapter.moveLinear(pose(150, 0, 80));
      const query = f.commands.findIndex((c) =>
        c.startsWith('InverseSolution('),
      );
      const motion = f.commands.findIndex((c) => c.startsWith('MovL('));
      expect(query).toBeGreaterThanOrEqual(0);
      expect(motion).toBeGreaterThan(query);
      expect((await handle.wait()).status).toBe('completed');
      expect(f.adapter.reachabilityStatus()).toMatchObject({
        verified: 1,
        rejected: 0,
        unchecked: 0,
      });
    } finally {
      await f.cleanup();
    }
  });
  it('refuses an unreachable target without sending any motion', async () => {
    const f = await controller({ inverseSolution: 'reject' });
    try {
      await f.adapter.connect();
      await f.adapter.enable();
      await expect(
        f.adapter.moveLinear(pose(999, 0, 80)),
      ).rejects.toMatchObject({ code: 'UNREACHABLE_TARGET' });
      expect(f.commands.some((c) => c.startsWith('MovL('))).toBe(false);
      expect(f.adapter.reachabilityStatus().rejected).toBe(1);
    } finally {
      await f.cleanup();
    }
  });
  for (const dialect of ['malformed', 'silent'] as const)
    it(`blocks motion after ${dialect} reachability response`, async () => {
      const f = await controller({ inverseSolution: dialect });
      try {
        await f.adapter.connect();
        await f.adapter.enable();
        await expect(
          f.adapter.moveLinear(pose(150, 0, 80)),
        ).rejects.toMatchObject({
          code: dialect === 'silent' ? 'COMMAND_TIMEOUT' : 'PROTOCOL_ERROR',
        });
        expect(f.commands.some((command) => command.startsWith('MovL('))).toBe(
          false,
        );
        expect(f.adapter.reachabilityStatus().unchecked).toBe(0);
      } finally {
        await f.cleanup();
      }
    });
  it('only skips a query explicitly rejected as unsupported by firmware', async () => {
    const f = await controller({ inverseSolution: 'unsupported' });
    try {
      await f.adapter.connect();
      await f.adapter.enable();
      expect(
        (await (await f.adapter.moveLinear(pose(150, 0, 80))).wait()).status,
      ).toBe('completed');
      expect(f.adapter.reachabilityStatus().unchecked).toBe(1);
      expect(f.adapter.driver.inverseKinematics).toBeUndefined();
    } finally {
      await f.cleanup();
    }
  });
  it('skips the query entirely when reachability verification is off', async () => {
    const f = await controller({
      adapter: { verifyReachability: false },
    });
    try {
      await f.adapter.connect();
      await f.adapter.enable();
      const handle = await f.adapter.moveLinear(pose(150, 0, 80));
      expect((await handle.wait()).status).toBe('completed');
      // Startup negotiates read-only IK support; disabling reachability skips motion-time queries.
      expect(
        f.commands.filter((c) => c.startsWith('InverseSolution(')),
      ).toHaveLength(1);
      expect(f.adapter.reachabilityStatus()).toMatchObject({
        verified: 0,
        rejected: 0,
        unchecked: 0,
      });
    } finally {
      await f.cleanup();
    }
  });
  it('checks targets without inventing a Cartesian envelope', async () => {
    const f = await controller();
    try {
      // No invented reach box: the reference has no Cartesian envelope and
      // deriving one would put an unverified number in a safety path.
      expect(f.adapter.kinematics.workspace).toBeUndefined();
      const kernel = new RobotKernel(f.adapter);
      await kernel.connect();
      await kernel.enable();
      await kernel.preflightCartesian('linear', pose(150, 0, 80), {
        speed: { kind: 'ratio', value: 0.1 },
        acceleration: { kind: 'ratio', value: 0.1 },
      });
      expect(f.commands.some((c) => c.startsWith('MovL('))).toBe(false);
    } finally {
      await f.cleanup();
    }
  });
});

for (const dialect of ['unsupported', 'malformed', 'silent'] as const)
  it(`does not allow unbounded kernel motion with ${dialect} IK checks`, async () => {
    const f = await controller({ inverseSolution: dialect });
    try {
      const kernel = new RobotKernel(f.adapter);
      await kernel.connect();
      await kernel.enable();
      await expect(
        kernel.moveLinear(pose(150, 0, 80), {
          speed: { kind: 'ratio', value: 0.1 },
          acceleration: { kind: 'ratio', value: 0.1 },
        }),
      ).rejects.toMatchObject({
        code:
          dialect === 'unsupported'
            ? 'REACHABILITY_UNAVAILABLE'
            : dialect === 'silent'
              ? 'COMMAND_TIMEOUT'
              : 'PROTOCOL_ERROR',
      });
      expect(f.commands.some((c) => c.startsWith('MovL('))).toBe(false);
    } finally {
      await f.cleanup();
    }
  });

describe('MG400 bounded state reads', () => {
  const stateCommands = (commands: string[]): number =>
    commands.filter((c) => /^(RobotMode|GetErrorID|GetPose)\(/.test(c)).length;

  it('bounds reads by default, and 0 disables the bound', () => {
    expect(DOBOT_MG400_DEFAULTS.statePollIntervalMs).toBe(200);
    expect(DOBOT_MG400_DEFAULTS.verifyReachability).toBe(true);
    expect(
      codeOf(() => new Mg400Adapter({ host: 'h', statePollIntervalMs: -1 })),
    ).toBe('INVALID_CONFIG');
  });
  it('collapses repeated reads onto one dashboard refresh', async () => {
    const uncached = await controller({ adapter: { statePollIntervalMs: 0 } });
    const cached = await controller({ adapter: { statePollIntervalMs: 200 } });
    try {
      await uncached.adapter.connect();
      await cached.adapter.connect();
      const uncachedStart = stateCommands(uncached.commands);
      const cachedStart = stateCommands(cached.commands);
      for (let i = 0; i < 6; i++) {
        await uncached.adapter.getState();
        await cached.adapter.getState();
      }
      const uncachedUsed = stateCommands(uncached.commands) - uncachedStart;
      const cachedUsed = stateCommands(cached.commands) - cachedStart;
      // Uncached: every read is RobotMode + GetErrorID + GetPose.
      expect(uncachedUsed).toBeGreaterThanOrEqual(18);
      expect(cachedUsed).toBeLessThanOrEqual(uncachedUsed / 2);
    } finally {
      await uncached.cleanup();
      await cached.cleanup();
    }
  });
  it('pipes state queries only when the option is enabled', async () => {
    const plain = await controller();
    const piped = await controller({
      adapter: { pipelineStateQueries: true },
    });
    try {
      await plain.adapter.connect();
      await piped.adapter.connect();
      // A complete batch is one write; the default path sends three commands.
      expect(plain.batchWrites).toHaveLength(0);
      expect(piped.batchWrites.length).toBeGreaterThan(0);
      await expect(piped.adapter.getStateFresh()).resolves.toMatchObject({
        connected: true,
      });
    } finally {
      await plain.cleanup();
      await piped.cleanup();
    }
  });
  it('stops polling an idle bench and restarts on the next read', async () => {
    const f = await controller({ adapter: { statePollIntervalMs: 30 } });
    try {
      await f.adapter.connect();
      await f.adapter.getState();
      // Let the poller exceed its idle threshold (3 intervals) with no readers.
      await new Promise((r) => setTimeout(r, 400));
      const idleStart = stateCommands(f.commands);
      await new Promise((r) => setTimeout(r, 300));
      expect(stateCommands(f.commands)).toBe(idleStart);
      // One read brings it back.
      await f.adapter.getState();
      await new Promise((r) => setTimeout(r, 200));
      expect(stateCommands(f.commands)).toBeGreaterThan(idleStart);
    } finally {
      await f.cleanup();
    }
  });
  it('never confirms enable() from a cached no-fault sample', async () => {
    const f = await controller({ adapter: { enableTimeoutMs: 200 } });
    try {
      await f.adapter.connect();
      await f.adapter.enable();
      // Prime the cache while the controller is healthy...
      expect((await f.adapter.getState()).faults).toEqual([]);
      // ...then make the controller faulty behind the adapter's back.
      f.injectFault(-2);
      // The predicate must consult a fresh read, or the primed sample would
      // satisfy "enabled and fault-free" and enable() would wrongly succeed.
      await expect(f.adapter.enable()).rejects.toMatchObject({
        code: 'STATE_UNCONFIRMED',
      });
      expect(
        (await f.adapter.getState()).faults.map((fault) => fault.code),
      ).toEqual(['-2']);
    } finally {
      await f.cleanup();
    }
  });
  it('drops the cached sample whenever a command can change state', async () => {
    // A 5s interval makes the point sharp: without invalidation the pre-command
    // sample would still be reused and would still say "paused".
    const f = await controller({
      paused: true,
      adapter: { statePollIntervalMs: 5000 },
    });
    try {
      await f.adapter.connect();
      expect((await f.adapter.getState()).paused).toBe(true);
      await f.adapter.resume();
      expect((await f.adapter.getState()).paused).toBe(false);
    } finally {
      await f.cleanup();
    }
  });
  it('reports the sample age only while the bound is active', async () => {
    const bounded = await controller({ adapter: { statePollIntervalMs: 200 } });
    const unbounded = await controller({
      adapter: { statePollIntervalMs: 0 },
    });
    try {
      await bounded.adapter.connect();
      await unbounded.adapter.connect();
      const age = bounded.adapter.feedbackStatus().stateSampleAgeMs;
      expect(typeof age).toBe('number');
      expect(age).toBeGreaterThanOrEqual(0);
      expect(
        unbounded.adapter.feedbackStatus().stateSampleAgeMs,
      ).toBeUndefined();
    } finally {
      await bounded.cleanup();
      await unbounded.cleanup();
    }
  });
});

it('MG400 joint motion uses joint units and confirms fresh measured arrival', async () => {
  const f = await controller();
  try {
    await f.adapter.connect();
    await f.adapter.enable();
    const handle = await f.adapter.driver.moveJoints!([5, 6, 7, 8], {
      speed: { kind: 'ratio', value: 0.1 },
      acceleration: { kind: 'ratio', value: 0.1 },
    });
    expect((await handle.wait({ timeoutMs: 2000 })).status).toBe('completed');
    expect(
      f.commands.some((c) =>
        c.startsWith('JointMovJ(5,6,7,8,SpeedJ=10,AccJ=10'),
      ),
    ).toBe(true);
    expect(
      (await f.adapter.driver.readJoints!({ fresh: true })).values,
    ).toEqual([5, 6, 7, 8]);
  } finally {
    await f.cleanup();
  }
});

const until = async (condition: () => boolean) => {
  const deadline = Date.now() + 1500;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Fixture condition timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};
for (const kind of ['stop', 'pause'] as const)
  it(`MG400 emergency upgrades pending ${kind} and bypasses blocked reset acknowledgement`, async () => {
    const f = await controller({
      holdResetReply: true,
      adapter: { statePollIntervalMs: 0 },
    });
    const profileDirectory = await mkdtemp(
      path.join(tmpdir(), 'mg400-runtime-profile-'),
    );
    const runtime = new RobotArmRuntime({
      adapter: f.adapter,
      profileStore: new ProfileStore(
        path.join(profileDirectory, 'profiles.json'),
      ),
    });
    try {
      await runtime.connect();
      await runtime.enable();
      const lower = runtime[kind]();
      const lowerOutcome = lower.catch((error) => error);
      await until(() => f.commands.includes('ResetRobot()'));
      await runtime.emergencyStop();
      await lowerOutcome;
      expect(f.commands).toContain('EmergencyStop()');
      expect((await runtime.state()).recoveryRequired).toBe(true);
      expect(f.commands.some((c) => c.startsWith('Mov'))).toBe(false);
    } finally {
      await f.cleanup();
      await rm(profileDirectory, { recursive: true, force: true });
    }
  });
it('MG400 stop reconnects control while an ordinary state query is blocked', async () => {
  const f = await controller({ adapter: { statePollIntervalMs: 0 } });
  try {
    await f.adapter.connect();
    await f.adapter.enable();
    f.blockNextMode();
    const reading = f.adapter.driver.getState({ fresh: true });
    const outcome = reading.catch((error) => error);
    await until(() => f.modeIsBlocked());
    await f.adapter.stop();
    expect((await outcome).code).toBe('QUERY_INTERRUPTED');
    expect(f.commands).toContain('ResetRobot()');
    expect((await f.adapter.driver.getState({ fresh: true })).motion).toBe(
      'idle',
    );
  } finally {
    await f.cleanup();
  }
});
it('MG400 late replies from a timed-out socket cannot satisfy reconnect queries', async () => {
  const f = await controller({
    adapter: { commandTimeoutMs: 60, statePollIntervalMs: 0 },
  });
  try {
    await f.adapter.connect();
    await f.adapter.enable();
    f.delayNextMode(200);
    await expect(
      f.adapter.driver.getState({ fresh: true }),
    ).rejects.toMatchObject({ code: 'COMMAND_TIMEOUT' });
    await f.adapter.connect();
    await new Promise((r) => setTimeout(r, 220));
    expect((await f.adapter.driver.getState({ fresh: true })).enablement).toBe(
      'enabled',
    );
  } finally {
    await f.cleanup();
  }
});

describe('MG400 external Drag Mode changes', () => {
  it('refreshes the motion connection before the first move after a physical drag exit', async () => {
    const f = await controller({ dragMode: true });
    try {
      f.setEnabled(true);
      await f.adapter.connect();
      expect((await f.adapter.getState()).dragMode).toBe(true);
      const connections = { ...f.connections };
      f.setDrag(false);
      const handle = await f.adapter.moveLinear(pose(150, 10, 80));
      await expect(handle.wait()).resolves.toMatchObject({
        status: 'completed',
      });
      expect(f.connections).toEqual({
        dashboard: connections.dashboard,
        motion: connections.motion + 1,
      });
      expect(f.commands).not.toContain('StopDrag()');
      expect(
        f.commands.filter((command) => command === 'ResetRobot()'),
      ).toHaveLength(1);
      expect(f.commands.indexOf('ResetRobot()')).toBeLessThan(
        f.commands.findIndex((command) => command.startsWith('MovL(')),
      );
    } finally {
      await f.cleanup();
    }
  });
  it('skips StopDrag when the operator already exited, using a fresh state instead of cached Drag Mode', async () => {
    const f = await controller({ dragMode: true });
    try {
      await f.adapter.connect();
      expect((await f.adapter.getState()).dragMode).toBe(true);
      f.setDrag(false);
      f.setEnabled(true);
      await expect(f.adapter.exitDragMode()).resolves.toBeUndefined();
      expect(f.commands).not.toContain('StopDrag()');
      expect((await f.adapter.getState()).dragMode).toBe(false);
    } finally {
      await f.cleanup();
    }
  });
  it('sends StopDrag and confirms the measured state when still dragging', async () => {
    const f = await controller({ dragMode: true });
    try {
      f.setEnabled(true);
      await f.adapter.connect();
      const connections = { ...f.connections };
      await f.adapter.exitDragMode();
      expect(f.commands).toContain('StopDrag()');
      expect(f.connections).toEqual({
        dashboard: connections.dashboard,
        motion: connections.motion + 1,
      });
      expect(
        f.commands.filter((command) => command === 'ResetRobot()'),
      ).toHaveLength(1);
      expect(f.commands.indexOf('StopDrag()')).toBeLessThan(
        f.commands.indexOf('ResetRobot()'),
      );
      expect((await f.adapter.getState()).dragMode).toBe(false);
      const handle = await f.adapter.moveLinear(pose(150, 10, 80));
      await expect(handle.wait()).resolves.toMatchObject({
        status: 'completed',
      });
    } finally {
      await f.cleanup();
    }
  });
  it('reconciles an external exit that races StopDrag without retrying the command', async () => {
    const f = await controller({ dragMode: true, exitBeforeStopDrag: true });
    try {
      f.setEnabled(true);
      await f.adapter.connect();
      await expect(f.adapter.exitDragMode()).resolves.toBeUndefined();
      expect(
        f.commands.filter((command) => command === 'StopDrag()'),
      ).toHaveLength(1);
      expect((await f.adapter.getState()).dragMode).toBe(false);
    } finally {
      await f.cleanup();
    }
  });
  it('does not suppress an actual StopDrag rejection while still dragging', async () => {
    const f = await controller({ dragMode: true, rejectStopDrag: true });
    try {
      await f.adapter.connect();
      await expect(f.adapter.exitDragMode()).rejects.toMatchObject({
        code: 'VENDOR_ERROR',
      });
      expect((await f.adapter.getState()).dragMode).toBe(true);
    } finally {
      await f.cleanup();
    }
  });
  it('does not report a successful exit from a faulted controller', async () => {
    const f = await controller({ errorMode: true, errorCodes: [42] });
    try {
      await f.adapter.connect();
      await expect(f.adapter.exitDragMode()).rejects.toMatchObject({
        code: 'DRAG_UNCONFIRMED',
      });
      expect(f.commands).not.toContain('StopDrag()');
    } finally {
      await f.cleanup();
    }
  });
});

describe('MG400 authoritative Cartesian motion', () => {
  const targets = [
    {
      pose: pose(10, 20, 30),
      options: {
        speed: { kind: 'ratio' as const, value: 0.2 },
        acceleration: { kind: 'ratio' as const, value: 0.2 },
      },
    },
    {
      pose: pose(10, 20, 35),
      options: {
        speed: { kind: 'ratio' as const, value: 0.4 },
        acceleration: { kind: 'ratio' as const, value: 0.4 },
      },
    },
  ];
  it('releases after measured Base arrival without blocking on a contact Sync', async () => {
    const c = await controller({ arrivalDelayMs: 15, syncDelayMs: 600 });
    try {
      await c.adapter.connect();
      await c.adapter.enable();
      c.commands.length = 0;
      const capability = c.adapter.driver.beginLinearSequence!;
      const sequence = await capability(targets, { timeoutMs: 1000 });
      // All target reachability checks finish while the tool is off-screen.
      expect(
        c.commands.filter((v) => v.startsWith('InverseSolution')),
      ).toHaveLength(2);
      c.commands.length = 0;
      await sequence.submit(0);
      const arrival = await sequence.waitForHandoff();
      expect(arrival.pose.positionMm).toEqual(targets[0].pose.positionMm);
      await sequence.submit(1);
      expect(c.commands.filter((v) => v.startsWith('MovL'))).toHaveLength(2);
      expect(c.commands).not.toContain('Sync()');
      expect(c.commands.some((v) => v.startsWith('InverseSolution'))).toBe(
        false,
      );
      const result = await sequence.finish();
      expect(result.status).toBe('completed');
      expect(result.pose?.positionMm).toEqual(targets[1].pose.positionMm);
      expect(c.commands.filter((v) => v === 'Sync()')).toHaveLength(1);
      // Raw push TCP vectors remain unavailable for screen-plane timing.
      expect(c.adapter.latestToolVectorSample()).toBeUndefined();
    } finally {
      await c.cleanup();
    }
  });
  it('runs a 30 ms tap through the shared executor before final Sync confirmation', async () => {
    const c = await controller({ arrivalDelayMs: 15, syncDelayMs: 600 });
    const f = await fixture();
    try {
      await c.adapter.connect();
      await c.adapter.enable();
      c.commands.length = 0;
      const boundary = new RobotDriverBoundary(c.adapter);
      const unexpected = () => {
        throw new Error('Unexpected terminal fallback');
      };
      const host: ScreenMotionHost = {
        adapter: boundary,
        beginSequence: (prepared, ctx) =>
          boundary.beginLinearSequence(prepared, {
            timeoutMs: ctx.screen.motionTimeoutMs,
          }),
        move: unexpected,
        target: unexpected,
        preflight: unexpected,
        stable: unexpected,
        safeLift: unexpected,
        latestToolVector: () => undefined,
        hold: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      };
      const result = await executeContactPlan(
        host,
        {
          contact: targets[0].pose,
          entryLift: targets[1].pose,
          lift: targets[1].pose,
          entryOptions: targets[0].options,
          releaseOptions: targets[1].options,
          traverseOptions: targets[0].options,
          holdMs: 30,
          holdMode: 'target',
        },
        f.calibration,
        { robot: f.robot, tool: f.tool, screen: f.screen },
      );
      expect(result.executionMode).toBe('feedback-sequence');
      expect(result.targetContactMs).toBe(30);
      expect(result.releaseSubmittedAt).toBeGreaterThanOrEqual(
        result.contactStartedAt!,
      );
      expect(result.terminalConfirmedAt).toBeGreaterThan(
        result.releaseSubmittedAt!,
      );
      const moves = c.commands
        .map((command, index) => (command.startsWith('MovL') ? index : -1))
        .filter((index) => index >= 0);
      expect(moves).toHaveLength(2);
      expect(c.commands.indexOf('Sync()')).toBeGreaterThan(moves[1]);
      expect(
        c.commands
          .slice(moves[0], moves[1])
          .some((v) => v.startsWith('InverseSolution')),
      ).toBe(false);
      expect(result.timingStatus).toBe('unmeasurable');
    } finally {
      await c.cleanup();
      await f.cleanup();
    }
  });
  it('does not hand off on a motion ACK or unchanged measured coordinates', async () => {
    const c = await controller({ arrivalDelayMs: 5, freezeMeasuredPose: true });
    try {
      await c.adapter.connect();
      await c.adapter.enable();
      const sequence = await c.adapter.driver.beginLinearSequence!(targets, {
        timeoutMs: 200,
      });
      await sequence.submit(0);
      await expect(sequence.waitForHandoff()).rejects.toMatchObject({
        code: 'SEQUENCE_ARRIVAL_TIMEOUT',
      });
      expect(c.commands.filter((v) => v.startsWith('MovL'))).toHaveLength(1);
      await c.adapter.stop();
      sequence.dispose();
    } finally {
      await c.cleanup();
    }
  });
  it('dispatches sequence fault monitoring ahead of waiting pose telemetry', async () => {
    const c = await controller({ adapter: { statePollIntervalMs: 0 } });
    try {
      await c.adapter.connect();
      await c.adapter.enable();
      const sequence = await c.adapter.driver.beginLinearSequence!(targets, {
        timeoutMs: 1000,
      });
      const held = c.holdNextDashboardReply('GetPose');
      await held.requested;
      const backlog = [c.adapter.getPose(), c.adapter.getPose()];
      await new Promise((resolve) => setTimeout(resolve, 75));
      const firstWaitingRequest = c.commands.length;
      held.release();
      await Promise.all(backlog);
      expect(
        c.commands.slice(firstWaitingRequest, firstWaitingRequest + 2),
      ).toEqual(['RobotMode()', 'GetErrorID()']);
      sequence.dispose();
    } finally {
      await c.cleanup();
    }
  });
  it('queues sequence pose monitoring while a fault reply is pending', async () => {
    const c = await controller({ adapter: { statePollIntervalMs: 0 } });
    try {
      await c.adapter.connect();
      await c.adapter.enable();
      const sequence = await c.adapter.driver.beginLinearSequence!(targets, {
        timeoutMs: 1000,
      });
      const held = c.holdNextDashboardReply('GetErrorID');
      await held.requested;
      const stateRead = c.adapter.getState();
      await new Promise((resolve) => setTimeout(resolve, 65));
      const firstWaitingRequest = c.commands.length;
      held.release();
      await stateRead;
      expect(c.commands[firstWaitingRequest]).toMatch(/^GetPose\(/);
      sequence.dispose();
    } finally {
      await c.cleanup();
    }
  });
  it('refuses another submission when fresh monitoring reports a controller fault', async () => {
    const c = await controller({ arrivalDelayMs: 5 });
    try {
      await c.adapter.connect();
      await c.adapter.enable();
      const sequence = await c.adapter.driver.beginLinearSequence!(targets, {
        timeoutMs: 1000,
      });
      await sequence.submit(0);
      await sequence.waitForHandoff();
      c.injectFault();
      // Allow the independent fault monitor to observe the change.
      await new Promise((resolve) => setTimeout(resolve, 130));
      await expect(sequence.submit(1)).rejects.toMatchObject({
        code: 'ROBOT_FAULT',
      });
      expect(c.commands.filter((v) => v.startsWith('MovL'))).toHaveLength(1);
      await c.adapter.stop();
      sequence.dispose();
    } finally {
      await c.cleanup();
    }
  });
  it('prevents a delayed release after Stop invalidates the prepared sequence', async () => {
    const c = await controller({ arrivalDelayMs: 5 });
    try {
      await c.adapter.connect();
      await c.adapter.enable();
      const sequence = await c.adapter.driver.beginLinearSequence!(targets, {
        timeoutMs: 1000,
      });
      await sequence.submit(0);
      await sequence.waitForHandoff();
      await c.adapter.stop();
      await expect(sequence.submit(1)).rejects.toMatchObject({
        code: 'ACTION_STOPPED',
      });
      expect(c.commands.filter((v) => v.startsWith('MovL'))).toHaveLength(1);
      sequence.dispose();
    } finally {
      await c.cleanup();
    }
  });
});
