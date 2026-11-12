import type { ApplicationContext } from '../application/context.js';
import { contactDepthMm } from '../calibration/surface.js';
import type { CalibrationProfile } from '../contracts.js';
import { contactPoint } from '../domain.js';
import type { ScreenMotionHost } from './service.js';
/** Poll interval of the passive screen-plane observer. */
const PLANE_WATCH_INTERVAL_MS = 25;
export interface PlaneWatch {
  /** Host time of the first sample past the plane; undefined when never seen. */
  readonly at?: number;
  stop(): void;
}
/**
 * Watch the fitted screen plane through the adapter's push channel while one
 * contact segment runs.
 *
 * The observer is passive on purpose: a query would compete with the driver's
 * own arrival confirmation, which is exactly the loop whose latency is being
 * measured. It ignores samples older than its own start so a frame left over
 * from the previous segment cannot be mistaken for this one, and it never lets
 * a failing channel break the action.
 */
export function watchScreenPlane(
  host: ScreenMotionHost,
  c: CalibrationProfile,
  ctx: ApplicationContext,
  direction: 'enter' | 'leave',
): PlaneWatch {
  const startedAt = Date.now();
  let at: number | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observe = () => {
    const sample = host.latestToolVector();
    if (sample && sample.receivedAt >= startedAt) {
      const height = contactDepthMm(
        c,
        contactPoint(sample.pose, ctx.tool.offsetMm),
      );
      // Height is signed along the inward normal: positive is past the
      // surface. Arrival tolerance can stop the flange just short of contact,
      // so this comparison is what actually decides when the press started.
      const crossed = direction === 'enter' ? height >= 0 : height < 0;
      if (crossed && at === undefined) at = sample.receivedAt;
    }
  };
  const tick = () => {
    if (stopped) return;
    try {
      observe();
    } catch {
      stop();
      return;
    }
    if (!stopped) timer = setTimeout(tick, PLANE_WATCH_INTERVAL_MS);
  };
  const stop = () => {
    if (stopped) return;
    // Short releases can finish between two 25 ms ticks. Inspect the final
    // passive sample without delaying the lift or inventing a release time.
    try {
      observe();
    } catch {
      /* Optional telemetry must not block completion. */
    }
    stopped = true;
    if (timer) clearTimeout(timer);
  };
  tick();
  return {
    get at() {
      return at;
    },
    stop,
  };
}
