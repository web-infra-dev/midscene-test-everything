import type { PerspectiveTarget } from '@midscene/arm-kit-shared/camera/vision-types';
import { create } from 'zustand';

export interface CameraEntry {
  id: string;
  name: string;
  hasCorrection?: boolean;
  perspectiveTarget?: PerspectiveTarget;
  error?: string;
  stream?: {
    state: string;
    width: number;
    height: number;
    actualFps?: number;
    hasFrame: boolean;
    error?: string;
  };
}
export function cameraStateLabel(camera: CameraEntry) {
  switch (camera.stream?.state) {
    case 'running':
      return 'running';
    case 'starting':
      return 'cameraStarting';
    case 'failed':
      return 'cameraFailed';
    default:
      return camera.error ? 'cameraFailed' : 'stopped';
  }
}
type CameraStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
// Camera records are discovered by the Node host, never manually created in UI.
// Preserve the original listCameras response shape at this migration boundary.
let listRevision = 0;
export const useCameras = create<{
  cameras: CameraEntry[];
  selectedId: string | null;
  status: CameraStatus;
  select: (id: string) => void;
  error?: string;
  pendingId?: string;
  start: (id: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
  refresh: (discover?: boolean) => Promise<void>;
  markCorrection: (id: string, target: PerspectiveTarget) => void;
  markCorrectionCleared: (id: string) => void;
}>((set, get) => ({
  cameras: [],
  selectedId: (() => {
    try {
      return sessionStorage.getItem('arm-playground-device');
    } catch {
      return null;
    }
  })(),
  status: 'idle',
  start: async (id) => {
    if (get().pendingId) return;
    set({ pendingId: id, error: undefined });
    try {
      await cameraRequest('start', id);
      await get().refresh();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ pendingId: undefined });
    }
  },
  stop: async (id) => {
    if (get().pendingId) return;
    set({ pendingId: id, error: undefined });
    try {
      await cameraRequest('stop', id);
      await get().refresh();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ pendingId: undefined });
    }
  },
  select: (selectedId) => {
    set({ selectedId });
    try {
      sessionStorage.setItem('arm-playground-device', selectedId);
    } catch {
      // Selection still works when browser storage is unavailable.
    }
  },
  markCorrection: (id, target) => {
    set((state) => ({
      cameras: state.cameras.map((camera) =>
        camera.id === id
          ? { ...camera, hasCorrection: true, perspectiveTarget: target }
          : camera,
      ),
    }));
  },
  markCorrectionCleared: (id) => {
    set((state) => ({
      cameras: state.cameras.map((camera) =>
        camera.id === id
          ? { ...camera, hasCorrection: false, perspectiveTarget: undefined }
          : camera,
      ),
    }));
  },
  refresh: async (discover = true) => {
    const revision = ++listRevision;
    set({ status: 'loading' });
    try {
      const response = await fetch(
        discover ? '/api/cameras?refresh=true' : '/api/cameras',
        {
          signal: AbortSignal.timeout(5000),
        },
      );
      if (revision !== listRevision) return;
      if (
        response.status === 404 ||
        response.headers.get('content-type')?.includes('text/html')
      ) {
        set({ status: 'unavailable', cameras: [], selectedId: null });
        return;
      }
      if (!response.ok) throw new Error('Camera discovery failed');
      const data: unknown = await response.json();
      if (
        !data ||
        typeof data !== 'object' ||
        !('cameras' in data) ||
        !Array.isArray(data.cameras) ||
        !data.cameras.every(
          (camera: unknown) =>
            camera &&
            typeof camera === 'object' &&
            'id' in camera &&
            typeof camera.id === 'string' &&
            'name' in camera &&
            typeof camera.name === 'string',
        )
      )
        throw new Error('Invalid camera list');
      if (revision !== listRevision) return;
      const cameras = data.cameras as CameraEntry[];
      set({
        cameras,
        error:
          'error' in data && typeof data.error === 'string'
            ? data.error
            : undefined,
        status: 'ready',
        selectedId: cameras.some((camera) => camera.id === get().selectedId)
          ? get().selectedId
          : (cameras[0]?.id ?? null),
      });
    } catch (error) {
      if (revision !== listRevision) return;
      set({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));

async function cameraRequest(action: 'start' | 'stop', id: string) {
  const response = await fetch(`/api/cameras/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Camera request failed');
}
