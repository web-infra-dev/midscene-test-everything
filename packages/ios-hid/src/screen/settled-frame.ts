import { setTimeout as pause } from 'node:timers/promises';
import { getDebug } from '@midscene/shared/logger';
import sharp from 'sharp';
import type { ScreenFrame } from '../types.js';
import type { ScreenSession } from './source.js';

const debug = getDebug('ios-hid-screen');

async function thumbnail(frame: ScreenFrame) {
  return sharp(frame.jpeg)
    .resize(96, 192, { fit: 'fill' })
    .greyscale()
    .blur(1)
    .raw()
    .toBuffer();
}

/** Wait for visible motion to quiet, with a deadline for video/spinners.
 * This is visual readiness, not a guarantee that application data has loaded.
 * Small isolated changes (pointer, clock, caret) do not reset the quiet window.
 */
export async function settledFrame(
  screen: ScreenSession,
): Promise<ScreenFrame> {
  const started = Date.now();
  let quietSince = started;
  let frame = await screen.getFrame({
    fresh: true,
    allowUnchanged: true,
    timeoutMs: 10000,
  });
  quietSince = Date.now();
  let previous = await thumbnail(frame);
  while (Date.now() - started < 2500) {
    await pause(100);
    const next = await screen.getFrame({
      fresh: true,
      allowUnchanged: true,
      timeoutMs: 10000,
    });
    const pixels = await thumbnail(next);
    let changed = 0;
    let total = 0;
    for (let i = 0; i < pixels.length; i++) {
      const difference = Math.abs(pixels[i] - previous[i]);
      if (difference > 16) changed++;
      total += difference;
    }
    if (
      next.width !== frame.width ||
      next.height !== frame.height ||
      (changed / pixels.length > 0.006 && total / pixels.length > 0.35)
    )
      quietSince = Date.now();
    frame = next;
    previous = pixels;
    if (Date.now() - quietSince >= 320) {
      return frame;
    }
  }
  debug(
    'visual motion still active after deadline; using latest sequence=%d',
    frame.sequence,
  );
  return frame;
}
