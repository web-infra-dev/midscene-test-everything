import {
  type MotionHandle,
  type MotionResult,
  RobotArmError,
} from '../contracts.js';

/** Aborting a waiter never implies a physical stop. Runtime owns stop(). */
export function createMotionHandle(
  id: string,
  terminal: Promise<MotionResult>,
): MotionHandle {
  terminal.catch(() => undefined);
  return {
    id,
    acceptedAt: new Date().toISOString(),
    wait(options = {}) {
      return new Promise((resolve, reject) => {
        // `abort()` below can fire before the timeout is created, so this must
        // be declared (undefined) up front; `const` would hit the TDZ.
        // biome-ignore lint/style/useConst: assigned once, but only after the abort path may already have run.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const cleanup = () => {
          if (timer) clearTimeout(timer);
          options.signal?.removeEventListener('abort', abort);
        };
        const abort = () => {
          cleanup();
          reject(
            new RobotArmError(
              'WAIT_ABORTED',
              'Motion wait aborted; stop is not implied',
              409,
            ),
          );
        };
        if (options.signal?.aborted) {
          abort();
          return;
        }
        options.signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => {
          cleanup();
          reject(
            new RobotArmError(
              'MOTION_TIMEOUT',
              'Physical completion is unknown',
              504,
            ),
          );
        }, options.timeoutMs ?? 60000);
        terminal.then(
          (r) => {
            cleanup();
            resolve(r);
          },
          (e) => {
            cleanup();
            reject(e);
          },
        );
      });
    },
  };
}
