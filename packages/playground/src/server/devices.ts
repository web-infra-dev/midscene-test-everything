import { createHash, randomUUID } from 'node:crypto';
import type { ArmController, CalibrationProfile } from '@midscene/arm-kit';
import {
  CameraSessionManager,
  RobotArmDevice,
  RobotArmError,
  listCameras,
} from '@midscene/arm-kit';
import { CalibrationHost } from '@midscene/arm-kit/internal/calibration-server/host';
import { controllerRuntime } from '@midscene/arm-kit/internal/controller-runtime';
import { CalibrationBatch } from './calibration-batch.js';
import type { PhonePairings } from './phone-pairings.js';
import { ScreenCalibration } from './screen-calibration.js';

interface CalibrationSession {
  abort: AbortController;
  phase: string;
  token: string;
  host?: CalibrationHost;
  pending?: Promise<void>;
  ready?: Promise<void>;
  error?: string;
}
export interface DeviceEntry {
  cameraId: string;
  camera: Awaited<ReturnType<CameraSessionManager['acquire']>>;
  device: RobotArmDevice;
  owner: string;
  calibration?: CalibrationSession;
  host?: CalibrationHost;
  hostOpening?: Promise<CalibrationHost>;
}
type PhoneLinks = (token: string) => { name: string; url: string }[];

/** One camera session shared by preview, calibration and the Midscene Device. */
export class PlaygroundDevices {
  readonly batch = new CalibrationBatch(this);
  readonly markerCalibration = new ScreenCalibration(this);
  entries = new Map<string, DeviceEntry>();
  readonly cameras: CameraSessionManager;
  private ownsCameras: boolean;
  private Device: typeof RobotArmDevice;
  private Host: typeof CalibrationHost;
  private phoneLinks: PhoneLinks;
  readonly phoneEntryAtRoot: boolean;
  private pairings?: PhonePairings;
  cameraErrors = new Map<string, string>();
  discoveryError?: string;
  opening = new Map<string, Promise<DeviceEntry>>();
  stopping = new Map<string, Promise<void>>();
  closed = false;
  constructor(
    readonly arm: ArmController,
    {
      cameras,
      Device = RobotArmDevice,
      Host = CalibrationHost,
      phoneLinks = () => [],
      phoneEntryAtRoot = false,
      pairings,
    }: {
      cameras?: CameraSessionManager;
      Device?: typeof RobotArmDevice;
      Host?: typeof CalibrationHost;
      phoneLinks?: PhoneLinks;
      phoneEntryAtRoot?: boolean;
      pairings?: PhonePairings;
    } = {},
  ) {
    this.cameras = cameras ?? new CameraSessionManager();
    this.ownsCameras = !cameras;
    this.Device = Device;
    this.Host = Host;
    this.phoneLinks = phoneLinks;
    this.phoneEntryAtRoot = phoneEntryAtRoot;
    this.pairings = pairings;
  }
  screens() {
    const saved =
      controllerRuntime(this.arm).profileStore.list().screenTargets ?? [];
    const defaults = [...this.entries]
      .filter(([id, e]) => id === e.cameraId && !saved.some((s) => s.id === id))
      .map(([id, e]) => ({ id, cameraId: id, name: e.camera.camera.name }));
    return [...defaults, ...saved.filter((t) => !t.archived)].map((target) => {
      const camera = this.entries.get(target.id)?.camera;
      const correction = camera?.getCorrection();
      return {
        ...target,
        hasCorrection: Boolean(correction),
        hasSavedPerspective: camera?.hasSavedPerspective() ?? false,
        // The stage draws every screen's outline from the saved correction, so
        // the list carries the quad instead of only a yes/no flag.
        ...(correction ? { correction } : {}),
      };
    });
  }
  markerCodes(id: string) {
    const targets =
      controllerRuntime(this.arm).profileStore.list().screenTargets ?? [];
    const target = targets.find((t) => t.id === id);
    const slot =
      target?.markerSlot ??
      (target && target.id !== target.cameraId
        ? targets
            .filter((t) => t.cameraId === target.cameraId)
            .findIndex((t) => t.id === id) + 1
        : 0);
    return [10, 11, 12, 13, 14, 15].map((code) => code + slot * 10);
  }
  async ensureHost(id: string) {
    const entry = await this.open(id);
    if (entry.host) return entry.host;
    entry.hostOpening ??= (async () => {
      const token = (await this.pairings?.token(id)) ?? randomUUID();
      const host = new this.Host({
        arm: this.arm,
        camera: entry.camera,
        deviceId: id,
        markerCodes: this.markerCodes(id),
        basePath: `/api/devices/${encodeURIComponent(id)}/calibration`,
        phoneLinks: () => this.phoneLinks(token),
      });
      try {
        await host.prepare();
        entry.host = host;
        return host;
      } catch (error) {
        await host.close();
        throw error;
      } finally {
        entry.hostOpening = undefined;
      }
    })();
    return entry.hostOpening;
  }
  pairingLinks(token: string) {
    return this.phoneLinks(token);
  }
  async addScreen(cameraId: string, name: string) {
    await this.open(cameraId);
    const existing = this.screens().filter((t) => t.cameraId === cameraId);
    if (existing.length >= 9) throw new Error('At most 9 screens per camera');
    const id = randomUUID();
    const store = controllerRuntime(this.arm).profileStore;
    await store.saveScreenTarget({ id, cameraId, name });
    await this.open(id);
    return { id, cameraId, name };
  }
  async startAll(discover = listCameras) {
    this.discoveryError = undefined;
    try {
      const cameras = await discover({ refresh: true });
      await Promise.allSettled(cameras.map((camera) => this.open(camera.id)));
      const targets =
        controllerRuntime(this.arm).profileStore.list().screenTargets ?? [];
      await Promise.allSettled(
        targets
          .filter((t) => cameras.some((c) => c.id === t.cameraId))
          .map((t) => this.open(t.id)),
      );
    } catch (error) {
      this.discoveryError =
        error instanceof Error ? error.message : String(error);
    }
  }
  async open(id: string, retryFailed = false): Promise<DeviceEntry> {
    if (this.closed) throw new Error('Device host is closed');
    if (this.stopping.has(id)) {
      await this.stopping.get(id);
      return this.open(id, retryFailed);
    }
    if (this.opening.has(id)) return this.opening.get(id)!;
    const existing = this.entries.get(id);
    if (
      existing &&
      !(retryFailed && existing.camera.stream.getInfo().state === 'failed')
    )
      return existing;
    const pending = (async () => {
      if (existing) {
        const { stream } = existing.camera;
        await stream.restart(stream.getOptions());
        return existing;
      }
      const owner = `preview:${randomUUID()}`;
      const target = controllerRuntime(this.arm)
        .profileStore.list()
        .screenTargets?.find((t) => t.id === id);
      const cameraId = target?.cameraId ?? id;
      const screenId = target && target.id !== cameraId ? id : undefined;
      const camera = await this.cameras.acquire(cameraId, owner, screenId);
      const device = new this.Device({
        arm: this.arm,
        camera: cameraId,
        id,
        screenId,
        cameraManager: this.cameras,
      });
      try {
        await device.connect();
        if (this.closed) throw new Error('Device host is closed');
        const entry: DeviceEntry = { cameraId, camera, device, owner };
        this.entries.set(id, entry);
        return entry;
      } catch (error) {
        await device.destroy();
        await this.cameras.release(cameraId, owner);
        throw error;
      }
    })();
    this.opening.set(id, pending);
    try {
      const entry = await pending;
      this.cameraErrors.delete(id);
      return entry;
    } catch (error) {
      this.cameraErrors.set(
        id,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    } finally {
      this.opening.delete(id);
    }
  }
  stop(id: string) {
    if (this.stopping.has(id)) return this.stopping.get(id);
    const pending = (async () => {
      await this.opening.get(id)?.catch(() => undefined);
      const entry = this.entries.get(id);
      if (!entry) return;
      if (entry.cameraId === id) {
        await Promise.all(
          [...this.entries]
            .filter(([key, e]) => key !== id && e.cameraId === id)
            .map(([key]) => this.stop(key)),
        );
      }
      entry.calibration?.abort.abort();
      await entry.host?.close();
      await entry.device.destroy();
      await this.cameras.release(entry.cameraId, entry.owner);
      this.entries.delete(id);
    })();
    this.stopping.set(id, pending);
    void pending.finally(() => this.stopping.delete(id)).catch(() => undefined);
    return pending;
  }
  async configuration(id: string) {
    const { device } = await this.open(id);
    return device.configuration();
  }
  async updateConfiguration(
    id: string,
    kind: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    const { device } = await this.open(id);
    return kind === 'motion-settings'
      ? device.updateMotionSettings(input, signal)
      : device.safePosition(
          input as Parameters<RobotArmDevice['safePosition']>[0],
          signal,
        );
  }
  async transferConfiguration(id: string) {
    const { device } = await this.open(id);
    const calibration = await device.getCalibration();
    return {
      version: createHash('sha256')
        .update(JSON.stringify(calibration))
        .digest('hex'),
      calibration: {
        id: calibration.id,
        observationPose: calibration.observationPose,
        toolProfileId: calibration.toolProfileId,
      },
      routes: this.arm
        .transferRoutes()
        .filter((route) => route.fromCalibrationId === calibration.id),
    };
  }
  async configureTransfer(
    fromId: string,
    toId: string,
    input: Parameters<RobotArmDevice['configureTransferTo']>[1] & {
      sourceVersion: string;
      targetVersion: string;
    },
    signal: AbortSignal,
  ) {
    if (!fromId || !toId || fromId === toId)
      throw new Error('Select two different devices');
    signal?.throwIfAborted();
    const [from, to] = await Promise.all([this.open(fromId), this.open(toId)]);
    signal?.throwIfAborted();
    const [source, target] = await Promise.all([
      this.transferConfiguration(fromId),
      this.transferConfiguration(toId),
    ]);
    if (
      input.sourceVersion !== source.version ||
      input.targetVersion !== target.version
    ) {
      const error = new Error(
        'Calibration changed while editing. Reopen the route editor and review the safe positions.',
      );
      throw Object.assign(error, { code: 'TRANSFER_STALE', status: 409 });
    }
    await from.device.configureTransferTo(to.device, {
      waypoints: input.waypoints,
      confirmed: input.confirmed,
      signal,
    });
    return this.transferConfiguration(fromId);
  }
  private calibrationOpening = new Map<string, Promise<unknown>>();
  startCalibration(id: string): Promise<unknown> {
    this.assertBatchIdle();
    const current = this.calibrationOpening.get(id);
    if (current) return current;
    const pending = this.prepareCalibration(id);
    this.calibrationOpening.set(id, pending);
    void pending
      .finally(() => this.calibrationOpening.delete(id))
      .catch(() => undefined);
    return pending;
  }
  private async prepareCalibration(id: string) {
    const entry = await this.open(id);
    const host = await this.ensureHost(id);
    if (
      entry.calibration &&
      ['queued', 'running'].includes(entry.calibration.phase)
    )
      return this.status(id);
    let ready!: () => void;
    let failed!: (error: unknown) => void;
    const prepared = new Promise<void>((resolve, reject) => {
      ready = resolve;
      failed = reject;
    });
    void prepared.catch(() => undefined);
    const session: CalibrationSession = {
      abort: new AbortController(),
      phase: 'queued',
      ready: prepared,
      // Pairing belongs to this device, not to one calibration attempt.
      token:
        entry.calibration?.token ??
        (await this.pairings?.token(id)) ??
        randomUUID(),
    };
    entry.calibration = session;
    session.pending = entry.device
      .calibrate({
        host,
        signal: session.abort.signal,
        basePath: `/api/devices/${encodeURIComponent(id)}/calibration`,
        phoneLinks: () => this.phoneLinks(session.token),
        markerCodes: this.markerCodes(id),
        interaction: async (host, signal) => {
          session.host = host;
          session.phase = 'running';
          ready();
          return new Promise<CalibrationProfile>((resolve, reject) => {
            const finish = (error?: unknown, result?: CalibrationProfile) => {
              clearInterval(timer);
              signal.removeEventListener('abort', abort);
              if (result) resolve(result);
              else reject(error);
            };
            const abort = () =>
              finish(signal.reason ?? new Error('Calibration cancelled'));
            const timer = setInterval(() => {
              try {
                const state = host.service.status();
                if (state?.stage === 'completed' && state.result)
                  finish(undefined, state.result);
                else if (state?.stage === 'cancelled')
                  finish(new Error('Calibration cancelled'));
              } catch (error) {
                finish(error);
              }
            }, 200);
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
          });
        },
      })
      .then(
        () => {
          session.phase = 'completed';
        },
        (error) => {
          session.phase = session.abort.signal.aborted ? 'cancelled' : 'error';
          session.error = error.message;
          failed(error);
        },
      );
    return this.status(id);
  }
  status(id: string) {
    const session = this.entries.get(id)?.calibration;
    return session
      ? { phase: session.phase, error: session.error }
      : { phase: 'idle' };
  }
  async cancelCalibration(id: string) {
    const entry = this.entries.get(id);
    const session = entry?.calibration;
    if (!session) return;
    this.assertBatchIdle();
    if (session && ['queued', 'running'].includes(session.phase))
      await entry?.host?.service.stop();
    session?.abort.abort();
    await session?.pending;
  }
  assertBatchIdle() {
    const batch = this.batch.read();
    if (
      this.batch.active ||
      (batch && ['running', 'waiting', 'stopping'].includes(batch.status))
    )
      throw new RobotArmError(
        'BUSY',
        'Stop the calibration batch before changing its setup',
        409,
      );
  }
  assertCalibrationRunning(id: string) {
    if (this.entries.get(id)?.calibration?.phase !== 'running')
      throw new RobotArmError(
        'BUSY',
        'Wait for the Controller queue before starting calibration commands',
        409,
      );
  }
  async resolvePhoneHost(token: string | null) {
    if (!token || this.closed) return undefined;
    const active = this.phoneHost(token);
    if (active) return active;
    const cameraId = this.pairings?.camera(token);
    if (!cameraId) return undefined;
    // Restoring the input page prepares a session, never starts collection.
    await this.ensureHost(cameraId);
    return this.entries.get(cameraId)?.host;
  }
  phoneHost(token: string | null) {
    if (!token) return undefined;
    for (const { calibration } of this.entries.values()) {
      if (calibration?.token === token && calibration.phase === 'running')
        return calibration.host;
    }
  }
  async close() {
    this.closed = true;
    await this.batch.close();
    await this.markerCalibration.close();
    await Promise.allSettled(this.opening.values());
    await Promise.all([...this.entries.keys()].map((id) => this.stop(id)));
    if (this.ownsCameras) await this.cameras.close();
  }
}
