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
        cancelling: boolean;
        error?: string;
        connectionError?: string;
      }>(() => ({
        session: null,
        setup: { prepared: false, phoneConnected: false },
        phone: { state: 'waiting', links: [] },
        busy: false,
        cancelling: false,
      })),
    [api, installation, active],
  );
  const { session, setup, phone, busy, cancelling, error, connectionError } =
    useStore(store);
  const generation = useRef(0);
  const requests = useRef({ count: 0, revision: 0, cancelling: false });
  useEffect(() => {
    const current = ++generation.current;
    requests.current = { count: 0, revision: 0, cancelling: false };
    store.setState({
      session: null,
      setup: { prepared: false, phoneConnected: false },
      phone: { state: 'waiting', links: [] },
      error: undefined,
      connectionError: undefined,
      busy: false,
      cancelling: false,
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
    async <T>(work: () => Promise<T>, cancel = false) => {
      const pending = requests.current;
      if (pending.cancelling || (pending.count && !cancel))
        throw new Error(t('A calibration command is already running.'));
      ++pending.count;
      const revision = ++pending.revision;
      pending.cancelling = cancel;
      store.setState({ busy: true, cancelling: cancel, error: undefined });
      const current = generation.current;
      try {
        return await work();
      } catch (e) {
        if (generation.current !== current || pending.revision !== revision)
          throw new DOMException(
            'Calibration command superseded',
            'AbortError',
          );
        store.setState({ error: e instanceof Error ? e.message : String(e) });
        throw e;
      } finally {
        --pending.count;
        if (cancel) pending.cancelling = false;
        if (generation.current === current)
          store.setState({
            busy: pending.count > 0,
            cancelling: pending.cancelling,
          });
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
    }, action === 'cancel');
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
    cancelling,
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
