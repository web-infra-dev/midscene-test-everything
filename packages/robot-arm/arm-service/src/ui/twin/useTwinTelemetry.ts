import { useEffect, useRef, useState } from 'react';
import type {
  TwinMotionMessage,
  TwinStateMessage,
} from '../../server/twin-types.js';

export interface TwinTelemetryStatus {
  connection: 'connecting' | 'live' | 'reconnecting';
  /** True once at least one 30004-backed joint sample arrived. */
  hasJoints: boolean;
  state?: TwinStateMessage;
}

/**
 * One SSE stream per panel. Joint samples never enter React state: the caller
 * writes them straight into the three.js controller so a 30 Hz stream does not
 * re-render the page.
 */
export function useTwinTelemetry(
  onSample: (sample: TwinMotionMessage) => void,
): TwinTelemetryStatus {
  const [status, setStatus] = useState<TwinTelemetryStatus>({
    connection: 'connecting',
    hasJoints: false,
  });
  const sampleHandler = useRef(onSample);
  useEffect(() => {
    sampleHandler.current = onSample;
  }, [onSample]);

  useEffect(() => {
    const source = new EventSource('/api/twin/stream');
    const onOpen = () =>
      setStatus((current) => ({ ...current, connection: 'live' }));
    const onError = () =>
      setStatus((current) => ({ ...current, connection: 'reconnecting' }));
    const onSampleMessage = (event: MessageEvent<string>) => {
      try {
        const message = JSON.parse(event.data) as TwinMotionMessage;
        if (message.type !== 'sample') return;
        sampleHandler.current(message);
        setStatus((current) =>
          current.hasJoints
            ? current
            : { ...current, hasJoints: true, connection: 'live' },
        );
      } catch {
        // Ignore a malformed frame; the next sample is authoritative.
      }
    };
    const onStateMessage = (event: MessageEvent<string>) => {
      try {
        const message = JSON.parse(event.data) as TwinStateMessage;
        if (message.type !== 'state') return;
        setStatus((current) => ({ ...current, state: message }));
      } catch {
        // Ignore.
      }
    };
    source.addEventListener('open', onOpen);
    source.addEventListener('error', onError);
    source.addEventListener('sample', onSampleMessage as EventListener);
    source.addEventListener('state', onStateMessage as EventListener);
    return () => {
      source.removeEventListener('open', onOpen);
      source.removeEventListener('error', onError);
      source.removeEventListener('sample', onSampleMessage as EventListener);
      source.removeEventListener('state', onStateMessage as EventListener);
      source.close();
    };
  }, []);

  return status;
}
