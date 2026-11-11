import type { ScreenSession } from '../screen/source.js';
import type { Point, ScreenFrame } from '../types.js';
import { scorePointerPositions } from './detector.js';
import { type PointerTurn, pointerToScreen } from './mapping.js';

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
): Promise<{ turn: PointerTurn; width: number; height: number }> {
  const votes = [0, 0, 0, 0];
  let frame = await screen.getFrame({ fresh: true, allowUnchanged: true });
  for (const point of [
    { x: 0.27, y: 0.32 },
    { x: 0.68, y: 0.61 },
    { x: 0.38, y: 0.72 },
  ]) {
    signal.throwIfAborted();
    const before = frame;
    await input.absolute(point);
    // Poll multiple frames because video delivery can lag the report.
    const matched = new Set<number>();
    for (let attempt = 0; attempt < 5; attempt++) {
      await pause(100);
      signal.throwIfAborted();
      frame = await screen.getFrame({
        fresh: true,
        allowUnchanged: true,
        timeoutMs: 3000,
      });
      const turns = [0, 1, 2, 3] as const;
      const scores = await scorePointerPositions(
        before,
        frame,
        turns.map((turn) => pointerToScreen(point, turn)),
      );
      const ranked = turns
        .map((turn) => ({ turn, ...scores[turn] }))
        .sort((a, b) => b.mean - a.mean);
      const [best, second] = ranked;
      if (
        best.mean >= 8 &&
        best.fraction >= 0.2 &&
        best.mean > second.mean * 1.5 + 3
      )
        matched.add(best.turn);
      if (matched.size === 1) break;
    }
    for (const turn of matched) votes[turn]++;
  }
  const matches = votes.flatMap((count, turn) =>
    count === 3 ? [turn as PointerTurn] : [],
  );
  if (matches.length !== 1)
    throw new Error(
      'Cannot reliably locate the mouse pointer. Enable AssistiveTouch, keep the phone still on a static bright screen, then retry.',
    );
  return { turn: matches[0], width: frame.width, height: frame.height };
}
