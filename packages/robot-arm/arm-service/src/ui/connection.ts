import { create } from 'zustand';
import { robotVoice } from './calibration';
import type { EffectiveCapabilities, RuntimeState } from './robot-arm-api';

export type Phase =
  | 'checking'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'interrupted';
export interface ControlState {
  remoteBusy?: boolean;
  activeCalibrationId?: string;
  positionUnknown: boolean;
  manualBusy: boolean;
  manualAction?: {
    screenId: string;
    action: 'tap' | 'longPress' | 'swipe' | 'dragAndDrop';
    startedAt: number;
  };
}
interface RuntimeSnapshot {
  runtime?: RuntimeState;
  capabilities?: EffectiveCapabilities;
  adapter?: { name?: string; connectionIdentity: string };
  control?: ControlState;
  setupSession?: string;
}
interface ConnectionSnapshot extends RuntimeSnapshot {
  phase: Phase;
  host?: string;
  error?: string;
  recoveryRequired?: boolean;
  softwarePaused?: boolean;
  state?: { enabled: boolean; moving: boolean; mode: string };
}
async function request(
  path: string,
  data?: unknown,
): Promise<ConnectionSnapshot> {
  const response = await fetch(`/api/arm${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
interface ConnectionStore extends RuntimeSnapshot {
  recoveryRequired?: boolean;
  controlPending?: 'stop' | 'recover' | 'disconnect';
  controlError?: string;
  stop: () => Promise<void>;
  recover: () => Promise<void>;
  phase: Phase;
  host: string;
  error?: string;
  check: (fresh?: boolean) => Promise<void>;
  disconnect: () => Promise<void>;
}
let controlRevision = 0;
let checking: Promise<void> | undefined;
export const useConnection = create<ConnectionStore>((set, get) => ({
  phase: 'checking',
  host: '',
  stop: async () => {
    const revision = ++controlRevision;
    set({
      controlPending: 'stop',
      controlError: undefined,
      recoveryRequired: true,
    });
    try {
      const result = await request('/stop', {});
      if (revision === controlRevision) robotVoice.notify('stopSent', 3);
      if (revision === controlRevision)
        set({ recoveryRequired: result.recoveryRequired });
    } catch (error) {
      if (revision === controlRevision) {
        robotVoice.notify('stopFailed', 3);
        set({ controlError: String(error) });
      }
    } finally {
      if (revision === controlRevision) set({ controlPending: undefined });
    }
  },
  recover: async () => {
    if (get().controlPending) return;
    const revision = ++controlRevision;
    set({ controlPending: 'recover', controlError: undefined });
    try {
      const result = await request('/recover', {
        confirmed: true,
        session: get().setupSession,
      });
      if (revision === controlRevision)
        set({ recoveryRequired: result.recoveryRequired });
    } catch (error) {
      if (revision === controlRevision) set({ controlError: String(error) });
    } finally {
      if (revision === controlRevision) set({ controlPending: undefined });
    }
  },
  check: (fresh = false) => {
    if (checking)
      return fresh ? checking.then(() => get().check(true)) : checking;
    checking = (async () => {
      const revision = controlRevision;
      if (get().controlPending) return;
      try {
        const snapshot = await request(fresh ? '?fresh=true' : '');
        if (get().controlPending || revision !== controlRevision) return;
        set({
          runtime: snapshot.runtime,
          capabilities: snapshot.capabilities,
          adapter: snapshot.adapter,
          control: snapshot.control,
          setupSession: snapshot.setupSession,
          ...(snapshot.setupSession &&
          snapshot.setupSession !== get().setupSession
            ? { controlError: undefined }
            : {}),
          recoveryRequired: snapshot.recoveryRequired,
          phase:
            snapshot.phase === 'disconnected' && get().phase === 'connected'
              ? 'interrupted'
              : snapshot.phase,
          host: snapshot.host ?? get().host,
          error: snapshot.error,
        });
      } catch (error) {
        if (!get().controlPending && revision === controlRevision)
          set({
            runtime: undefined,
            capabilities: undefined,
            adapter: undefined,
            phase: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
      }
    })().finally(() => {
      checking = undefined;
    });
    return checking;
  },
  disconnect: async () => {
    if (get().controlPending) return;
    const revision = ++controlRevision;
    set({ controlPending: 'disconnect' });
    try {
      const state = await request('/disconnect', {
        session: get().setupSession,
      });
      if (revision !== controlRevision) return;
      set({
        runtime: undefined,
        capabilities: undefined,
        adapter: undefined,
        control: undefined,
        setupSession: state.setupSession,
        phase: state.phase,
        error: state.error,
        recoveryRequired: state.recoveryRequired,
        controlError: undefined,
      });
    } catch (error) {
      if (revision === controlRevision) set({ controlError: String(error) });
    } finally {
      if (revision === controlRevision) set({ controlPending: undefined });
    }
  },
}));
