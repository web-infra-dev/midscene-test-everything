import type { ServerResponse } from 'node:http';
import {
  type ArmController,
  calibrationAccepted,
  hasScreenMapping,
} from '@midscene/arm-kit';
import { controllerRuntime } from '@midscene/arm-kit/internal/controller-runtime';
import type { ProfileData } from '@midscene/robotics-shared/contracts';
import type { PlaygroundDevices } from './devices.js';
import {
  type TwinCameraScreenSample,
  estimateCameraPose,
} from './twin-camera.js';
import { visualScreenOriginMm, visualTipOffsetMm } from './twin-geometry.js';
import type {
  TwinBlockedReason,
  TwinCameraSnapshot,
  TwinHello,
  TwinMotionMessage,
  TwinSceneSnapshot,
  TwinScreenSnapshot,
  TwinStateMessage,
} from './twin-types.js';

const SAMPLE_INTERVAL_MS = 33;
const STATE_INTERVAL_MS = 2000;
const HEARTBEAT_MS = 15_000;

/** The installed webcam whose body mesh the twin carries. */
const C922_NAME = /c922/i;
const C922_BODY = {
  modelUrl: '/models/mg400/logitech-c922-body.stl',
  assetUnits: 'mm' as const,
  /** Centre of the +Y lens bezel, just above its 55.16 mm front surface. */
  lensOffsetMm: { x: 47.025, y: 55.18, z: 73.22 },
};

type ScreenTarget = ReturnType<PlaygroundDevices['screens']>[number];

/**
 * Pick the calibration a target's screen can actually be drawn from.
 *
 * The persisted model has no single foreign key from a screen target to a
 * calibration: accepted devices keep one, measured setups keep dimensions, and
 * older installs only have the screen profile. Prefer an explicit binding,
 * fall back to a setup with the same image dimensions, then rank accepted
 * calibrations ahead of an unverified one. A pending calibration is still
 * drawable and is labelled as such in the snapshot.
 */
export function resolveCalibration(data: ProfileData, target: ScreenTarget) {
  const screens = data.screens ?? [];
  const calibrations = data.calibrations ?? [];
  const binding = data.devices?.find((entry) => entry.deviceId === target.id);
  if (binding) {
    const bound = calibrations.find(
      (entry) => entry.id === binding.calibrationProfileId,
    );
    if (bound) return bound.geometryStatus === 'valid' ? bound : undefined;
  }
  const setup = data.calibrationSetups?.find(
    (entry) => entry.deviceId === target.id,
  );
  const workstation = data.workstation;
  const candidates = calibrations.filter((entry) => {
    const screen = screens.find((item) => item.id === entry.screenProfileId);
    if (!screen || entry.geometryStatus !== 'valid') return false;
    if (
      workstation &&
      workstation.calibrationProfileId === entry.id &&
      workstation.vision?.perspectiveProfileKey === target.id
    )
      return true;
    if (!setup) return true;
    if (
      screen.pixelWidth !== setup.width ||
      screen.pixelHeight !== setup.height
    )
      return false;
    return (
      entry.robotProfileId === setup.robotProfileId &&
      entry.toolProfileId === setup.toolProfileId
    );
  });
  return [...candidates].sort((left, right) => {
    const accepted =
      Number(calibrationAccepted(right)) - Number(calibrationAccepted(left));
    if (accepted) return accepted;
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  })[0];
}

export async function buildTwinScene(
  arm: ArmController,
  devices: PlaygroundDevices,
): Promise<TwinSceneSnapshot> {
  const capabilities = arm.describeCapabilities();
  const runtime = controllerRuntime(arm);
  const data = runtime.profileStore.list();
  const blocked = new Set<TwinBlockedReason>();
  const screens: TwinScreenSnapshot[] = [];
  const skippedScreens: TwinSceneSnapshot['skippedScreens'] = [];
  let firstToolId: string | undefined;
  const cameraSamples = new Map<string, TwinCameraScreenSample[]>();
  const cameraNames = new Map<string, string>();

  const skip = (target: ScreenTarget, reason: TwinBlockedReason) => {
    blocked.add(reason);
    skippedScreens.push({ id: target.id, name: target.name, reason });
  };

  for (const target of devices.screens()) {
    const calibration = resolveCalibration(data, target);
    if (!calibration) {
      skip(target, 'calibration-required');
      continue;
    }
    const screen = data.screens?.find(
      (entry) => entry.id === calibration.screenProfileId,
    );
    if (!screen || !hasScreenMapping(screen)) {
      skip(target, 'screen-mapping-required');
      continue;
    }
    const entry = devices.entries.get(target.id);
    if (!entry || entry.cameraId !== target.cameraId) {
      skip(target, 'camera-not-running');
      continue;
    }
    const correction = entry.camera.getCorrection();
    if (!correction) {
      skip(target, 'perspective-required');
      continue;
    }
    if (!entry.camera.getRectifiedPreviewTarget()) {
      skip(target, 'perspective-required');
      continue;
    }
    const params = new URLSearchParams({
      id: target.cameraId,
      screen: target.id,
      view: 'corrected',
    });
    const frameUrl = `/api/cameras/frame?${params}`;
    params.set('viewer', `twin-${target.id}`);
    const screenTool = data.tools?.find(
      (entry) => entry.id === calibration.toolProfileId,
    );
    const originMm = visualScreenOriginMm(calibration.origin, screenTool);
    screens.push({
      id: target.id,
      name: target.name,
      cameraId: target.cameraId,
      calibrationId: calibration.id,
      accepted: calibrationAccepted(calibration),
      physicalWidthMm: screen.physicalWidthMm,
      physicalHeightMm: screen.physicalHeightMm,
      pixelWidth: screen.pixelWidth!,
      pixelHeight: screen.pixelHeight!,
      originMm,
      xAxis: { ...calibration.xAxis },
      yAxis: { ...calibration.yAxis },
      inward: { ...calibration.inward },
      frameUrl,
      previewUrl: `/api/cameras/preview?${params.toString()}`,
      cameraLive: entry.camera.stream.getInfo().state === 'running',
    });
    firstToolId ??= calibration.toolProfileId;
    // The camera prop is only meaningful when the calibration spans the whole
    // screen. Legacy page-frame calibrations would put the lens in the wrong
    // place, so they still draw screens but do not contribute a camera pose.
    if (calibration.geometryFrame === 'screen') {
      const samples = cameraSamples.get(target.cameraId) ?? [];
      samples.push({
        calibration: {
          origin: originMm,
          xAxis: { ...calibration.xAxis },
          yAxis: { ...calibration.yAxis },
        },
        screen: {
          physicalWidthMm: screen.physicalWidthMm,
          physicalHeightMm: screen.physicalHeightMm,
        },
        correction,
      });
      cameraSamples.set(target.cameraId, samples);
      cameraNames.set(target.cameraId, entry.camera.camera.name);
    }
  }

  const visual = capabilities.kinematics.visual;
  if (!visual) blocked.add('visual-model-missing');
  if (!screens.length) {
    if (!(data.calibrations ?? []).some((c) => c.geometryStatus === 'valid'))
      blocked.add('calibration-required');
  }
  const toolId = data.workstation?.toolProfileId ?? firstToolId;
  const tool = data.tools?.find((entry) => entry.id === toolId);
  const cameraEntry = [...cameraSamples.entries()].find(([cameraId]) =>
    C922_NAME.test(cameraNames.get(cameraId) ?? ''),
  );
  const cameraPose = cameraEntry
    ? estimateCameraPose(cameraEntry[1])
    : undefined;
  const camera: TwinCameraSnapshot | undefined =
    cameraEntry && cameraPose
      ? {
          id: cameraEntry[0],
          name: cameraNames.get(cameraEntry[0]) ?? 'C922 camera',
          modelUrl: C922_BODY.modelUrl,
          assetUnits: C922_BODY.assetUnits,
          lensOffsetMm: { ...C922_BODY.lensOffsetMm },
          positionMm: { ...cameraPose.positionMm },
          quaternion: { ...cameraPose.quaternion },
          frameCornersMm: cameraPose.frameCornersMm,
          source: 'estimated',
          residualPx: cameraPose.residualPx,
          samples: cameraPose.samples,
        }
      : undefined;

  return {
    ready: Boolean(visual && screens.length),
    blockedReasons: [...blocked],
    ...(visual
      ? {
          robot: {
            visual,
            visualTipOffsetMm: visualTipOffsetMm(tool),
            joints: capabilities.kinematics.joints,
          },
        }
      : {}),
    ...(tool
      ? {
          tool: {
            offsetMm: { ...tool.offsetMm },
            contactDirection: { ...tool.contactDirection },
          },
        }
      : {}),
    ...(camera ? { camera } : {}),
    screens,
    skippedScreens,
    generatedAt: new Date().toISOString(),
  };
}

interface TwinClient {
  res: ServerResponse;
  blocked: boolean;
  lastSeq: number;
}

/**
 * One shared SSE hub for every browser tab. Samples come from the adapter's
 * passive 30004 cache, so an idle browser costs no controller traffic; state
 * flags are polled at 2 s and only while a viewer exists.
 */
export class TwinStream {
  private readonly clients = new Set<TwinClient>();
  private sampleTimer?: NodeJS.Timeout;
  private stateTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private stateBusy = false;

  constructor(private readonly getArm: () => ArmController | undefined) {}

  handle(
    req: { on: (event: string, listener: () => void) => void },
    res: ServerResponse,
  ) {
    const arm = this.getArm();
    if (!arm) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Connect the arm first' }));
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    const hello: TwinHello = {
      type: 'hello',
      intervalMs: SAMPLE_INTERVAL_MS,
      generatedAt: new Date().toISOString(),
    };
    res.write(`event: hello\ndata: ${JSON.stringify(hello)}\n\n`);
    res.socket?.setKeepAlive(true, 10_000);

    const client: TwinClient = { res, blocked: false, lastSeq: -1 };
    this.clients.add(client);
    res.on('drain', () => {
      client.blocked = false;
    });
    const remove = () => {
      if (!this.clients.delete(client)) return;
      if (!this.clients.size) this.stop();
    };
    res.on('close', remove);
    res.on('error', remove);
    void this.pumpState();
    this.start();
  }

  private start() {
    if (this.sampleTimer) return;
    this.sampleTimer = setInterval(
      () => this.pumpSamples(),
      SAMPLE_INTERVAL_MS,
    );
    this.stateTimer = setInterval(() => this.pumpState(), STATE_INTERVAL_MS);
    this.heartbeatTimer = setInterval(() => this.ping(), HEARTBEAT_MS);
  }

  private stop() {
    if (this.sampleTimer) clearInterval(this.sampleTimer);
    if (this.stateTimer) clearInterval(this.stateTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.sampleTimer = undefined;
    this.stateTimer = undefined;
    this.heartbeatTimer = undefined;
  }

  private write(client: TwinClient, event: string, data: unknown) {
    if (client.blocked || client.res.writableEnded || client.res.destroyed)
      return;
    const ok = client.res.write(
      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    );
    if (!ok) client.blocked = true;
  }

  private pumpSamples() {
    const arm = this.getArm();
    if (!arm) return;
    const sample = controllerRuntime(arm).motionSample();
    if (!sample) return;
    const message: TwinMotionMessage = {
      type: 'sample',
      seq: sample.seq,
      t: sample.receivedAt,
      joints: [...sample.joints],
      source: sample.source,
      stale: sample.stale,
    };
    for (const client of this.clients) {
      if (client.lastSeq === message.seq) continue;
      client.lastSeq = message.seq;
      this.write(client, 'sample', message);
    }
  }

  private pumpState() {
    return this.sendState();
  }

  private async sendState() {
    if (this.stateBusy) return;
    const arm = this.getArm();
    if (!arm) return;
    this.stateBusy = true;
    try {
      const runtime = await controllerRuntime(arm).state();
      const message: TwinStateMessage = {
        type: 'state',
        connected: runtime.state.connected,
        enabled: runtime.state.enabled,
        moving: runtime.state.moving,
        paused: Boolean(runtime.state.paused),
        dragMode: runtime.state.dragMode,
        faults: runtime.state.faults.length,
        stale: Boolean(runtime.state.status?.quality.stale),
        ...(runtime.state.pose
          ? {
              pose: {
                positionMm: { ...runtime.state.pose.positionMm },
                quaternion: { ...runtime.state.pose.orientation },
              },
            }
          : {}),
      };
      for (const client of this.clients) this.write(client, 'state', message);
    } catch {
      // A dropped controller connection is reported by the next successful read;
      // the stream itself stays open so a reconnect is visible without a reload.
    } finally {
      this.stateBusy = false;
    }
  }

  private ping() {
    for (const client of this.clients) {
      if (client.blocked || client.res.writableEnded) continue;
      if (!client.res.write(': ping\n\n')) client.blocked = true;
    }
  }

  close() {
    for (const client of this.clients) {
      try {
        client.res.end();
      } catch {
        // Already closed.
      }
    }
    this.clients.clear();
    this.stop();
  }
}
