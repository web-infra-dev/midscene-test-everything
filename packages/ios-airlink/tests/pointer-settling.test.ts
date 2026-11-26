import assert from 'node:assert/strict';
import { rstest, test } from '@rstest/core';
import sharp from 'sharp';
import {
  measureMotionModel,
  predictMovement,
  validateMotionModel,
} from '../dist/hardware/pointer/motion-model.js';
import type { Point } from '../dist/hardware/types.js';
import { curveModel, physicalMovement } from './fixtures/pointer-model.js';

test('measurement waits for delayed video to settle instead of fitting intermediate movement', async () => {
  const realTimer = globalThis.setTimeout;
  rstest
    .spyOn(globalThis, 'setTimeout')
    .mockImplementation(((
      callback: (...args: unknown[]) => void,
      delay: number,
      ...args: unknown[]
    ) =>
      realTimer(callback, Math.min(delay, 1), ...args)) as typeof setTimeout);
  const model = curveModel();
  let actual: Point = { x: 400, y: 600 };
  let displayed = { ...actual };
  let sequence = 0;
  let writes = 0;
  const measured = await measureMotionModel(
    {
      getFrame: async () => {
        // Video catches up over several fresh frames after writes complete.
        displayed = {
          x: displayed.x + (actual.x - displayed.x) * 0.6,
          y: displayed.y + (actual.y - displayed.y) * 0.6,
        };
        return {
          jpeg: await sharp(
            Buffer.from(
              `<svg width="800" height="1200"><rect width="800" height="1200" fill="white"/><circle cx="${displayed.x}" cy="${displayed.y}" r="13" fill="#444"/><circle cx="${sequence % 2 ? 300 : 320}" cy="650" r="4" fill="#777"/></svg>`,
            ),
          )
            .png()
            .toBuffer(),
          width: 800,
          height: 1200,
          sequence: ++sequence,
          receivedAt: Date.now(),
        };
      },
      close: async () => {},
    },
    {
      moveTo: async (point) => {
        actual = { ...point };
        displayed = { ...point };
      },
      relative: async (delta) => {
        const movement = physicalMovement(model, delta);
        const coldGain = ++writes <= 12 ? 0.7 : 1;
        movement.x *= coldGain;
        movement.y *= coldGain;
        actual = { x: actual.x + movement.x, y: actual.y + movement.y };
      },
    },
    new AbortController().signal,
  );
  for (const sample of measured.samples) {
    const expected = predictMovement(model, sample.delta);
    const error = Math.hypot(
      sample.displacement.x - expected.x * sample.reports,
      sample.displacement.y - expected.y * sample.reports,
    );
    assert.ok(error < 3, `must fit the settled endpoint, error=${error}`);
  }
  // Rasterising every frame is CPU-heavy; shared CI runners took 44.8s with a
  // 60s limit, which made this timing-sensitive test flake.
}, 120_000);

test('measured diagonals retain their own gain and unmeasured reports are rejected', () => {
  const model = curveModel();
  const diagonal = predictMovement(model, { x: 4, y: -4 });
  assert.deepEqual(diagonal, physicalMovement(model, { x: 4, y: -4 }));
  assert.notEqual(diagonal.x, predictMovement(model, { x: 4, y: 0 }).x);
  assert.throws(
    () => predictMovement(model, { x: 14, y: 0 }),
    /has not been measured/,
  );
});

function delayedPhone(gain: (trial: number) => number = () => 1, offsetX = 0) {
  const model = curveModel({ a: 1.4, b: 0.08 }, { a: 1.4, b: 0.08 });
  let point = { x: 260, y: 450 };
  let displayed = { ...point };
  let previous = { ...point };
  let frames = 0;
  let moving = false;
  let trial = 0;
  let sequence = 0;
  let anchorSeen = 0;
  const screen = {
    getFrame: async () => {
      frames++;
      const delay = moving ? 5 : 10;
      if (frames > delay) {
        const ratio = moving && frames < 9 ? 0.75 : 1;
        displayed = {
          x: previous.x + (point.x - previous.x) * ratio,
          y: previous.y + (point.y - previous.y) * ratio,
        };
        if (!moving) anchorSeen++;
      }
      return {
        jpeg: await sharp(
          Buffer.from(
            `<svg width="320" height="640"><rect width="320" height="640" fill="white"/><circle cx="${displayed.x}" cy="${displayed.y}" r="8" fill="#444"/></svg>`,
          ),
        )
          .png()
          .toBuffer(),
        width: 320,
        height: 640,
        sequence: ++sequence,
        receivedAt: Date.now(),
      };
    },
    close: async () => {},
  };
  const transport = {
    moveTo: async (target: Point) => {
      previous = { ...displayed };
      point = { x: target.x + offsetX, y: target.y };
      frames = 0;
      moving = false;
      anchorSeen = 0;
      trial++;
    },
    relative: async (delta: Point) => {
      if (!moving) {
        assert.ok(
          anchorSeen >= 3,
          'must see three settled anchor frames before moving',
        );
        moving = true;
        frames = 0;
        previous = { ...displayed };
      }
      const d = physicalMovement(model, delta);
      point = {
        x: point.x + d.x * gain(trial),
        y: point.y + d.y * gain(trial),
      };
    },
  };
  return { model, screen, transport };
}
function accelerateTimers() {
  const realTimer = globalThis.setTimeout;
  rstest
    .spyOn(globalThis, 'setTimeout')
    .mockImplementation(((
      callback: (...args: unknown[]) => void,
      delay: number,
      ...args: unknown[]
    ) =>
      realTimer(callback, Math.min(delay, 1), ...args)) as typeof setTimeout);
}

test('validation waits for a delayed anchor and endpoint and rejects an isolated anomalous trial', async () => {
  accelerateTimers();
  const phone = delayedPhone((trial) => (trial === 1 ? 1.4 : 1));
  const validation = await validateMotionModel(
    phone.screen,
    phone.transport,
    phone.model,
    new AbortController().signal,
  );
  assert.equal(validation.samples.length, 3);
  assert.ok(validation.maxRelativeError < 0.04);
  assert.equal(validation.samples[0].repetitions!.length, 3);
  assert.ok(
    validation.samples[0].repetitions![0].displacement.x >
      validation.samples[0].displacement.x * 1.2,
  );
}, 60_000);

test('repeated but consistently wrong movement still fails with measured error details', async () => {
  accelerateTimers();
  const phone = delayedPhone(() => 1.3);
  await assert.rejects(
    validateMotionModel(
      phone.screen,
      phone.transport,
      phone.model,
      new AbortController().signal,
    ),
    /differs from the fitted curve by .*px/,
  );
}, 60_000);

test('inconsistent repeated moves are rejected instead of fitting a noisy curve', async () => {
  accelerateTimers();
  const phone = delayedPhone((trial) => [0.65, 1, 1.35][(trial - 1) % 3]);
  await assert.rejects(
    validateMotionModel(
      phone.screen,
      phone.transport,
      phone.model,
      new AbortController().signal,
    ),
    /inconsistent across repeated moves/,
  );
}, 60_000);

test('a tracked pointer can settle outside the expected anchor region', async () => {
  accelerateTimers();
  const phone = delayedPhone(() => 1, 24);
  const validation = await validateMotionModel(
    phone.screen,
    phone.transport,
    phone.model,
    new AbortController().signal,
    {
      position: {
        x: 260,
        y: 450,
        area: 200,
        strength: 187,
        bounds: { left: 252, top: 442, right: 268, bottom: 458 },
      },
    },
  );
  assert.equal(validation.samples.length, 3);
  assert.ok(validation.maxErrorPx < 3);
}, 60_000);
