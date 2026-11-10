import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it, rstest } from '@rstest/core';
import { createCalibrationClient } from '../../calibration-ui/src/client.js';
import {
  calibrationCaptureTargets,
  calibrationPageMarkers,
} from '../src/assisted-contracts.js';
import type {
  CalibrationPageLayout,
  CalibrationPageUpdate,
  WebPoint,
} from '../src/assisted-contracts.js';
import { createCalibrationHandler } from '../src/calibration-server/handler.js';
import { AutomaticCapture } from '../src/calibration/exploration/capture.js';
import { explorationTargets } from '../src/calibration/exploration/targets.js';
import { CalibrationWorkflow } from '../src/calibration/workflow.js';
import { RobotVisionError } from '../src/camera/errors.js';
import { RobotArmError } from '../src/contracts.js';
import { contactPoint } from '../src/domain.js';
import { fixture, pose } from './fixtures.js';
const layout: CalibrationPageLayout = {
  revision: 1,
  width: 400,
  height: 800,
  screen: { width: 400, height: 900, devicePixelRatio: 1 },
  markers: calibrationPageMarkers(400, 800),
};
afterEach(() => {
  rstest.unstubAllGlobals();
  rstest.restoreAllMocks();
});
async function setup(deviceId = 'cam') {
  const f = await fixture();
  const originalBinding = f.store.list().workstation!;
  await f.store.acceptDeviceBinding({
    ...originalBinding,
    deviceId: 'cam',
    revision: 0,
    vision: originalBinding.vision!,
  });
  const jpg = Buffer.from([
    255, 216, 255, 192, 0, 17, 8, 1, 244, 3, 232, 3, 1, 17, 0, 2, 17, 0, 3, 17,
    0,
  ]);
  let fingerprint = 'original';
  const detectMarkers = rstest.fn(() =>
    Response.json({
      webToImage: [999 / 400, 0, 0, 0, 499 / 800, 0, 0, 0, 1],
      markerErrorPx: 0.2,
      accuracy: {
        fit: { count: 4, meanErrorCssPx: 0.1, maxErrorCssPx: 0.2 },
        validation: { count: 2, meanErrorCssPx: 0.2, maxErrorCssPx: 0.4 },
        points: [],
      },
    }),
  );
  const binding = async (options: { width: number; height: number }) => ({
    cameraId: 'cam',
    cameraName: 'Camera',
    perspectiveProfileKey: 'p',
    fingerprint,
    width: options.width,
    height: options.height,
  });
  const assertPerspectiveCurrent = rstest.fn(async () => {});
  const forScreen = (owner: string) =>
    new CalibrationWorkflow(f.runtime, {
      deviceId: owner,
      vision: {
        assertPerspectiveCurrent,
        binding,
        snapshot: async (options) => ({
          base64: jpg.toString('base64'),
          width: options.width,
          height: options.height,
          binding: await binding(options),
        }),
        detectMarkers: async () => detectMarkers().json(),
      },
    });
  const service = forScreen(deviceId);
  await service.prepare({
    robotProfileId: f.robot.id,
    toolProfileId: f.tool.id,
    cameraId: 'cam',
    width: 1000,
    height: 500,
    motion: f.screen,
  });
  let sequence = 0;
  let pageId = service.openPhonePage();
  let point: WebPoint | undefined;
  let contactId = crypto.randomUUID();
  let lastReply:
    | import('../src/assisted-contracts.js').CalibrationPageReply
    | undefined;
  let visible = true;
  let revision = 1;

  const sendNow = async (extra: Partial<CalibrationPageUpdate> = {}) => {
    const reply = service.receivePhone({
      pageId,
      sequence: ++sequence,
      platform: 'android',
      displayMode: 'fullscreen',
      visible,
      layout: { ...layout, revision },
      contact: point ? { point, id: contactId, motionRevision: 0 } : undefined,
      targetReady: lastReply?.capture?.target.id,
      captureAck: lastReply?.capture?.probe?.id,
      ...extra,
    });
    lastReply = reply;
    return reply;
  };
  let queued: Promise<unknown> = Promise.resolve();
  const send = (extra: Partial<CalibrationPageUpdate> = {}) => {
    const request = queued.then(() => sendNow(extra));
    queued = request.catch(() => undefined);
    return request;
  };
  await send();
  await service.mapSetup();
  const beforeTask = {
    state: service.status(),
    setup: service.setup(),
    operation: f.runtime.current(),
  };
  const state = await service.create();
  return {
    ...f,
    forScreen,
    assertPerspectiveCurrent,
    service,
    state,
    beforeTask,
    detectMarkers,
    recordSafe: async () => {
      await service.command(state.id, 'position-safe', true);
      await rstest.waitFor(async () =>
        expect((await f.adapter.getState()).dragMode).toBe(true),
      );
      f.adapter.setPoseForTesting(pose(150, -50, 100));
      return service.command(state.id, 'record-safe', true);
    },
    recordReference: async () => {
      await service.command(state.id, 'position-reference', true);
      await rstest.waitFor(async () =>
        expect((await f.adapter.getState()).dragMode).toBe(true),
      );
      return service.command(state.id, 'record-reference', true);
    },
    send,
    reload: () => {
      pageId = service.openPhonePage();
      sequence = 0;
      return send();
    },
    setPoint: (p: WebPoint) => {
      point = p;
      contactId = crypto.randomUUID();
      f.adapter.setPoseForTesting(pose(p.x * 0.5, -p.y * 0.125, 30));
    },
    lift: () => {
      point = undefined;
    },
    show: () => {
      visible = true;
    },
    hide: () => {
      visible = false;
    },
    resize: () => {
      revision++;
    },
    changeCamera: (value = 'changed') => {
      fingerprint = value;
    },
    dispose: async () => {
      await queued;
      await service.stop();
      await f.cleanup();
    },
  };
}
describe('phone-assisted calibration coordinator', () => {
  it.each(['start-automatic', 'start-fast', 'start-slide'] as const)(
    'runs upstream boundaries, records a Safe Position and accepts without click verification (%s)',
    async (action) => {
      const screenId = action === 'start-fast' ? 'right' : 'cam';
      const f = await setup(screenId);
      const original = f.store.deviceBinding('cam');
      const timer = setInterval(() => void f.send(), 50);
      try {
        rstest
          .spyOn(AutomaticCapture.prototype, 'run')
          .mockImplementation(async function (this: AutomaticCapture) {
            this.reference = pose(100, -50, 30);
            for (const point of [
              { x: 200, y: 400 },
              { x: 220, y: 400 },
              { x: 200, y: 480 },
            ])
              this.localPoints.push({
                point,
                positionMm: { x: point.x * 0.5, y: -point.y * 0.125, z: 30 },
                purpose: 'direction',
                readings: 1,
                tipSpreadMm: 0,
                touchSpreadPx: 0,
              });
            for (const { point, purpose } of explorationTargets(
              layout,
              action !== 'start-automatic',
            ))
              this.points.push({
                point,
                purpose,
                positionMm: { x: point.x * 0.5, y: -point.y * 0.125, z: 30 },
                readings: 1,
                tipSpreadMm: 0,
                touchSpreadPx: 0,
              });
          });
        f.adapter.setPoseForTesting(pose(100, -50, 60));
        await f.recordReference();
        await f.service.command(f.state.id, action, true);
        await rstest.waitFor(
          () => {
            const s = f.service.status()!;
            expect(s.error).toBeUndefined();
            expect(s.stage).toBe('return-ready');
            expect(s.calibration?.boundary.hoverEdges).toBe(true);
          },
          { timeout: 30000 },
        );
        const before = f.service.status()!;
        expect(before.automaticWorkflow).toBe(true);
        expect(before.samples).toBe(action === 'start-automatic' ? 9 : 6);
        expect(before.explorationMode).toBe(
          action === 'start-fast'
            ? 'fast'
            : action === 'start-slide'
              ? 'slide'
              : 'standard',
        );
        expect(before.explorationQuality?.coverage).toBeGreaterThanOrEqual(0.6);
        expect(before.calibration!.boundary.hoverHuman).toBe(false);
        expect(before.calibration!.boundary.contactCorners).toBe(true);
        expect(before.calibration!.boundary.contactEdges).toBe(true);
        expect(before.result).toBeUndefined();
        expect(before.safePosition).toBeUndefined();
        expect(before.verification).toHaveLength(0);
        const runs = before.calibration!.verificationRuns!;
        expect(runs.map((r) => r.group)).toEqual(['hover', 'contact']);
        expect(
          runs.every((r) => r.speed.kind === f.screen.actionSpeed.kind),
        ).toBe(true);
        expect(runs[0].targets[0].name).toBe('Initial lift');
        expect(runs[1].targets.some((t) => t.name === 'Corner 1 lift')).toBe(
          true,
        );
        expect(
          runs[1].targets.some((t) => t.name === 'Boundary segment 1 lift'),
        ).toBe(true);
        await expect(
          f.service.command(before.id, 'accept', true),
        ).rejects.toThrow('Complete boundary verification');
        await expect(
          f.runtime.acceptWebCalibration(before.calibration!.id, {
            protocol: 'auto-boundary-v1',
          }),
        ).rejects.toThrow('record the Safe Position');
        await f.recordSafe();
        await expect(
          f.service.command(before.id, 'accept', false),
        ).rejects.toThrow('confirm before saving');
        expect(f.service.status()!.stage).toBe('review');
        const saved = await f.service.command(before.id, 'accept', true);
        expect(saved.stage).toBe('completed');
        expect(saved.result?.verification?.protocol).toBe('auto-boundary-v1');
        expect(saved.result?.verification?.web).toBeUndefined();
        expect(saved.result?.verification?.auto?.humanAccepted).toBe(true);
        expect(saved.result?.observationPose).toEqual(pose(150, -50, 100));
        expect(f.store.deviceBinding(screenId)?.calibrationProfileId).toBe(
          saved.result!.id,
        );
        if (screenId === 'right') {
          expect(f.store.deviceBinding('cam')).toEqual(original);
          const recording = f.service.recording();
          const other = f.forScreen('cam');
          expect(recording.deviceId).toBe(screenId);
          await expect(
            other.restoreRecording(recording, true),
          ).rejects.toMatchObject({ code: 'PROFILE_MISMATCH' });
          expect(other.status()).toBeNull();
          const beforeRetry = f.adapter.movements.length;
          f.service.resetAttempt();
          const retry = await f.service.create();
          expect(retry.id).not.toBe(saved.id);
          expect(retry).toMatchObject({
            points: [],
            samples: 0,
            stage: 'ready',
            phoneConnected: true,
          });
          expect(retry.result).toBeUndefined();
          expect(f.store.deviceBinding(screenId)?.calibrationProfileId).toBe(
            saved.result!.id,
          );
          expect(f.adapter.movements).toHaveLength(beforeRetry);
        }
      } finally {
        clearInterval(timer);
        await f.dispose();
      }
    },
    45000,
  );
  it('prepares phone and camera without creating a task or acquiring a robot operation', async () => {
    const f = await setup();
    try {
      expect(f.beforeTask.state).toBeNull();
      expect(f.beforeTask.setup.mapping).toBeDefined();
      expect(f.beforeTask.operation?.status).not.toBe('running');
      expect(f.service.status()?.stage).toBe('ready');
      expect(f.adapter.movements).toHaveLength(0);
    } finally {
      await f.dispose();
    }
  });
  it('cannot install a draft after the operator cancels during a slow mapping check', async () => {
    const f = await setup('right');
    try {
      const phone = f.service.phoneStatus().diagnostics?.pageId;
      const mapping = f.service.setup().mapping;
      await f.service.stop();
      f.service.resetAttempt();
      let release!: () => void;
      f.assertPerspectiveCurrent.mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            release = r;
          }),
      );
      const pending = f.service.create();
      const stopping = f.service.stop();
      release();
      await expect(pending).rejects.toMatchObject({ code: 'ACTION_STOPPED' });
      await stopping;
      expect(f.service.status()).toBeNull();
      const retry = await f.service.create();
      expect(retry.mapping).toEqual(mapping);
      expect(retry.points).toEqual([]);
      expect(f.service.phoneStatus().diagnostics?.pageId).toBe(phone);
      expect(f.store.deviceBinding('right')).toBeUndefined();
      expect(f.adapter.movements).toHaveLength(0);
    } finally {
      await f.dispose();
    }
  });
  it('discards partial touches after cancel while keeping both the phone and the sibling’s accepted mapping', async () => {
    const f = await setup('right');
    const phone = f.service.phoneStatus().diagnostics?.pageId;
    const original = f.store.deviceBinding('cam')!;
    const screen = f.store.getScreen(original.screenProfileId);
    try {
      expect(screen.phoneMapping?.visionFingerprint).toBe(
        original.vision.fingerprint,
      );
      const mapping = f.service.setup().mapping;
      rstest
        .spyOn(AutomaticCapture.prototype, 'run')
        .mockImplementation(async function (this: AutomaticCapture, host) {
          this.points.push({
            point: { x: 75, y: 100 },
            positionMm: { x: 25, y: 30, z: 30 },
            purpose: 'fit',
            readings: 1,
            tipSpreadMm: 0,
            touchSpreadPx: 0,
          });
          await new Promise<void>((resolve) =>
            host.signal.addEventListener('abort', () => resolve(), {
              once: true,
            }),
          );
          host.check();
        });
      await f.recordReference();
      await f.service.command(f.state.id, 'start-fast', true);
      await rstest.waitFor(() => expect(f.service.status()?.samples).toBe(1));
      await f.service.stop();
      f.service.resetAttempt();
      await f.send();
      const retry = await f.service.create();
      expect(retry.id).not.toBe(f.state.id);
      expect(retry).toMatchObject({
        stage: 'ready',
        points: [],
        samples: 0,
        mapping,
      });
      expect(f.service.phoneStatus().diagnostics?.pageId).toBe(phone);
      expect(f.store.getScreen(original.screenProfileId)).toEqual(screen);
      expect(f.store.deviceBinding('cam')).toEqual(original);
      expect(f.store.deviceBinding('right')).toBeUndefined();
      await expect(
        f.service.command(f.state.id, 'accept', true),
      ).rejects.toMatchObject({ code: 'CALIBRATION_REQUIRED' });
    } finally {
      await f.dispose();
    }
  });
  it('starts a fresh regular collection only on confirmation after a failed slide', async () => {
    const f = await setup('right');
    try {
      const run = rstest
        .spyOn(AutomaticCapture.prototype, 'run')
        .mockImplementationOnce(async function (this: AutomaticCapture) {
          this.points.push({
            point: { x: 75, y: 100 },
            positionMm: { x: 25, y: 30, z: 30 },
            purpose: 'fit',
            readings: 1,
            tipSpreadMm: 0,
            touchSpreadPx: 0,
          });
          throw new Error('Lost sliding contact');
        })
        .mockRejectedValue(new Error('Point probe failed'));
      const reference = await f.recordReference();
      await f.service.command(f.state.id, 'start-slide', true);
      await rstest.waitFor(() =>
        expect(f.service.status()).toMatchObject({
          stage: 'interrupted',
          explorationMode: 'slide',
          collectionFailed: true,
          samples: 1,
        }),
      );
      await expect(
        f.service.command(f.state.id, 'retry-standard'),
      ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
      expect(run).toHaveBeenCalledTimes(1);
      const retry = await f.service.command(f.state.id, 'retry-standard', true);
      expect(retry.id).not.toBe(f.state.id);
      expect(retry).toMatchObject({
        explorationMode: 'standard',
        samples: 0,
        referencePosition: reference.referencePosition,
        mapping: reference.mapping,
      });
      await rstest.waitFor(() =>
        expect(f.service.status()?.stage).toBe('interrupted'),
      );
      await expect(
        f.service.command(f.state.id, 'retry-standard', true),
      ).rejects.toMatchObject({ code: 'CALIBRATION_REQUIRED' });
      await expect(
        f.service.command(retry.id, 'retry-standard', true),
      ).rejects.toMatchObject({ code: 'INVALID_STAGE' });
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      await f.dispose();
    }
  });
  it('restarts with both recorded positions, without redetecting the camera or moving', async () => {
    const f = await setup();
    try {
      await f.recordSafe();
      const safePosition = f.service.status()!.safePosition;
      await f.recordReference();
      const saved = f.service.status()!.referencePosition;
      await f.service.command(f.state.id, 'cancel');
      const resumed = await f.service.command(f.state.id, 'restart', true);
      expect(resumed.id).not.toBe(f.state.id);
      expect(resumed.stage).toBe('ready');
      expect(resumed.mapping).toEqual(f.beforeTask.setup.mapping);
      expect(resumed.referencePosition).toEqual(saved);
      expect(resumed.safePosition).toEqual(safePosition);
      const audit = rstest.fn(async () => {});
      Object.defineProperty(f.runtime, 'auditStore', {
        value: { record: audit },
      });
      const run = rstest
        .spyOn(AutomaticCapture.prototype, 'run')
        .mockRejectedValue(new Error('Simulated stop'));
      await f.send();
      await f.service.command(resumed.id, 'start-fast', true);
      await rstest.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
      expect(f.service.status()?.explorationMode).toBe('fast');
      await rstest.waitFor(() =>
        expect(audit).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: 'calibration',
            outcome: 'failed',
            error: 'Simulated stop',
            detail: expect.objectContaining({
              explorationMode: 'fast',
              stage: 'collecting',
            }),
          }),
        ),
      );
      expect(f.detectMarkers).toHaveBeenCalledTimes(1);
      expect(f.adapter.movements).toHaveLength(0);
    } finally {
      await f.dispose();
    }
  });
  it('preserves taught positions on repeated setup checks and invalidates a changed camera', async () => {
    const f = await setup();
    try {
      await f.recordSafe();
      await f.recordReference();
      const before = f.service.status()!;
      await f.service.prepare({
        robotProfileId: f.robot.id,
        toolProfileId: f.tool.id,
        cameraId: 'cam',
        width: 1000,
        height: 500,
        motion: f.screen,
      });
      await f.service.mapSetup();
      expect(f.service.status()).toMatchObject({
        id: before.id,
        safePosition: before.safePosition,
        referencePosition: before.referencePosition,
      });
      expect(f.adapter.movements).toHaveLength(0);
      f.changeCamera();
      await f.service.mapSetup();
      expect(f.service.status()).toBeNull();
    } finally {
      await f.dispose();
    }
  });
  it('confirms the selected screen mapping over HTTP with the prepared output or an explicit size', async () => {
    const f = await setup('right-screen');
    const basePath = '/api/devices/right-screen/calibration';
    const handle = createCalibrationHandler({ service: f.service, basePath });
    const server = createServer((req, res) => void handle(req, res));
    try {
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}${basePath}`;
      const client = createCalibrationClient({ baseUrl });
      const confirmed = await client.mapAssistedCalibration();
      expect(confirmed.mapping).toEqual(f.beforeTask.setup.mapping);
      const output = { cameraId: 'cam', width: 600, height: 900 };
      const resized = await client.mapAssistedCalibration(output);
      expect(resized.mapping?.vision).toMatchObject(output);
      expect((await client.mapAssistedCalibration()).mapping).toEqual(
        resized.mapping,
      );
      await expect(
        client.mapAssistedCalibration({ ...output, cameraId: 'other-camera' }),
      ).rejects.toThrow('camera or output size changed');
      const partial = await fetch(
        `${baseUrl}/assisted-calibration/setup/mapping`,
        {
          method: 'POST',
          body: JSON.stringify({ cameraId: 'cam', width: 600 }),
        },
      );
      expect(await partial.json()).toMatchObject({ code: 'INVALID_MAPPING' });
      expect(f.adapter.movements).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await f.dispose();
    }
  });
  it('reuses unchanged camera mapping and detects again when the vision fingerprint changes', async () => {
    const f = await setup();
    try {
      const first = await f.service.mapSetup();
      const before = f.detectMarkers.mock.calls.length;
      const reused = await f.service.mapSetup();
      expect(reused.mapping).toEqual(first.mapping);
      expect(f.detectMarkers).toHaveBeenCalledTimes(1);
      expect(f.detectMarkers).toHaveBeenCalledTimes(before);
      f.changeCamera();
      f.detectMarkers.mockImplementationOnce(() => {
        throw new RobotVisionError(
          'NO_SCREEN_DETECTED',
          'temporary marker loss',
        );
      });
      const updated = await f.service.mapSetup();
      expect(updated.mapping?.vision.fingerprint).toBe('changed');
      expect(f.detectMarkers).toHaveBeenCalledTimes(before + 2);
    } finally {
      await f.dispose();
    }
  });
  it('records a stable safe pose before drawing, without moving or creating screen geometry', async () => {
    const f = await setup();
    try {
      await expect(
        f.service.command(f.state.id, 'start', true),
      ).rejects.toMatchObject({ code: 'REFERENCE_POSITION_REQUIRED' });
      await expect(
        f.service.command(f.state.id, 'position-reference'),
      ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
      await f.service.command(f.state.id, 'position-reference', true);
      await rstest.waitFor(async () =>
        expect((await f.adapter.getState()).dragMode).toBe(true),
      );
      await expect(
        f.service.command(f.state.id, 'record-reference'),
      ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
      const saved = await f.service.command(
        f.state.id,
        'record-reference',
        true,
      );
      expect(saved.stage).toBe('ready');
      expect(saved.referencePosition).toEqual(pose(100, -50, 100));
      expect((await f.adapter.getState()).dragMode).toBe(false);
      expect(f.adapter.movements).toHaveLength(0);
      expect(f.store.list().screens).toHaveLength(1);
    } finally {
      await f.dispose();
    }
  });
  it('keeps safe positioning independent of phone visibility and never moves automatically', async () => {
    const f = await setup();
    try {
      await f.service.command(f.state.id, 'position-reference', true);
      await rstest.waitFor(async () =>
        expect((await f.adapter.getState()).dragMode).toBe(true),
      );
      f.hide();
      await f.send();
      await rstest.waitFor(async () =>
        expect((await f.adapter.getState()).dragMode).toBe(true),
      );
      expect(f.service.status()?.stage).toBe('positioning');
      expect(f.service.status()?.referencePosition).toBeUndefined();
      expect(f.adapter.movements).toHaveLength(0);
    } finally {
      await f.dispose();
    }
  });
  it('records safe and reference positions while disconnected, but blocks automatic capture until reconnection', async () => {
    const f = await setup();
    try {
      f.service.disconnectPhone();
      await f.recordSafe();
      await f.recordReference();
      const state = f.service.status()!;
      expect(state.safePosition).toBeDefined();
      expect(state.referencePosition).toBeDefined();
      expect(state.phoneConnected).toBe(false);
      expect((await f.adapter.getState()).dragMode).toBe(false);
      for (const action of [
        'start-automatic',
        'start-fast',
        'start-slide',
      ] as const) {
        await expect(
          f.service.command(state.id, action, true),
        ).rejects.toMatchObject({ code: 'PHONE_DISCONNECTED' });
      }
      expect(f.adapter.movements).toHaveLength(0);
    } finally {
      await f.dispose();
    }
  });
  it('only lets the newest opened page take over, including delayed first reports', async () => {
    const f = await setup();
    try {
      const delayed = f.service.openPhonePage();
      const newest = f.service.openPhonePage();
      await f.send({ pageId: newest });
      for (const old of [undefined, delayed]) {
        await expect(
          old ? f.send({ pageId: old }) : f.send(),
        ).rejects.toMatchObject({
          code: 'PHONE_PAGE_REPLACED',
        });
      }
      expect((await f.send({ pageId: newest })).view).toBe('markers');
    } finally {
      await f.dispose();
    }
  });
  it('keeps the fixed URL and phone pairing through ending and restarting calibration', async () => {
    const f = await setup();
    try {
      const before = f.service.phoneStatus();
      expect(
        before.links.every((link) =>
          link.url.endsWith(':3021/phone-calibration'),
        ),
      ).toBe(true);
      await f.service.command(f.state.id, 'cancel');
      expect((await f.send()).view).toBe('markers');
      expect(f.service.phoneStatus()).toMatchObject({
        state: before.state,
        links: before.links,
        model: before.model,
      });
      expect(f.service.phoneStatus().diagnostics?.pageId).toBe(
        before.diagnostics?.pageId,
      );
      const restarted = await f.service.create();
      expect(restarted.phoneConnected).toBe(true);
      expect(f.service.phoneStatus().links).toEqual(before.links);
    } finally {
      await f.dispose();
    }
  });

  it('keeps mechanical capture independent of camera correction changes', async () => {
    const f = await setup();
    try {
      expect(f.store.list().screens).toHaveLength(1);
      await f.recordReference();
      f.changeCamera();
      await f.service.command(f.state.id, 'start', true);
      expect(f.service.status()?.stage).toBe('collecting');
      await f.service.stop();
    } finally {
      await f.dispose();
    }
  });
  it.each(['verify', 'auto-repair', 'reprobe', 'apply-reprobe'] as const)(
    'does not expose the removed local %s path',
    async (action) => {
      const f = await setup();
      try {
        await expect(
          f.service.command(f.state.id, action, true),
        ).rejects.toMatchObject({ code: 'INVALID_COMMAND' });
        expect(f.adapter.movements).toHaveLength(0);
      } finally {
        await f.dispose();
      }
    },
  );
  it.each(['hide', 'resize', 'reload'] as const)(
    'interrupts on phone %s and never accepts a result',
    async (cause) => {
      const f = await setup();
      try {
        if (!f.service.status()?.referencePosition) await f.recordReference();
        await f.service.command(f.state.id, 'start', true);
        if (cause === 'reload') await f.reload();
        else f[cause]();
        await f.send();
        await rstest.waitFor(() =>
          expect(f.service.status()?.stage).toBe('interrupted'),
        );
        if (cause === 'reload') {
          await rstest.waitFor(() =>
            expect(f.runtime.current()?.status).not.toBe('running'),
          );
          await f.runtime.recover();
          const resumed = await f.service.command(f.state.id, 'restart', true);
          expect(resumed.stage).toBe('ready');
          expect(resumed.referencePosition).toBeDefined();
          expect(resumed.points).toEqual([]);
        }
        if (cause === 'resize') expect(f.service.status()?.error).toBeDefined();
        expect(f.service.status()?.result).toBeUndefined();
      } finally {
        await f.dispose();
      }
    },
  );
});

it('stops collection when phone acknowledgements time out', async () => {
  const f = await setup();
  try {
    await f.recordReference();
    await f.service.command(f.state.id, 'start', true);
    await rstest.waitFor(
      () => expect(f.service.status()?.stage).toBe('interrupted'),
      { timeout: 12000 },
    );
    await rstest.waitFor(() =>
      expect(f.runtime.current()?.status).not.toBe('running'),
    );
    expect(f.service.status()?.result).toBeUndefined();
    expect((await f.adapter.getState()).dragMode).toBe(false);
  } finally {
    await f.dispose();
  }
}, 15000);

it.each(['missing', 'failed'])(
  'refuses %s independent camera accuracy evidence',
  async (kind) => {
    const f = await setup();
    try {
      f.changeCamera();
      f.detectMarkers.mockReturnValueOnce(
        Response.json({
          webToImage: [999 / 400, 0, 0, 0, 499 / 800, 0, 0, 0, 1],
          markerErrorPx: 0.2,
          accuracy:
            kind === 'missing'
              ? undefined
              : {
                  fit: { count: 4, meanErrorCssPx: 0.1, maxErrorCssPx: 0.2 },
                  validation: { count: 2, meanErrorCssPx: 1, maxErrorCssPx: 6 },
                  points: [],
                },
        }),
      );
      await expect(f.service.mapSetup()).rejects.toMatchObject({
        code: 'INVALID_MAPPING',
      });
      expect(f.service.setup().mapping).toBeUndefined();
      expect(f.adapter.movements).toHaveLength(0);
    } finally {
      await f.dispose();
    }
  },
);

it('keeps a candidate parking pose separate from the start; a bad holdout blocks adoption', async () => {
  const f = await setup();
  try {
    await f.recordSafe();
    expect(f.service.status()?.safePosition).toEqual(pose(150, -50, 100));
    expect(f.service.status()?.referencePosition).toBeUndefined();
    expect(f.adapter.movements).toHaveLength(0);
    await f.recordReference();
    rstest
      .spyOn(AutomaticCapture.prototype, 'run')
      .mockImplementation(async function (this: AutomaticCapture) {
        this.reference = pose(100, -50, 30);
        const targets = calibrationCaptureTargets(layout);
        for (const [i, point] of targets.entries()) {
          const check = [1, 3, 7].includes(i);
          this.points.push({
            point,
            positionMm: {
              x: point.x * 0.5 + (check ? 2 : 0),
              y: -point.y * 0.125,
              z: 30,
            },
            purpose: check ? 'check' : 'fit',
            readings: 1,
            tipSpreadMm: 0,
            touchSpreadPx: 0,
          });
        }
      });
    await f.service.command(f.state.id, 'start', true);
    await rstest.waitFor(() =>
      expect(f.service.status()?.stage).toBe('interrupted'),
    );
    expect(f.service.status()!.error).toContain('Validation residual');
    expect(f.service.status()!.calibration).toBeUndefined();
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    await f.dispose();
  }
});

it('exposes received touch diagnostics without treating history as active contact', async () => {
  const f = await setup();
  try {
    await f.send({
      touchEvents: [
        {
          sequence: 1,
          elapsedMs: 50,
          kind: 'pointerdown',
          point: { x: 123, y: 234 },
        },
        { sequence: 2, elapsedMs: 60, kind: 'pointerup' },
      ],
    });
    expect(f.service.phoneStatus().diagnostics).toMatchObject({
      contact: false,
      updateSequence: expect.any(Number),
      receivedAt: expect.any(Number),
      events: [
        { kind: 'pointerdown', point: { x: 123, y: 234 } },
        { kind: 'pointerup' },
      ],
    });
  } finally {
    await f.dispose();
  }
});

it.each([1.25, 2.5])(
  'rejects held-out height error %s without another collection pass',
  async (heightError) => {
    const f = await setup();
    const timer = setInterval(() => void f.send(), 50);
    try {
      rstest
        .spyOn(AutomaticCapture.prototype, 'run')
        .mockImplementation(async function (this: AutomaticCapture) {
          this.reference = pose(100, -50, 30);
          for (const { point, purpose } of explorationTargets(layout, false)) {
            this.points.push({
              point,
              purpose,
              positionMm: {
                x: point.x * 0.5,
                y: -point.y * 0.125,
                z: purpose === 'check' ? 30 + heightError : 30,
              },
              readings: 1,
              tipSpreadMm: 0,
              touchSpreadPx: 0,
            });
          }
        });
      const collect = rstest.spyOn(f.runtime, 'collectAutomaticPoints');
      await f.recordSafe();
      f.adapter.setPoseForTesting(pose(100, -50, 60));
      await f.recordReference();
      await f.service.command(f.state.id, 'start-automatic', true);
      await rstest.waitFor(
        () => {
          const state = f.service.status()!;
          expect(state.stage).toBe('interrupted');
          expect(state.error).toMatch(
            /Validation height residual|2 mm compensation limit/,
          );
          expect(state.result).toBeUndefined();
        },
        { timeout: 10000 },
      );
      expect(collect).toHaveBeenCalledTimes(1);
      expect(
        f.service
          .status()!
          .points.filter((p) => p.purpose === 'check')
          .every(
            (p) => p.positionMm.z === 30 + heightError && !p.repeatedSamples,
          ),
      ).toBe(true);
    } finally {
      clearInterval(timer);
      await f.dispose();
    }
  },
  20000,
);

it('records measured installation reference and camera boundary, requires corridor confirmation and reuses teaching', async () => {
  const f = await setup();
  try {
    await f.recordReference();
    const reference = f.service.status()!.referencePosition!;
    await f.service.command(f.state.id, 'position-boundary', true);
    await rstest.waitFor(async () =>
      expect((await f.adapter.getState()).dragMode).toBe(true),
    );
    f.adapter.setPoseForTesting(
      pose(
        reference.positionMm.x,
        reference.positionMm.y + 50,
        reference.positionMm.z,
      ),
    );
    await f.service.command(f.state.id, 'record-boundary', true);
    await expect(
      f.service.command(f.state.id, 'save-teaching', false),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(f.store.list().installationTeachings).toBeUndefined();
    const saved = await f.service.command(f.state.id, 'save-teaching', true);
    expect(saved.teachingId).toBeDefined();
    expect(f.service.setup().teaching?.cameraBoundary.normal).toEqual({
      x: 0,
      y: 1,
    });
    const recreated = await f.service.create();
    expect(recreated.referencePosition).toEqual(reference);
    expect(recreated.teachingId).toBe(saved.teachingId);
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    await f.dispose();
  }
});

it('automatically parks after boundary verification with taught mounting and still requires acceptance', async () => {
  const f = await setup();
  const timer = setInterval(() => void f.send(), 50);
  try {
    rstest
      .spyOn(AutomaticCapture.prototype, 'run')
      .mockImplementation(async function (this: AutomaticCapture) {
        this.reference = pose(100, -50, 30);
        for (const point of [
          { x: 200, y: 400 },
          { x: 220, y: 400 },
          { x: 200, y: 480 },
        ])
          this.localPoints.push({
            point,
            positionMm: { x: point.x * 0.5, y: -point.y * 0.125, z: 30 },
            purpose: 'direction',
            readings: 1,
            tipSpreadMm: 0,
            touchSpreadPx: 0,
          });
        for (const { point, purpose } of explorationTargets(layout, false))
          this.points.push({
            point,
            purpose,
            positionMm: { x: point.x * 0.5, y: -point.y * 0.125, z: 30 },
            readings: 1,
            tipSpreadMm: 0,
            touchSpreadPx: 0,
          });
      });

    f.adapter.setPoseForTesting(pose(100, -50, 80));
    await f.recordReference();
    await f.service.command(f.state.id, 'position-boundary', true);
    await rstest.waitFor(async () =>
      expect((await f.adapter.getState()).dragMode).toBe(true),
    );
    f.adapter.setPoseForTesting(pose(100, 50, 80));
    await f.service.command(f.state.id, 'record-boundary', true);
    await f.service.command(f.state.id, 'save-teaching', true);
    f.adapter.setPoseForTesting(pose(100, 50.000008, 75));
    const move = rstest.spyOn(f.adapter, 'moveLinear');
    await f.service.command(f.state.id, 'start-automatic', true);
    await rstest.waitFor(
      () => {
        const state = f.service.status()!;
        expect(state.error).toBeUndefined();
        expect(state.stage).toBe('review');
      },
      { timeout: 30000 },
    );
    const state = f.service.status()!;
    expect(move.mock.calls.slice(0, 3).map(([p]) => p)).toEqual([
      pose(100, 50, 80),
      pose(100, -50, 80),
      pose(100, -50, 80),
    ]);
    for (const [, options] of move.mock.calls.slice(0, 3)) {
      expect(options).toMatchObject({
        speed: f.screen.actionSpeed,
        acceleration: f.screen.actionAcceleration,
      });
    }
    expect(state.calibration?.auto?.observationRecorded).toBe(true);
    expect(state.safePosition!.positionMm.z).toBeGreaterThanOrEqual(80);
    expect(state.result).toBeUndefined();
    const saved = await f.service.command(state.id, 'accept', true);
    expect(saved.stage).toBe('completed');
    expect(saved.result?.verification?.protocol).toBe('auto-boundary-v1');
  } finally {
    clearInterval(timer);
    await f.dispose();
  }
}, 45000);

it('refuses a measured outline mismatch before collecting or moving', async () => {
  const f = await setup();
  try {
    f.service.setBatchReference(pose(100, -50, 100));
    f.assertPerspectiveCurrent.mockRejectedValueOnce(
      new RobotArmError('CALIBRATION_MISMATCH', 'screen shifted', 409),
    );
    await expect(
      f.service.command(f.state.id, 'start-automatic', true),
    ).rejects.toMatchObject({ code: 'CALIBRATION_MISMATCH' });
    expect(f.service.status()?.stage).toBe('ready');
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    await f.dispose();
  }
});

it('cancels a pending outline check immediately and never starts its suspended command', async () => {
  const f = await setup();
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  try {
    f.service.setBatchReference(pose(100, -50, 100));
    f.assertPerspectiveCurrent.mockImplementationOnce(async () => gate);
    const pending = f.service.command(f.state.id, 'start-automatic', true);
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'ACTION_STOPPED',
    });
    await rstest.waitFor(() =>
      expect(f.assertPerspectiveCurrent).toHaveBeenCalled(),
    );
    expect((await f.service.command(f.state.id, 'cancel')).stage).toBe(
      'cancelled',
    );
    release();
    await rejected;
    expect(f.service.status()?.stage).toBe('cancelled');
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    release();
    await f.dispose();
  }
});

it.each(['disconnect', 'layout', 'stop'] as const)(
  'does not start motion if %s occurs during outline verification',
  async (event) => {
    const f = await setup();
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    try {
      f.service.setBatchReference(pose(100, -50, 100));
      f.assertPerspectiveCurrent.mockImplementationOnce(async () => gate);
      const pending = f.service.command(f.state.id, 'start-automatic', true);
      const rejected = expect(pending).rejects.toThrow();
      await rstest.waitFor(() =>
        expect(f.assertPerspectiveCurrent).toHaveBeenCalled(),
      );
      if (event === 'disconnect') f.service.disconnectPhone();
      else if (event === 'layout') {
        f.resize();
        await f.send();
      } else await f.runtime.stop();
      release();
      await rejected;
      expect(f.adapter.movements).toHaveLength(0);
      expect(f.service.status()?.stage).not.toBe('collecting');
    } finally {
      release();
      await f.dispose();
    }
  },
);

it('interrupts active collection when a later outline check detects drift, before accepting any geometry', async () => {
  const f = await setup();
  const stop = rstest.spyOn(f.runtime, 'stop');
  let entered!: () => void;
  const collecting = new Promise<void>((done) => {
    entered = done;
  });
  const run = rstest
    .spyOn(AutomaticCapture.prototype, 'run')
    .mockImplementation(async (host) => {
      entered();
      await delay(10_000, undefined, { signal: host.signal });
    });
  const heartbeat = setInterval(() => void f.send(), 50);
  try {
    f.service.setBatchReference(pose(100, -50, 100));
    await f.service.command(f.state.id, 'start-automatic', true);
    await collecting;
    f.assertPerspectiveCurrent.mockRejectedValue(
      new RobotArmError('CALIBRATION_MISMATCH', 'screen shifted', 409),
    );
    await rstest.waitFor(() =>
      expect(f.service.status()).toMatchObject({
        stage: 'interrupted',
        errorDetails: { code: 'CALIBRATION_MISMATCH' },
      }),
    );
    await rstest.waitFor(() => expect(stop).toHaveBeenCalled());
    expect(f.service.status()?.result).toBeUndefined();
    expect(f.store.deviceBinding('cam')?.calibrationProfileId).toBe(
      f.calibration.id,
    );
  } finally {
    clearInterval(heartbeat);
    run.mockRestore();
    await f.dispose();
  }
});
