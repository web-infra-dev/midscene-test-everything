import { createHash, randomUUID } from 'node:crypto';
import type { ArmController, CalibrationProfile } from '@midscene/arm-kit';
import {
  CameraSessionManager,
  RobotArmError,
  listCameras,
} from '@midscene/arm-kit';
import { CalibrationHost } from '@midscene/arm-kit/internal/calibration-server/host';
import { calibrationPreviewPositions } from '@midscene/arm-kit/internal/calibration-server/preview-positions';
import { controllerRuntime } from '@midscene/arm-kit/internal/controller-runtime';
import { RobotArmDevice } from '@midscene/arm-kit/internal/device';
import { CalibrationBatch } from './calibration-batch.js';
import type { PhonePairings } from './phone-pairings.js';
import { ScreenCalibration, nextScreenName } from './screen-calibration.js';

interface CalibrationSession {
  attemptId: string;
  cancelling?: Promise<void>;
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
  private pairings?: PhonePairings;
  cameraErrors = new Map<string, string>();
  discoveryError?: string;
  opening = new Map<string, Promise<DeviceEntry>>();
  stopping = new Map<string, Promise<void>>();
  /** Targets created by Add Screen stay visible until the flow commits or cancels. */
  private readonly addedScreens = new Set<string>();
  closed = false;
  constructor(
    readonly arm: ArmController,
    {
      cameras,
      Device = RobotArmDevice,
      Host = CalibrationHost,
      phoneLinks = () => [],
      pairings,
    }: {
      cameras?: CameraSessionManager;
      Device?: typeof RobotArmDevice;
      Host?: typeof CalibrationHost;
      phoneLinks?: PhoneLinks;
      pairings?: PhonePairings;
    } = {},
  ) {
    this.cameras = cameras ?? new CameraSessionManager();
    this.ownsCameras = !cameras;
    this.Device = Device;
    this.Host = Host;
    this.phoneLinks = phoneLinks;
    this.pairings = pairings;
    controllerRuntime(this.arm).batchTransferContext = (from, to) =>
      this.batch.transferContext(from, to);
  }
  private get store() {
    return controllerRuntime(this.arm).profileStore;
  }
  private screenHasDurableIdentity(
    target: {
      id: string;
      cameraId: string;
      pageKey?: string;
      pending?: boolean;
    },
    pageTargetIds: ReadonlySet<string>,
  ) {
    if (
      target.pending === false ||
      target.id === target.cameraId ||
      target.pageKey !== undefined ||
      pageTargetIds.has(target.id) ||
      this.store.calibrationMapping(target.id) ||
      this.store.deviceBinding(target.id)
    )
      return true;
    const entry = this.entries.get(target.id);
    return Boolean(
      entry?.camera.getCorrection() || entry?.camera.hasSavedPerspective(),
    );
  }
  screens(includePreviewPositions = false) {
    const runtime = controllerRuntime(this.arm);
    const profiles = runtime.profileStore.list();
    const saved = profiles.screenTargets ?? [];
    const pageTargetIds = new Set(
      (profiles.screenPages ?? []).flatMap((page) =>
        page.targetId ? [page.targetId] : [],
      ),
    );
    const defaults = [...this.entries]
      .filter(([id, e]) => id === e.cameraId && !saved.some((s) => s.id === id))
      .map(([id, e]) => ({ id, cameraId: id, name: e.camera.camera.name }));
    const targets: {
      id: string;
      cameraId: string;
      name: string;
      pageKey?: string;
      markerSlot?: number;
    }[] = [
      ...defaults,
      ...saved.filter(
        (target) =>
          !target.archived &&
          this.screenHasDurableIdentity(target, pageTargetIds),
      ),
    ];
    return targets.map((target) => {
      const entry = this.entries.get(target.id);
      const camera = entry?.camera;
      const correction = camera?.getCorrection();
      return {
        id: target.id,
        cameraId: target.cameraId,
        name: target.name,
        ...(target.pageKey !== undefined ? { pageKey: target.pageKey } : {}),
        ...(target.markerSlot !== undefined
          ? { markerSlot: target.markerSlot }
          : {}),
        hasCorrection: Boolean(correction),
        hasSavedPerspective: camera?.hasSavedPerspective() ?? false,
        // The stage draws every applied screen's outline, so the list carries
        // the live quad instead of only a yes/no flag. Never spread the stored
        // target: an older naming path saved the whole screen DTO there, and
        // its snapshot correction would outlive a cleared perspective.
        ...(correction
          ? {
              correction,
              previewPositions:
                includePreviewPositions && camera
                  ? entry.host
                    ? entry.host.previewPositions()
                    : calibrationPreviewPositions(runtime, camera, target.id, {
                        profiles,
                      })
                  : undefined,
              perspectiveTarget: camera?.getRectifiedPreviewTarget(),
            }
          : {}),
      };
    });
  }
  markerSlot(id: string) {
    const targets =
      controllerRuntime(this.arm).profileStore.list().screenTargets ?? [];
    const target = targets.find((t) => t.id === id);
    if (target?.markerSlot !== undefined) return target.markerSlot;
    const cameraId = target?.cameraId ?? id;
    const screens = targets.filter(
      (t) => t.cameraId === cameraId && !t.archived,
    );
    const used = new Set(
      screens.flatMap((t) =>
        t.markerSlot === undefined ? [] : [t.markerSlot],
      ),
    );
    // Reserve an unsaved default too. An already-open host must keep its codes
    // if a sibling enters calibration before it does.
    for (const next of [
      cameraId,
      ...screens.filter((t) => t.id !== cameraId).map((t) => t.id),
    ]) {
      if (screens.find((t) => t.id === next)?.markerSlot !== undefined)
        continue;
      let slot = 0;
      while (used.has(slot)) slot++;
      if (next === id) return slot;
      used.add(slot);
    }
    throw new RobotArmError('INVALID_ARGUMENT', 'Screen not found');
  }
  markerCodes(id: string) {
    const slot = this.markerSlot(id);
    return [10, 11, 12, 13, 14, 15].map((code) => code + slot * 10);
  }
  /**
   * Older Add Screen cancellation paths could leave an active target with no
   * page, mapping or perspective. Those records are not screens: hide them from
   * every list and retire them so marker slots and generated names are reused.
   */
  async pruneUnusedScreenTargets(
    cameraId?: string,
    options: { includePending?: boolean } = {},
  ) {
    const profiles = controllerRuntime(this.arm).profileStore.list();
    const pageTargetIds = new Set(
      (profiles.screenPages ?? []).flatMap((page) =>
        page.targetId ? [page.targetId] : [],
      ),
    );
    for (const target of profiles.screenTargets ?? []) {
      if (
        target.archived ||
        (cameraId && target.cameraId !== cameraId) ||
        (!options.includePending && this.addedScreens.has(target.id)) ||
        this.screenHasDurableIdentity(target, pageTargetIds)
      )
        continue;
      const persisted = await this.cameras.persistedPerspective?.(
        target.cameraId,
        target.id === target.cameraId ? undefined : target.id,
      );
      if (persisted?.correction) continue;
      await controllerRuntime(this.arm).profileStore.archiveScreenTarget(
        target.id,
      );
      this.addedScreens.delete(target.id);
      await this.stop(target.id)?.catch(() => undefined);
    }
  }
  pendingAddedScreen(id: string) {
    this.addedScreens.add(id);
  }
  async commitAddedScreen(id: string) {
    this.addedScreens.delete(id);
    const target = this.store
      .list()
      .screenTargets?.find((entry) => entry.id === id && !entry.archived);
    if (target?.pending)
      await this.store.updateScreenTarget(id, { pending: false });
  }
  discardAddedScreen(id: string) {
    this.addedScreens.delete(id);
  }
  screenTarget(id: string, includeArchived = false) {
    const target = this.store
      .list()
      .screenTargets?.find(
        (entry) => entry.id === id && (includeArchived || !entry.archived),
      );
    return target
      ? {
          id: target.id,
          cameraId: target.cameraId,
          name: target.name,
          pageKey: target.pageKey,
          markerSlot: target.markerSlot,
          archived: target.archived,
        }
      : undefined;
  }
  async setCameraImagingPattern(
    cameraId: string,
    request?: string,
    screenIds?: readonly string[],
  ) {
    const requested = screenIds?.length ? new Set(screenIds) : undefined;
    const hosts = [...this.entries.values()]
      .filter(
        (entry) =>
          entry.cameraId === cameraId &&
          entry.host &&
          (!requested || requested.has(entry.device.id)),
      )
      .map((entry) => entry.host!);
    if (!request) {
      for (const host of hosts) host.service.clearImagingPattern();
      return;
    }
    const connected = hosts.filter(
      (host) => host.service.phoneStatus().state === 'connected',
    );
    if (requested && connected.length !== requested.size)
      throw new RobotArmError(
        'PHONE_UNAVAILABLE',
        'Reconnect every target screen calibration page before tuning the camera image.',
        409,
      );
    if (!connected.length)
      throw new RobotArmError(
        'PHONE_UNAVAILABLE',
        'Reconnect the phone calibration page before tuning the camera image.',
        409,
      );
    const richPatternHosts = connected.filter((host) =>
      host.service.supportsImagingPattern(),
    );
    if (richPatternHosts.length !== connected.length)
      throw new RobotArmError(
        'PHONE_PAGE_OUTDATED',
        'Reload every phone calibration page before tuning the camera image.',
        409,
      );
    for (const host of richPatternHosts)
      host.service.showImagingPattern(request);
    const deadline = Date.now() + 2_200;
    while (
      richPatternHosts.some(
        (host) => !host.service.imagingPatternObservation(request),
      ) &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 80));
    if (
      richPatternHosts.some(
        (host) => !host.service.imagingPatternObservation(request),
      )
    )
      throw new RobotArmError(
        'PHONE_PAGE_OUTDATED',
        'The phone did not display the camera imaging pattern. Reload the calibration page and retry.',
        409,
      );
  }
  async calibrateCameraImaging(
    cameraId: string,
    screenIds?: readonly string[],
  ) {
    const targetIds = screenIds?.length
      ? [...new Set(screenIds)]
      : [...this.entries.values()]
          .filter((entry) => entry.cameraId === cameraId && entry.host)
          .map((entry) => entry.device.id);
    if (!targetIds.length)
      throw new RobotArmError(
        'MAPPING_REQUIRED',
        'No mapped screens are available for camera imaging calibration',
        409,
      );
    const request = randomUUID();
    const entry = [...this.entries.values()].find(
      (item) =>
        item.cameraId === cameraId &&
        item.host &&
        targetIds.includes(item.device.id),
    );
    if (!entry)
      throw new RobotArmError(
        'VISION_UNAVAILABLE',
        'No calibration host is active for this camera',
        409,
      );
    const calibrationToken = entry.camera.beginScreensImaging(targetIds);
    try {
      await this.setCameraImagingPattern(cameraId, request, targetIds);
      return await entry.camera.calibrateScreens(targetIds, calibrationToken);
    } catch (error) {
      entry.camera.failScreensImaging(calibrationToken, targetIds, error);
      throw error;
    } finally {
      await this.setCameraImagingPattern(cameraId, undefined, targetIds).catch(
        () => undefined,
      );
    }
  }

  async activateCameraImaging(cameraId: string, screenId: string) {
    const target = this.screenTarget(screenId);
    if (!target || target.cameraId !== cameraId)
      throw new RobotArmError(
        'PROFILE_MISMATCH',
        'Screen belongs to another camera',
        409,
      );
    const entry = this.entries.get(screenId) ?? (await this.open(screenId));
    if (entry.cameraId !== cameraId)
      throw new RobotArmError('PROFILE_MISMATCH', 'Screen camera changed', 409);
    return entry.camera.activateImaging();
  }
  async ensureHost(id: string, runningOnly = false) {
    const entry = runningOnly ? this.entries.get(id) : await this.open(id);
    if (!entry || this.closed || this.stopping.has(id))
      throw new RobotArmError(
        'VISION_UNAVAILABLE',
        'Camera is not running',
        409,
      );
    if (entry.host) {
      await entry.host.prepare(false);
      return entry.host;
    }
    entry.hostOpening ??= (async () => {
      const token = (await this.pairings?.token(id)) ?? randomUUID();
      const store = controllerRuntime(this.arm).profileStore;
      const target = store.list().screenTargets?.find((t) => t.id === id);
      if (target && target.markerSlot === undefined)
        await store.updateScreenTarget(id, { markerSlot: this.markerSlot(id) });
      const host = new this.Host({
        arm: this.arm,
        camera: entry.camera,
        deviceId: id,
        sharedTool: true,
        markerCodes: this.markerCodes(id),
        onImagingPattern: (request) =>
          this.setCameraImagingPattern(entry.cameraId, request, [id]),
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
      }
    })();
    const opening = entry.hostOpening;
    try {
      return await opening;
    } finally {
      if (entry.hostOpening === opening) entry.hostOpening = undefined;
    }
  }
  pairingLinks(token: string) {
    return this.phoneLinks(token);
  }
  async addScreen(cameraId: string, name?: string) {
    await this.open(cameraId);
    await this.pruneUnusedScreenTargets(cameraId);
    const store = controllerRuntime(this.arm).profileStore;
    const durable = this.screens().filter((t) => t.cameraId === cameraId);
    const pending = (store.list().screenTargets ?? [])
      .filter(
        (target) =>
          !target.archived &&
          target.cameraId === cameraId &&
          this.addedScreens.has(target.id) &&
          !durable.some((screen) => screen.id === target.id),
      )
      .map((target) => ({ id: target.id, name: target.name }));
    const existing = [...durable, ...pending];
    if (existing.length >= 9) throw new Error('At most 9 screens per camera');
    const screenName = name ?? nextScreenName(existing);
    const profiles = store.list();
    const pageTargetIds = new Set(
      (profiles.screenPages ?? []).flatMap((page) =>
        page.targetId ? [page.targetId] : [],
      ),
    );
    const stale = profiles.screenTargets?.find(
      (target) =>
        !target.archived &&
        target.cameraId === cameraId &&
        this.addedScreens.has(target.id) &&
        target.name.toLocaleLowerCase('en-US') ===
          screenName.toLocaleLowerCase('en-US') &&
        !this.screenHasDurableIdentity(target, pageTargetIds),
    );
    if (stale) {
      await store.archiveScreenTarget(stale.id);
      this.discardAddedScreen(stale.id);
      await this.stop(stale.id)?.catch(() => undefined);
    }
    const id = randomUUID();
    await store.saveScreenTarget({
      id,
      cameraId,
      name: screenName,
      pending: true,
    });
    this.pendingAddedScreen(id);
    try {
      await this.ensureHost(id);
      return { id, cameraId, name: screenName };
    } catch (error) {
      try {
        this.discardAddedScreen(id);
        await store.archiveScreenTarget(id);
      } finally {
        await this.stop(id);
      }
      throw error;
    }
  }
  async startAll(discover = listCameras, previewing: readonly string[] = []) {
    this.discoveryError = undefined;
    try {
      const cameras = await discover({ refresh: true });
      const cameraIds = new Set([
        ...cameras.map((camera) => camera.id),
        ...previewing,
      ]);
      await Promise.allSettled([...cameraIds].map((id) => this.open(id)));
      await this.pruneUnusedScreenTargets(undefined, { includePending: true });
      const targets =
        controllerRuntime(this.arm).profileStore.list().screenTargets ?? [];
      await Promise.allSettled(
        targets
          .filter((t) => !t.archived && cameraIds.has(t.cameraId))
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
        sharedTool: true,
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
    const opening = this.calibrationOpening.get(id);
    if (
      opening &&
      this.entries.get(id)?.calibration?.attemptId !== opening.attemptId
    )
      opening.abort.abort();
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
      if (entry.calibration)
        await this.cancelCalibration(id, entry.calibration.attemptId);
      // A host preparing concurrently still owns listeners and a phone socket.
      await entry.hostOpening?.catch(() => undefined);
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
    const entry = this.entries.get(id);
    if (!entry || this.stopping.has(id))
      throw new RobotArmError(
        'VISION_UNAVAILABLE',
        'Start the camera before checking calibration',
        409,
      );
    try {
      return await entry.device.configuration();
    } catch (error) {
      if (
        !(error instanceof RobotArmError) ||
        error.code !== 'EXECUTION_CONTEXT_CHANGED' ||
        this.entries.get(id) !== entry ||
        this.stopping.has(id)
      )
        throw error;
      entry.device.refreshCalibrationContext();
      return entry.device.configuration();
    }
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
  private calibrationOpening = new Map<
    string,
    { attemptId: string; abort: AbortController; pending: Promise<unknown> }
  >();
  startCalibration(id: string): Promise<unknown> {
    this.assertBatchIdle();
    if (
      !this.store.sharedCalibrationTool(
        this.arm.id,
        this.arm.connectionIdentity,
      )
    )
      throw new RobotArmError(
        'SETUP_REQUIRED',
        'Save tool configuration first',
        409,
      );
    const opening = this.calibrationOpening.get(id);
    if (opening) return opening.pending;
    const existing = this.entries.get(id)?.calibration;
    if (existing?.cancelling)
      throw new RobotArmError('BUSY', 'Wait for cancellation to finish', 409);
    if (
      existing?.phase === 'running' &&
      existing.host?.service.status()?.stage === 'completed'
    )
      return existing.pending!.then(() => this.startCalibration(id));
    if (existing && ['queued', 'running'].includes(existing.phase))
      return Promise.resolve(this.status(id));
    const attemptId = randomUUID();
    const abort = new AbortController();
    const pending = this.prepareCalibration(id, attemptId, abort);
    this.calibrationOpening.set(id, { attemptId, abort, pending });
    void pending
      .finally(() => this.calibrationOpening.delete(id))
      .catch(() => undefined);
    return pending;
  }
  private async prepareCalibration(
    id: string,
    attemptId: string,
    abort: AbortController,
  ) {
    const entry = await this.open(id);
    abort.signal.throwIfAborted();
    const host = await this.ensureHost(id);
    abort.signal.throwIfAborted();
    let ready!: () => void;
    let failed!: (error: unknown) => void;
    const prepared = new Promise<void>((resolve, reject) => {
      ready = resolve;
      failed = reject;
    });
    void prepared.catch(() => undefined);
    const session: CalibrationSession = {
      attemptId,
      abort,
      phase: 'queued',
      ready: prepared,
      // Pairing belongs to this device, not to one calibration attempt.
      token:
        entry.calibration?.token ??
        (await this.pairings?.token(id)) ??
        randomUUID(),
    };
    if (this.closed || this.stopping.has(id) || entry !== this.entries.get(id))
      throw new Error('Camera is stopping');
    abort.signal.throwIfAborted();
    this.assertBatchIdle();
    entry.calibration = session;
    session.pending = entry.device
      .withCalibration(async (signal) => {
        if (host.deviceId !== id || host.cameraId !== entry.camera.camera.id)
          throw new RobotArmError(
            'PROFILE_MISMATCH',
            'Calibration host belongs to another screen',
            409,
          );
        await host.prepare();
        signal.throwIfAborted();
        if (session.phase !== 'queued')
          throw new Error('Calibration cancelled');
        host.service.resetAttempt();
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
              if (session.phase === 'cancelling') return;
              const state = host.service.status();
              if (state?.stage === 'completed' && state.result)
                finish(undefined, state.result);
              else if (state?.stage === 'cancelled') {
                session.phase = 'cancelled';
                finish(new Error('Calibration cancelled'));
              }
            } catch (error) {
              finish(error);
            }
          }, 200);
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        });
      }, session.abort.signal)
      .then(
        () => {
          session.phase = 'completed';
        },
        (error) => {
          session.phase =
            session.abort.signal.aborted ||
            session.phase === 'cancelled' ||
            session.phase === 'cancelling'
              ? 'cancelled'
              : 'error';
          session.error = error.message;
          failed(error);
        },
      );
    return this.status(id);
  }
  status(id: string) {
    const session = this.entries.get(id)?.calibration;
    return session
      ? {
          phase: session.phase,
          attemptId: session.attemptId,
          error: session.error,
        }
      : { phase: 'idle' };
  }
  async cancelCalibration(id: string, attemptId?: string) {
    const opening = this.calibrationOpening.get(id);
    if (
      opening &&
      (!attemptId || attemptId === opening.attemptId) &&
      this.entries.get(id)?.calibration?.attemptId !== opening.attemptId
    ) {
      opening.abort.abort();
      await opening.pending.catch(() => undefined);
      return;
    }
    const session = this.entries.get(id)?.calibration;
    if (!session || (attemptId && session.attemptId !== attemptId)) return;
    if (session.cancelling) return session.cancelling;
    if (!['queued', 'running'].includes(session.phase)) return;
    const host = session.host; // Only a running lease owns a workflow.
    session.phase = 'cancelling';
    session.cancelling = (async () => {
      let committed = false;
      try {
        await host?.service.stop();
        committed = host?.service.status()?.stage === 'completed';
      } finally {
        // Acceptance can win just before a cancel arrives. Let the Device
        // validate that committed result instead of labelling it cancelled.
        if (committed) session.phase = 'running';
        else session.abort.abort();
        await session.pending;
      }
    })();
    try {
      await session.cancelling;
    } finally {
      session.cancelling = undefined;
    }
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
  get hasActiveScreenCalibration() {
    return (
      this.calibrationOpening.size > 0 ||
      [...this.entries.values()].some(
        ({ calibration }) =>
          calibration &&
          ['queued', 'running', 'cancelling'].includes(calibration.phase),
      )
    );
  }
  assertCalibrationRunning(id: string, attemptId: string) {
    const session = this.entries.get(id)?.calibration;
    if (session?.phase !== 'running')
      throw new RobotArmError(
        'BUSY',
        'Wait for the Controller queue before starting calibration commands',
        409,
      );
    if (attemptId !== session.attemptId)
      throw new RobotArmError(
        'STALE_CONTEXT',
        'The screen calibration attempt changed',
        409,
      );
  }
  async resolvePhoneHost(token: string | null) {
    if (!token || this.closed) return undefined;
    const active = this.phoneHost(token);
    if (active) return active;
    const cameraId = this.pairings?.camera(token);
    if (
      !cameraId ||
      controllerRuntime(this.arm)
        .profileStore.list()
        .screenTargets?.some(
          (screen) => screen.id === cameraId && screen.archived,
        )
    )
      return undefined;
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
