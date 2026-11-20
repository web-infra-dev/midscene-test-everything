import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import type {
  AssistedCalibrationInput,
  AssistedMappingInput,
} from '../robot-arm-api';
import type { CameraProfile } from '../types';
import type { AssistedCalibrationController } from './useAssistedCalibration';

/** Validate each saved correction/layout once; failures require an explicit retry. */
export function useCameraMarkerMapping({
  controller,
  camera,
  output,
  input,
  correctionKey,
  blocked,
}: {
  controller: AssistedCalibrationController;
  camera?: CameraProfile;
  input?: AssistedCalibrationInput;
  output?: AssistedMappingInput;
  correctionKey?: string;
  blocked: boolean;
}) {
  const [attempt, setAttempt] = useState<{
    key: string;
    status: 'pending' | 'success' | 'error';
    error?: string;
  }>();
  const [mappingBusy, setMappingBusy] = useState(false);
  const running = useRef(false);
  const mounted = useRef(true);
  const { setup, session, busy } = controller;
  const mapping = setup.mapping;
  const canMap = Boolean(
    input &&
      (!session ||
        ['ready', 'completed'].includes(session.stage) ||
        (session.samples === 0 &&
          session.points.length === 0 &&
          ['interrupted', 'cancelled'].includes(session.stage))),
  );
  const requestKey =
    correctionKey && setup.layout && output
      ? JSON.stringify([
          input?.robotProfileId,
          input?.toolProfileId,
          correctionKey,
          setup.layout,
          output.cameraId,
          output.width,
          output.height,
        ])
      : undefined;
  const currentKey = useRef(requestKey);
  currentKey.current = requestKey;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (
      !requestKey ||
      !canMap ||
      !setup.phoneConnected ||
      !camera?.online ||
      busy ||
      blocked ||
      running.current ||
      attempt?.key === requestKey
    )
      return;
    running.current = true;
    setMappingBusy(true);
    setAttempt({ key: requestKey, status: 'pending' });
    void controller
      .prepare(input!)
      .then(() => controller.map(output))
      .then((next) => {
        if (
          !next.mapping ||
          next.mapping.vision.cameraId !== camera.id ||
          next.mapping.vision.width !== output?.width ||
          next.mapping.vision.height !== output?.height ||
          JSON.stringify(next.mapping.layout) !== JSON.stringify(setup.layout)
        )
          throw new Error(
            t('Page marker mapping was not returned. Retry camera mapping.'),
          );
        if (mounted.current && currentKey.current === requestKey)
          setAttempt({ key: requestKey, status: 'success' });
      })
      .catch((e) => {
        if (mounted.current && currentKey.current === requestKey)
          setAttempt({
            key: requestKey,
            status: 'error',
            error: e instanceof Error ? e.message : String(e),
          });
      })
      .finally(() => {
        running.current = false;
        if (mounted.current) setMappingBusy(false);
      });
  }, [
    requestKey,
    canMap,
    setup.phoneConnected,
    camera,
    busy,
    blocked,
    attempt,
    controller.map,
    controller.prepare,
    input,
    output,
    mappingBusy,
  ]);
  const mappingError = attempt?.key === requestKey ? attempt?.error : undefined;
  const mapped = Boolean(
    requestKey &&
      mapping &&
      mapping.vision.cameraId === camera?.id &&
      mapping.vision.width === output?.width &&
      mapping.vision.height === output?.height &&
      JSON.stringify(mapping.layout) === JSON.stringify(setup.layout) &&
      (!canMap ||
        (attempt?.key === requestKey && attempt.status === 'success')),
  );
  const retry = useCallback(() => setAttempt(undefined), []);
  return {
    mapped,
    mappingBusy,
    mappingError,
    canMap,
    retry,
  };
}
