import assert from 'node:assert/strict';
import { test } from '@rstest/core';
import { IOSHIDAgent, IOSHIDDevice } from '../dist/index.js';
import { HIDInputSession } from '../dist/input/session.js';
import { DeviceSession } from '../dist/runtime/device-session.js';
import type { InputAction, Point } from '../dist/types.js';

const screen = {
  getFrame: async () => ({
    jpeg: Buffer.alloc(0),
    width: 1000,
    height: 2000,
    sequence: 1,
    receivedAt: Date.now(),
  }),
  close: async () => {},
};
test('Device and borrowed Agent expose navigation with cancellation preserved', async () => {
  const phone = new IOSHIDDevice();
  const calls: { action: InputAction; signal?: AbortSignal }[] = [];
  phone.execute = async (action, options) => {
    calls.push({ action, signal: options?.signal });
  };
  const signal = new AbortController().signal;
  await phone.home({ signal });
  await phone.back({ signal });
  const agent = new IOSHIDAgent(phone);
  try {
    for (const name of ['Home', 'Back']) {
      const action = agent.interface
        .actionSpace()
        .find((item) => item.name === name);
      assert.ok(action);
      await action.call(undefined, { signal } as Parameters<
        typeof action.call
      >[1]);
    }
    assert.deepEqual(
      calls.map((item) => item.action.type),
      ['home', 'back', 'home', 'back'],
    );
    assert.ok(calls.every((item) => item.signal === signal));
  } finally {
    await agent.destroy();
  }
});

test('Home sends and releases AC Home even when cancelled after press', async () => {
  for (const cancel of [false, true]) {
    const abort = new AbortController();
    const reports: { peer: string; report: number; bytes: number[] }[] = [];
    const input = new HIDInputSession(
      {
        send: async (peer: string, report: number, bytes: number[]) => {
          reports.push({ peer, report, bytes });
          if (cancel && bytes[0] === 0x23) abort.abort();
          return true;
        },
      } as unknown as ConstructorParameters<typeof HIDInputSession>[0],
      'phone',
    );
    const result = input.execute({ type: 'home' }, screen, abort.signal);
    if (cancel) await assert.rejects(result, { name: 'AbortError' });
    else await result;
    assert.deepEqual(reports, [
      { peer: 'phone', report: 4, bytes: [0x23, 0x02] },
      { peer: 'phone', report: 4, bytes: [0, 0] },
    ]);
  }
});

test('Back uses calibrated dragging from the left edge, releasing the pointer', async () => {
  const input = new HIDInputSession(
    { send: async () => true } as unknown as ConstructorParameters<
      typeof HIDInputSession
    >[0],
    'phone',
  );
  // biome-ignore lint/complexity/useLiteralKeys: Bracket access preserves type checking for non-public test hooks.
  input['mapping'] = { turn: 0, width: 1000, height: 2000 };
  // biome-ignore lint/complexity/useLiteralKeys: Bracket access preserves type checking for non-public test hooks.
  input['motion'] = { x: { a: 4, b: 0 }, y: { a: 4, b: 0 } };
  const positions: Point[] = [];
  const buttons: (number | undefined)[] = [];
  // biome-ignore lint/complexity/useLiteralKeys: Bracket access preserves type checking for non-public test hooks.
  input['moveTo'] = async (point) => {
    positions.push(point);
  };
  // biome-ignore lint/complexity/useLiteralKeys: Bracket access preserves type checking for non-public test hooks.
  input['relative'] = async (_delta, button) => {
    buttons.push(button);
  };
  await input.execute({ type: 'back' }, screen);
  assert.deepEqual(positions, [
    { x: 5, y: 900 },
    { x: 600, y: 900 },
  ]);
  assert.equal(buttons[0], 1);
  assert.equal(buttons.at(-1), 0);
});

test('navigation obeys the Host fresh-frame gate and pre-cancellation', async () => {
  let sent = 0;
  const device = new DeviceSession(
    { id: 'phone', name: 'Phone', screen: { source: 'usb' } },
    {
      getFrame: async () => {
        throw Error('no picture');
      },
      close: async () => {},
    },
    {
      execute: async () => {
        sent++;
      },
      releaseAll: async () => {},
    } as unknown as ConstructorParameters<typeof DeviceSession>[2],
    () => {},
  );
  for (const type of ['home', 'back'] as const)
    await assert.rejects(device.execute({ type }), /no picture/);
  assert.equal(sent, 0);
  const input = new HIDInputSession(
    {
      send: async () => {
        sent++;
        return true;
      },
    } as unknown as ConstructorParameters<typeof HIDInputSession>[0],
    'phone',
  );
  const abort = new AbortController();
  abort.abort();
  for (const type of ['home', 'back'] as const)
    await assert.rejects(input.execute({ type }, screen, abort.signal), {
      name: 'AbortError',
    });
  assert.equal(sent, 0);
});
