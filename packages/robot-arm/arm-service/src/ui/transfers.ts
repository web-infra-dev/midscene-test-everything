import type { CartesianPose } from '@midscene/arm-kit/contracts';
import { create } from 'zustand';

export interface TransferConfiguration {
  version: string;
  calibration: {
    id: string;
    observationPose: CartesianPose;
    toolProfileId: string;
  };
  routes: {
    fromCalibrationId: string;
    toCalibrationId: string;
    waypoints: CartesianPose[];
    status: 'verified' | 'stale';
  }[];
}
export interface WaypointDraft {
  x: number | null;
  y: number | null;
  z: number | null;
}
export interface TransferError {
  message: string;
  code?: string;
}
interface TransferState {
  source?: TransferConfiguration;
  target?: TransferConfiguration;
  targetId?: string;
  rows: WaypointDraft[];
  confirmed: boolean;
  dirty: boolean;
  loading: boolean;
  busy: boolean;
  error?: TransferError;
  load(): Promise<void>;
  select(id: string): Promise<void>;
  edit(index: number, axis: keyof WaypointDraft, value: number | null): void;
  add(): void;
  remove(index: number): void;
  confirm(value: boolean): void;
  verify(): Promise<void>;
  dispose(): void;
}
const base = (id: string) => `/api/devices/${encodeURIComponent(id)}/transfer`;
async function request(
  id: string,
  signal: AbortSignal,
  body?: unknown,
): Promise<TransferConfiguration> {
  const response = await fetch(base(id), {
    method: body === undefined ? 'GET' : 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw {
      message: data.error ?? `HTTP ${response.status}`,
      code: data.code,
    } satisfies TransferError;
  return data;
}
const errorOf = (error: unknown): TransferError =>
  error && typeof error === 'object' && 'message' in error
    ? (error as TransferError)
    : { message: String(error) };

/** One store per dialog; switching targets cancels stale loads and resets confirmation. */
export function createTransferStore(sourceId: string) {
  let disposed = false;
  let sourceLoad: AbortController | undefined;
  let targetLoad: AbortController | undefined;
  let verification: AbortController | undefined;
  return create<TransferState>((set, get) => ({
    rows: [],
    confirmed: false,
    dirty: false,
    loading: false,
    busy: false,
    load: async () => {
      sourceLoad?.abort();
      const active = new AbortController();
      sourceLoad = active;
      set({ loading: true, error: undefined });
      try {
        const source = await request(sourceId, active.signal);
        if (!disposed && !active.signal.aborted) set({ source });
      } catch (error) {
        if (!disposed && !active.signal.aborted) set({ error: errorOf(error) });
      } finally {
        if (!disposed && !active.signal.aborted) set({ loading: false });
      }
    },
    select: async (targetId) => {
      if (get().busy) return;
      targetLoad?.abort();
      const active = new AbortController();
      targetLoad = active;
      set({
        targetId,
        target: undefined,
        rows: [],
        confirmed: false,
        dirty: false,
        loading: true,
        error: undefined,
      });
      try {
        const target = await request(targetId, active.signal);
        if (disposed || active.signal.aborted) return;
        const route = get().source?.routes.find(
          (entry) => entry.toCalibrationId === target.calibration.id,
        );
        set({
          target,
          rows: route?.waypoints.map((pose) => ({ ...pose.positionMm })) ?? [],
        });
      } catch (error) {
        if (!disposed && !active.signal.aborted) set({ error: errorOf(error) });
      } finally {
        if (!disposed && !active.signal.aborted) set({ loading: false });
      }
    },
    edit: (index, axis, value) => {
      if (get().busy) return;
      set({
        rows: get().rows.map((row, i) =>
          i === index ? { ...row, [axis]: value } : row,
        ),
        dirty: true,
        confirmed: false,
        error: undefined,
      });
    },
    add: () => {
      if (get().busy || get().rows.length >= 64) return;
      set({
        rows: [...get().rows, { x: null, y: null, z: null }],
        dirty: true,
        confirmed: false,
      });
    },
    remove: (index) => {
      if (get().busy) return;
      set({
        rows: get().rows.filter((_, i) => i !== index),
        dirty: true,
        confirmed: false,
      });
    },
    confirm: (confirmed) => {
      if (!get().busy) set({ confirmed });
    },
    verify: async () => {
      const { source, target, targetId, rows, confirmed, busy } = get();
      if (busy || !source || !target || !targetId || !confirmed) return;
      if (
        rows.some((row) =>
          Object.values(row).some(
            (value) => value === null || !Number.isFinite(value),
          ),
        )
      ) {
        set({
          error: {
            code: 'WAYPOINT_REQUIRED',
            message: 'Enter all measured waypoint coordinates',
          },
        });
        return;
      }
      const active = new AbortController();
      verification = active;
      set({ busy: true, error: undefined });
      try {
        const updated = await request(sourceId, active.signal, {
          targetId,
          sourceVersion: source.version,
          targetVersion: target.version,
          confirmed,
          waypoints: rows.map((row) => ({
            ...source.calibration.observationPose,
            positionMm: row,
          })),
        });
        if (!disposed && !active.signal.aborted)
          set({ source: updated, dirty: false });
      } catch (error) {
        if (!disposed && !active.signal.aborted) set({ error: errorOf(error) });
      } finally {
        if (!disposed) set({ busy: false });
      }
    },
    dispose: () => {
      disposed = true;
      sourceLoad?.abort();
      targetLoad?.abort();
      verification?.abort();
    },
  }));
}
