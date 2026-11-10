import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  type AutomaticCaptureHost,
  type AutomaticExplorationMode,
  CALIBRATION_PHONE_POLICY,
  type CalibrationPageLayout,
  type CalibrationPageUpdate,
  type CalibrationPointProgress,
  type CapturedCalibrationPoint,
  type WebPoint,
} from '../../assisted-contracts.js';
import {
  type CartesianPose,
  RobotArmError,
  type Vector3,
} from '../../contracts.js';
import type { ScreenProfile, ToolProfile } from '../../contracts.js';
import { contactPoint, flangePose } from '../../domain.js';
import { invertMapping, project } from '../phone/geometry.js';
import {
  type PhoneProbeEvidence,
  StationaryPhoneObservation,
} from './phone-observation.js';
import { runAutoExploration } from './sampler.js';
import { explorationTargets, mappedExplorationTargets } from './targets.js';
import type {
  AutoExplorationHost,
  ScreenCalibSessionSummary,
  CalibrationSession as UpstreamSession,
} from './types.js';

const fail = (message: string): never => {
  throw new RobotArmError('AUTOMATIC_CAPTURE_FAILED', message, 409);
};

/** Phone challenges bracket every descent and every stationary pose sample. */
export class AutomaticCapture {
  readonly points: CapturedCalibrationPoint[] = [];
  readonly localPoints: CapturedCalibrationPoint[] = [];
  get allPoints() {
    return [...this.localPoints, ...this.points];
  }
  reference?: CartesianPose;
  private target?: { id: string; point: WebPoint };
  private observation?: StationaryPhoneObservation;
  private readonly recentObservations: PhoneProbeEvidence[] = [];
  get phoneObservations() {
    return this.observation
      ? [...this.recentObservations.slice(-23), this.observation.diagnostics()]
      : this.recentObservations;
  }
  private captured = false;
  private latest?: CalibrationPageUpdate;
  private lastSeen = 0;
  private pageId?: string;
  private invalid?: string;
  private contactSeen = false;
  private challenge?: string;
  private phase: 'local' | 'grid' = 'local';
  private runTargets?: ReturnType<typeof explorationTargets>;
  private index = 0;
  private operation?: CalibrationPointProgress['operation'];
  private heightSearch?: CalibrationPointProgress['heightSearch'];
  constructor(
    private readonly layout: CalibrationPageLayout,
    private readonly offset: Vector3,
    private readonly changed: () => void = () => {},
    private readonly mode: AutomaticExplorationMode = 'standard',
  ) {}
  snapshot() {
    return {
      points: structuredClone(this.allPoints),
      samples: this.points.length,
      anchors: this.allPoints.map((p) => p.point),
      capture: this.target
        ? {
            mode: this.mode,
            index: this.index + 1,
            total:
              this.phase === 'local'
                ? 3
                : (
                    this.runTargets ??
                    explorationTargets(this.layout, this.mode !== 'standard')
                  ).length,
            target: this.target,
            operation: this.operation,
            targets:
              this.phase === 'grid'
                ? (
                    this.runTargets ??
                    explorationTargets(this.layout, this.mode !== 'standard')
                  ).map((target) => target.point)
                : undefined,
            measuredPoints:
              this.phase === 'grid' && this.mode === 'standard'
                ? this.points.map((sample) => sample.point)
                : undefined,
            heightSearch: this.heightSearch && { ...this.heightSearch },
            phase: this.captured
              ? ('captured' as const)
              : this.contactSeen
                ? ('holding' as const)
                : ('waiting' as const),
            progress: this.captured ? 1 : 0,
            readings: this.captured ? 1 : 0,
            step: this.observation?.step,
            probe: this.challenge
              ? { id: this.challenge, contactId: '' }
              : undefined,
          }
        : undefined,
      automaticPhase: this.phase,
    };
  }
  resetStability() {
    this.invalid = 'The phone page changed during automatic collection';
  }
  receive(update: CalibrationPageUpdate) {
    if (this.pageId && this.pageId !== update.pageId) this.resetStability();
    if (
      this.latest?.pageId === update.pageId &&
      update.sequence <= this.latest.sequence
    )
      return;
    this.pageId = update.pageId;
    this.latest = structuredClone(update);
    this.lastSeen = performance.now();
    this.observation?.receive(update);
    if (
      update.contact ||
      (update.contactStart && update.contactStart.targetId === this.target?.id)
    )
      this.contactSeen = true;
    if (
      update.stepFeedback?.id === this.observation?.step?.id &&
      update.stepFeedback?.outcome === 'touched'
    )
      this.contactSeen = true;
  }
  private check(host: AutomaticCaptureHost) {
    host.check();
    if (this.invalid) fail(this.invalid);
    if (
      !this.latest?.visible ||
      performance.now() - this.lastSeen >
        CALIBRATION_PHONE_POLICY.measurementFreshMs
    )
      throw new RobotArmError(
        'PHONE_DISCONNECTED',
        'Fresh visible phone feedback is required; automatic collection stopped',
        409,
      );
  }
  private async move(
    host: AutomaticCaptureHost,
    pose: CartesianPose,
    options?: Parameters<AutomaticCaptureHost['move']>[1],
  ) {
    this.check(host);
    await host.move(pose, options);
    this.check(host);
  }
  /** Upstream owns all automatic sampling decisions; this boundary only adapts IO. */
  upstreamResult?: Awaited<ReturnType<typeof runAutoExploration>>;
  async run(
    host: AutomaticCaptureHost,
    home: CartesianPose,
    config: {
      screen: ScreenProfile;
      tool: ToolProfile;
      webToImage: number[];
      minimumTravelTipZMm?: number;
    },
  ) {
    this.reference = structuredClone(home);
    this.points.length = 0;
    this.localPoints.length = 0;
    this.invalid = undefined;
    this.upstreamResult = undefined;
    this.recentObservations.length = 0;
    let requestedTipZMm = contactPoint(home, this.offset).z;
    this.target = {
      id: randomUUID(),
      point: { x: this.layout.width / 2, y: this.layout.height / 2 },
    };
    this.phase = 'local';
    this.index = 0;
    this.changed();
    const first = performance.now();
    while (!this.latest) {
      host.check();
      if (
        performance.now() - first >
        CALIBRATION_PHONE_POLICY.measurementFreshMs
      )
        throw new RobotArmError(
          'PHONE_DISCONNECTED',
          'Phone feedback is unavailable',
          409,
        );
      await delay(20, undefined, { signal: host.signal });
    }
    const imageToWeb = invertMapping(config.webToImage);
    const mappingVersion = this.layout.revision;
    let snapshot: ScreenCalibSessionSummary['sampleSnapshot'];
    let sampleId: string | undefined;
    const page = (): ScreenCalibSessionSummary => {
      this.check(host);
      return {
        id: this.pageId!,
        instanceId: this.pageId!,
        connected: true,
        display: {
          width: this.layout.width,
          height: this.layout.height,
          visible: this.latest!.visible,
        },
        config: {
          pixelWidth: config.screen.pixelWidth!,
          pixelHeight: config.screen.pixelHeight!,
        },
        mapping: {
          version: mappingVersion,
          displayKey: JSON.stringify(this.layout),
        },
        sampleId,
        sampleSnapshot: snapshot,
      };
    };
    const mapped = mappedExplorationTargets(
      this.layout,
      (p) => project(config.webToImage, p),
      { width: config.screen.pixelWidth!, height: config.screen.pixelHeight! },
    );
    this.runTargets = explorationTargets(
      this.layout,
      this.mode !== 'standard',
      mapped.inset,
    );
    const targets = mapped.targets.map((target, index) => ({
      id: String(index),
      css: target.point,
      screen: project(config.webToImage, target.point),
      role:
        target.purpose === 'check' ? ('validation' as const) : ('fit' as const),
    }));
    const session: UpstreamSession = { auto: {} };
    const updateSamples = () => {
      const samples = session.auto?.collectedSamples ?? [];
      this.localPoints.length = 0;
      this.points.length = 0;
      for (const sample of samples) {
        const pose = flangePose(
          { ...sample.robot, z: sample.pressedZMm },
          home.orientation,
          this.offset,
        );
        const point: CapturedCalibrationPoint = {
          point: project(imageToWeb, sample.screen),
          positionMm: { ...sample.robot },
          weight: sample.weight,
          purpose:
            sample.role === 'probe'
              ? 'direction'
              : sample.role === 'validation'
                ? 'check'
                : 'fit',
          readings: 1,
          tipSpreadMm: 0,
          touchSpreadPx: 0,
          probeStep: {
            id: randomUUID(),
            before: pose,
            after: pose,
            positionConvention:
              sample.method === 'stepped' ? 'contact-interval' : 'predicted',
          },
        };
        (sample.role === 'probe' ? this.localPoints : this.points).push(point);
      }
      if (this.phase === 'local')
        this.index = Math.min(2, this.localPoints.length);
      this.changed();
    };
    const bridge: AutoExplorationHost = {
      check: () => this.check(host),
      currentPose: () => host.read(),
      move: async (pose, _ctx, speed, acceleration) => {
        await this.move(host, pose, {
          speed,
          acceleration,
          timeoutMs: 10000,
        });
        requestedTipZMm = contactPoint(pose, this.offset).z;
      },
      // The runtime move already performs adapter preflight and measured stable completion
      // under the same motion lease; do not duplicate these network round trips.
      preflight: async () => {
        this.check(host);
      },
      stable: async () => {
        this.check(host);
      },
      stop: host.stop,
      progress: () => {
        const progress = session.auto?.progress;
        if (!progress) return;
        if (progress.phase === 'grid') {
          this.phase = 'grid';
          this.index = Math.max(0, progress.index - 1);
          const ordered = this.runTargets!;
          this.target = { id: randomUUID(), point: ordered[this.index].point };
        } else if (progress.phase === 'probe') {
          this.index = this.localPoints.length;
        }
        this.contactSeen = Boolean(progress.touching);
        if (progress.operation) this.operation = progress.operation;
        this.captured = false;
        this.changed();
      },
      profileStore: {
        saveSession: async () => {
          updateSamples();
        },
      },
      screenCalib: {
        findMappedSession: async () => page(),
        session: async () => page(),
        targets: async () => ({ mappingVersion, targets }),
        setSample: async (_id, id, purpose, settleMs) => {
          if (purpose !== 'preflight')
            this.operation = purpose === 'search-limit' ? 'search' : purpose;
          snapshot = undefined;
          sampleId = id;
          const observation = new StationaryPhoneObservation(
            id,
            this.target!.id,
            purpose,
            requestedTipZMm,
            this.latest!.sequence,
            this.lastSeen,
          );
          this.observation = observation;
          try {
            const point = await observation.measure(
              { signal: host.signal, check: () => this.check(host) },
              this.changed,
              Math.min(this.layout.width, this.layout.height),
              settleMs,
            );
            snapshot = {
              sampleId: id,
              mappingVersion,
              pointerCount: point ? 1 : 0,
              screen: point ? project(config.webToImage, point) : null,
            };
          } finally {
            this.recentObservations.push(observation.diagnostics());
            if (this.recentObservations.length > 24)
              this.recentObservations.shift();
            this.observation = undefined;
            this.changed();
          }
        },
      },
    };
    this.upstreamResult = await runAutoExploration(
      bridge,
      session,
      {
        screen: config.screen,
        tool: config.tool,
        minimumTravelTipZMm: config.minimumTravelTipZMm,
      },
      {
        startPose: home,
        mode: this.mode === 'standard' ? 'standard' : 'fast-horizontal',
        collection: this.mode === 'slide' ? 'slide' : 'tap',
        horizontalConfirmed: this.mode !== 'standard',
      },
    );
    this.captured = true;
    this.changed();
  }
}
