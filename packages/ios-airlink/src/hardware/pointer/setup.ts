import type { ScreenSession } from '../screen/source.js';
import type { Point, ScreenFrame } from '../types.js';
import {
  type PointerCandidate,
  detectPointerChanges,
  pointerNear,
  scorePointerPositions,
} from './detector.js';
import {
  type AbsolutePointerCorrection,
  type PointerTurn,
  correctedScreenToPointer,
  pointerToScreen,
  validAbsoluteCorrection,
} from './mapping.js';

export interface PointerTransport {
  absolute(point: Point): Promise<void>;
}
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runtime measurement; no clicks, no phone-side page or installed app. */
export async function measurePointerTurn(
  screen: ScreenSession,
  input: PointerTransport,
  signal: AbortSignal,
): Promise<{
  turn: PointerTurn;
  width: number;
  height: number;
  position?: PointerCandidate;
}> {
  const votes = [0, 0, 0, 0];
  let frame = await screen.getFrame();
  const probes = [
    { x: 0.27, y: 0.32 },
    { x: 0.68, y: 0.61 },
    { x: 0.38, y: 0.72 },
    { x: 0.64, y: 0.36 },
  ];
  let position: PointerCandidate | undefined;
  let winner: PointerTurn | undefined;
  for (const point of probes) {
    signal.throwIfAborted();
    const before = frame;
    let lastSequence = before.sequence;
    await input.absolute(point);
    // Poll multiple frames because video delivery can lag the report.
    let matchedTurn: PointerTurn | undefined;
    for (let attempt = 0; attempt < 8; attempt++) {
      signal.throwIfAborted();
      frame = await screen.getFrame({
        fresh: true,
        afterSequence: lastSequence,
        allowUnchanged: true,
        timeoutMs: 3000,
      });
      if (frame.sequence <= lastSequence) {
        await pause(45);
        continue;
      }
      lastSequence = frame.sequence;
      const turns = [0, 1, 2, 3] as const;
      let scores;
      try {
        scores = await scorePointerPositions(
          before,
          frame,
          turns.map((turn) => pointerToScreen(point, turn)),
        );
      } catch {
        continue;
      }
      const ranked = turns
        .map((turn) => ({ turn, ...scores[turn] }))
        .sort((a, b) => b.mean - a.mean);
      const [best, second] = ranked;
      if (
        best.mean >= 7 &&
        best.fraction >= 0.16 &&
        best.mean > second.mean * 1.45 + 2.5
      ) {
        matchedTurn = best.turn;
        break;
      }
    }
    if (matchedTurn !== undefined) {
      votes[matchedTurn]++;
      const rankedVotes = [...votes]
        .map((count, turn) => ({ turn: turn as PointerTurn, count }))
        .sort((a, b) => b.count - a.count);
      if (
        rankedVotes[0].count >= 2 &&
        rankedVotes[0].count >= rankedVotes[1].count + 2
      ) {
        winner = rankedVotes[0].turn;
        const expected = pointerToScreen(point, winner);
        try {
          const candidates = await detectPointerChanges(before, frame);
          const nearby = candidates.filter((candidate) =>
            pointerNear(
              candidate,
              {
                x: expected.x * (frame.width - 1),
                y: expected.y * (frame.height - 1),
              },
              Math.max(10, Math.min(frame.width, frame.height) * 0.03),
            ),
          );
          if (nearby.length === 1) position = nearby[0];
        } catch {
          position = undefined;
        }
        break;
      }
    }
  }
  if (winner === undefined)
    throw new Error(
      'Cannot reliably locate the mouse pointer. Enable AssistiveTouch, keep the phone still on a static bright screen, then retry.',
    );
  return {
    turn: winner,
    width: frame.width,
    height: frame.height,
    position,
  };
}

export async function measureAbsoluteCorrection(
  screen: ScreenSession,
  input: PointerTransport,
  geometry: { width: number; height: number; turn: PointerTurn },
  signal: AbortSignal,
) {
  const { width, height, turn } = geometry;
  const normalize = (point: Point) => ({
    x: point.x / (width - 1),
    y: point.y / (height - 1),
  });

  async function observe(
    target: Point,
    correction?: AbsolutePointerCorrection,
  ) {
    signal.throwIfAborted();
    const options = { fresh: true, allowUnchanged: true, timeoutMs: 1500 };
    const before = await screen.getFrame(options);
    let sequence = before.sequence;
    let previous: PointerCandidate | undefined;
    let seenAt = 0;
    await input.absolute(correctedScreenToPointer(target, turn, correction));
    for (let attempt = 0; attempt < 20; attempt++) {
      await pause(attempt === 0 ? 25 : 20);
      signal.throwIfAborted();
      const after = await screen.getFrame(options);
      if (
        before.width !== width ||
        before.height !== height ||
        after.width !== width ||
        after.height !== height
      )
        throw new Error('Screen geometry changed during pointer measurement');
      if (after.sequence <= sequence) {
        if (previous && Date.now() - seenAt >= 220) return previous;
        await pause(45);
        continue;
      }
      sequence = after.sequence;

      let changes: PointerCandidate[];
      try {
        changes = await detectPointerChanges(before, after);
      } catch {
        previous = undefined;
        continue;
      }
      const candidates = changes.filter((candidate) => {
        const point = normalize(candidate);
        return (
          Math.abs(point.x - target.x) <= 0.12 &&
          Math.abs(point.y - target.y) <= 0.12
        );
      });
      const candidate = candidates.length === 1 ? candidates[0] : undefined;
      if (candidate && previous && pointerNear(candidate, previous, 1.5))
        return candidate;
      if (candidate) seenAt = Date.now();
      previous = candidate;
    }
    throw new Error(
      'Could not measure camera pointer position. Keep a static bright screen visible and check video latency.',
    );
  }

  const low = 0.25;
  const high = 0.75;
  const maxErrorPx = Math.max(3, Math.min(width, height) * 0.01);
  const closeTo = (point: Point, target: Point) =>
    Math.hypot(
      (point.x - target.x) * (width - 1),
      (point.y - target.y) * (height - 1),
    ) <= maxErrorPx;

  const topLeft = normalize(await observe({ x: low, y: low }));
  const bottomRight = normalize(await observe({ x: high, y: high }));
  const bottomLeft = normalize(await observe({ x: low, y: high }));
  const topRight = normalize(await observe({ x: high, y: low }));
  const start = {
    x: (topLeft.x + bottomLeft.x) / 2,
    y: (topLeft.y + topRight.y) / 2,
  };
  const scale = {
    x: ((topRight.x + bottomRight.x) / 2 - start.x) / (high - low),
    y: ((bottomLeft.y + bottomRight.y) / 2 - start.y) / (high - low),
  };
  const correction: AbsolutePointerCorrection = {
    version: 1,
    scale,
    offset: { x: start.x - low * scale.x, y: start.y - low * scale.y },
  };
  const validationTarget = { x: 0.43, y: 0.57 };
  const predict = (x: number, y: number) => ({
    x: x * scale.x + correction.offset.x,
    y: y * scale.y + correction.offset.y,
  });
  if (
    !validAbsoluteCorrection(correction) ||
    !closeTo(topLeft, predict(low, low)) ||
    !closeTo(bottomRight, predict(high, high)) ||
    !closeTo(bottomLeft, predict(low, high)) ||
    !closeTo(topRight, predict(high, low))
  )
    throw new Error('Camera pointer measurements did not agree');

  const position = await observe(validationTarget, correction);
  if (!closeTo(normalize(position), validationTarget))
    throw new Error('Camera pointer correction did not pass verification');
  return { correction, position };
}
