import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { expect, it, rstest } from '@rstest/core';
import {
  type CalibrationPageUpdate,
  calibrationPageMarkers,
} from '../src/assisted-contracts.js';
import { CalibrationHost } from '../src/calibration-server/host.js';
import type { CameraSession } from '../src/camera/session.js';
import type { CameraFrame } from '../src/camera/types.js';
import { controllerRuntime } from '../src/controller-runtime.js';
import { ArmController } from '../src/controller.js';
import { robotSetupDefaults } from '../src/setup-contracts.js';
import { fixture } from './fixtures.js';

it('prepares first-time measured setup without inventing tool geometry or replacing accepted profiles', async () => {
  const f = await fixture();
  await f.runtime.shutdown();
  // Cross-screen tool reuse needs adapter defaults for the new screen's motion.
  Object.assign(f.adapter, { setupDefaults: robotSetupDefaults('mg400') });
  const arm = new ArmController({ adapter: f.adapter, profileStore: f.store });
  await arm.connect();
  const camera = {
    camera: { id: 'fresh-camera', name: 'Camera' },
    stream: { getInfo: () => ({ state: 'running' }) },
    getCorrection: () => undefined,
    getRectifiedPreviewTarget: () => undefined,
    getPerspectiveValidity: () => undefined,
  } as unknown as CameraSession;
  const host = new CalibrationHost({ arm, camera, deviceId: 'new-device' });
  try {
    await host.prepare();
    expect((await host.configuration()).input).toBeUndefined();
    await expect(host.enable()).rejects.toMatchObject({
      code: 'SETUP_REQUIRED',
    });
    // Measured zero and omitted length have different calibration frames.
    const geometry = {
      offsetMm: f.tool.offsetMm,
      contactDirection: f.tool.contactDirection,
    };
    const unknown = await host.configure({
      tool: { ...geometry, contactFrame: 'flange' },
      motion: f.screen,
    });
    expect(unknown.input?.toolProfileId).not.toBe(f.tool.id);
    await f.store.load();
    expect((await host.configuration()).measuredSetup?.tool.contactFrame).toBe(
      'flange',
    );
    expect(
      (await host.configure({ tool: geometry, motion: f.screen })).input
        ?.toolProfileId,
    ).toBe(f.tool.id);
    await expect(
      host.configure({
        tool: {
          ...geometry,
          contactFrame: 'flange',
          offsetMm: { x: 0, y: 0, z: -10 },
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PROFILE' });
    const before = f.store.getTool(f.tool.id);
    const config = await host.configure({
      tool: {
        offsetMm: { x: 0, y: 0, z: -38 },
        contactDirection: { x: 0, y: 0, z: -1 },
      },
      motion: f.screen,
    });
    expect(config.output).toEqual({
      cameraId: 'fresh-camera',
      width: 720,
      height: 1280,
    });
    expect(config.input?.toolProfileId).not.toBe(f.tool.id);
    expect(host.service.setup().prepared).toBe(true);
    expect(f.store.getTool(f.tool.id)).toEqual(before);
    expect(f.store.deviceBinding('new-device')).toBeUndefined();
    // Closing a wizard must not discard measurements entered before acceptance.
    await f.store.load();
    const reopened = new CalibrationHost({
      arm,
      camera,
      deviceId: 'new-device',
    });
    await reopened.prepare();
    const restored = await reopened.configuration();
    expect(restored.input?.toolProfileId).toBe(config.input?.toolProfileId);
    expect(restored.measuredSetup?.tool.offsetMm).toEqual({
      x: 0,
      y: 0,
      z: -38,
    });
    expect(f.store.deviceBinding('new-device')).toBeUndefined();
    await reopened.close();

    await f.store.saveScreenTarget({
      id: 'new-device',
      name: 'Previous screen',
      cameraId: camera.camera.id,
    });
    await f.store.archiveScreenTarget('new-device');
    await f.store.load();
    const replacement = new CalibrationHost({
      arm,
      camera: {
        ...camera,
        camera: { ...camera.camera, id: 'replacement-camera' },
      },
      deviceId: 'replacement-screen',
    });
    try {
      await replacement.prepare();
      const replacementConfig = await replacement.configuration();
      expect(replacementConfig.input?.cameraId).toBe('replacement-camera');
      expect(replacementConfig.measuredSetup?.tool).toEqual(
        restored.measuredSetup?.tool,
      );
      expect(f.store.deviceBinding('replacement-screen')).toBeUndefined();
    } finally {
      await replacement.close();
    }
    const post = async (body: unknown, path = 'enable') => {
      const req = Readable.from([JSON.stringify(body)]) as IncomingMessage;
      req.method = 'POST';
      req.url = `/api/calibration/${path}`;
      let status = 0;
      const res = {
        writeHead: (code: number) => {
          status = code;
        },
        end: () => undefined,
      } as unknown as ServerResponse;
      await host.handle(req, res);
      return status;
    };
    expect(await post({ confirmed: 'true' })).toBe(400);
    expect((await arm.getState()).enabled).toBe(false);
    expect(await post({ confirmed: true })).toBe(200);
    expect((await host.configuration()).ready).toBe(true);
    const runtime = controllerRuntime(arm);
    const payloadSpy = rstest
      .spyOn(runtime, 'applySavedPayload')
      .mockResolvedValue();
    const recoverSpy = rstest.spyOn(runtime, 'recover').mockResolvedValue();
    try {
      expect(await post({}, 'payload')).toBe(400);
      expect(payloadSpy).not.toHaveBeenCalled();
      expect(await post({ confirmed: true }, 'payload')).toBe(200);
      const selectedTool = f.store.getTool(config.input!.toolProfileId);
      expect(payloadSpy).toHaveBeenCalledWith({
        robotProfileId: config.input!.robotProfileId,
        toolProfileId: selectedTool.id,
        toolRevision: selectedTool.revision,
      });
      expect(await post({}, 'recover')).toBe(200);
      expect(recoverSpy).toHaveBeenCalledTimes(1);
    } finally {
      payloadSpy.mockRestore();
      recoverSpy.mockRestore();
    }
    const live = await runtime.state();
    const stateSpy = rstest.spyOn(runtime, 'state').mockResolvedValueOnce({
      ...live,
      payloadApplication: {
        ...live.payloadApplication!,
        status: 'unconfirmed',
      },
    });
    try {
      expect((await host.configuration()).ready).toBe(false);
      expect(stateSpy).toHaveBeenCalledWith(config.input?.toolProfileId);
    } finally {
      stateSpy.mockRestore();
    }

    expect(f.adapter.movements).toHaveLength(0);
    await f.store.acceptDeviceBinding({
      ...f.binding,
      deviceId: 'existing-device',
      cameraId: 'cam',
      calibrationProfileId: f.calibration.id,
      revision: 0,
      vision: {
        cameraId: 'cam',
        cameraName: 'Camera',
        perspectiveProfileKey: 'p',
        fingerprint: 'f',
        width: 1000,
        height: 500,
        confirmedAt: new Date().toISOString(),
      },
    });
    const reused = await host.configure({
      width: 720,
      height: 1280,
      tool: before,
      motion: f.screen,
    });
    expect(reused.input?.toolProfileId).toBe(before.id);
    expect(reused.measuredSetup?.tool.offsetMm).toEqual(before.offsetMm);
    expect(reused.editable).toBe(true);
    const accepted = f.store.deviceBinding('existing-device');
    const changed = await host.configure({
      width: 800,
      height: 1400,
      tool: {
        ...before,
        offsetMm: { ...before.offsetMm, z: before.offsetMm.z - 5 },
      },
    });
    expect(changed.input?.toolProfileId).not.toBe(before.id);
    expect(changed.input?.motion).toEqual(f.screen);
    expect(changed.measuredSetup?.width).toBe(800);
    const edited = await host.configure({ tool: changed.measuredSetup!.tool });
    expect(edited.output).toEqual(changed.output);
    expect(f.store.deviceBinding('existing-device')).toEqual(accepted);

    expect(f.store.getTool(before.id)).toEqual(before);
    await expect(
      host.configure({ width: 0, height: 720, tool: before, motion: f.screen }),
    ).rejects.toMatchObject({ code: 'INVALID_MAPPING' });
  } finally {
    await host.close();
    await arm.close();
    await f.cleanup();
  }
});

it('requires the marker page for both screen detection routes', async () => {
  const f = await fixture();
  await f.runtime.shutdown();
  const arm = new ArmController({ adapter: f.adapter, profileStore: f.store });
  const camera = { camera: { id: 'detect-camera' } } as CameraSession;
  const host = new CalibrationHost({ arm, camera, deviceId: 'detect-device' });
  try {
    for (const action of ['markers', 'detect']) {
      const req = Readable.from([]) as IncomingMessage;
      req.method = 'POST';
      req.url = `/api/calibration/camera/${action}`;
      const res = {
        writeHead: (status: number) => expect(status).toBe(409),
        end: (body: string) =>
          expect(JSON.parse(body).error).toBe('Connect Phone'),
      } as unknown as ServerResponse;
      await host.handle(req, res);
    }
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    await host.close();
    await arm.close();
    await f.cleanup();
  }
});

it('restores measured length and weight before calibration acceptance, isolated by device', async () => {
  const f = await fixture();
  await f.runtime.shutdown();
  const arm = new ArmController({ adapter: f.adapter, profileStore: f.store });
  await arm.connect();
  const camera = {
    camera: { id: 'remembered-camera', name: 'Camera' },
    stream: { getInfo: () => ({ state: 'running' }) },
    getCorrection: () => undefined,
    getRectifiedPreviewTarget: () => undefined,
    getPerspectiveValidity: () => undefined,
  } as unknown as CameraSession;
  const options = { arm, camera, deviceId: 'remembered-device' };
  const first = new CalibrationHost(options);
  const next = new CalibrationHost(options);
  const other = new CalibrationHost({ ...options, deviceId: 'other-device' });
  try {
    const tool = {
      offsetMm: { x: 0, y: 0, z: -42 },
      contactDirection: { x: 0, y: 0, z: -1 },
      payload: { massKg: 0.15 },
    };
    await first.prepare();
    await first.configure({ tool, motion: f.screen });
    await first.close();
    await f.store.load();
    await next.prepare();
    const config = await next.configuration();
    expect(config.measuredSetup?.tool).toMatchObject(tool);
    expect(f.store.deviceBinding(options.deviceId)).toBeUndefined();
    await other.prepare();
    expect((await other.configuration()).input).toBeUndefined();
    expect(f.adapter.movements).toHaveLength(0);
    expect((await arm.getState()).enabled).toBe(false);
  } finally {
    await next.close();
    await other.close();
    await arm.close();
    await f.cleanup();
  }
});

it('admits only frames bracketed by visible phone reports for the active calibration view', async () => {
  const f = await fixture();
  await f.runtime.shutdown();
  const arm = new ArmController({ adapter: f.adapter, profileStore: f.store });
  let now = Date.now();
  const clock = rstest.spyOn(Date, 'now').mockImplementation(() => now);
  let frame = { capturedAt: now - 1 } as CameraFrame;
  const camera = {
    stream: {
      get currentFrame() {
        return frame;
      },
    },
  } as CameraSession;
  const host = new CalibrationHost({ arm, camera, deviceId: 'screen' });
  const report: CalibrationPageUpdate = {
    pageId: host.service.openPhonePage(),
    sequence: 0,
    visible: true,
    platform: 'android',
    displayMode: 'fullscreen',
    view: 'markers',
    markersPainted: true,
    layout: {
      revision: 1,
      width: 400,
      height: 800,
      screen: { width: 400, height: 839, devicePixelRatio: 1 },
      topInset: 39,
      markers: calibrationPageMarkers(400, 800),
    },
  };
  const send = (fields: Partial<CalibrationPageUpdate> = {}) =>
    host.service.receivePhone({
      ...report,
      sequence: ++report.sequence,
      ...fields,
    });
  try {
    send();
    expect(camera.referenceFrame?.()).toBeUndefined();
    frame = { capturedAt: ++now } as CameraFrame;
    now++;
    send();
    expect(camera.referenceFrame?.()).toEqual({
      ...frame,
      pageLayout: report.layout,
    });
    expect(frame).not.toHaveProperty('pageLayout');
    await arm.connect();
    await f.adapter.enable();
    await f.adapter.enterDragMode();
    await arm.getState();
    expect(camera.referenceFrame?.()).toBeUndefined();
    frame = { capturedAt: ++now } as CameraFrame;
    send();
    await f.adapter.exitDragMode();
    await arm.getState();
    expect(camera.referenceFrame?.()).toBeUndefined();
    frame = { capturedAt: ++now } as CameraFrame;
    send();
    expect(camera.referenceFrame?.()?.capturedAt).toBe(frame.capturedAt);
    send({ visible: false });
    expect(camera.referenceFrame?.()).toBeUndefined();
    frame = { capturedAt: ++now } as CameraFrame;
    now++;
    send();
    expect(camera.referenceFrame?.()).toBeUndefined(); // frame from the other app
    frame = { capturedAt: ++now } as CameraFrame;
    send();
    expect(camera.referenceFrame?.()).toEqual({
      ...frame,
      pageLayout: report.layout,
    });
    now += 3000;
    host.service.phoneHeartbeat(); // transport liveness alone does not confirm the display
    expect(camera.referenceFrame?.()).toBeUndefined();
    send();
    expect(camera.referenceFrame?.()).toBeUndefined();
    frame = { capturedAt: ++now } as CameraFrame;
    send();
    expect(camera.referenceFrame?.()).toEqual({
      ...frame,
      pageLayout: report.layout,
    });
    send({ displayMode: 'browser' });
    expect(camera.referenceFrame?.()).toBeUndefined();
    host.service.restorePhoneHome();
    send({ view: 'waiting' });
    expect(camera.referenceFrame?.()).toBeUndefined();
    host.service.resumePhonePage();
    send();
    frame = { capturedAt: ++now } as CameraFrame;
    send();
    host.service.disconnectPhone();
    expect(camera.referenceFrame?.()).toBeUndefined();
  } finally {
    clock.mockRestore();
    await host.close();
    await arm.close();
    await f.cleanup();
  }
});
