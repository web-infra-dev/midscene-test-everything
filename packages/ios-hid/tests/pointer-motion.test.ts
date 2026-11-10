import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, rstest, test } from '@rstest/core';
import sharp from 'sharp';
import { DeviceConfigStore } from '../dist/config/store.js';
import { HIDInputSession } from '../dist/input/session.js';
import {
  type PointerTurn,
  screenDeltaToPointer,
} from '../dist/pointer/mapping.js';
import {
  planRelativeDrag,
  predictMovement,
} from '../dist/pointer/motion-model.js';
import {
  compatibleMotionProfile,
  motionBinding,
} from '../dist/pointer/motion-profile.js';
import type { DeviceConfig, Point } from '../dist/types.js';

const linear = { x: { a: 1, b: 0 }, y: { a: 1, b: 0 } };
function displacement(reports: Point[], model = linear, turn: PointerTurn = 0) {
  return reports.reduce(
    (sum, report) => {
      const raw = screenDeltaToPointer(report, ((4 - turn) % 4) as PointerTurn);
      const d = predictMovement(model, raw);
      return { x: sum.x + d.x, y: sum.y + d.y };
    },
    { x: 0, y: 0 },
  );
}

test('an out-of-range ideal still advances, rather than selecting zero', () => {
  const plan = planRelativeDrag(
    { x: 0, y: 0 },
    { x: 140, y: 0 },
    300,
    linear,
    0,
  );
  assert.ok(plan.reports[0].x > 0);
  assert.ok(plan.reports.every((p) => Math.hypot(p.x, p.y) <= 8));
  assert.ok(Math.abs(displacement(plan.reports).x - 140) <= 1);
  assert.ok(plan.reports.at(-1)!.x > 0, 'no held stationary tail');
});

test('bounded duration extension preserves distance without increasing step size', () => {
  const plan = planRelativeDrag(
    { x: 0, y: 0 },
    { x: 260, y: 0 },
    300,
    linear,
    0,
  );
  assert.ok(plan.durationMs > 300 && plan.durationMs <= 608);
  assert.ok(Math.abs(displacement(plan.reports).x - 260) <= 1);
  assert.throws(
    () => planRelativeDrag({ x: 0, y: 0 }, { x: 10000, y: 0 }, 300, linear, 0),
    /timing limit/,
  );
});

test('nonlinear diagonal paths and all pointer rotations preserve their endpoints', () => {
  const model = { x: { a: 0.8, b: 0.07 }, y: { a: 0.95, b: 0.06 } };
  for (const turn of [0, 1, 2, 3] as const)
    for (const target of [
      { x: 160, y: 210 },
      { x: -160, y: 210 },
      { x: 160, y: -210 },
    ]) {
      const plan = planRelativeDrag({ x: 0, y: 0 }, target, 500, model, turn);
      const end = displacement(plan.reports, model, turn);
      assert.ok(Math.hypot(end.x - target.x, end.y - target.y) <= 1.1);
      assert.ok(plan.reports.every((p) => Math.hypot(p.x, p.y) <= 8));
    }
});

test('ordinary drags start quickly and slow down at the end', () => {
  const plan = planRelativeDrag(
    { x: 0, y: 0 },
    { x: 80, y: 0 },
    500,
    linear,
    0,
  );
  const third = Math.floor(plan.reports.length / 3);
  const first = plan.reports.slice(0, third).reduce((n, p) => n + p.x, 0);
  const last = plan.reports.slice(-third).reduce((n, p) => n + p.x, 0);
  assert.ok(first > last * 2);
  assert.throws(
    () => planRelativeDrag({ x: 0, y: 0 }, { x: 0, y: 0 }, 300, linear, 0),
    /different endpoints/,
  );
});

function fastTimers() {
  const real = globalThis.setTimeout;
  rstest
    .spyOn(globalThis, 'setTimeout')
    .mockImplementation(((
      callback: (...args: unknown[]) => void,
      delay: number,
      ...args: unknown[]
    ) => real(callback, Math.min(delay, 1), ...args)) as typeof setTimeout);
}

/** Real image differencing, simulated HID transport; never touches Bluetooth. */
function simulatedPhone(
  config: DeviceConfig,
  model = { x: { a: 0.8, b: 0.07 }, y: { a: 0.95, b: 0.06 } },
) {
  let point = { x: 350, y: 650 };
  let sequence = 0;
  let pressed = 0;
  let dropMovement = false;
  let cancel: AbortController | undefined;
  const probes: Point[] = [];
  const input = new HIDInputSession(
    {
      send: async (_peer: string, report: number, bytes: number[]) => {
        if (report === 2)
          point = {
            x: ((bytes[1] + bytes[2] * 256) / 32767) * 799,
            y: ((bytes[3] + bytes[4] * 256) / 32767) * 1199,
          };
        return true;
      },
    } as unknown as ConstructorParameters<typeof HIDInputSession>[0],
    'peer-a',
  );
  Object.assign(input, {
    mapping: { width: 800, height: 1200, turn: 0 },
    moveTo: async (p: Point) => {
      point = { ...p };
    },
    relative: async (delta: Point, buttons = 0) => {
      if (buttons) pressed++;
      else probes.push(delta);
      const d = predictMovement(model, delta);
      if (!dropMovement) point = { x: point.x + d.x, y: point.y + d.y };
      cancel?.abort();
    },
  });
  const screen = {
    getFrame: async () => ({
      jpeg: await sharp(
        Buffer.from(
          `<svg width="800" height="1200"><rect width="800" height="1200" fill="white"/><circle cx="${point.x}" cy="${point.y}" r="13" fill="#444"/></svg>`,
        ),
      )
        .png()
        .toBuffer(),
      width: 800,
      height: 1200,
      sequence: ++sequence,
      receivedAt: Date.now(),
    }),
    close: async () => {},
  };
  let saved = 0;
  input.configureMotion(config, async () => {
    saved++;
  });
  // Keep the calibrated orientation, then exercise the same preparation used by verify().
  const prepare = () => {
    // biome-ignore lint/complexity/useLiteralKeys: Exercise private measurement without native Bluetooth orientation setup.
    return input['prepareMotion'](screen, new AbortController().signal);
  };
  return {
    input,
    screen,
    prepare,
    probes,
    saved: () => saved,
    pressed: () => pressed,
    drop: () => {
      dropMovement = true;
    },
    cancelWith: (c: AbortController) => {
      cancel = c;
    },
  };
}
const phoneConfig = (): DeviceConfig => ({
  id: 'phone-a',
  name: 'Phone',
  bluetoothPeerId: 'peer-a',
  screen: { source: 'usb', deviceId: 'usb-a' },
});

test('measured samples persist through devices.json and reconnect only checks independent probes', async () => {
  fastTimers();
  const config = phoneConfig();
  const first = simulatedPhone(config);
  await first.prepare();
  assert.equal(first.pressed(), 0);
  assert.equal(config.pointerMotion!.samples.length, 4);
  assert.equal(config.pointerMotion!.validation.samples.length, 3);
  assert.ok(first.probes.some((d) => d.x === 14));
  assert.ok(first.probes.some((d) => d.y === 14));
  const measuredAt = config.pointerMotion!.measuredAt;
  const directory = await mkdtemp(join(tmpdir(), 'ios-motion-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const store = new DeviceConfigStore(directory);
  await store.load();
  await store.save(config);
  const disk = JSON.parse(
    await readFile(join(directory, 'devices.json'), 'utf8'),
  );
  assert.deepEqual(disk.devices[0].pointerMotion, config.pointerMotion);
  const nextStore = new DeviceConfigStore(directory);
  await nextStore.load();
  const restored = nextStore.resolve({ id: config.id });
  const next = simulatedPhone(restored);
  await next.input.verify(next.screen);
  assert.equal(restored.pointerMotion!.measuredAt, measuredAt);
  assert.ok(
    !next.probes.some(
      (p) => p.x === 6 || p.y === 6 || p.x === 14 || p.y === 14,
    ),
  );
  assert.ok(next.probes.some((p) => p.x === 4 && p.y === 4));
  assert.equal(next.saved(), 1);
});

test('changed pointer sensitivity rejects the cache and refits before any drag', async () => {
  fastTimers();
  const config = phoneConfig();
  await simulatedPhone(config).prepare();
  const old = config.pointerMotion!.model.x.a;
  const next = simulatedPhone(config, {
    x: { a: 1.8, b: 0.11 },
    y: { a: 1.7, b: 0.1 },
  });
  await next.prepare();
  assert.ok(next.probes.some((p) => p.x === 14));
  assert.ok(config.pointerMotion!.model.x.a > old + 0.5);
  assert.equal(next.saved(), 2, 'invalidate then save verified replacement');
  assert.equal(next.pressed(), 0);
});

test('failed revalidation clears stale disk data, and cancellation never starts a drag', async () => {
  fastTimers();
  const config = phoneConfig();
  await simulatedPhone(config).prepare();
  const broken = simulatedPhone(config);
  broken.drop();
  await assert.rejects(broken.prepare(), /Cannot measure/);
  assert.equal(config.pointerMotion, undefined);
  assert.equal(broken.saved(), 1);
  assert.equal(broken.pressed(), 0);
  const abort = new AbortController();
  const cancelled = simulatedPhone(phoneConfig());
  cancelled.cancelWith(abort);
  await assert.rejects(
    cancelled.input.execute(
      { type: 'swipe', from: { x: 100, y: 100 }, to: { x: 200, y: 200 } },
      cancelled.screen,
      abort.signal,
    ),
    { name: 'AbortError' },
  );
  assert.equal(cancelled.pressed(), 0);
  assert.equal(cancelled.saved(), 0);
});

test('cache binding includes source, Bluetooth identity, dimensions, rotation and camera correction', async () => {
  fastTimers();
  const config = phoneConfig();
  await simulatedPhone(config).prepare();
  const geometry = { width: 800, height: 1200, turn: 0 as const };
  const binding = motionBinding(config, geometry);
  assert.ok(compatibleMotionProfile(config.pointerMotion, binding));
  for (const other of [
    { ...config, bluetoothPeerId: 'peer-b' },
    { ...config, screen: { source: 'airplay' as const } },
  ])
    assert.notEqual(motionBinding(other, geometry), binding);
  assert.notEqual(motionBinding(config, { ...geometry, width: 801 }), binding);
  assert.notEqual(motionBinding(config, { ...geometry, turn: 1 }), binding);
  const camera = {
    ...config,
    screen: { source: 'camera' as const, cameraId: 'cam' },
    camera: {
      cameraId: 'cam',
      width: 720,
      height: 1280,
      correction: { rotation: 0, points: [{ x: 10, y: 10 }] },
    } as unknown as DeviceConfig['camera'],
  };
  assert.notEqual(
    motionBinding(camera, geometry),
    motionBinding(
      {
        ...camera,
        camera: {
          ...camera.camera!,
          correction: { ...camera.camera!.correction, rotation: 90 },
        },
      },
      geometry,
    ),
  );
  assert.equal(
    compatibleMotionProfile(
      { ...config.pointerMotion!, version: 999 },
      binding,
    ),
    false,
  );
  const bad = {
    ...config.pointerMotion!,
    model: { x: { a: Number.NaN, b: 0 }, y: linear.y },
  };
  assert.equal(compatibleMotionProfile(bad, binding), false);
});
