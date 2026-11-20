import { create } from 'zustand';
import { useConnection } from '../connection';
import { RobotArmApiError } from '../robot-arm-api';
import type {
  ControllerMotionSettings,
  ControllerMotionSettingsUpdate,
  RobotAdapterSetup,
  RobotConnectionRequest,
  RobotSetupStatus,
} from '../robot-arm-api';
interface Snapshot {
  setup?: RobotSetupStatus & { connectionDiagram?: 'ethernet' };
  setupAdapters?: RobotAdapterSetup[];
}
interface Store extends Snapshot {
  busy: boolean;
  serviceStatus: 'checking' | 'online' | 'offline';
  error?: string;
  refresh: () => Promise<void>;
  refreshConfiguration: () => Promise<void>;
}
let epoch = 0;
export const useSetupStore = create<Store>((set) => ({
  busy: false,
  serviceStatus: 'checking',
  refresh: async () => {
    await useSetupStore.getState().refreshConfiguration();
    await useConnection.getState().check();
  },
  refreshConfiguration: async () => {
    const token = ++epoch;
    try {
      const data = await request<Snapshot>('');
      if (token !== epoch) return;
      set({ ...data, serviceStatus: 'online', error: undefined });
    } catch (error) {
      if (token === epoch)
        set({ serviceStatus: 'offline', error: String(error) });
    }
  },
}));
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/setup${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new RobotArmApiError(
      data.error?.message ?? data.error ?? `HTTP ${response.status}`,
      data.code,
    );
  return data;
}
const session = () => ({ session: useSetupStore.getState().setup?.session });
const api = {
  configureConnection: (input: RobotConnectionRequest) =>
    request<RobotSetupStatus>('/connection', input),
  connect: () => request<RobotSetupStatus>('/reconnect', session()),
  disable: () => request('/disable', session()),
  controllerMotionSettings: () =>
    request<ControllerMotionSettings>('/motion-settings'),
  updateControllerMotionSettings: (input: ControllerMotionSettingsUpdate) =>
    request<ControllerMotionSettings>('/motion-settings', {
      ...input,
      ...session(),
    }),
};
async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (useSetupStore.getState().busy) return;
  ++epoch;
  useSetupStore.setState({ busy: true, error: undefined });
  try {
    return await fn();
  } catch (error) {
    useSetupStore.setState({ error: String(error) });
    return undefined;
  } finally {
    try {
      await useSetupStore.getState().refresh();
    } finally {
      useSetupStore.setState({ busy: false });
    }
  }
}
export function useRobotArm() {
  const state = useSetupStore();
  const connection = useConnection();
  return {
    ...state,
    setup:
      connection.setupSession &&
      state.setup?.session !== connection.setupSession
        ? undefined
        : state.setup,
    state: connection.runtime,
    capabilities: connection.capabilities,
    adapter: connection.adapter,
    connectionError: connection.error,
    api,
    run,
  };
}
export type RobotArmController = ReturnType<typeof useRobotArm>;
