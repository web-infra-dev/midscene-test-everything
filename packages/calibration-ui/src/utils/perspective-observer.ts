import type {
  PerspectiveValidityCheck,
  PerspectiveValiditySummary,
} from '@midscene/robotics-shared/contracts';

export interface PerspectiveObservation {
  summary?: PerspectiveValiditySummary;
  check?: PerspectiveValidityCheck;
  error?: string;
}
/** Bounded, non-overlapping checks; an unavailable frame cannot erase evidence. */
export function observePerspective(options: {
  baseUrl: string;
  visible(): boolean;
  publish(observation: PerspectiveObservation): void;
}) {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let running = false;
  let last: PerspectiveObservation = {};
  const refresh = async () => {
    if (running || abort.signal.aborted) return;
    clearTimeout(timer);
    if (options.visible()) {
      running = true;
      try {
        const response = await fetch(`${options.baseUrl}/camera/validity`, {
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5_000)]),
          cache: 'no-store',
        });
        const data = await response.json();
        if (data.summary) last = { ...last, summary: data.summary };
        if (!response.ok)
          throw new Error(
            data.error?.message ??
              data.error ??
              'Outline verification unavailable',
          );
        if (data.skipped === 'reference-page-unavailable') {
          last =
            data.summary?.state === 'invalid' ? { summary: data.summary } : {};
        } else {
          if (!data.validity || !data.summary)
            throw new Error('Outline verification unavailable');
          last = { check: data, summary: data.summary };
        }
      } catch (error) {
        if (abort.signal.aborted) return;
        last = {
          ...last,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        running = false;
      }
      if (!abort.signal.aborted) options.publish(last);
    }
    if (!abort.signal.aborted)
      timer = setTimeout(
        refresh,
        last.summary?.state === 'invalid'
          ? 2_000
          : last.summary?.state === 'valid' && !last.error
            ? 10_000
            : 4_000,
      );
  };
  void refresh();
  return {
    refresh,
    close() {
      abort.abort();
      clearTimeout(timer);
    },
  };
}
