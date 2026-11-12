import type { MarkerCalibrationDetectionResponse } from '@midscene/robotics-shared/marker-contracts';
import { RobotVisionApiError, type RobotVisionClient } from '../marker-client';

function waitSecond(signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const aborted = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', aborted);
      resolve();
    }, 1000);
    signal.addEventListener('abort', aborted, { once: true });
  });
}

/** Fresh capture batches, each preceded by the three-second countdown. */
const MARKER_CAPTURE_ATTEMPTS = 3;

/** Retry fresh batches, preserving all geometric and per-frame quality gates. */
export async function detectMarkersWithRetry(
  api: Pick<RobotVisionClient, 'detectMarkerCalibration'>,
  sessionId: string,
  token: string,
  targetIds: string[] | undefined,
  options: {
    signal: AbortSignal;
    countdown: (seconds: number, retry: boolean) => void;
    response: (response: MarkerCalibrationDetectionResponse) => void;
    /** Experimental square flow needs a per-screen acquisition budget. */
    temporal?: boolean;
  },
): Promise<MarkerCalibrationDetectionResponse> {
  let previous: MarkerCalibrationDetectionResponse | undefined;
  for (let attempt = 0; attempt < MARKER_CAPTURE_ATTEMPTS; attempt++) {
    const last = attempt === MARKER_CAPTURE_ATTEMPTS - 1;
    for (let seconds = 3; seconds > 0; seconds--) {
      options.signal.throwIfAborted();
      options.countdown(seconds, attempt > 0);
      await waitSecond(options.signal);
    }
    options.signal.throwIfAborted();
    options.countdown(0, attempt > 0);
    try {
      const response = options.temporal
        ? await api.detectMarkerCalibration(sessionId, token, targetIds, {
            temporal: true,
          })
        : await api.detectMarkerCalibration(sessionId, token, targetIds);
      options.signal.throwIfAborted();
      if (!response?.session?.targets || !response.frames)
        throw new Error('Marker detection response is empty');
      options.response(response);
      previous = {
        ...response,
        frames: { ...previous?.frames, ...response.frames },
      };
      const failedIds = response.session.targets
        .filter(
          (target) =>
            target.state === 'failed' &&
            (!targetIds || targetIds.includes(target.id)),
        )
        .map((target) => target.id);
      if (!failedIds.length || last) return previous;
      targetIds = failedIds;
    } catch (error) {
      options.signal.throwIfAborted();
      if (
        !(error instanceof RobotVisionApiError) ||
        error.code !== 'MARKER_DETECTION_FAILED'
      )
        throw error;
      if (last) {
        if (previous) return previous;
        throw error;
      }
    }
  }
  throw new Error('Marker detection returned no result');
}
