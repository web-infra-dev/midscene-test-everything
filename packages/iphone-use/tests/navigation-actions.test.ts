import assert from 'node:assert/strict';
import { test } from '@rstest/core';
import { HIDInputSession } from '../dist/hardware/input/session.js';
import { DeviceSession } from '../dist/hardware/runtime/device-session.js';
import type { InputAction, Point } from '../dist/hardware/types.js';
import { curveModel } from './fixtures/pointer-model.js';

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
test('Home sends and releases Command H even when cancelled after press', async () => {
  for (const cancel of [false, true]) {
    const abort = new AbortController();
    const reports: { peer: string; report: number; bytes: number[] }[] = [];
    const input = new HIDInputSession(
      {
        send: async (peer: string, report: number, bytes: number[]) => {
          reports.push({ peer, report, bytes });
          if (cancel && bytes[0] === 8) abort.abort();
          return true;
        },
      } as unknown as ConstructorParameters<typeof HIDInputSession>[0],
      'phone',
    );
    const result = input.execute({ type: 'home' }, screen, abort.signal);
    if (cancel) await assert.rejects(result, { name: 'AbortError' });
    else await result;
    assert.deepEqual(reports, [
      { peer: 'phone', report: 1, bytes: [8, 0, 11, 0, 0, 0, 0, 0] },
      { peer: 'phone', report: 1, bytes: [0, 0, 0, 0, 0, 0, 0, 0] },
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
  input['motion'] = curveModel({ a: 4, b: 0 }, { a: 4, b: 0 });
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

test('navigation obeys the service fresh-frame gate and pre-cancellation', async () => {
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

test('Long press holds at the requested point and releases on cancellation', async () => {
  const point = { x: 120, y: 300 };
  for (const cancel of [false, true]) {
    const abort = new AbortController();
    const reports: { report: number; bytes: number[]; at: number }[] = [];
    const positions: Point[] = [];
    const input = new HIDInputSession(
      {
        send: async (_peer: string, report: number, bytes: number[]) => {
          reports.push({ report, bytes, at: performance.now() });
          if (cancel && bytes[0] === 1) abort.abort();
          return true;
        },
      } as unknown as ConstructorParameters<typeof HIDInputSession>[0],
      'phone',
    );
    // biome-ignore lint/complexity/useLiteralKeys: Seed the verified mapping without a camera.
    input['mapping'] = { turn: 0, width: 1000, height: 2000 };
    input.moveTo = async (target) => {
      positions.push(target);
    };
    const result = input.execute(
      { type: 'longPress', point, durationMs: cancel ? 5000 : undefined },
      screen,
      abort.signal,
    );
    if (cancel) await assert.rejects(result, { name: 'AbortError' });
    else await result;
    assert.deepEqual(positions, [point]);
    assert.deepEqual(
      reports.map(({ report, bytes }) => ({ report, bytes })),
      [
        { report: 3, bytes: [1, 0, 0, 0] },
        { report: 3, bytes: [0, 0, 0, 0] },
      ],
    );
    const heldMs = reports[1].at - reports[0].at;
    if (cancel) assert.ok(heldMs < 1000, 'cancellation releases promptly');
    else assert.ok(heldMs >= 690, 'default hold is approximately 700 ms');
  }
});

test('Double tap moves once and releases any active press on cancellation', async () => {
  const point = { x: 120, y: 300 };
  for (const cancelAfterReport of [0, 2, 3]) {
    const abort = new AbortController();
    const reports: number[][] = [];
    const positions: Point[] = [];
    const input = new HIDInputSession(
      {
        send: async (_peer: string, report: number, bytes: number[]) => {
          assert.equal(report, 3);
          reports.push(bytes);
          if (reports.length === cancelAfterReport) abort.abort();
          return true;
        },
      } as unknown as ConstructorParameters<typeof HIDInputSession>[0],
      'phone',
    );
    // biome-ignore lint/complexity/useLiteralKeys: Seed the verified mapping without a camera.
    input['mapping'] = { turn: 0, width: 1000, height: 2000 };
    input.moveTo = async (target) => {
      positions.push(target);
    };
    const result = input.execute(
      { type: 'doubleTap', point },
      screen,
      abort.signal,
    );
    if (cancelAfterReport) await assert.rejects(result, { name: 'AbortError' });
    else await result;
    assert.deepEqual(positions, [point]);
    const click = [
      [1, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    assert.deepEqual(
      reports,
      cancelAfterReport === 2 ? click : [...click, ...click],
    );
  }
});
