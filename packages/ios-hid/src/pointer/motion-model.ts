import type { ScreenSession } from '../screen/source.js';
import type { Point } from '../types.js';
import { detectPointerChanges } from './detector.js';
import { type PointerTurn, screenDeltaToPointer } from './mapping.js';
import {
  CALIBRATION_REPORTS,
  DRAG_REPORT_LIMIT,
  type MotionSample,
  type MotionValidation,
  REPORT_INTERVAL_MS,
} from './motion-profile.js';

export interface RelativeTransport {
  moveTo(point: Point): Promise<void>;
  relative(delta: Point, buttons?: number): Promise<void>;
}
/** Actual screen displacement for one report, at the configured report cadence. */
export interface PointerMotionModel {
  reports: { delta: Point; displacement: Point }[];
}
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function predictMovement(
  model: PointerMotionModel,
  delta: Point,
): Point {
  if (!delta.x && !delta.y) return { x: 0, y: 0 };
  const measured = model.reports.find(
    ({ delta: report }) =>
      report.x === Math.abs(delta.x) && report.y === Math.abs(delta.y),
  );
  if (!measured) throw new Error('Relative report has not been measured');
  return {
    x: Math.sign(delta.x) * measured.displacement.x,
    y: Math.sign(delta.y) * measured.displacement.y,
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
): Promise<MotionSample> {
  signal.throwIfAborted();
  const frame = await screen.getFrame({ fresh: true, allowUnchanged: true });
  const origin = {
    x: frame.width * (delta.x ? 0.2 : cross),
    y: frame.height * (delta.y ? 0.2 : cross),
  };
  await transport.moveTo(origin);
  const tolerance = Math.max(10, Math.min(frame.width, frame.height) * 0.025);
  let before = frame;
  let previousAnchor: Point | undefined;
  let anchorFrames = 0;
  // The absolute report can arrive well before its video frame. Verify that the
  // anchor itself has appeared and settled before sending relative reports.
  for (let attempt = 0; attempt < 24; attempt++) {
    await pause(100);
    signal.throwIfAborted();
    before = await screen.getFrame({
      fresh: true,
      allowUnchanged: true,
      timeoutMs: 1500,
    });
    if (before.width !== frame.width || before.height !== frame.height)
      throw new Error('Screen geometry changed during pointer measurement');
    let changes;
    try {
      changes = await detectPointerChanges(frame, before);
    } catch {
      previousAnchor = undefined;
      anchorFrames = 0;
      continue;
    }
    const anchors = changes.filter(
      (p) => Math.hypot(p.x - origin.x, p.y - origin.y) < tolerance,
    );
    const anchor = anchors.length === 1 ? anchors[0] : undefined;
    anchorFrames =
      anchor &&
      previousAnchor &&
      Math.hypot(anchor.x - previousAnchor.x, anchor.y - previousAnchor.y) <=
        1.5
        ? anchorFrames + 1
        : 0;
    previousAnchor = anchor;
    if (anchorFrames >= 2) break;
  }
  if (anchorFrames < 2)
    throw new Error(
      'Pointer start position did not settle. Keep a static screen visible and check video latency.',
    );
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
  let previousEnd: Point | undefined;
  let stableFrames = 0;
  for (let attempt = 0; attempt < 24; attempt++) {
    await pause(100);
    signal.throwIfAborted();
    const after = await screen.getFrame({
      fresh: true,
      allowUnchanged: true,
      timeoutMs: 3000,
    });
    let changes;
    try {
      changes = await detectPointerChanges(before, after);
    } catch (error) {
      signal.throwIfAborted();
      // An old frame is retryable; geometry changes must not be fitted.
      if (before.width !== after.width || before.height !== after.height)
        throw error;
      previousEnd = undefined;
      stableFrames = 0;
      continue;
    }

    const anchors = changes.filter(
      (p) => Math.hypot(p.x - origin.x, p.y - origin.y) < tolerance,
    );
    if (anchors.length !== 1) {
      previousEnd = undefined;
      stableFrames = 0;
      continue;
    }
    const start = anchors[0];
    const ends = changes.filter((p) => {
      // Small changing text or spinner fragments are not the pointer endpoint.
      if (p === start || p.area < start.area * 0.4) return false;
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
    if (ends.length === 1) {
      const end = ends[0];
      // Acknowledging a HID write does not mean video has reached its final
      // position. Observe four agreeing fresh frames (~300ms), so a short
      // plateau in delayed video isn't mistaken for the final endpoint.
      stableFrames =
        previousEnd &&
        Math.hypot(end.x - previousEnd.x, end.y - previousEnd.y) <= 1.5
          ? stableFrames + 1
          : 0;
      previousEnd = end;
      if (stableFrames < 3) continue;
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
    previousEnd = undefined;
    stableFrames = 0;
  }
  throw new Error(
    'Pointer endpoint did not settle or could not be identified. Keep a static bright screen visible and check video latency.',
  );
}

/** Three independent moves; take the median trial only when a majority agrees. */
async function repeatProbe(
  ...args: Parameters<typeof probe>
): Promise<MotionSample> {
  const trials: MotionSample[] = [];
  for (let i = 0; i < 3; i++) {
    const sample = await probe(...args);
    trials.push(sample);
  }
  const ordered = [...trials].sort(
    (a, b) =>
      Math.hypot(a.displacement.x, a.displacement.y) -
      Math.hypot(b.displacement.x, b.displacement.y),
  );
  const median = ordered[1];
  const tolerance = Math.max(
    4,
    Math.hypot(median.displacement.x, median.displacement.y) * 0.08,
  );
  const agreeing = trials.filter(
    (sample) =>
      Math.hypot(
        sample.displacement.x - median.displacement.x,
        sample.displacement.y - median.displacement.y,
      ) <= tolerance,
  );
  if (agreeing.length < 2)
    throw new Error(
      'Pointer measurements are inconsistent across repeated moves. Keep a static screen visible and check video latency.',
    );
  return {
    ...median,
    repetitions: trials.map(({ displacement, elapsedMs }) => ({
      displacement,
      elapsedMs,
    })),
  };
}

export async function measureMotionModel(
  screen: ScreenSession,
  transport: RelativeTransport,
  signal: AbortSignal,
): Promise<{ model: PointerMotionModel; samples: MotionSample[] }> {
  // iOS may damp the first relative reports after establishing the channel.
  // Warm up without pressing a button, then return to measured probe anchors.
  const frame = await screen.getFrame({ fresh: true, allowUnchanged: true });
  await transport.moveTo({ x: frame.width * 0.2, y: frame.height * 0.3 });
  for (let i = 0; i < 12; i++) {
    signal.throwIfAborted();
    await transport.relative({ x: 6, y: 0 });
    await pause(REPORT_INTERVAL_MS);
  }
  const model: PointerMotionModel = { reports: [] };
  const samples: MotionSample[] = [];
  // Measure only reports the planner will actually send. Diagonals are measured
  // independently: iOS acceleration can depend on vector length, not each axis.
  for (const { delta, reports } of CALIBRATION_REPORTS) {
    let sample: MotionSample | undefined;
    for (const cross of [0.3, 0.5, 0.7]) {
      try {
        sample = await repeatProbe(
          screen,
          transport,
          delta,
          reports,
          cross,
          signal,
        );
        break;
      } catch (error) {
        signal.throwIfAborted();
        if (cross === 0.7) throw error;
      }
    }
    const observed = sample!;
    model.reports.push({
      delta: { ...delta },
      displacement: {
        x: delta.x ? observed.displacement.x / reports : 0,
        y: delta.y ? observed.displacement.y / reports : 0,
      },
    });
    samples.push(observed);
  }
  return { model, samples };
}

export class MotionValidationError extends Error {
  constructor(
    readonly sample: MotionSample,
    message: string,
  ) {
    super(message);
  }
}

/** Refine a measured report only; a subsequent independent check is mandatory. */
export function correctMotionModel(
  model: PointerMotionModel,
  sample: MotionSample,
) {
  const point = model.reports.find(
    ({ delta }) => delta.x === sample.delta.x && delta.y === sample.delta.y,
  );
  if (!point) throw new Error('Cannot correct an unmeasured report');
  point.displacement = {
    x: sample.delta.x ? sample.displacement.x / sample.reports : 0,
    y: sample.delta.y ? sample.displacement.y / sample.reports : 0,
  };
}

/** Independent axis and diagonal checks, also used before reusing disk data. */
export async function validateMotionModel(
  screen: ScreenSession,
  transport: RelativeTransport,
  model: PointerMotionModel,
  signal: AbortSignal,
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
        result = await repeatProbe(
          screen,
          transport,
          delta,
          count,
          cross,
          signal,
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
      throw new MotionValidationError(
        sample,
        `Pointer movement differs from the fitted curve by ${error.toFixed(1)}px (${(relativeError * 100).toFixed(1)}%). Keep a static screen visible; check Tracking Speed and video latency.`,
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
      if (
        (x || y) &&
        !model.reports.some(
          ({ delta }) => delta.x === Math.abs(x) && delta.y === Math.abs(y),
        )
      )
        continue;
      candidates.push({
        report: { x, y },
        displacement: predictMovement(model, { x, y }),
      });
    }
  const minimumSteps = Math.max(8, Math.ceil(duration / REPORT_INTERVAL_MS));
  // Extend from measured capacity, not a multiple of the requested duration.
  // Movement starts immediately; the bound limits total gesture time, not a hold.
  const maximumSteps = Math.floor(
    Math.max(duration, 2000) / REPORT_INTERVAL_MS,
  );
  for (
    let steps = minimumSteps;
    steps <= Math.max(minimumSteps, maximumSteps);
    steps++
  ) {
    const travelled = { x: 0, y: 0 };
    const reports: Point[] = [];
    for (let i = 0; i < steps; i++) {
      const fraction = (i + 1) / steps;
      // Start promptly and keep moving through release. The previous steep
      // ease-out exhausted most travel early, making short page swipes crawl
      // at release and bounce back instead of committing a page turn.
      const progress = fraction * (1.2 - 0.2 * fraction);
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
      Math.max(
        1,
        Math.min(
          ...model.reports.map(({ displacement }) =>
            Math.hypot(displacement.x, displacement.y),
          ),
        ) * 0.75,
      ),
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
