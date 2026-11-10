import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { rstest, test } from '@rstest/core';
import sharp from 'sharp';
import { DeviceSetupSession } from '../dist/host/setup.js';
import type { IOSHIDRuntime } from '../dist/runtime/runtime.js';
import { AirPlayScreenSession } from '../dist/screen/airplay.js';
import type { AirPlaySetupInfo, DeviceConfig } from '../dist/types.js';

const realTimeout = setTimeout;
const realClearTimeout = clearTimeout;
function until(
  session: AirPlayScreenSession,
  state: AirPlaySetupInfo['state'],
) {
  if (session.getSetupInfo().state === state) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = realTimeout(() => {
      unsubscribe();
      reject(new Error(`Missing ${state}`));
    }, 2000);
    const unsubscribe = session.subscribeSetup((info) => {
      if (info.state === state) {
        realClearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

test('receiver waits without a first-frame deadline; frames, silence and process failure emit state changes', async () => {
  let child!: ChildProcess;
  const session = Reflect.construct(AirPlayScreenSession, [
    'fixture',
    'Phone',
    '/unused.key',
    () => {
      child = spawn(
        process.execPath,
        [
          fileURLToPath(
            new URL('./fixtures/airplay-receiver.mjs', import.meta.url),
          ),
        ],
        { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] },
      );
      return child;
    },
  ]) as AirPlayScreenSession;
  await Reflect.get(session, 'stream').start();
  const seen: string[] = [];
  const unsubscribe = session.subscribeSetup((info) => seen.push(info.state));
  rstest.useFakeTimers();
  try {
    await rstest.advanceTimersByTimeAsync(15000);
    assert.deepEqual(seen, ['waiting']);
    const jpeg = await sharp({
      create: { width: 8, height: 16, channels: 3, background: '#fff' },
    })
      .jpeg()
      .toBuffer();
    child.stdin!.write(
      `${JSON.stringify({ frame: jpeg.toString('base64') })}\n`,
    );
    await until(session, 'streaming');
    assert.equal((await session.getFrame()).width, 8);
    await rstest.advanceTimersByTimeAsync(5001);
    assert.equal(session.getSetupInfo().state, 'interrupted');
    child.stdin!.write(
      `${JSON.stringify({ frame: jpeg.toString('base64') })}\n`,
    );
    await until(session, 'streaming');
    child.stdin!.write(`${JSON.stringify({ fail: true })}\n`);
    await until(session, 'failed');
    assert.match(session.getSetupInfo().error!, /failed to bind/);
    assert.deepEqual(seen, [
      'waiting',
      'streaming',
      'interrupted',
      'streaming',
      'failed',
    ]);
    unsubscribe();
    await session.close();
    assert.equal(child.exitCode, 1);
  } finally {
    unsubscribe();
    await session.close();
    rstest.useRealTimers();
  }
});

test('a missing receiver is an explicit failure rather than a first-frame timeout', async () => {
  const session = Reflect.construct(AirPlayScreenSession, [
    'fixture',
    'Phone',
    '/unused.key',
    () =>
      spawn('/nonexistent-midscene-uxplay', [], {
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      }),
  ]) as AirPlayScreenSession;
  try {
    await Reflect.get(session, 'stream').start();
    await until(session, 'failed');
    assert.match(session.getSetupInfo().error!, /未找到 UxPlay/);
  } finally {
    await session.close();
  }
});

test('setup streams availability, returns no-content while waiting, and rejects confirmation without fresh video', async () => {
  let info: AirPlaySetupInfo = {
    name: 'Receiver',
    pin: '1234',
    state: 'waiting',
  };
  const listeners = new Set<(info: AirPlaySetupInfo) => void>();
  let frameCalls = 0;
  let closes = 0;
  let fresh = false;
  const preview = {
    getSetupInfo: () => info,
    subscribeSetup: (listener: (value: AirPlaySetupInfo) => void) => {
      listeners.add(listener);
      listener(info);
      return () => {
        listeners.delete(listener);
      };
    },
    getFrame: async (options?: { fresh?: boolean }) => {
      frameCalls++;
      fresh = Boolean(options?.fresh);
      return {
        jpeg: Buffer.from('jpeg'),
        width: 8,
        height: 16,
        sequence: 1,
        receivedAt: Date.now(),
      };
    },
    close: async () => {
      closes++;
    },
  };
  const config: DeviceConfig = {
    id: 'phone',
    name: 'Phone',
    screen: { source: 'airplay' },
    bluetoothPeerId: 'bt',
  };
  const setup = new DeviceSetupSession(config, {
    input: {
      status: async () => ({ hosts: [] }),
      listPeers: async () => [{ id: 'bt', reports: [1, 2, 3] }],
    },
    openScreen: async () => preview,
  } as unknown as IOSHIDRuntime);
  const server = createServer((req, res) => {
    void setup.handle(req, res, req.url!).catch((error: Error) => {
      res
        .writeHead(400, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: error.message }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown = {}) =>
    fetch(url + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Midscene-Setup': setup.id,
      },
      body: JSON.stringify(body),
    });
  const stop = new AbortController();
  try {
    await post('/select');
    const stream = await fetch(`${url}/events`, { signal: stop.signal });
    const reader = stream.body!.getReader();
    assert.match(
      new TextDecoder().decode((await reader.read()).value),
      /"state":"waiting"/,
    );
    assert.equal((await fetch(`${url}/frame`)).status, 204);
    assert.equal(frameCalls, 0);
    const rejected = await post('/confirm', {
      confirmed: true,
      bluetoothPeerId: 'bt',
    });
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json()).error, /开始屏幕镜像/);
    info = { ...info, state: 'streaming' };
    for (const listener of listeners) listener(info);
    assert.match(
      new TextDecoder().decode((await reader.read()).value),
      /"state":"streaming"/,
    );
    assert.equal((await fetch(`${url}/frame`)).status, 200);
    assert.equal(
      fresh,
      false,
      'preview can display the first available AirPlay frame',
    );
    assert.equal(
      (await post('/confirm', { confirmed: true, bluetoothPeerId: 'bt' }))
        .status,
      200,
    );
    await setup.result;
    assert.equal(fresh, true);
    const transferred = setup.takePreview();
    assert.equal(listeners.size, 0);
    await setup.close();
    assert.equal(closes, 0, 'transferred video remains owned by the device');
    await transferred!.close();
    assert.equal(closes, 1);
  } finally {
    stop.abort();
    await setup.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
