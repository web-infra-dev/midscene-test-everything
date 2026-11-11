import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  type CalibrationProfile,
  type CartesianPose,
  RobotArmError,
  type SharedParkingEvidence,
  calibrationAccepted,
  semanticJson,
} from '@midscene/arm-kit';
import type {
  CalibrationBatchPlan,
  CalibrationBatchSamplingMode,
  CalibrationBatchState,
  WorkstationScreenState,
} from '@midscene/arm-kit-shared/assisted-contracts';
import { insideCameraParkingFootprint } from '@midscene/arm-kit/internal/calibration/camera-avoidance';
import {
  confirmVisibilityPages,
  verifyScreenVisibility,
} from '@midscene/arm-kit/internal/calibration/camera/visibility';
import {
  type ScreenPlaneSource,
  calibrationQuad,
  estimateScreenPlane,
  estimatedScreenExclusion,
  insideQuad,
  knownScreenTravelHeight,
  pageOrderedQuad,
  quadCenter,
} from '@midscene/arm-kit/internal/calibration/screen-position';
import { controllerRuntime } from '@midscene/arm-kit/internal/controller-runtime';
import { contactPoint, flangePose } from '@midscene/arm-kit/internal/domain';
import type { PlaygroundDevices } from './devices.js';

const terminal = (status: string) => ['completed', 'skipped'].includes(status);
/** Original per-screen batch states and confirmations, using the shared Controller queue. */
export class CalibrationBatch {
  private state?: CalibrationBatchState;
  private abort?: AbortController;
  private task?: Promise<void>;
  private busy = false;
  private starting = false;
  private ownsQueue = false;
  private safetyStop?: Promise<void>;
  private stopFailed = false;
  private stopping?: Promise<CalibrationBatchState | null>;
  private choice?: 'retry' | 'skip';
  private writes: Promise<unknown> = Promise.resolve();
  private stopRevision?: number;
  private transfer?: CalibrationBatchPlan['transfer'];
  constructor(private readonly devices: PlaygroundDevices) {}
  get active() {
    return Boolean(this.task || this.starting || this.stopping);
  }
  private get runtime() {
    return controllerRuntime(this.devices.arm);
  }
  read() {
    if (!this.state) {
      const saved = this.runtime.profileStore.list().calibrationBatch;
      if (!saved) return null;
      this.state = structuredClone(saved);
      this.transfer = this.state.transfer;
      if (['running', 'waiting', 'stopping'].includes(this.state.status)) {
        this.state.status = 'stopped';
        this.state.revision++;
        this.state.error =
          'The service restarted. Review the screens before retrying.';
        const row = this.state.items[this.state.currentIndex];
        if (row && !terminal(row.status)) row.status = 'stopped';
      }
    }
    return structuredClone(this.state);
  }
  private update(work: () => void) {
    work();
    this.state!.revision++;
    const snapshot = structuredClone(this.state!);
    this.writes = this.writes.then(() =>
      this.runtime.profileStore.saveCalibrationBatch(snapshot),
    );
    return this.writes;
  }
  private selection(cameraId: string) {
    const setups = this.runtime.profileStore.list().calibrationSetups ?? [];
    const input =
      setups.find((s) => s.deviceId === cameraId && s.cameraId === cameraId) ??
      setups.filter((s) => s.cameraId === cameraId).slice(-1)[0];
    if (!input)
      throw new RobotArmError(
        'SETUP_REQUIRED',
        'Save tool configuration first',
        409,
      );
    return input;
  }
  private contextVersion(cameraId: string) {
    const input = this.selection(cameraId);
    const store = this.runtime.profileStore;
    return createHash('sha256')
      .update(
        semanticJson([
          input,
          store.getRobot(input.robotProfileId).geometryRevision,
          store.getTool(input.toolProfileId),
          store.installationTeaching(input)?.id,
          this.entries(cameraId).map((entry) => [
            entry.target.id,
            entry.target.name,
            entry.binding,
            entry.calibration,
            entry.screen,
            this.devices.entries.get(entry.target.id)?.camera.getCorrection(),
          ]),
        ]),
      )
      .digest('hex');
  }
  transferContext(from: string, to: string): CalibrationBatchState | undefined {
    const batch = this.runtime.profileStore.list().calibrationBatch;
    if (
      this.active ||
      batch?.status !== 'completed' ||
      !batch.cameraId ||
      !batch.contextVersion ||
      ![from, to].every((id) =>
        batch.items.some(
          (item) =>
            item.status === 'completed' && item.calibrationProfileId === id,
        ),
      )
    )
      return undefined;
    // Missing setup or a changed camera/geometry invalidates the saved corridor.
    try {
      if (this.contextVersion(batch.cameraId) === batch.contextVersion)
        return batch;
    } catch (error) {
      if (!(error instanceof RobotArmError) || error.code !== 'SETUP_REQUIRED')
        throw error;
    }
  }
  private async assertResumeContext() {
    const state = this.state!;
    await this.assertPerspectives(state.cameraId!);
    if (
      !state.contextVersion ||
      state.contextVersion !== this.contextVersion(state.cameraId!)
    )
      throw new RobotArmError(
        'STALE_CONTEXT',
        'Review the calibration plan again before starting.',
        409,
      );
    const toolProfileId =
      state.toolProfileId ?? this.selection(state.cameraId!).toolProfileId;
    const pose = await this.runtime.assertCalibrationMotionReady(toolProfileId);
    if (state.transfer) {
      const tip = contactPoint(
        pose,
        this.runtime.profileStore.getTool(toolProfileId).offsetMm,
      );
      const box = state.transfer.corridor;
      if (
        tip.x < box.minX ||
        tip.x > box.maxX ||
        tip.y < box.minY ||
        tip.y > box.maxY
      )
        throw new RobotArmError(
          'STALE_CONTEXT',
          'Review the calibration plan again before starting.',
          409,
        );
    }
    this.transfer = state.transfer;
  }
  private async assertPerspectives(cameraId: string) {
    for (const target of this.devices
      .screens()
      .filter((s) => s.cameraId === cameraId)) {
      const camera = this.devices.entries.get(target.id)?.camera;
      if (camera?.getCorrection()) await camera.assertPerspectiveCurrent();
    }
  }
  private entries(cameraId: string) {
    const data = this.runtime.profileStore.list();
    const input = this.selection(cameraId);
    return this.devices
      .screens()
      .filter(
        (t) =>
          t.cameraId === cameraId &&
          this.devices.entries.get(t.id)?.camera.getCorrection(),
      )
      .map((target) => {
        const binding = data.devices?.find((d) => d.deviceId === target.id);
        const c =
          binding &&
          data.calibrations.find((c) => c.id === binding.calibrationProfileId);
        const screen =
          binding && data.screens.find((s) => s.id === binding.screenProfileId);
        const calibration =
          c &&
          screen &&
          binding &&
          calibrationAccepted(c, c.pendingParkingBatchId) &&
          c.robotProfileId === input.robotProfileId &&
          c.toolProfileId === input.toolProfileId &&
          c.robotGeometryRevision ===
            this.runtime.profileStore.getRobot(input.robotProfileId)
              .geometryRevision &&
          c.toolGeometryRevision ===
            this.runtime.profileStore.getTool(input.toolProfileId)
              .geometryRevision &&
          c.screenGeometryRevision === screen.geometryRevision &&
          this.devices.entries
            .get(target.id)!
            .camera.isBindingCurrent(binding.vision)
            ? c
            : undefined;
        return { target, binding, calibration, screen };
      });
  }
  private estimates(cameraId: string) {
    const entries = this.entries(cameraId);
    const sources: ScreenPlaneSource[] = entries.flatMap((e) => {
      const profile = this.devices.entries
        .get(e.target.id)
        ?.camera.getCorrection();
      const robot =
        e.calibration && e.screen && calibrationQuad(e.calibration, e.screen);
      return profile && robot
        ? [{ image: pageOrderedQuad(profile.points, profile.rotation), robot }]
        : [];
    });
    return new Map(
      entries.flatMap((e) => {
        const profile = this.devices.entries
          .get(e.target.id)
          ?.camera.getCorrection();
        const estimate =
          profile &&
          estimateScreenPlane(
            sources,
            pageOrderedQuad(profile.points, profile.rotation),
          );
        return estimate ? [[e.target.id, estimate] as const] : [];
      }),
    );
  }
  private savedSharedPosition(cameraId: string) {
    const previous =
      this.state ?? this.runtime.profileStore.list().calibrationBatch;
    if (
      previous?.sharedSafePosition &&
      previous.contextVersion === this.contextVersion(cameraId)
    )
      return previous.sharedSafePosition;
    const entries = this.entries(cameraId);
    const pose = entries[0]?.calibration?.observationPose;
    if (
      entries.length < 2 ||
      !pose ||
      !entries.every(
        ({ calibration }) =>
          calibration &&
          calibrationAccepted(calibration) &&
          semanticJson(calibration.observationPose) === semanticJson(pose),
      )
    )
      return undefined;
    const points = entries.flatMap(
      ({ calibration, screen }) =>
        (calibration && screen && calibrationQuad(calibration, screen)) || [],
    );
    const tool = this.runtime.profileStore.getTool(
      this.selection(cameraId).toolProfileId,
    );
    return points.length === entries.length * 4 &&
      !insideCameraParkingFootprint(contactPoint(pose, tool.offsetMm), points)
      ? pose
      : undefined;
  }
  private async visibilityInputs(cameraId: string, signal: AbortSignal) {
    await this.assertPerspectives(cameraId);
    this.check(signal);
    const entries = this.entries(cameraId);
    const phones = await Promise.all(
      entries.map(async ({ target }) => {
        const entry = this.devices.entries.get(target.id)!;
        const host = await this.devices.ensureHost(target.id);
        const correction = entry.camera.getCorrection();
        if (!correction)
          throw new RobotArmError(
            'VISIBILITY_UNAVAILABLE',
            'A screen mapping is required for visibility verification.',
            409,
          );
        return {
          id: target.id,
          name: target.name,
          points: pageOrderedQuad(correction.points, correction.rotation),
          sourceWidth: correction.sourceWidth,
          sourceHeight: correction.sourceHeight,
          correctionKey: semanticJson(correction),
          show: (phase: 0 | 1) => host.service.showVisibilityProbe(phase),
          observation: (id: string) => host.service.visibilityObservation(id),
          clear: (id: string) => host.service.clearVisibilityProbe(id),
        };
      }),
    );
    const camera = this.devices.entries.get(entries[0]?.target.id)?.camera;
    if (!camera)
      throw new RobotArmError(
        'VISIBILITY_UNAVAILABLE',
        'A camera is required for visibility verification.',
        409,
      );
    return {
      phones,
      frame: () => camera.rawFrame(),
      check: () => {
        this.check(signal);
        if (
          semanticJson(
            this.entries(cameraId).map(({ target }) => target.id),
          ) !== semanticJson(entries.map(({ target }) => target.id)) ||
          phones.some(
            (phone) =>
              semanticJson(
                this.devices.entries.get(phone.id)?.camera.getCorrection(),
              ) !== phone.correctionKey,
          )
        )
          throw new RobotArmError(
            'VISION_BINDING_CHANGED',
            'The screen group changed during visibility verification.',
            409,
          );
      },
    };
  }
  private async recordSharedParking(
    pose: CartesianPose,
    evidence: SharedParkingEvidence,
    profiles: CalibrationProfile[],
    guard: () => void,
  ) {
    const state = this.state!;
    guard();
    if (profiles.length)
      await this.runtime.profileStore.saveBatchParking(
        state.id,
        profiles.map(({ id, revision }) => ({ id, revision })),
        pose,
        evidence,
        guard,
      );
    await this.update(() => {
      state.sharedSafePosition = pose;
      const manual = 'operatorConfirmedAt' in evidence;
      state.sharedVisibility = manual ? undefined : evidence;
      state.sharedParkingOperatorConfirmedAt = manual
        ? evidence.operatorConfirmedAt
        : undefined;
      state.sharedSafePositionVerified = true;
      state.contextVersion = this.contextVersion(state.cameraId!);
    });
  }
  async screens(cameraId: string): Promise<WorkstationScreenState[]> {
    if (
      !this.runtime.profileStore
        .list()
        .calibrationSetups?.some((s) => s.cameraId === cameraId)
    )
      return [];
    const entries = this.entries(cameraId);
    const estimates = this.estimates(cameraId);
    return Promise.all(
      entries.map(async (e) => {
        const host = await this.devices.ensureHost(e.target.id);
        const setup = host.service.setup();
        const quad =
          e.calibration && e.screen && calibrationQuad(e.calibration, e.screen);
        const center = quad
          ? quadCenter(quad)
          : estimates.get(e.target.id)?.center;
        return {
          cameraId,
          screenId: e.target.id,
          name: e.target.name,
          screenProfileId: e.screen?.id,
          calibrationProfileId: e.calibration?.id,
          selected: false,
          ready: Boolean(
            calibrationAccepted(e.calibration) &&
              setup.mapping &&
              setup.phoneConnected,
          ),
          status: !setup.prepared
            ? 'unconfigured'
            : !setup.phoneConnected || !setup.mapping
              ? 'mapping-required'
              : calibrationAccepted(e.calibration)
                ? 'ready'
                : 'calibration-required',
          expectedCenterMm: center,
          expectedSource: quad
            ? 'calibration'
            : center
              ? 'estimate'
              : undefined,
        };
      }),
    );
  }
  async plan(cameraId: string): Promise<CalibrationBatchPlan> {
    if (this.task || this.stopping || this.busy)
      throw new RobotArmError(
        'BUSY',
        'A calibration batch is already active',
        409,
      );
    const input = this.selection(cameraId);
    await this.assertPerspectives(cameraId);
    const entries = this.entries(cameraId);
    const estimates = this.estimates(cameraId);
    const teaching = this.runtime.profileStore.installationTeaching(input);
    if (!teaching)
      throw new RobotArmError(
        'INSTALLATION_TEACHING_REQUIRED',
        'Record installation teaching for the current robot, tool and camera',
        409,
      );
    if (!entries.length)
      throw new RobotArmError(
        'MAPPING_REQUIRED',
        'Apply the screen perspective results first',
        409,
      );
    const measured = (
      await this.runtime.state(input.toolProfileId, { fresh: true })
    ).state;
    if (
      !measured.connected ||
      !measured.pose ||
      measured.status?.quality.stale ||
      measured.moving ||
      measured.faults.length
    )
      throw new RobotArmError(
        'NOT_READY',
        'Hold the robot still with current pose feedback before reviewing the calibration plan',
        409,
      );
    const tip = contactPoint(
      measured.pose,
      this.runtime.profileStore.getTool(input.toolProfileId).offsetMm,
    );
    entries.sort((a, b) =>
      a.calibration && b.calibration
        ? a.calibration.origin.x - b.calibration.origin.x ||
          a.calibration.origin.y - b.calibration.origin.y
        : a.calibration
          ? -1
          : b.calibration
            ? 1
            : a.target.name.localeCompare(b.target.name),
    );
    const current = entries.findIndex((e) => {
      const quad =
        e.calibration && e.screen && calibrationQuad(e.calibration, e.screen);
      return quad && insideQuad(tip, quad, 0);
    });
    const reference = entries.findIndex(
      (e) => e.target.id === teaching.referenceDeviceId && !e.calibration,
    );
    const first = current >= 0 ? current : reference;
    if (first > 0) entries.unshift(...entries.splice(first, 1));
    let transfer: CalibrationBatchPlan['transfer'];
    if (entries.length > 1 && entries.every((e) => e.calibration && e.screen)) {
      const points = entries.flatMap((e) =>
        [
          [0, 0],
          [e.screen!.physicalWidthMm, 0],
          [e.screen!.physicalWidthMm, e.screen!.physicalHeightMm],
          [0, e.screen!.physicalHeightMm],
        ].map(([x, y]) => ({
          x:
            e.calibration!.origin.x +
            e.calibration!.xAxis.x * x +
            e.calibration!.yAxis.x * y,
          y:
            e.calibration!.origin.y +
            e.calibration!.xAxis.y * x +
            e.calibration!.yAxis.y * y,
          z:
            e.calibration!.origin.z +
            e.calibration!.xAxis.z * x +
            e.calibration!.yAxis.z * y,
        })),
      );
      const highest = Math.max(...points.map((p) => p.z));
      const parking = this.savedSharedPosition(cameraId);
      const corridorPoints = parking
        ? [
            ...points,
            contactPoint(
              parking,
              this.runtime.profileStore.getTool(input.toolProfileId).offsetMm,
            ),
          ]
        : points;
      transfer = {
        travelTipZMm: Math.max(
          Math.ceil(highest + 60),
          Math.ceil(tip.z),
          contactPoint(
            teaching.referencePose,
            this.runtime.profileStore.getTool(input.toolProfileId).offsetMm,
          ).z,
        ),
        highestObstacleZMm: Math.ceil(highest + 40),
        clearanceMm: 20,
        corridor: {
          minX: Math.floor(
            Math.min(tip.x, ...corridorPoints.map((p) => p.x)) - 40,
          ),
          maxX: Math.ceil(
            Math.max(tip.x, ...corridorPoints.map((p) => p.x)) + 40,
          ),
          minY: Math.floor(
            Math.min(tip.y, ...corridorPoints.map((p) => p.y)) - 40,
          ),
          maxY: Math.ceil(
            Math.max(tip.y, ...corridorPoints.map((p) => p.y)) + 40,
          ),
        },
        waypoints: [],
        corridorConfirmed: true,
      };
    }
    const version = createHash('sha256')
      .update(
        semanticJson([
          cameraId,
          teaching.id,
          entries.map((e) => [
            e.target,
            e.calibration,
            e.screen,
            this.devices.entries.get(e.target.id)?.camera.getCorrection(),
          ]),
          input,
          transfer,
          this.runtime.stopRevision,
        ]),
      )
      .digest('hex');
    return {
      cameraId,
      version,
      transfer,
      screens: entries.map((e, index) => {
        const quad =
          e.calibration && e.screen && calibrationQuad(e.calibration, e.screen);
        const expected = quad
          ? quadCenter(quad)
          : estimates.get(e.target.id)?.center;
        return {
          screenId: e.target.id,
          name: e.target.name,
          calibrated: Boolean(e.calibration),
          startsHere: Boolean(index === 0 && quad && insideQuad(tip, quad, 0)),
          expectedCenterMm: expected,
          expectedSource: quad
            ? 'calibration'
            : expected
              ? 'estimate'
              : undefined,
        };
      }),
    };
  }
  async start(input: {
    cameraId: string;
    planVersion: string;
    horizontalConfirmed: boolean;
    corridorConfirmed?: boolean;
    samplingMode?: CalibrationBatchSamplingMode;
    acceptance?: 'manual' | 'automatic';
  }) {
    if (this.active || this.busy)
      throw new RobotArmError(
        'BUSY',
        'A calibration batch is already active',
        409,
      );
    this.starting = true;
    try {
      const { samplingMode = 'standard' } = input;
      if (samplingMode !== 'standard' && samplingMode !== 'slide')
        throw new RobotArmError('INVALID_ARGUMENT', 'Unknown sampling mode');
      if (
        [...this.devices.entries.values()].some(
          (entry) =>
            entry.calibration &&
            ['queued', 'running', 'cancelling'].includes(
              entry.calibration.phase,
            ),
        )
      )
        throw new RobotArmError(
          'BUSY',
          'Finish the current screen calibration before starting a batch',
          409,
        );
      const plan = await this.plan(input.cameraId);
      if (input.planVersion !== plan.version)
        throw new RobotArmError(
          'STALE_CONTEXT',
          'Review the calibration plan again before starting.',
          409,
        );
      if (
        input.horizontalConfirmed !== true ||
        (plan.transfer && input.corridorConfirmed !== true)
      )
        throw new RobotArmError(
          'CONFIRMATION_REQUIRED',
          'Confirm fixed screens and the full arm corridor before starting',
          409,
        );
      const selected = this.selection(input.cameraId);
      await this.runtime.assertCalibrationMotionReady(selected.toolProfileId);
      const contextVersion = this.contextVersion(input.cameraId);
      const sharedSafePosition = this.savedSharedPosition(input.cameraId);
      const tool = this.runtime.profileStore.getTool(selected.toolProfileId);
      this.stopRevision = this.runtime.stopRevision;
      this.transfer = plan.transfer;
      this.state = {
        id: randomUUID(),
        revision: 0,
        cameraId: input.cameraId,
        robotProfileId: selected.robotProfileId,
        toolProfileId: selected.toolProfileId,
        status: 'running',
        currentIndex: 0,
        samplingMode,
        usesSharedSafePosition: true,
        sharedSafePosition:
          sharedSafePosition &&
          contactPoint(sharedSafePosition, tool.offsetMm).z >=
            (plan.transfer?.travelTipZMm ?? Number.NEGATIVE_INFINITY)
            ? sharedSafePosition
            : undefined,
        acceptance: input.acceptance ?? 'automatic',
        planVersion: plan.version,
        contextVersion,
        transfer: plan.transfer,
        items: plan.screens.map((s) => ({
          deviceId: s.screenId,
          screenId: s.screenId,
          name: s.name,
          status: 'pending',
          attempts: 0,
          runIds: [],
        })),
      };
      await this.update(() => {});
      this.launch();
      return this.read();
    } finally {
      this.starting = false;
    }
  }
  private launch(operatorConfirmedParking = false) {
    const state = this.state!;
    this.abort = new AbortController();
    this.choice = undefined;
    this.safetyStop = undefined;
    this.stopFailed = false;
    this.task = this.devices.arm
      .calibrationBatchForDevices(
        state.id,
        async (signal) => {
          this.ownsQueue = true;
          try {
            await this.assertPerspectives(state.cameraId!);
            this.check(signal);
            if (state.contextVersion !== this.contextVersion(state.cameraId!))
              throw new RobotArmError(
                'STALE_CONTEXT',
                'Review the calibration plan again before starting.',
                409,
              );
            const last = await this.run(signal, operatorConfirmedParking);
            return { value: undefined, lastCalibration: last };
          } finally {
            try {
              await this.safetyStop;
            } finally {
              this.ownsQueue = false;
            }
          }
        },
        this.abort.signal,
      )
      .catch(async (error) => {
        await this.update(() => {
          state.status = this.stopFailed ? 'failed' : 'stopped';
          state.error = error instanceof Error ? error.message : String(error);
          const row = state.items[state.currentIndex];
          if (row && !terminal(row.status)) row.status = 'stopped';
        });
      })
      .finally(() => {
        this.task = undefined;
        this.abort = undefined;
      });
  }
  private check(signal: AbortSignal) {
    signal.throwIfAborted();
    this.runtime.assertStopRevision(this.stopRevision!);
  }
  private async wait(signal: AbortSignal) {
    this.check(signal);
    await delay(150, undefined, { signal });
    this.check(signal);
  }
  private async run(
    signal: AbortSignal,
    operatorConfirmedParking: boolean,
  ): Promise<CalibrationProfile | undefined> {
    const state = this.state!;
    let last: CalibrationProfile | undefined;
    try {
      for (; state.currentIndex < state.items.length; state.currentIndex++) {
        const row = state.items[state.currentIndex];
        if (terminal(row.status)) continue;
        let retry = true;
        while (retry) {
          retry = false;
          this.check(signal);
          await this.update(() => {
            state.status = 'running';
            row.status = 'preparing';
            row.attempts++;
            row.calibrationProfileId = undefined;
            row.progress = undefined;
            row.note = undefined;
            row.error = undefined;
          });
          const host = await this.devices.ensureHost(row.deviceId);
          let attemptId: string | undefined;
          try {
            await this.assertPerspectives(state.cameraId!);
            this.check(signal);
            const setup = host.service.setup();
            if (!setup.prepared)
              throw new RobotArmError(
                'SETUP_REQUIRED',
                'Save tool configuration first',
                409,
              );
            if (!host.service.setup().phoneConnected)
              await this.devices.markerCalibration.resumeBoundPage(host);
            const phoneDeadline = performance.now() + 15_000;
            while (!host.service.setup().phoneConnected) {
              if (performance.now() >= phoneDeadline)
                throw new RobotArmError(
                  'PHONE_UNAVAILABLE',
                  'Open the phone page and retry this step',
                  409,
                );
              if (row.status !== 'awaiting-mapping')
                await this.update(() => {
                  row.status = 'awaiting-mapping';
                  state.status = 'waiting';
                  row.note = 'Keep the phone page visible and fullscreen';
                });
              await this.wait(signal);
              if (this.choice) break;
            }
            if (this.choice) throw new Error('Batch screen changed');
            if (!host.service.setup().mapping) await host.alignForBatch(signal);
            this.check(signal);
            let session = await host.service.create({ batch: true });
            attemptId = session.id;
            const readAttempt = () => {
              const status = host.service.status();
              if (!status || status.id !== attemptId)
                throw new RobotArmError(
                  'STALE_CONTEXT',
                  'The screen calibration attempt changed',
                  409,
                );
              return status;
            };
            host.service.setBatchTravelHeight(this.transfer?.travelTipZMm);
            if (state.usesSharedSafePosition)
              host.service.setBatchParking(state.id);
            const selection = this.selection(state.cameraId!);
            if (!session.referencePosition) {
              const estimate = this.estimates(state.cameraId!).get(
                row.deviceId,
              );
              const source = this.entries(state.cameraId!).find(
                (e) => e.calibration,
              )?.calibration;
              const teaching =
                this.runtime.profileStore.installationTeaching(selection);
              if (estimate && source && teaching) {
                const tool = this.runtime.profileStore.getTool(
                  selection.toolProfileId,
                );
                const z = Math.max(
                  contactPoint(teaching.referencePose, tool.offsetMm).z,
                  source.origin.z + 30,
                  this.transfer?.travelTipZMm ?? Number.NEGATIVE_INFINITY,
                );
                host.service.setBatchReference(
                  flangePose(
                    { ...estimate.center, z },
                    teaching.referencePose.orientation,
                    tool.offsetMm,
                  ),
                );
                session = readAttempt();
              }
            }
            while (!session.referencePosition) {
              if (row.status !== 'awaiting-placement')
                await this.update(() => {
                  row.status = 'awaiting-placement';
                  row.note = `Place the stylus 2–5 cm above "${row.name}" and confirm its page mapping`;
                  state.status = 'waiting';
                });
              await this.wait(signal);
              if (this.choice) break;
              session = readAttempt();
            }
            if (this.choice) throw new Error('Batch screen changed');
            this.check(signal);
            if (
              (await this.runtime.state(selection.toolProfileId)).state.dragMode
            )
              await this.runtime.exitDragMode();
            await this.runtime.assertCalibrationMotionReady(
              selection.toolProfileId,
            );
            this.check(signal);
            await this.update(() => {
              state.status = 'running';
              row.status = 'preparing';
              row.runIds.push(session.id);
              row.note = undefined;
            });
            await host.service.command(
              session.id,
              state.samplingMode === 'slide'
                ? 'start-slide'
                : 'start-automatic',
              true,
            );
            let deadline = Date.now() + 15 * 60_000;
            let checkedAcceptance = false;
            while (true) {
              this.check(signal);
              if (this.choice) break;
              const current = readAttempt();
              if (current.stage === 'completed' && current.result) {
                last = current.result;
                await this.update(() => {
                  row.status = 'completed';
                  row.calibrationProfileId = current.result!.id;
                  state.contextVersion = this.contextVersion(state.cameraId!);
                  row.note = undefined;
                  row.error = undefined;
                });
                break;
              }
              if (
                ['cancelled', 'interrupted', 'capture-failed'].includes(
                  current.stage,
                )
              )
                throw new RobotArmError(
                  current.errorDetails?.code ?? 'CALIBRATION_FAILED',
                  current.error ?? 'Screen calibration stopped',
                  409,
                );
              if (
                [
                  'review',
                  'boundary-review',
                  'return-ready',
                  'positioning-safe',
                ].includes(current.stage)
              ) {
                deadline = Date.now() + 15 * 60_000;
                const phase =
                  current.stage === 'review'
                    ? 'awaiting-acceptance'
                    : current.stage === 'boundary-review'
                      ? 'awaiting-boundary-review'
                      : 'awaiting-safe-position';
                const status =
                  current.stage === 'boundary-review'
                    ? 'awaiting-boundary-review'
                    : 'awaiting-acceptance';
                if (
                  current.stage === 'review' &&
                  state.acceptance === 'automatic' &&
                  !checkedAcceptance
                ) {
                  checkedAcceptance = true;
                  const result = await host.service.acceptAutomatically();
                  if (result.accepted) continue;
                  await this.update(() => {
                    row.note = result.reasons.join(' · ');
                  });
                }
                if (row.status !== status || row.progress?.phase !== phase)
                  await this.update(() => {
                    state.status = 'waiting';
                    row.status = status;
                    if (current.stage === 'return-ready')
                      row.note = current.error;
                    row.progress = {
                      phase,
                      index: 1,
                      total: 1,
                    };
                  });
              } else {
                const capture = current.capture;
                const status =
                  current.stage === 'collecting' &&
                  (!capture ||
                    current.referenceTravel ||
                    current.recheckingPayload)
                    ? 'preparing'
                    : 'exploring';
                const progress = {
                  phase: current.stage,
                  message:
                    current.stage === 'avoiding-camera'
                      ? current.calibration?.auto?.checkingVisibility
                        ? 'Checking screen visibility'
                        : 'Avoiding camera'
                      : undefined,
                  index: capture?.index ?? 0,
                  total: capture?.total ?? 1,
                };
                if (
                  row.status !== status ||
                  semanticJson(row.progress) !== semanticJson(progress)
                )
                  await this.update(() => {
                    state.status = 'running';
                    row.status = status;
                    row.progress = progress;
                  });
                if (Date.now() > deadline)
                  throw new RobotArmError(
                    'AUTO_MOVE_TIMEOUT',
                    'Screen exploration exceeded the batch time limit',
                    409,
                  );
              }
              await this.wait(signal);
            }
          } catch (error) {
            if (!this.choice) {
              this.check(signal);
              if (attemptId && host.service.status()?.id === attemptId)
                await host.service.stop();
              await this.update(() => {
                row.status = 'failed';
                row.error =
                  error instanceof Error ? error.message : String(error);
                state.status = 'waiting';
              });
              // A controller fault or a failed submitted move stops all screens.
              const runtime = await this.runtime.state();
              if (
                runtime.recoveryRequired ||
                runtime.state.faults.length ||
                !runtime.state.connected
              )
                throw error;
              await this.update(() => {
                state.status = 'failed';
              });
              return undefined;
            }
          }
          if (this.choice === 'retry') retry = true;
          else if (this.choice === 'skip')
            await this.update(() => {
              row.status = 'skipped';
            });
          this.choice = undefined;
        }
      }
      if (
        state.usesSharedSafePosition &&
        state.items.some((item) => item.status === 'completed')
      ) {
        await this.assertPerspectives(state.cameraId!);
        this.check(signal);
        const selection = this.selection(state.cameraId!);
        const store = this.runtime.profileStore;
        const entries = this.entries(state.cameraId!);
        const profiles = entries.flatMap(({ calibration }) =>
          calibration && calibrationAccepted(calibration, state.id)
            ? [calibration]
            : [],
        );
        const source =
          profiles.find((profile) => profile.id === last?.id) ??
          profiles[0] ??
          last;
        if (!source)
          throw new RobotArmError(
            'CALIBRATION_REQUIRED',
            'A calibrated screen is required for shared parking.',
            409,
          );
        const estimates = this.estimates(state.cameraId!);
        const otherScreens = entries.filter(
          ({ calibration }) => calibration?.id !== source.id,
        );
        const measuredObstacles = otherScreens.flatMap(
          ({ calibration, screen }) => {
            const quad =
              calibration && screen && calibrationQuad(calibration, screen);
            return quad ? [quad] : [];
          },
        );
        const estimatedObstacles = otherScreens.flatMap(
          ({ target, calibration }) => {
            const quad = !calibration && estimates.get(target.id)?.quad;
            return quad ? [estimatedScreenExclusion(quad)] : [];
          },
        );
        const obstacles = [...measuredObstacles, ...estimatedObstacles];
        const contextVersion = this.contextVersion(state.cameraId!);
        if (contextVersion !== state.contextVersion)
          throw new RobotArmError(
            'STALE_CONTEXT',
            'The screen group changed during shared parking.',
            409,
          );
        const guard = () => {
          this.check(signal);
          if (this.contextVersion(state.cameraId!) !== contextVersion)
            throw new RobotArmError(
              'STALE_CONTEXT',
              'The screen group changed during shared parking.',
              409,
            );
        };
        const parked = await this.runtime.parkScreenGroup(
          source,
          source.id,
          {
            pose: state.sharedSafePosition,
            obstacles,
            estimatedObstacles,
            complete: obstacles.length === otherScreens.length,
            corridor: state.transfer?.corridor,
          },
          Math.max(
            knownScreenTravelHeight(store.list(), selection),
            state.transfer?.travelTipZMm ?? Number.NEGATIVE_INFINITY,
          ),
          async (signal) => {
            const { phones, frame, check } = await this.visibilityInputs(
              state.cameraId!,
              signal,
            );
            return verifyScreenVisibility(phones, frame, signal, check);
          },
          guard,
          async () => {
            const { phones, check } = await this.visibilityInputs(
              state.cameraId!,
              signal,
            );
            await confirmVisibilityPages(phones, signal, check);
          },
          operatorConfirmedParking,
        );
        await this.recordSharedParking(
          parked.pose,
          parked.visibility,
          profiles,
          guard,
        );
        if (profiles.some((profile) => profile.id === source.id))
          last = store.getCalibration(source.id);
      }
      this.check(signal);
      await this.update(() => {
        state.status = state.items.some((r) => r.status === 'failed')
          ? 'failed'
          : 'completed';
        state.currentIndex = Math.min(
          state.currentIndex,
          state.items.length - 1,
        );
      });
      return last;
    } catch (error) {
      const stopped =
        signal.aborted || this.runtime.stopRevision !== this.stopRevision;
      const missing =
        error instanceof RobotArmError ? error.details?.screens : undefined;
      await this.update(() => {
        state.status = stopped ? 'stopped' : 'failed';
        state.error = error instanceof Error ? error.message : String(error);
        state.visibilityMissingScreens = Array.isArray(missing)
          ? missing.flatMap((screen) => {
              if (typeof screen === 'string') return [screen];
              if (
                typeof screen?.id !== 'string' ||
                typeof screen.percent !== 'number'
              )
                return [];
              const item = state.items.find(
                (item) => item.deviceId === screen.id,
              );
              return [`${item?.name ?? screen.id} ${screen.percent}%`];
            })
          : undefined;
        const row = state.items[state.currentIndex];
        if (row && !terminal(row.status)) {
          row.status = stopped ? 'stopped' : 'failed';
          row.error = state.error;
        }
      });
      const row = state.items[state.currentIndex];
      if (row)
        await this.devices.entries.get(row.deviceId)?.host?.service.stop();
      return undefined;
    } finally {
      for (const item of state.items) {
        const service = this.devices.entries.get(item.deviceId)?.host?.service;
        service?.setBatchTravelHeight();
        if (state.usesSharedSafePosition) service?.setBatchParking();
      }
    }
  }
  private stopActive() {
    if (this.stopping) return this.stopping;
    const task = this.task;
    if (!task) return Promise.resolve(this.read());
    const row = this.state!.items[this.state!.currentIndex];
    this.safetyStop =
      this.ownsQueue && this.runtime.current()
        ? (async () => {
            await this.runtime.stop();
            if (
              (await this.runtime.state(undefined, { fresh: true })).state
                .dragMode
            )
              await this.runtime.exitDragMode();
          })().catch((error) => {
            this.stopFailed = true;
            throw error;
          })
        : Promise.resolve();
    void this.safetyStop.catch(() => undefined);
    this.abort?.abort();
    this.stopping = (async () => {
      await this.update(() => {
        this.state!.status = 'stopping';
      });
      await this.safetyStop;
      if (row)
        await this.devices.entries.get(row.deviceId)?.host?.service.stop();
      await task;
      await this.update(() => {
        this.state!.status = 'stopped';
      });
      return this.read();
    })()
      .catch(async (error) => {
        await this.update(() => {
          this.state!.status = 'failed';
          this.state!.error =
            error instanceof Error ? error.message : String(error);
        });
        throw error;
      })
      .finally(() => {
        this.stopping = undefined;
      });
    return this.stopping;
  }
  async command(revision: number, action: string, id?: string) {
    const state = this.read();
    if (!state || (id && state.id !== id))
      throw new RobotArmError(
        'STALE_CONTEXT',
        'Refresh the calibration batch before continuing',
        409,
      );
    // Stop must preempt ordinary commands and stale UI revisions, as in the original flow.
    if (action === 'stop') return this.stopActive();
    if (this.busy || this.stopping || state.revision !== revision)
      throw new RobotArmError(
        'STALE_CONTEXT',
        'Refresh the calibration batch before continuing',
        409,
      );
    this.busy = true;
    try {
      const parkingOnly =
        state.usesSharedSafePosition &&
        state.items.some((item) => item.status === 'completed') &&
        state.items.every((item) => terminal(item.status));
      const row = this.state!.items[this.state!.currentIndex];
      if (action === 'confirm-shared-parking') {
        if (
          !parkingOnly ||
          state.sharedSafePositionVerified ||
          !['failed', 'stopped'].includes(state.status)
        )
          throw new RobotArmError(
            'INVALID_STAGE',
            'The shared Safe Position is not awaiting confirmation.',
            409,
          );
        await this.task;
        await this.assertResumeContext();
        await this.update(() => {
          this.state!.status = 'running';
          this.state!.error = undefined;
          this.state!.visibilityMissingScreens = undefined;
        });
        this.stopRevision = this.runtime.stopRevision;
        this.launch(true);
      } else if (action === 'retry' || action === 'skip') {
        if (
          (!row && !parkingOnly) ||
          (parkingOnly && action !== 'retry') ||
          !['waiting', 'failed', 'stopped'].includes(this.state!.status)
        )
          throw new RobotArmError(
            'INVALID_STAGE',
            'Wait for the current screen before retrying or skipping',
            409,
          );
        if (['failed', 'stopped'].includes(this.state!.status)) await this.task;
        if (this.task) {
          this.choice = action;
          await this.devices.entries.get(row.deviceId)?.host?.service.stop();
        } else {
          await this.assertResumeContext();
          await this.update(() => {
            if (!parkingOnly)
              row.status = action === 'skip' ? 'skipped' : 'pending';
            this.state!.status = 'running';
            this.state!.error = undefined;
            this.state!.visibilityMissingScreens = undefined;
          });
          this.stopRevision = this.runtime.stopRevision;
          this.launch();
        }
      } else {
        if (this.state!.status !== 'waiting' || !row)
          throw new RobotArmError(
            'INVALID_STAGE',
            'The calibration batch is not waiting',
            409,
          );
        const host = await this.devices.ensureHost(row.deviceId);
        const session = host.service.status();
        if (action === 'enter-drag') {
          if (
            session &&
            ['return-ready', 'positioning-safe'].includes(session.stage)
          )
            await host.service.command(session.id, 'position-safe', true);
          else
            await this.runtime.enterDragMode(
              this.selection(this.state!.cameraId!),
            );
        } else if (action === 'exit-drag') {
          if (session?.stage === 'positioning-safe')
            await host.service.command(session.id, 'stop-capture', true);
          else await this.runtime.exitDragMode();
        } else if (action === 'record-safe-position') {
          if (!session)
            throw new RobotArmError(
              'INVALID_STAGE',
              'No active screen calibration',
            );
          await host.service.command(session.id, 'record-safe', true);
        } else if (action === 'accept') {
          if (!session)
            throw new RobotArmError(
              'INVALID_STAGE',
              'No active screen calibration',
            );
          await host.service.command(session.id, 'accept', true);
        } else if (action === 'continue') {
          if (
            row.status === 'awaiting-boundary-review' &&
            session?.stage === 'boundary-review'
          ) {
            await host.service.command(session.id, 'verify-boundary', true);
          } else if (row.status === 'awaiting-mapping')
            await host.alignForBatch(this.abort!.signal);
          else if (row.status === 'awaiting-placement') {
            if ((await this.runtime.state()).state.dragMode)
              await this.runtime.exitDragMode();
            const selection = this.selection(this.state!.cameraId!);
            const current = (await this.runtime.state(selection.toolProfileId))
              .state.pose;
            if (!current)
              throw new RobotArmError(
                'NOT_READY',
                'Current pose is unavailable',
                409,
              );
            host.service.setBatchReference(current);
          } else
            throw new RobotArmError(
              'INVALID_STAGE',
              'The current batch step cannot be continued',
              409,
            );
        } else
          throw new RobotArmError('INVALID_ARGUMENT', 'Unknown batch command');
        await this.update(() => {});
      }
      return this.read();
    } finally {
      this.busy = false;
    }
  }
  async clear() {
    if (this.active)
      throw new RobotArmError(
        'BUSY',
        'Stop the calibration batch before clearing its history',
        409,
      );
    this.state = undefined;
    await this.runtime.profileStore.clearCalibrationBatch();
  }
  async close() {
    await this.stopActive();
    await this.writes;
  }
}
