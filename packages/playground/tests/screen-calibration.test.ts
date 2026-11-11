import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArmController, type CameraSessionManager } from '@midscene/arm-kit';
import { calibrationPageMarkers } from '@midscene/arm-kit-shared/assisted-contracts';
import type {
  MarkerCalibrationDetectionResponse,
  TargetDisplaySession,
} from '@midscene/arm-kit-shared/marker-contracts';
import { markerSvg } from '@midscene/arm-kit/internal/camera/calibration-markers';
import { CameraSession } from '@midscene/arm-kit/internal/camera/session';
import { ProfileStore } from '@midscene/arm-kit/internal/runtime/profile-store';
import { TestRobotAdapter } from '@midscene/arm-kit/internal/testkit/test-adapter';
import { afterEach, expect, it } from '@rstest/core';
import sharp from 'sharp';
import { PlaygroundDevices } from '../src/server/devices';
import { PhonePairings } from '../src/server/phone-pairings';
import { ScreenCalibration } from '../src/server/screen-calibration';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture({ screens = true }: { screens?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'screen-bench-test-'));
  const adapter = new TestRobotAdapter();
  const store = new ProfileStore(join(directory, 'profiles.json'));
  const arm = new ArmController({ adapter, profileStore: store });
  await arm.connect();
  let image = Buffer.alloc(0);
  const frame = () => ({ jpeg: image, id: Date.now(), capturedAt: Date.now() });
  const stream = {
    currentFrame: () => (image.length ? frame() : undefined),
    getInfo: () => ({ state: 'running' }),
    getFrame: async () => frame(),
    getOptions: () => ({ width: 1000, height: 900 }),
  };
  const root = new CameraSession(
    { id: 'cam', name: 'Test camera', backend: 'avfoundation' },
    stream as never,
    join(directory, 'cameras'),
  );
  const scoped = new Map<string, CameraSession>();
  const cameras = {
    acquire: async (_id: string, _owner: string, screenId?: string) => {
      if (!screenId) return root;
      let session = scoped.get(screenId);
      if (!session) {
        session = await root.forScreen(screenId);
        scoped.set(screenId, session);
      }
      return session;
    },
    release: async () => {},
    close: async () => {},
  } as unknown as CameraSessionManager;
  const pairings = new PhonePairings(join(directory, 'pairings.json'));
  const devices = new PlaygroundDevices(arm, {
    cameras,
    pairings,
    phoneLinks: (token) => [
      {
        name: 'LAN',
        url: `http://127.0.0.1:5173/phone-calibration?token=${token}`,
      },
    ],
  });
  cleanups.push(async () => {
    await devices.close();
    await arm.close();
    await rm(directory, { recursive: true, force: true });
  });
  const host = await devices.ensureHost('cam');
  await host.configure({
    tool: {
      offsetMm: { x: 0, y: 0, z: 0 },
      contactDirection: { x: 0, y: 0, z: -1 },
    },
    motion: {
      pressDepthMm: 0.5,
      safeHeightMm: 5,
      actionSpeed: { kind: 'ratio', value: 0.1 },
      actionAcceleration: { kind: 'ratio', value: 0.1 },
      contactMs: 30,
      swipeEndpointHoldMs: 30,
      longPressMs: 500,
      dragHoldMs: 80,
      releaseSpeedFactor: 0.4,
      releaseAccelerationFactor: 0.4,
      successorStartLeadMs: 0,
      motionTimeoutMs: 60000,
    },
  });
  const service = devices.markerCalibration;
  // A bench can start without any saved screen, which is the state the phone
  // dialog and the camera-mapping step have to grow from.
  const session = screens
    ? await service.create('cam', ['Screen 1', 'Screen 2'])
    : undefined;
  for (const target of session?.targets ?? [])
    await service.pageAction({
      action: 'create-display',
      visionSessionId: session!.id,
      targetId: target.id,
      visionToken: target.token,
    });
  const link = session
    ? ((await service.pageAction({
        action: 'bind-link',
        visionSessionId: session.id,
        targets: session.targets.map((t) => ({ id: t.id, token: t.token })),
      })) as { path: string })
    : undefined;
  const ticket = link?.path.split('=')[1];
  async function connect(pageKey = randomUUID()) {
    if (!session || !ticket) throw new Error('No marker session in fixture');
    const registered = await service.register({ pageKey, ticket });
    const token = new URL(registered.url, 'http://localhost').searchParams.get(
      'token',
    )!;
    const page = (await service.phoneHost(token))!;
    const targetId = page.saved.targetId!;
    const targetHost = page.host!;
    const pageId = targetHost.service.openPhonePage();
    targetHost.service.receivePhone({
      pageId,
      sequence: 1,
      platform: 'android',
      displayMode: 'fullscreen',
      visible: true,
      markersPainted: true,
      markerRequest: targetHost.service.phoneView().markerRequest,
      layout: {
        revision: 1,
        width: 400,
        height: 800,
        screen: { width: 400, height: 800, devicePixelRatio: 1 },
        markers: calibrationPageMarkers(400, 800).map((m, i) => ({
          ...m,
          code: devices.markerCodes(targetId)[i],
        })),
      },
    });
    return { page, targetHost, pageKey, token, targetId, pageId };
  }
  async function render(missingSecond = false, secondOffsetX = 0) {
    if (!session) throw new Error('No marker session in fixture');
    const chunks = session.targets
      .map(
        (target, index) =>
          `<g transform="translate(${index * 480 + 30 + (index === 1 ? secondOffsetX : 0)},50)"><rect width="400" height="800" fill="white"/>${calibrationPageMarkers(
            400,
            800,
          )
            .map((m, i) => ({ ...m, code: devices.markerCodes(target.id)[i] }))
            .filter(
              (m) =>
                !missingSecond ||
                index === 0 ||
                (m.purpose === 'fit' && m.x < 200),
            )
            .map((m) =>
              markerSvg(m.code).replace(
                '<svg ',
                `<svg x="${m.x - m.size / 2}" y="${m.y - m.size / 2}" width="${m.size}" height="${m.size}" `,
              ),
            )
            .join('')}</g>`,
      )
      .join('');
    image = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="900"><rect width="100%" height="100%" fill="#999"/>${chunks}</svg>`,
      ),
    )
      .jpeg()
      .toBuffer();
  }
  return {
    arm,
    adapter,
    store,
    devices,
    directory,
    service,
    session: session!,
    connect,
    render,
    host,
  };
}
it('binds each phone once, gives it distinct markers and applies all passing perspectives without moving the arm', async () => {
  const f = await fixture();
  const first = await f.connect();
  const second = await f.connect();
  expect(first.targetId).not.toBe(second.targetId);
  expect(f.devices.markerCodes(first.targetId)).not.toEqual(
    f.devices.markerCodes(second.targetId),
  );
  await f.render();
  const result = (await f.service.markerAction({
    action: 'detect',
    cameraId: 'cam',
    id: f.session.id,
    token: f.session.token,
  })) as MarkerCalibrationDetectionResponse;
  expect(result.session.targets.map((t) => t.state)).toEqual([
    'succeeded',
    'succeeded',
  ]);
  expect(f.store.list().devices).toBeUndefined();
  await f.service.markerAction({
    action: 'apply',
    cameraId: 'cam',
    id: f.session.id,
    token: f.session.token,
  });
  expect(
    f.devices.entries.get(first.targetId)?.camera.getCorrection(),
  ).toBeDefined();
  expect(
    f.devices.entries.get(second.targetId)?.camera.getCorrection(),
  ).toBeDefined();
  expect(second.targetHost.service.setup().selection?.toolProfileId).toBe(
    first.targetHost.service.setup().selection?.toolProfileId,
  );
  expect(f.adapter.movements).toHaveLength(0);
});
it('keeps markers visible on the screen whose perspective passed but page mapping failed', async () => {
  const f = await fixture();
  const first = await f.connect();
  const second = await f.connect();
  const command = { cameraId: 'cam', id: f.session.id, token: f.session.token };
  await f.render();
  await f.service.markerAction({ ...command, action: 'detect' });
  await f.render(true);
  const applied = await f.service.markerAction({ ...command, action: 'apply' });
  expect(applied).toMatchObject({
    mappingErrors: {
      [second.targetId]:
        'Keep at least five of the six calibration markers visible and in focus.',
    },
  });
  expect(first.targetHost.service.phoneView().view).toBe('touch-preview');
  expect(second.targetHost.service.phoneView().view).toBe('markers');
  expect(second.targetHost.service.setup().mapping).toBeUndefined();
  expect(
    f.devices.entries.get(second.targetId)!.camera.getCorrection(),
  ).toBeDefined();

  await f.render();
  second.targetHost.service.receivePhone({
    ...second.targetHost.service.phoneObservation()!,
    sequence: 2,
    view: 'markers',
    markersPainted: true,
    markerRequest: undefined,
  });
  expect((await second.targetHost.service.mapSetup()).mapping).toBeDefined();
  expect(second.targetHost.service.phoneView().view).toBe('touch-preview');
  expect(f.adapter.movements).toHaveLength(0);
});
it('preserves a passing screen and only retries the failed phone, retaining stable page bindings', async () => {
  const f = await fixture();
  const first = await f.connect();
  const second = await f.connect();
  await f.render(true);
  const partial = (await f.service.markerAction({
    action: 'detect',
    cameraId: 'cam',
    id: f.session.id,
    token: f.session.token,
  })) as MarkerCalibrationDetectionResponse;
  expect(partial.session.targets.map((t) => t.state)).toEqual([
    'succeeded',
    'failed',
  ]);
  const observation = second.targetHost.service.phoneObservation()!;
  second.targetHost.service.receivePhone({
    ...observation,
    sequence: 2,
    markerRequest: second.targetHost.service.phoneView().markerRequest,
  });
  await f.render();
  const result = (await f.service.markerAction({
    action: 'detect',
    cameraId: 'cam',
    id: f.session.id,
    token: f.session.token,
    targetIds: [second.targetId],
  })) as MarkerCalibrationDetectionResponse;
  expect(result.session.targets.map((t) => t.state)).toEqual([
    'succeeded',
    'succeeded',
  ]);
  expect(result.frames[first.targetId]).toEqual(partial.frames[first.targetId]);
  expect(
    f.store.list().screenPages?.find((p) => p.pageKey === first.pageKey)
      ?.targetId,
  ).toBe(first.targetId);
});
it('keeps saved identity when restoring home, and permits explicit release and reassignment', async () => {
  const f = await fixture();
  const first = await f.connect();
  const second = await f.connect();
  await f.service.pageAction({
    action: 'release',
    id: first.page.saved.id,
    keepBinding: true,
  });
  expect(first.page.summary().mode).toBe('waiting');
  // The marker display is released too, so the dialog can bind the page again.
  expect(first.page.summary().targetDisplayId).toBeUndefined();
  expect(
    f.store.list().screenPages?.find((p) => p.id === first.page.saved.id)
      ?.targetId,
  ).toBe(first.targetId);
  await f.service.pageAction({
    action: 'assign',
    id: first.page.saved.id,
    role: 'mapping',
    cameraId: 'cam',
  });
  expect(first.page.summary().mode).toBe('mapping');
  await f.service.pageAction({ action: 'release', id: first.page.saved.id });
  await f.service.pageAction({ action: 'release', id: second.page.saved.id });
  const displays = (await f.service.pageAction({
    action: 'displays',
  })) as TargetDisplaySession[];
  await f.service.pageAction({
    action: 'assign',
    id: first.page.saved.id,
    role: 'markers',
    targetDisplayId: displays.find((d) => d.visionTargetId === second.targetId)!
      .id,
  });
  expect(first.page.saved.targetId).toBe(second.targetId);
  expect(first.page.saved.token).toBe(first.token);
  expect(f.adapter.movements).toHaveLength(0);
});
it('keeps a deleted screen page available without reactivating its target', async () => {
  const f = await fixture();
  const first = await f.connect();
  await f.connect();
  await f.service.pageAction({
    action: 'delete-screen',
    cameraId: 'cam',
    id: first.targetId,
  });
  const listed = (await f.service.pageAction({
    action: 'list',
    cameraId: 'cam',
  })) as {
    devices: Array<{ id: string; mode: string; screenId?: string }>;
  };
  expect(
    listed.devices.find((device) => device.id === first.page.saved.id),
  ).toMatchObject({ mode: 'waiting', screenId: undefined });
  expect(
    f.store.list().screenPages?.find((page) => page.id === first.page.saved.id),
  ).toMatchObject({
    cameraId: 'cam',
    pageKey: first.pageKey,
    targetId: undefined,
  });
  expect(
    f.devices.screens().some((screen) => screen.id === first.targetId),
  ).toBe(false);
  const replacement = await f.service.create('cam', ['Replacement']);
  expect(replacement.targets.map((target) => target.id)).not.toContain(
    first.targetId,
  );
  const afterCreate = (await f.service.pageAction({
    action: 'list',
    cameraId: 'cam',
  })) as {
    devices: Array<{ id: string; screenId?: string }>;
  };
  expect(
    afterCreate.devices.find((device) => device.id === first.page.saved.id)
      ?.screenId,
  ).toBeUndefined();
});
it('lists online phone pages after deleting every screen for a camera', async () => {
  const f = await fixture();
  const first = await f.connect();
  const second = await f.connect();
  for (const targetId of [first.targetId, second.targetId])
    await f.service.pageAction({
      action: 'delete-screen',
      cameraId: 'cam',
      id: targetId,
    });
  await f.devices.stop('cam');
  expect(f.devices.entries.has('cam')).toBe(false);
  const listed = (await f.service.pageAction({
    action: 'list',
    cameraId: 'cam',
  })) as {
    devices: Array<{ id: string; mode: string; screenId?: string }>;
    pairing: unknown;
  };
  const ids = [first.page.saved.id, second.page.saved.id];
  expect(listed.devices.filter((device) => ids.includes(device.id))).toEqual([
    expect.objectContaining({
      id: first.page.saved.id,
      mode: 'waiting',
      screenId: undefined,
    }),
    expect.objectContaining({
      id: second.page.saved.id,
      mode: 'waiting',
      screenId: undefined,
    }),
  ]);
  expect(listed.pairing).toBeDefined();
});
it('rejects applying captured results after either phone changed layout', async () => {
  const f = await fixture();
  await f.connect();
  const second = await f.connect();
  await f.render();
  await f.service.markerAction({
    action: 'detect',
    cameraId: 'cam',
    id: f.session.id,
    token: f.session.token,
  });
  const observation = second.targetHost.service.phoneObservation()!;
  second.targetHost.service.receivePhone({
    ...observation,
    sequence: 2,
    layout: {
      ...observation.layout,
      revision: observation.layout.revision + 1,
      width: observation.layout.width - 1,
    },
  });
  await expect(
    f.service.markerAction({
      action: 'apply',
      cameraId: 'cam',
      id: f.session.id,
      token: f.session.token,
    }),
  ).rejects.toMatchObject({ code: 'PAGE_CHANGED' });
  expect(
    f.devices.entries.get(second.targetId)?.camera.getCorrection(),
  ).toBeUndefined();
  expect(f.adapter.movements).toHaveLength(0);
});

it('rechecks both phones after asynchronous frame validation and before committing the first screen', async () => {
  const f = await fixture();
  const first = await f.connect();
  const second = await f.connect();
  await f.render();
  const command = { cameraId: 'cam', id: f.session.id, token: f.session.token };
  await f.service.markerAction({ ...command, action: 'detect' });
  const camera = f.devices.entries.get(first.targetId)!.camera;
  const validate = camera.checkCorrection.bind(camera);
  camera.checkCorrection = async (...args) => {
    second.targetHost.service.disconnectPhone();
    return validate(...args);
  };
  await expect(
    f.service.markerAction({ ...command, action: 'apply' }),
  ).rejects.toMatchObject({ code: 'PAGE_CHANGED' });
  expect(camera.getCorrection()).toBeUndefined();
  expect(
    f.devices.entries.get(second.targetId)?.camera.getCorrection(),
  ).toBeUndefined();
});
it('adopts an existing single-screen phone once and does not recreate a released association', async () => {
  const f = await fixture();
  const pageId = f.host.service.openPhonePage();
  f.host.service.receivePhone({
    pageId,
    sequence: 1,
    platform: 'android',
    displayMode: 'fullscreen',
    visible: true,
    markersPainted: true,
    layout: {
      revision: 1,
      width: 400,
      height: 800,
      screen: { width: 400, height: 800, devicePixelRatio: 1 },
      markers: calibrationPageMarkers(400, 800),
    },
  });
  const first = (await f.service.pageAction({ action: 'list' })) as {
    devices: { id: string }[];
  };
  expect(first.devices).toHaveLength(1);
  await f.service.pageAction({ action: 'release', id: first.devices[0].id });
  await f.service.pageAction({ action: 'list' });
  expect(f.store.list().screenPages).toHaveLength(1);
  expect(f.store.list().screenPages?.[0].targetId).toBeUndefined();
  expect(f.adapter.movements).toHaveLength(0);
});
it('leaves an extra phone waiting until the original first-calibration UI allocates and assigns its screen', async () => {
  const f = await fixture();
  await f.connect();
  await f.connect();
  const link = (await f.service.pageAction({
    action: 'bind-link',
    visionSessionId: f.session.id,
    targets: f.session.targets.map((t) => ({ id: t.id, token: t.token })),
  })) as { path: string };
  const third = await f.service.register({
    pageKey: randomUUID(),
    ticket: link.path.split('=')[1],
  });
  const page = (await f.service.phoneHost(
    new URL(third.url, 'http://localhost').searchParams.get('token'),
  ))!;
  expect(page.saved.targetId).toBeUndefined();
  expect(f.devices.screens()).toHaveLength(2);
  const added = (await f.service.markerAction({
    action: 'add',
    cameraId: 'cam',
    id: f.session.id,
    token: f.session.token,
    name: 'Screen 3',
  })) as { target: { id: string; token: string } };
  const display = (await f.service.pageAction({
    action: 'create-display',
    visionSessionId: f.session.id,
    targetId: added.target.id,
    visionToken: added.target.token,
  })) as TargetDisplaySession;
  await f.service.pageAction({
    action: 'assign',
    id: page.saved.id,
    role: 'markers',
    targetDisplayId: display.id,
  });
  expect(page.saved.targetId).toBe(added.target.id);
  expect(f.devices.screens()).toHaveLength(3);
  expect(f.adapter.movements).toHaveLength(0);
});

it('keeps commands gated while a real Controller queue is occupied, then grants the calibration session', async () => {
  const f = await fixture();
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const owner = f.arm.configureForDevice('queue-owner', async () => {
    entered();
    await gate;
  });
  try {
    await ready;
    const status = (await f.devices.startCalibration('cam')) as {
      phase: string;
      attemptId: string;
    };
    expect(status.phase).toBe('queued');
    expect(() =>
      f.devices.assertCalibrationRunning('cam', status.attemptId),
    ).toThrow('Controller queue');
    expect(f.adapter.movements).toHaveLength(0);
    release();
    await owner;
    await f.devices.entries.get('cam')!.calibration!.ready;
    expect(() =>
      f.devices.assertCalibrationRunning('cam', status.attemptId),
    ).not.toThrow();
    await f.devices.cancelCalibration('cam');
    expect(f.devices.status('cam').phase).toBe('cancelled');
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    release();
    await owner;
  }
});
it('cancels a queued sibling without stopping the selected screen and rejects stale lease commands', async () => {
  const f = await fixture();
  const right = f.session!.targets.find((target) => target.id !== 'cam')!.id;
  await f.devices.startCalibration('cam');
  const first = f.devices.entries.get('cam')!.calibration!;
  await first.ready;
  await f.devices.startCalibration(right);
  const sibling = f.devices.entries.get(right)!.calibration!;
  expect(sibling.phase).toBe('queued');
  await f.devices.cancelCalibration(right, sibling.attemptId);
  expect(first.phase).toBe('running');
  expect(sibling.phase).toBe('cancelled');
  await f.devices.cancelCalibration('cam', first.attemptId);
  await f.devices.startCalibration(right);
  const retry = f.devices.entries.get(right)!.calibration!;
  await retry.ready;
  await f.devices.cancelCalibration(right, sibling.attemptId);
  expect(() =>
    f.devices.assertCalibrationRunning(right, first.attemptId),
  ).toThrow('attempt changed');
  expect(() =>
    f.devices.assertCalibrationRunning(right, sibling.attemptId),
  ).toThrow('attempt changed');
  expect(() =>
    f.devices.assertCalibrationRunning(right, retry.attemptId),
  ).not.toThrow();
  expect(f.adapter.movements).toHaveLength(0);
});
it('reports a missing phone network instead of generating a controller-cable or loopback QR code', async () => {
  const f = await fixture();
  f.devices.pairingLinks = () => [];
  await expect(f.service.pageAction({ action: 'list' })).rejects.toMatchObject({
    code: 'PHONE_NETWORK_UNAVAILABLE',
  });
  expect(f.adapter.movements).toHaveLength(0);
});
it('pairs directly from the phone dialog without a marker session and keeps QR and code stable while polling', async () => {
  const f = await fixture();
  const service = new ScreenCalibration(f.devices);
  cleanups.push(() => service.close());
  const first = (await service.pageAction({
    action: 'list',
    cameraId: 'cam',
  })) as { pairing: { path: string; code: string } };
  const second = (await service.pageAction({
    action: 'list',
    cameraId: 'cam',
  })) as typeof first;
  expect(second.pairing).toEqual(first.pairing);
  const link = new URL(first.pairing.path, 'http://localhost');
  expect(link.pathname).toBe('/phone-calibration/connect');
  const registered = await service.register({
    pageKey: randomUUID(),
    ticket: new URLSearchParams(link.hash.slice(1)).get('bind')!,
  });
  const token = new URL(registered.url, 'http://localhost').searchParams.get(
    'token',
  );
  const page = (await service.phoneHost(token))!;
  expect(page.saved.targetId).toBeDefined();
  expect(page.mode).toBe('mapping');
  const same = await service.register({
    pageKey: page.saved.pageKey,
    code: first.pairing.code,
  });
  expect(same.url).toBe(registered.url);
  expect(f.store.list().screenPages).toHaveLength(1);
  expect(f.adapter.movements).toHaveLength(0);
});
it('creates one named screen per device when connected from the computer', async () => {
  const f = await fixture({ screens: false });
  for (const userAgent of ['Mozilla/5.0 (iPhone)', 'Mozilla/5.0 (iPhone)']) {
    const { url } = await f.service.register(
      { pageKey: randomUUID() },
      userAgent,
    );
    const page = (await f.service.phoneHost(
      new URL(url, 'http://localhost').searchParams.get('token'),
    ))!;
    expect(page.saved.targetId).toBeUndefined();
    expect(page.saved.name).toBe(`iPhone · ${page.summary().label}`);
    for (let attempt = 0; attempt < 2; attempt++)
      await f.service.pageAction({
        action: 'assign',
        id: page.saved.id,
        role: 'mapping',
        cameraId: 'cam',
      });
    expect(
      f.devices.screens().find((screen) => screen.id === page.saved.targetId)
        ?.name,
    ).toBe(page.saved.name);
  }
  expect(f.devices.screens()).toHaveLength(2);
  expect(f.adapter.movements).toHaveLength(0);
});
it('keeps the screen label and the device label on the same name', async () => {
  const f = await fixture();
  const { page, targetId } = await f.connect();
  await f.service.pageAction({
    action: 'rename',
    id: page.saved.id,
    name: 'Left phone',
  });
  expect(
    f.devices.screens().find((screen) => screen.id === targetId)!.name,
  ).toBe('Left phone');
});
it('keeps paired pages at home on restart until their own calibration screen opens', async () => {
  const f = await fixture({ screens: false });
  const info = (await f.service.pageAction({
    action: 'list',
    cameraId: 'cam',
  })) as { pairing: { code: string } };
  const registered = await f.service.register({
    pageKey: randomUUID(),
    code: info.pairing.code,
  });
  const token = new URL(registered.url, 'http://localhost').searchParams.get(
    'token',
  )!;
  const page = (await f.service.phoneHost(token))!;
  expect(page.mode).toBe('mapping');
  // A restart builds a new service over the same store; the page comes back
  // home but keeps the screen it was paired with.
  const restarted = new ScreenCalibration(f.devices);
  cleanups.push(() => restarted.close());
  const listed = (await restarted.pageAction({
    action: 'list',
    cameraId: 'cam',
  })) as { devices: Array<{ id: string; mode: string; screenId?: string }> };
  const device = listed.devices.find((item) => item.id === page.saved.id)!;
  expect(device.mode).toBe('waiting');
  expect(device.screenId).toBe(page.saved.targetId);
  const restored = (await restarted.phoneHost(token))!;
  const other = await f.devices.addScreen('cam', 'Other');
  // The wizard selects the new screen immediately; its host must already be
  // prepared or the first configuration poll reports "Calibration is not ready".
  expect(f.devices.entries.get(other.id)?.host).toBeDefined();
  await restarted.resumeBoundPage(await f.devices.ensureHost(other.id));
  expect(restored.mode).toBe('waiting');
  const host = await f.devices.ensureHost(device.screenId!);
  await restarted.resumeBoundPage(host);
  expect(restored.mode).toBe('mapping');
  expect(restored.host).toBe(host);
  expect(host.service.status()).toBeNull();
  expect(f.adapter.movements).toHaveLength(0);
});
it('forgets an offline page and keeps the screen it served', async () => {
  const f = await fixture();
  const { page, targetId } = await f.connect();
  await f.service.pageAction({
    action: 'release',
    id: page.saved.id,
    keepBinding: true,
  });
  expect(f.devices.screens().some((screen) => screen.id === targetId)).toBe(
    true,
  );
  // No phone ever reported on this page in this test, so it counts as offline.
  await f.service.pageAction({ action: 'forget', id: page.saved.id });
  expect(f.store.list().screenPages).toHaveLength(0);
  expect(f.devices.screens().some((screen) => screen.id === targetId)).toBe(
    true,
  );
});
it('does not steal a saved screen when more phones use the global connection code', async () => {
  const f = await fixture();
  const first = await f.connect();
  const second = await f.connect();
  const info = (await f.service.pageAction({
    action: 'list',
    cameraId: 'cam',
  })) as { pairing: { code: string } };
  for (let i = 0; i < 3; i++)
    await f.service.register({
      pageKey: randomUUID(),
      code: info.pairing.code,
    });
  const pages = f.store.list().screenPages!;
  expect(pages).toHaveLength(5);
  expect(new Set(pages.map((page) => page.targetId)).size).toBe(5);
  expect(first.page.saved.targetId).toBe(first.targetId);
  expect(second.page.saved.targetId).toBe(second.targetId);
  expect(f.devices.screens()).toHaveLength(5);
  expect(f.adapter.movements).toHaveLength(0);
});
it('refuses a global reconnect while the bound screen is collecting samples', async () => {
  const f = await fixture();
  const info = (await f.service.pageAction({
    action: 'list',
    cameraId: 'cam',
  })) as { pairing: { code: string } };
  const { pageKey, page } = await f.connect();
  const original = page.host!.service.status;
  page.host!.service.status = () =>
    ({ id: 'active', stage: 'collecting' }) as ReturnType<typeof original>;
  try {
    await expect(
      f.service.register({ pageKey, code: info.pairing.code }),
    ).rejects.toMatchObject({ code: 'BUSY' });
  } finally {
    page.host!.service.status = original;
  }
  expect(f.adapter.movements).toHaveLength(0);
});

it('checks all current outlines before writing any passing result when a phone moved after detection', async () => {
  const f = await fixture();
  const first = await f.connect();
  const second = await f.connect();
  await f.render();
  await f.service.markerAction({
    action: 'detect',
    cameraId: 'cam',
    id: f.session.id,
    token: f.session.token,
  });
  await f.render(false, 30);
  await expect(
    f.service.markerAction({
      action: 'apply',
      cameraId: 'cam',
      id: f.session.id,
      token: f.session.token,
    }),
  ).rejects.toMatchObject({ code: 'CALIBRATION_MISMATCH' });
  expect(
    f.devices.entries.get(first.targetId)?.camera.getCorrection(),
  ).toBeUndefined();
  expect(
    f.devices.entries.get(second.targetId)?.camera.getCorrection(),
  ).toBeUndefined();
  expect(f.adapter.movements).toHaveLength(0);
});

it('does not expose a stored perspective after the applied correction is cleared', async () => {
  const f = await fixture({ screens: false });
  await f.store.saveScreenTarget({ id: 'seed', cameraId: 'cam', name: 'Seed' });
  const file = join(f.directory, 'profiles.json');
  const data = JSON.parse(await readFile(file, 'utf8'));
  // Older naming builds persisted the whole screen DTO, snapshot included.
  data.screenTargets.push({
    id: 'cam',
    cameraId: 'cam',
    name: '111',
    hasCorrection: true,
    hasSavedPerspective: true,
    correction: {
      points: {
        topLeft: { x: 10, y: 10 },
        topRight: { x: 90, y: 10 },
        bottomRight: { x: 90, y: 90 },
        bottomLeft: { x: 10, y: 90 },
      },
      sourceWidth: 100,
      sourceHeight: 100,
      rotation: 0,
    },
  });
  await writeFile(file, JSON.stringify(data));
  await f.store.load();

  const screen = f.devices.screens().find((entry) => entry.id === 'cam');
  expect(screen?.hasCorrection).toBe(false);
  expect(screen?.correction).toBeUndefined();
  expect(screen?.hasSavedPerspective).toBe(false);

  await f.store.saveScreenTarget({
    id: 'fresh',
    cameraId: 'cam',
    name: 'Fresh',
    correction: data.screenTargets[1].correction,
  } as never);
  expect(
    f.store.list().screenTargets?.find((entry) => entry.id === 'fresh'),
  ).toEqual({ id: 'fresh', cameraId: 'cam', name: 'Fresh' });
});

it('starts a marker session for the explicitly created Add Screen target', async () => {
  const f = await fixture();
  const created = await f.devices.addScreen('cam', 'Fresh');
  const session = await f.service.create('cam', undefined, [created.id]);
  expect(session.targets.map((target) => target.id)).toEqual([created.id]);
  expect(f.devices.screens().some((screen) => screen.id === created.id)).toBe(
    true,
  );
});
