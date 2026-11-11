import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, rstest, test } from '@rstest/core';
import sharp from 'sharp';
import { DeviceConfigStore } from '../dist/hardware/config/store.js';
import { HIDInputSession } from '../dist/hardware/input/session.js';
import {
  type PointerTurn,
  screenDeltaToPointer,
} from '../dist/hardware/pointer/mapping.js';
import {
  planRelativeDrag,
  predictMovement,
} from '../dist/hardware/pointer/motion-model.js';
import {
  compatibleMotionProfile,
  motionBinding,
} from '../dist/hardware/pointer/motion-profile.js';
import type { DeviceConfig, Point } from '../dist/hardware/types.js';
import { curveModel, physicalMovement } from './fixtures/pointer-model.js';

const linear = curveModel({ a: 1, b: 0 }, { a: 1, b: 0 });
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
}, 60_000);

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
}, 60_000);

test('nonlinear diagonal paths and all pointer rotations preserve their endpoints', () => {
  const model = curveModel();
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
}, 60_000);

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
}, 60_000);

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
  model = curveModel(),
  movement?: (delta: Point) => Point,
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
      const d = movement?.(delta) ?? physicalMovement(model, delta);
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

test('connection measures and persists movement before the first swipe; reconnect reuses saved data without probes', async () => {
  fastTimers();
  const config = phoneConfig();
  const first = simulatedPhone(config);
  await first.input.verify(first.screen);
  assert.equal(first.pressed(), 0);
  assert.equal(config.pointerMotion!.samples.length, 10);
  assert.equal(config.pointerMotion!.validation.samples.length, 3);
  assert.ok(first.probes.some((d) => d.x === 2));
  assert.ok(first.probes.some((d) => d.y === 2));
  const measurementCount = first.probes.filter((p) => p.x || p.y).length;
  await first.input.execute(
    {
      type: 'swipe',
      from: { x: 200, y: 300 },
      to: { x: 350, y: 450 },
      durationMs: 500,
    },
    first.screen,
  );
  assert.equal(
    first.probes.filter((p) => p.x || p.y).length,
    measurementCount,
    'the first swipe must reuse connection-time measurement without more hover probes',
  );
  assert.ok(first.pressed() > 0);
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
  assert.deepEqual(
    next.probes,
    [],
    'matching reconnect does not move the pointer',
  );
  assert.equal(next.saved(), 0, 'reuse does not rewrite validation timestamps');
}, 60_000);

test('explicit reconfiguration refits changed pointer sensitivity before any drag', async () => {
  fastTimers();
  const config = phoneConfig();
  await simulatedPhone(config).prepare();
  const old = predictMovement(config.pointerMotion!.model, { x: 8, y: 0 }).x;
  config.pointerMotion = undefined; // The setup checkbox explicitly requests remeasurement.
  const next = simulatedPhone(
    config,
    curveModel({ a: 1.8, b: 0.11 }, { a: 1.7, b: 0.1 }),
  );
  await next.input.verify(next.screen);
  assert.ok(next.probes.some((p) => p.x === 2));
  assert.ok(
    predictMovement(config.pointerMotion!.model, { x: 8, y: 0 }).x > old + 0.5,
  );
  assert.equal(next.saved(), 1, 'save only the verified replacement');
  assert.equal(next.pressed(), 0);
}, 60_000);

test('failed revalidation clears stale disk data, and cancellation never starts a drag', async () => {
  fastTimers();
  const config = phoneConfig();
  await simulatedPhone(config).prepare();
  const broken = simulatedPhone(config);
  broken.drop();
  await assert.rejects(
    broken.prepare(),
    /Pointer (start position|endpoint) did not settle/,
  );
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
}, 60_000);

test('a first connection fails if movement cannot be measured, without clicking or saving a profile', async () => {
  fastTimers();
  const config = phoneConfig();
  const phone = simulatedPhone(config);
  phone.drop();
  await assert.rejects(
    phone.input.verify(phone.screen),
    /Pointer (start position|endpoint) did not settle/,
  );
  assert.equal(config.pointerMotion, undefined);
  assert.equal(phone.saved(), 0);
  assert.equal(phone.pressed(), 0);
}, 60_000);

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
    model: {
      reports: config.pointerMotion!.model.reports.map((point, index) =>
        index === 0
          ? { ...point, displacement: { x: Number.NaN, y: 0 } }
          : point,
      ),
    },
  };
  assert.equal(compatibleMotionProfile(bad, binding), false);
}, 60_000);

test('non-quadratic response from the real AirPlay failure calibrates without extrapolation', async () => {
  fastTimers();
  const response = curveModel();
  for (const point of response.reports) {
    if (point.delta.x === 6 && !point.delta.y)
      point.displacement.x = 52.4154486036839 / 12;
    if (point.delta.y === 6 && !point.delta.x)
      point.displacement.y = 54.150702426564465 / 12;
    if (point.delta.x === 8 && !point.delta.y)
      point.displacement.x = 111.50824181637361 / 16;
    if (point.delta.y === 8 && !point.delta.x)
      point.displacement.y = 101.14728682170545 / 15;
  }
  const config = phoneConfig();
  const phone = simulatedPhone(config, response);
  await phone.prepare();
  assert.ok(config.pointerMotion!.validation.maxRelativeError < 0.08);
  assert.ok(!phone.probes.some((p) => Math.hypot(p.x, p.y) > 8));
  for (const target of [
    { x: 180, y: 240 },
    { x: -90, y: 150 },
  ]) {
    const plan = planRelativeDrag(
      { x: 0, y: 0 },
      target,
      700,
      config.pointerMotion!.model,
      0,
    );
    const actual = plan.reports.reduce(
      (sum, report) => {
        const d = physicalMovement(response, report);
        return { x: sum.x + d.x, y: sum.y + d.y };
      },
      { x: 0, y: 0 },
    );
    assert.ok(Math.hypot(actual.x - target.x, actual.y - target.y) < 3);
  }
}, 60_000);

test('stable validation drift is corrected and checked again before the table is saved', async () => {
  fastTimers();
  const response = curveModel();
  let warmed = false;
  const config = phoneConfig();
  const phone = simulatedPhone(config, response, (delta) => {
    if (delta.x === 2 && delta.y === 2) warmed = true;
    const d = physicalMovement(response, delta);
    if (warmed && delta.x === 8 && !delta.y) d.x *= 1.12;
    return d;
  });
  await phone.prepare();
  const measured = predictMovement(config.pointerMotion!.model, {
    x: 8,
    y: 0,
  }).x;
  const expected = physicalMovement(response, { x: 8, y: 0 }).x * 1.12;
  assert.ok(Math.abs(measured - expected) < 0.15);
  assert.ok(config.pointerMotion!.validation.maxRelativeError < 0.08);
  assert.equal(
    phone.saved(),
    1,
    'save only after the corrected table passes new probes',
  );
  assert.equal(phone.pressed(), 0);
}, 60_000);
