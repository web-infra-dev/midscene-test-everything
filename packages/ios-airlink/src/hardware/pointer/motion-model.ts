import type { ScreenSession } from '../screen/source.js';
import type { Point, ScreenFrame } from '../types.js';
import {
  type PointerCandidate,
  detectPointerChanges,
  dominantPointer,
  pointerNear,
} from './detector.js';
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
  relativeBatch?(
    deltas: Point[],
    buttons?: number,
    intervalMs?: number,
  ): Promise<void>;
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

export interface PointerTracking {
  position?: PointerCandidate;
  origin?: Point;
}

function selectAnchor(
  changes: PointerCandidate[],
  previous: PointerCandidate | undefined,
  expected: Point,
  tolerance: number,
) {
  if (previous) {
    const old = changes.filter((candidate) =>
      pointerNear(candidate, previous, tolerance),
    );
    if (old.length === 1) {
      // Bound proximity and size ratio so spinners or distant AssistiveTouch fades are ignored.
      const others = changes.filter(
        (candidate) =>
          candidate !== old[0] &&
          candidate.area >= old[0].area * 0.22 &&
          candidate.area <= old[0].area * 4.5 &&
          pointerNear(candidate, expected, tolerance * 3.5),
      );
      if (others.length === 1) return others[0];
    }
    changes = changes.filter((candidate) => !old.includes(candidate));
  }
  const nearby = changes.filter((candidate) =>
    pointerNear(candidate, expected, tolerance),
  );
  return nearby.length === 1 ? nearby[0] : undefined;
}

async function sendRelativeSteps(
  transport: Pick<RelativeTransport, 'relative' | 'relativeBatch'>,
  deltas: Point[],
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (transport.relativeBatch) {
    await transport.relativeBatch(deltas, 0, REPORT_INTERVAL_MS);
    return;
  }
  let lastStart = 0;
  for (let i = 0; i < deltas.length; i++) {
    if (i)
      await pause(
        Math.max(0, lastStart + REPORT_INTERVAL_MS - performance.now()),
      );
    signal.throwIfAborted();
    lastStart = performance.now();
    await transport.relative(deltas[i]);
  }
}

export async function warmUpPointer(
  transport: Pick<RelativeTransport, 'relative' | 'relativeBatch'>,
  signal: AbortSignal,
) {
  // iOS may damp the first relative reports after establishing the channel.
  await sendRelativeSteps(
    transport,
    Array.from({ length: 12 }, () => ({ x: 6, y: 0 })),
    signal,
  );
}

interface SegmentStart {
  reference: ScreenFrame;
  current: ScreenFrame;
  position: PointerCandidate;
  background: PointerCandidate[];
}

async function locateStart(
  screen: ScreenSession,
  transport: RelativeTransport,
  delta: Point,
  cross: number,
  signal: AbortSignal,
  tracking: PointerTracking,
): Promise<SegmentStart> {
  signal.throwIfAborted();
  const frame = await screen.getFrame();
  const previous = tracking.position;
  // Leave the previous endpoint well outside the next measurement region.
  // Even a small relative movement then shows a full cursor against the reference.
  const horizontal = delta.x !== 0 && delta.y === 0;
  const prior = tracking.origin ?? previous;
  const lane = horizontal
    ? (prior?.y ?? 0) / frame.height
    : (prior?.x ?? 0) / frame.width;
  const alternate = cross > 0.5 ? cross - 0.24 : cross + 0.24;
  const crossFraction = Math.abs(lane - cross) < 0.1 ? alternate : cross;
  const origin = {
    x: frame.width * (horizontal ? 0.2 : crossFraction),
    y: frame.height * (horizontal ? crossFraction : 0.2),
  };
  tracking.origin = origin;
  tracking.position = undefined;
  await transport.moveTo(origin);
  const tolerance = Math.max(10, Math.min(frame.width, frame.height) * 0.03);
  let before = frame;
  let referenceChanges: PointerCandidate[] = [];
  let previousAnchor: PointerCandidate | undefined;
  let anchorSeenAt = 0;
  let anchorFrames = 0;
  let lastSequence = frame.sequence;
  // The absolute report can arrive well before its video frame. Verify that the
  // anchor itself has appeared and settled before sending relative reports.
  for (let attempt = 0; attempt < 24; attempt++) {
    signal.throwIfAborted();
    before = await screen.getFrame({
      fresh: true,
      afterSequence: lastSequence,
      allowUnchanged: true,
      timeoutMs: 1500,
    });
    if (before.width !== frame.width || before.height !== frame.height)
      throw new Error('Screen geometry changed during pointer measurement');
    if (before.sequence <= lastSequence) {
      // On VFR streams (USB/AirPlay), iOS stops emitting frames once the pointer stops.
      if (previousAnchor && Date.now() - anchorSeenAt >= 240) {
        anchorFrames = 2;
        break;
      }
      await pause(45);
      continue;
    }
    lastSequence = before.sequence;
    let changes;
    try {
      changes = await detectPointerChanges(frame, before);
    } catch {
      previousAnchor = undefined;
      anchorFrames = 0;
      continue;
    }
    const anchor = selectAnchor(changes, previous, origin, tolerance);
    anchorFrames =
      anchor &&
      previousAnchor &&
      Math.hypot(anchor.x - previousAnchor.x, anchor.y - previousAnchor.y) <=
        1.5
        ? anchorFrames + 1
        : 0;
    if (anchor) {
      referenceChanges = changes.filter((candidate) => candidate !== anchor);
      if (
        !previousAnchor ||
        Math.hypot(anchor.x - previousAnchor.x, anchor.y - previousAnchor.y) >
          1.5
      )
        anchorSeenAt = Date.now();
    }
    previousAnchor = anchor;
    if (anchorFrames >= 2) break;
  }
  if (anchorFrames < 2 || !previousAnchor)
    throw new Error(
      'Pointer start position did not settle. Keep a static screen visible and check video latency.',
    );
  return {
    reference: frame,
    current: before,
    position: previousAnchor,
    background: referenceChanges,
  };
}

async function measureSegment(
  screen: ScreenSession,
  transport: RelativeTransport,
  delta: Point,
  reports: number,
  start: SegmentStart,
  signal: AbortSignal,
) {
  const {
    reference: frame,
    current: before,
    position: observedAnchor,
    background: referenceChanges,
  } = start;
  const signX = observedAnchor.x > frame.width * 0.5 ? -1 : 1;
  const signY = observedAnchor.y > frame.height * 0.5 ? -1 : 1;
  const report = { x: delta.x * signX, y: delta.y * signY };
  const tolerance = Math.max(10, Math.min(frame.width, frame.height) * 0.03);
  let lastSequence = before.sequence;
  const started = performance.now();
  await sendRelativeSteps(
    transport,
    Array.from({ length: reports }, () => report),
    signal,
  );
  const sentAt = performance.now();
  const elapsedMs = sentAt - started;
  const minTravel = 5;
  let previousEnd: Point | undefined;
  let endCandidate: PointerCandidate | undefined;
  let endSeenAt = 0;
  let stableFrames = 0;
  let exactSince = 0;
  let useLocalReference = false;
  for (let attempt = 0; attempt < 24; attempt++) {
    signal.throwIfAborted();
    const after = await screen.getFrame({
      fresh: true,
      afterSequence: lastSequence,
      allowUnchanged: true,
      timeoutMs: 3000,
    });
    if (after.width !== before.width || after.height !== before.height)
      throw new Error('Screen geometry changed during pointer measurement');
    if (after.sequence <= lastSequence) {
      if (endCandidate && Date.now() - endSeenAt >= 260) {
        return finish(endCandidate, after);
      }
      // An unchanged stream cannot reveal a missing endpoint by being polled
      // repeatedly. Restart this segment elsewhere once video has had time to arrive.
      if (!endCandidate && performance.now() - sentAt > 1200) break;
      await pause(45);
      continue;
    }
    lastSequence = after.sequence;
    const isEndpoint = (p: PointerCandidate) => {
      if (
        p.area < Math.max(5, observedAnchor.area * 0.22) ||
        p.area > observedAnchor.area * 4.5
      )
        return false;
      const dx = (p.x - observedAnchor.x) * signX;
      const dy = (p.y - observedAnchor.y) * signY;
      return (
        (delta.x
          ? dx > minTravel && dx < frame.width * 0.6
          : Math.abs(dx) < tolerance) &&
        (delta.y
          ? dy > minTravel && dy < frame.height * 0.6
          : Math.abs(dy) < tolerance) &&
        p.x > frame.width * 0.08 &&
        p.y > frame.height * 0.08 &&
        p.x < frame.width * 0.92 &&
        p.y < frame.height * 0.92
      );
    };
    // Exposure drift can invalidate the original reference while consecutive
    // frames still agree on both the departed anchor and the new endpoint.
    let ends: PointerCandidate[] = [];
    if (!useLocalReference) {
      const changes = await detectPointerChanges(frame, after).catch(() => []);
      ends = changes.filter(
        (p) =>
          isEndpoint(p) &&
          !referenceChanges.some(
            (old) => Math.hypot(p.x - old.x, p.y - old.y) <= 3,
          ),
      );
    }
    if (ends.length !== 1 && attempt >= 3) {
      const local = await detectPointerChanges(before, after).catch(() => []);
      const anchors = local.filter(
        (p) => Math.hypot(p.x - observedAnchor.x, p.y - observedAnchor.y) < 3,
      );
      ends =
        anchors.length === 1
          ? local.filter((p) => p !== anchors[0] && isEndpoint(p))
          : [];
      useLocalReference = ends.length === 1;
    }
    signal.throwIfAborted();

    const end = dominantPointer(ends);
    const shift =
      end && previousEnd
        ? Math.hypot(end.x - previousEnd.x, end.y - previousEnd.y)
        : Number.POSITIVE_INFINITY;
    // A cluttered frame can confirm an already tracked endpoint. Acquire a
    // new endpoint only from a frame in which it was uniquely identified.
    if (end && (ends.length === 1 || shift <= 1.5)) {
      // Acknowledging a HID write does not mean video has reached its final
      // position. Require repeated fresh evidence; at lower frame rates three
      // agreeing observations already span the normal four-frame window.
      stableFrames = shift <= 1.5 ? stableFrames + 1 : 0;
      if (shift > 1.5) endSeenAt = Date.now();
      if (shift > 0.25) exactSince = performance.now();
      const still =
        stableFrames >= 1 &&
        performance.now() - exactSince >= 100 &&
        performance.now() - sentAt >= 180;
      previousEnd = end;
      endCandidate = end;
      if (
        !still &&
        stableFrames < 3 &&
        !(stableFrames >= 2 && Date.now() - endSeenAt >= 150)
      )
        continue;
      return finish(end, after);
    }
    previousEnd = undefined;
    endCandidate = undefined;
    stableFrames = 0;
  }
  throw new Error(
    'Pointer endpoint did not settle or could not be identified. Keep a static bright screen visible and check video latency.',
  );

  function finish(end: PointerCandidate, current: ScreenFrame) {
    const sample: MotionSample = {
      delta,
      reports,
      elapsedMs,
      displacement: {
        x: (end.x - observedAnchor.x) * signX,
        y: (end.y - observedAnchor.y) * signY,
      },
    };
    return { sample, next: { ...start, position: end, current } };
  }
}

async function reconcileMoves(
  first: MotionSample,
  second: MotionSample,
  tieBreaker: () => Promise<MotionSample>,
): Promise<MotionSample> {
  const meanTwo = {
    x: (first.displacement.x + second.displacement.x) / 2,
    y: (first.displacement.y + second.displacement.y) / 2,
  };
  const twoTolerance = Math.max(4, Math.hypot(meanTwo.x, meanTwo.y) * 0.08);
  if (
    Math.hypot(
      first.displacement.x - second.displacement.x,
      first.displacement.y - second.displacement.y,
    ) <= twoTolerance
  ) {
    return {
      ...second,
      displacement: meanTwo,
      elapsedMs: (first.elapsedMs + second.elapsedMs) / 2,
      repetitions: [first, second].map(({ displacement, elapsedMs }) => ({
        displacement,
        elapsedMs,
      })),
    };
  }

  const third = await tieBreaker();
  const trials = [first, second, third];
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

/** Each observed endpoint starts the next segment. Re-anchor only after a missed observation. */
async function measureTrack(
  screen: ScreenSession,
  transport: RelativeTransport,
  specs: { delta: Point; reports: number }[],
  signal: AbortSignal,
  tracking: PointerTracking,
) {
  const samples: MotionSample[] = [];
  let next: SegmentStart | undefined;
  for (const { delta, reports } of specs) {
    let sample: MotionSample | undefined;
    for (const cross of [0.3, 0.5, 0.7]) {
      try {
        const start =
          next ??
          (await locateStart(
            screen,
            transport,
            delta,
            cross,
            signal,
            tracking,
          ));
        const result = await measureSegment(
          screen,
          transport,
          delta,
          reports,
          start,
          signal,
        );
        next = result.next;
        tracking.position = next.position;
        sample = result.sample;
        break;
      } catch (error) {
        next = undefined;
        tracking.position = undefined;
        signal.throwIfAborted();
        if (cross === 0.7) throw error;
        await pause(120);
      }
    }
    if (!sample) throw new Error('Missing pointer motion sample');
    samples.push(sample);
  }
  return samples;
}

export async function measureMotionModel(
  screen: ScreenSession,
  transport: RelativeTransport,
  signal: AbortSignal,
  warmedTracking?: PointerTracking,
): Promise<{ model: PointerMotionModel; samples: MotionSample[] }> {
  const tracking = warmedTracking ?? {};
  if (!warmedTracking) {
    const frame = await screen.getFrame({ fresh: true, allowUnchanged: true });
    await transport.moveTo({ x: frame.width * 0.2, y: frame.height * 0.3 });
    await warmUpPointer(transport, signal);
  }
  const model: PointerMotionModel = { reports: [] };
  const samples = await measureTrack(
    screen,
    transport,
    CALIBRATION_REPORTS,
    signal,
    tracking,
  );
  for (const sample of samples) {
    const { delta, reports } = sample;
    model.reports.push({
      delta: { ...delta },
      displacement: {
        x: delta.x ? sample.displacement.x / reports : 0,
        y: delta.y ? sample.displacement.y / reports : 0,
      },
    });
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

function predictionError(predicted: Point, sample: MotionSample) {
  const distance = Math.hypot(predicted.x, predicted.y) * sample.reports;
  const error = Math.hypot(
    sample.displacement.x - predicted.x * sample.reports,
    sample.displacement.y - predicted.y * sample.reports,
  );
  return {
    error,
    distance,
    relativeError: error / distance,
    passed: error <= Math.max(4, distance * 0.08),
  };
}

/** Independent axis and diagonal checks, also used before reusing disk data. */
export async function validateMotionModel(
  screen: ScreenSession,
  transport: RelativeTransport,
  model: PointerMotionModel,
  signal: AbortSignal,
  tracking: PointerTracking = {},
  refit?: (sample: MotionSample) => void,
): Promise<MotionValidation> {
  const frame = await screen.getFrame();
  const specs: { delta: Point; reports: number }[] = [];
  const samples: MotionSample[] = [];
  let maxErrorPx = 0;
  let maxRelativeError = 0;
  for (const delta of [
    { x: 8, y: 0 },
    { x: 0, y: 8 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
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
      delta.x === 0 && delta.y === 4 ? 18 : 14,
      Math.floor(available),
      Math.max(
        4,
        Math.ceil(
          (Math.min(frame.width, frame.height) * 0.14) /
            Math.hypot(predicted.x, predicted.y),
        ),
      ),
    );
    if (count < 2)
      throw new Error(
        'Pointer movement is too large to validate inside the screen. Reduce Tracking Speed and retry.',
      );
    specs.push({ delta, reports: count });
  }
  // Each checkpoint verifies an independently measured table entry. Repeat only
  // the checkpoints that miss the same pixel/relative tolerance used at acceptance.
  const first = await measureTrack(screen, transport, specs, signal, tracking);
  const qualityOf = (sample: MotionSample) =>
    predictionError(predictMovement(model, sample.delta), sample);
  const uncertain = first.filter((sample) => !qualityOf(sample).passed);
  const repeats = uncertain.length
    ? await measureTrack(screen, transport, uncertain, signal, tracking)
    : [];
  let repeatIndex = 0;
  for (const initial of first) {
    const spec = { delta: initial.delta, reports: initial.reports };
    const fresh = async () => {
      const [move] = await measureTrack(
        screen,
        transport,
        [spec],
        signal,
        tracking,
      );
      return move;
    };
    let sample = initial;
    if (initial === uncertain[repeatIndex]) {
      const repeat = repeats[repeatIndex++];
      const candidate = {
        x: initial.delta.x ? initial.displacement.x / initial.reports : 0,
        y: initial.delta.y ? initial.displacement.y / initial.reports : 0,
      };
      // The repeat is held out from the proposed correction. It can verify
      // the new entry without sending a third identical move.
      if (
        refit &&
        !qualityOf(repeat).passed &&
        predictionError(candidate, repeat).passed
      ) {
        refit(initial);
        sample = repeat;
      } else {
        sample = await reconcileMoves(initial, repeat, fresh);
        if (!qualityOf(sample).passed && refit) {
          refit(sample);
          sample = await fresh();
        }
      }
    }
    const quality = qualityOf(sample);
    const { error, relativeError } = quality;
    if (!quality.passed)
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
