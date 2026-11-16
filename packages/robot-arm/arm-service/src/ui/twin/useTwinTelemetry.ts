import { useEffect } from 'react';
import type {
  TwinMotionMessage,
  TwinStateMessage,
} from '../../server/twin-types.js';
import type { TwinStage } from './engine';

/** Subscribe after the meshes are ready so the initial joint sample is applied. */
export function useTwinTelemetry(stage: TwinStage | undefined) {
  useEffect(() => {
    if (!stage) return;
    let hasFreshJoints = false;
    const source = new EventSource('/api/twin/stream');
    source.onopen = () => {
      hasFreshJoints = false;
    };
    const sample = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as TwinMotionMessage;
        if (data.type !== 'sample') return;
        hasFreshJoints = !data.stale;
        stage.setJoints(data.joints);
      } catch {
        // Ignore a malformed sample and wait for the next one.
      }
    };
    const state = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as TwinStateMessage;
        if (
          data.type === 'state' &&
          data.pose &&
          data.connected &&
          !data.stale &&
          !data.moving &&
          hasFreshJoints
        )
          stage.alignToPose(data.pose.positionMm);
      } catch {
        // Ignore a malformed state message.
      }
    };
    source.addEventListener('sample', sample as EventListener);
    source.addEventListener('state', state as EventListener);
    return () => {
      source.removeEventListener('sample', sample as EventListener);
      source.removeEventListener('state', state as EventListener);
      source.close();
    };
  }, [stage]);
}
