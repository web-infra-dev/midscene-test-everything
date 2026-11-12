import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { calibrationPageMarkers } from '../assisted-contracts.js';
import { screenGeometry } from '../calibration/geometry.js';
import { webVerificationTargets } from '../calibration/phone/geometry.js';
import type {
  ActionRequest,
  CalibrationProfile,
  CartesianPose,
  ToolPayload,
} from '../contracts.js';
import { RobotKernel } from '../kernel.js';
import {
  ProfileStore,
  RobotActionAuditStore,
  RobotArmRuntime,
} from '../runtime.js';
import { TestRobotAdapter } from './test-adapter.js';
export const pose = (x = 0, y = 0, z = 30): CartesianPose => ({
  frame: 'base',
  positionMm: { x, y, z },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
});
export async function fixture(
  jointCount = 4,
  motionDurationMs = 10,
  adapterOverride?: TestRobotAdapter,
  payload?: ToolPayload,
) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'midscene-robot-arm-fixture-'),
  );
  const adapter =
    adapterOverride ??
    new TestRobotAdapter({
      jointCount,
      motionDurationMs,
      initialPose: pose(100, -50, 100),
    });
  const store = new ProfileStore(path.join(directory, 'profiles.json'));
  const robot = await store.putRobot({
    id: 'robot',
    name: 'Robot',
    adapterId: adapter.id,
    connectionIdentity: adapter.connectionIdentity,
    installation: 'Fixed',
  });
  const tool = await store.putTool({
    id: 'tool',
    name: 'Tool',
    ...(payload && { payload }),
    offsetMm: { x: 0, y: 0, z: 0 },
    contactDirection: { x: 0, y: 0, z: -1 },
  });
  const screen = await store.putScreen({
    id: 'screen',
    name: 'Screen',
    phoneMapping: {
      imageToPhone: [400 / 999, 0, 0, 0, 800 / 499, 0, 0, 0, 1],
      width: 400,
      height: 800,
      visionFingerprint: 'f',
    },
    pixelWidth: 1000,
    pixelHeight: 500,
    physicalWidthMm: 200,
    physicalHeightMm: 100,
    direction: 'right/down',
    pressDepthMm: 1,
    safeHeightMm: 20,
    actionSpeed: { kind: 'ratio', value: 0.1 },
    actionAcceleration: { kind: 'ratio', value: 0.1 },
    contactMs: 60,
    swipeEndpointHoldMs: 50,
    longPressMs: 800,
    dragHoldMs: 80,
    releaseSpeedFactor: 0.4,
    releaseAccelerationFactor: 0.4,
    successorStartLeadMs: 0,
    motionTimeoutMs: 60000,
  });
  const binding = {
    robotProfileId: robot.id,
    toolProfileId: tool.id,
    screenProfileId: screen.id,
  };
  const geometry = screenGeometry(
    { normal: { x: 0, y: 0, z: -1 }, offset: -30 },
    pose().positionMm,
    pose(200).positionMm,
    pose().orientation,
    tool,
    new RobotKernel(adapter).capabilities,
  );
  const layout = {
    revision: 1,
    width: 400,
    height: 800,
    screen: { width: 400, height: 900, devicePixelRatio: 1 },
    markers: calibrationPageMarkers(400, 800),
  };
  const results = webVerificationTargets(layout, () => 0.5).map(
    (target, i) => ({
      id: String(i),
      target,
      actual: target,
      errorPx: 0,
      durationMs: 60,
    }),
  );
  const calibration: CalibrationProfile = {
    phoneFrame: { width: 400, height: 800 },
    ...binding,
    ...geometry,
    id: 'calibration',
    geometryStatus: 'valid',
    acceptanceStatus: 'accepted',
    verification: {
      protocol: 'web-v1',
      hoverMotion: true,
      hoverHuman: true,
      confirmedAt: new Date().toISOString(),
      web: {
        protocol: 'web-v1',
        coordinateSpace: 'phone',
        layout,
        results,
        attempts: results.map((r) => ({
          id: r.id,
          target: r.target,
          hit: true,
        })),
      },
    },
    robotGeometryRevision: robot.geometryRevision,
    toolGeometryRevision: tool.geometryRevision,
    screenGeometryRevision: screen.geometryRevision,
    screenRevision: screen.revision,
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    quality: {
      rmseMm: 0,
      inliers: 5,
      total: 5,
      minorSpanMm: 100,
      majorSpanMm: 200,
    },
    observationPose: pose(100, -50, 100),
  };
  await store.saveCalibration(calibration);
  const workstation = await store.putWorkstation({
    ...binding,
    revision: 0,
    calibrationProfileId: calibration.id,
    cameraId: 'cam',
  });
  await store.confirmVision(
    {
      cameraId: 'cam',
      cameraName: 'Cam',
      perspectiveProfileKey: 'p',
      fingerprint: 'f',
      width: 1000,
      height: 500,
      confirmedAt: new Date().toISOString(),
    },
    workstation.revision,
  );

  // The fixture owns a temp audit file for the same reason it owns the Profile
  // store: nothing in a test run may write into the repository.
  const auditStore = new RobotActionAuditStore({
    filePath: path.join(directory, 'audit.jsonl'),
  });
  const runtime = new RobotArmRuntime({
    adapter,
    profileStore: store,
    auditStore,
  });
  await runtime.initialize();
  await runtime.lifecycle(
    'enable',
    payload ? { ...binding, toolRevision: tool.revision } : undefined,
  );
  const request = (action: ActionRequest['action']): ActionRequest => ({
    ...binding,
    action,
    requestId: crypto.randomUUID(),
    calibrationProfileId: calibration.id,
    contextKey: store.contextKey(binding, calibration.id),
  });
  return {
    adapter,
    store,
    auditStore,
    runtime,
    robot,
    tool,
    screen,
    binding,
    calibration,
    request,
    directory,
    async cleanup() {
      // A precondition, not cleanup: check the path before doing anything, so a
      // bad fixture directory fails fast instead of masking a shutdown error.
      if (
        path.dirname(directory) !== os.tmpdir() ||
        !path.basename(directory).startsWith('midscene-robot-arm-fixture-')
      )
        throw new Error('Unsafe fixture cleanup path');
      try {
        if ((await adapter.getState()).connected) await runtime.shutdown();
        else await adapter.disconnect();
      } finally {
        // Audit writes are fire-and-forget by design, so let any queued append
        // land before the directory goes away: a late write would recreate it
        // and make the recursive remove fail with ENOTEMPTY.
        await auditStore.flush();
        await rm(directory, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 50,
        });
      }
    },
  };
}
