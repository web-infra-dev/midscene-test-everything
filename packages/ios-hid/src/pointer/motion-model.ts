import type { ScreenSession } from '../screen/source.js';
import type { Point } from '../types.js';
import { detectPointerChanges } from './detector.js';
import type { PointerDiagnostics } from './diagnostics.js';
import { type PointerTurn, screenDeltaToPointer } from './mapping.js';
import {
  DRAG_REPORT_LIMIT,
  MEASURED_REPORT_LIMIT,
  type MotionSample,
  type MotionValidation,
  REPORT_INTERVAL_MS,
} from './motion-profile.js';

export interface RelativeTransport {
  moveTo(point: Point): Promise<void>;
  relative(delta: Point, buttons?: number): Promise<void>;
}
interface AxisCurve {
  a: number;
  b: number;
}
export interface PointerMotionModel {
  x: AxisCurve;
  y: AxisCurve;
}
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function predictMovement(
  model: PointerMotionModel,
  delta: Point,
): Point {
  const length = Math.hypot(delta.x, delta.y);
  return {
    x: delta.x * (model.x.a + model.x.b * length),
    y: delta.y * (model.y.a + model.y.b * length),
  };
}

/** Hover only. Identify both ends rather than trusting the requested anchor. */
async function probe(
  screen: ScreenSession,
  transport: RelativeTransport,
  delta: Point,
  reports: number,
  cross: number,
  signal: AbortSignal,
  diagnostics?: PointerDiagnostics,
): Promise<MotionSample> {
  signal.throwIfAborted();
  const frame = await screen.getFrame({ fresh: true });
  const origin = {
    x: frame.width * (delta.x ? 0.2 : cross),
    y: frame.height * (delta.y ? 0.2 : cross),
  };
  await transport.moveTo(origin);
  await pause(250);
  signal.throwIfAborted();
  const before = await screen.getFrame({ fresh: true });
  if (before.width !== frame.width || before.height !== frame.height)
    throw new Error('Screen geometry changed during pointer measurement');
  let lastStart = 0;
  const started = performance.now();
  for (let i = 0; i < reports; i++) {
    if (i)
      await pause(
        Math.max(0, lastStart + REPORT_INTERVAL_MS - performance.now()),
      );
    signal.throwIfAborted();
    lastStart = performance.now();
    await transport.relative(delta);
  }
  const elapsedMs = performance.now() - started;
  const tolerance = Math.max(10, Math.min(frame.width, frame.height) * 0.025);
  for (let attempt = 0; attempt < 8; attempt++) {
    await pause(100);
    signal.throwIfAborted();
    const after = await screen.getFrame({ fresh: true, timeoutMs: 3000 });
    let changes;
    try {
      changes = await detectPointerChanges(before, after);
    } catch (error) {
      signal.throwIfAborted();
      // An old frame is retryable; geometry changes must not be fitted.
      if (before.width !== after.width || before.height !== after.height)
        throw error;
      continue;
    }
    await diagnostics?.({
      stage: 'movement',
      before,
      after,
      data: { delta, reports, origin, attempt, candidates: changes },
    });
    const anchors = changes.filter(
      (p) => Math.hypot(p.x - origin.x, p.y - origin.y) < tolerance,
    );
    if (anchors.length !== 1) continue;
    const start = anchors[0];
    const ends = changes.filter((p) => {
      if (p === start) return false;
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      return (
        (delta.x
          ? dx > 20 && dx < frame.width * 0.55
          : Math.abs(dx) < tolerance) &&
        (delta.y
          ? dy > 20 && dy < frame.height * 0.55
          : Math.abs(dy) < tolerance) &&
        p.x < frame.width * 0.9 &&
        p.y < frame.height * 0.9
      );
    });
    if (ends.length === 1)
      return {
        delta,
        reports,
        displacement: {
          x: ends[0].x - start.x,
          y: ends[0].y - start.y,
        },
        elapsedMs,
      };
  }
  throw new Error(
    'Cannot measure relative pointer movement. Keep a static bright screen visible and avoid reflections, then retry.',
  );
}

export async function measureMotionModel(
  screen: ScreenSession,
  transport: RelativeTransport,
  signal: AbortSignal,
  diagnostics?: PointerDiagnostics,
): Promise<{ model: PointerMotionModel; samples: MotionSample[] }> {
  const model = {} as PointerMotionModel;
  const samples: MotionSample[] = [];
  for (const axis of ['x', 'y'] as const) {
    let accepted = false;
    for (const cross of [0.3, 0.5, 0.7]) {
      try {
        const measured: MotionSample[] = [];
        for (const [units, count] of [
          [6, 12],
          [MEASURED_REPORT_LIMIT, 5],
        ])
          measured.push(
            await probe(
              screen,
              transport,
              { x: axis === 'x' ? units : 0, y: axis === 'y' ? units : 0 },
              count,
              cross,
              signal,
              diagnostics,
            ),
          );
        const [small, large] = measured.map((s) => ({
          units: s.delta[axis],
          pixels: s.displacement[axis] / s.reports,
        }));
        const b =
          (large.pixels / large.units - small.pixels / small.units) /
          (large.units - small.units);
        const a = small.pixels / small.units - b * small.units;
        if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b < 0)
          continue;
        model[axis] = { a, b };
        samples.push(...measured);
        accepted = true;
        break;
      } catch (error) {
        signal.throwIfAborted();
        if (cross === 0.7) throw error;
      }
    }
    if (!accepted)
      throw new Error(
        'Cannot fit relative pointer movement. Keep the screen static and retry.',
      );
  }
  return { model, samples };
}

/** Independent axis and diagonal checks, also used before reusing disk data. */
export async function validateMotionModel(
  screen: ScreenSession,
  transport: RelativeTransport,
  model: PointerMotionModel,
  signal: AbortSignal,
  diagnostics?: PointerDiagnostics,
): Promise<MotionValidation> {
  const frame = await screen.getFrame();
  const samples: MotionSample[] = [];
  let maxErrorPx = 0;
  let maxRelativeError = 0;
  for (const delta of [
    { x: 8, y: 0 },
    { x: 0, y: 8 },
    { x: 4, y: 4 },
  ]) {
    const predicted = predictMovement(model, delta);
    // Long enough for distinct pointer blobs, but stay clear of clamped edges.
    const available = Math.min(
      predicted.x > 0
        ? (frame.width * 0.35) / predicted.x
        : Number.POSITIVE_INFINITY,
      predicted.y > 0
        ? (frame.height * 0.35) / predicted.y
        : Number.POSITIVE_INFINITY,
    );
    const count = Math.min(
      24,
      Math.floor(available),
      Math.max(
        4,
        Math.ceil(
          (Math.min(frame.width, frame.height) * 0.18) /
            Math.hypot(predicted.x, predicted.y),
        ),
      ),
    );
    if (count < 2)
      throw new Error(
        'Pointer movement is too large to validate inside the screen. Reduce Tracking Speed and retry.',
      );
    let result: MotionSample | undefined;
    for (const cross of [0.3, 0.5, 0.7]) {
      try {
        result = await probe(
          screen,
          transport,
          delta,
          count,
          cross,
          signal,
          diagnostics,
        );
        break;
      } catch (error) {
        signal.throwIfAborted();
        if (cross === 0.7) throw error;
      }
    }
    const sample = result!;
    const expected = { x: predicted.x * count, y: predicted.y * count };
    const error = Math.hypot(
      sample.displacement.x - expected.x,
      sample.displacement.y - expected.y,
    );
    const relativeError = error / Math.hypot(expected.x, expected.y);
    // Screenshot localization has a finite pixel floor; do not promise subpixel accuracy.
    if (error > Math.max(4, Math.hypot(expected.x, expected.y) * 0.08))
      throw new Error(
        'Pointer movement validation failed. Keep the phone still, check the picture and retry.',
      );
    maxErrorPx = Math.max(maxErrorPx, error);
    maxRelativeError = Math.max(maxRelativeError, relativeError);
    samples.push(sample);
  }
  return {
    samples,
    maxErrorPx,
    maxRelativeError,
    checkedAt: new Date().toISOString(),
  };
}

export interface DragPlan {
  reports: Point[];
  intervalMs: number;
  durationMs: number;
  requestedDurationMs: number;
}

/** Search ALL legal integer reports; never discard an out-of-range ideal as zero. */
export function planRelativeDrag(
  from: Point,
  to: Point,
  duration: number,
  model: PointerMotionModel,
  turn: PointerTurn,
): DragPlan {
  if (
    ![from.x, from.y, to.x, to.y, duration].every(Number.isFinite) ||
    duration < 100 ||
    duration > 5000
  )
    throw new Error('Invalid drag geometry or duration');
  const target = { x: to.x - from.x, y: to.y - from.y };
  const candidates: { report: Point; displacement: Point }[] = [];
  for (let x = -DRAG_REPORT_LIMIT; x <= DRAG_REPORT_LIMIT; x++)
    for (let y = -DRAG_REPORT_LIMIT; y <= DRAG_REPORT_LIMIT; y++) {
      if (
        Math.hypot(x, y) > DRAG_REPORT_LIMIT ||
        x * target.x < 0 ||
        y * target.y < 0 ||
        (!target.x && x) ||
        (!target.y && y)
      )
        continue;
      candidates.push({
        report: { x, y },
        displacement: predictMovement(model, { x, y }),
      });
    }
  const minimumSteps = Math.max(8, Math.ceil(duration / REPORT_INTERVAL_MS));
  // Bounded extension only. Excessively slow drags can become long presses.
  const maximumSteps = Math.floor(
    Math.min(5000, Math.max(duration, Math.min(1000, duration * 2))) /
      REPORT_INTERVAL_MS,
  );
  for (
    let steps = minimumSteps;
    steps <= Math.max(minimumSteps, maximumSteps);
    steps++
  ) {
    const travelled = { x: 0, y: 0 };
    const reports: Point[] = [];
    for (let i = 0; i < steps; i++) {
      const progress = 1 - (1 - (i + 1) / steps) ** 2.5;
      const needed = {
        x: target.x * progress - travelled.x,
        y: target.y * progress - travelled.y,
      };
      let best = candidates.find((c) => !c.report.x && !c.report.y)!;
      let error = Math.hypot(needed.x, needed.y);
      for (const candidate of candidates) {
        const difference = Math.hypot(
          needed.x - candidate.displacement.x,
          needed.y - candidate.displacement.y,
        );
        if (difference < error) {
          error = difference;
          best = candidate;
        }
      }
      travelled.x += best.displacement.x;
      travelled.y += best.displacement.y;
      reports.push(screenDeltaToPointer(best.report, turn));
    }
    const tolerance = Math.min(
      6,
      Math.max(1, Math.hypot(model.x.a, model.y.a) * 0.55),
    );
    if (Math.hypot(target.x - travelled.x, target.y - travelled.y) > tolerance)
      continue;
    // No stationary tail while holding the button: release immediately after travel.
    while (reports.length && !reports.at(-1)!.x && !reports.at(-1)!.y)
      reports.pop();
    if (reports.length && (reports[0].x || reports[0].y))
      return {
        reports,
        intervalMs: REPORT_INTERVAL_MS,
        durationMs: reports.length * REPORT_INTERVAL_MS,
        requestedDurationMs: duration,
      };
    if (!target.x && !target.y)
      throw new Error('Swipe requires different endpoints');
  }
  throw new Error(
    'Cannot plan this drag within the measured step range and timing limit. Use a shorter swipe or increase duration.',
  );
}
