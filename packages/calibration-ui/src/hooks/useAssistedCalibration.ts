import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createStore, useStore } from 'zustand';
import { t } from '../i18n';
import type {
  AssistedCalibrationAction,
  AssistedCalibrationInput,
  AssistedCalibrationSetup,
  AssistedCalibrationState,
  AssistedMappingInput,
  CalibrationCommand,
  CalibrationPhoneStatus,
  RobotArmApi,
} from '../robot-arm-api';
import { calibrationAnnouncements } from '../voice/calibration';

export function useAssistedCalibration(
  api: RobotArmApi,
  installation: string | undefined,
  active: boolean,
) {
  const store = useMemo(
    () =>
      createStore<{
        session: AssistedCalibrationState | null;
        setup: AssistedCalibrationSetup;
        phone: CalibrationPhoneStatus;
        busy: boolean;
        error?: string;
        connectionError?: string;
      }>(() => ({
        session: null,
        setup: { prepared: false, phoneConnected: false },
        phone: { state: 'waiting', links: [] },
        busy: false,
      })),
    [api, installation, active],
  );
  const { session, setup, phone, busy, error, connectionError } =
    useStore(store);
  const setBusy = (busy: boolean) => store.setState({ busy });
  const setError = (error: string | undefined) => store.setState({ error });
  const generation = useRef(0);
  const working = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    working.current = false;
    store.setState({
      session: null,
      setup: { prepared: false, phoneConnected: false },
      phone: { state: 'waiting', links: [] },
      error: undefined,
      connectionError: undefined,
      busy: false,
    });
    if (!active) return;
    const announce = calibrationAnnouncements();
    const unsubscribe = api.subscribeCalibration(
      (snapshot) => {
        if (current === generation.current) {
          announce(snapshot);
          store.setState({ ...snapshot, connectionError: undefined });
        }
      },
      () => {
        if (current === generation.current)
          store.setState({
            connectionError: t('Calibration connection lost. Reconnecting…'),
          });
      },
    );
    return () => {
      generation.current++;
      unsubscribe();
    };
  }, [store, api, active]);
  const run = useCallback(
    async <T>(work: () => Promise<T>) => {
      if (working.current)
        throw new Error(t('A calibration command is already running.'));
      working.current = true;
      setBusy(true);
      setError(undefined);
      const current = generation.current;
      try {
        return await work();
      } catch (e) {
        if (generation.current === current)
          setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        if (generation.current === current) {
          working.current = false;
          setBusy(false);
        }
      }
    },
    [store],
  );
  const prepare = (input: AssistedCalibrationInput) =>
    run(() => api.prepareAssistedCalibration(input));
  const map = (output?: AssistedMappingInput) =>
    run(() => api.mapAssistedCalibration(output));
  const create = () => run(() => api.createAssistedCalibration());
  const command = (
    action: AssistedCalibrationAction,
    confirmed = false,
    attemptId?: string,
  ) =>
    run(() => {
      if (!session)
        throw new Error('Start calibration in the Calibration step');
      return api.assistedCalibrationCommand(
        session.id,
        action,
        confirmed,
        attemptId,
      );
    });
  const safety = (type: CalibrationCommand['type'], accepted?: boolean) =>
    run(() => {
      if (!session?.calibration)
        throw new Error('Collect calibration points first');
      return api.assistedCalibrationSafety(session.id, {
        type,
        accepted,
        commandId: crypto.randomUUID(),
        expectedRevision: session.calibration.revision,
      });
    });
  return {
    session,
    setup,
    phone,
    busy,
    error: error ?? connectionError,
    connectionError,
    prepare,
    map,
    create,
    command,
    safety,
  };
}
export type AssistedCalibrationController = ReturnType<
  typeof useAssistedCalibration
>;
