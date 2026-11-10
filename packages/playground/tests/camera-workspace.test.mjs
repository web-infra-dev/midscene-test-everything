import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calibrationPageMarkers } from '@midscene/arm-kit-shared/assisted-contracts';
import { markerSvg } from '@midscene/arm-kit/internal/camera/calibration-markers';
import { cameraBackend } from '@midscene/arm-kit/internal/camera/index';
import { createFakeAdapter } from '@midscene/arm-kit/internal/testkit';
import { rstest, test } from '@rstest/core';
import sharp from 'sharp';
import {
  SCREEN,
  renderFrame,
} from '../../arm-kit/tests/fixtures/perspective-frame';
import { startArmPlayground } from '../src/server/index';

async function workspace(jpeg, run) {
  const directory = await mkdtemp(join(tmpdir(), 'camera-workspace-'));
  rstest.stubEnv('MIDSCENE_ARM_DATA_DIR', directory);
  rstest.stubEnv('MIDSCENE_RUN_DIR', directory);
  const id = 'builtin/qa';
  const backend = cameraBackend();
  const list = rstest
    .spyOn(backend, 'listDevices')
    .mockResolvedValue([
      { id, name: 'Built-in Camera', backend: 'avfoundation' },
    ]);
  const open = rstest
    .spyOn(backend, 'openStream')
    .mockImplementation(async () => {
      const source = new EventEmitter();
      const timer = setInterval(() => source.emit('frame', jpeg), 25);
      source.close = async () => clearInterval(timer);
      return source;
    });
  const server = await startArmPlayground({
    createAdapter: () => createFakeAdapter(),
  });
  const post = (path, body) =>
    fetch(server.url + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const get = async (path) => (await fetch(server.url + path)).json();
  const checked = async (response) => {
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  };
  const viewer = new AbortController();
  try {
    await run({ id, post, get, checked, server, viewer, open });
  } finally {
    viewer.abort();
    await server.close();
    open.mockRestore();
    list.mockRestore();
    rstest.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
}

test('a preview hands its camera and geometry to the connected workspace and rejects writes from the old installation', async () => {
  const { jpeg, ...quad } = await renderFrame({ screen: SCREEN });
  return workspace(
    jpeg,
    async ({ id, post, get, checked, server, viewer, open }) => {
      const correction = { ...quad, rotation: 90 };
      const perspectiveTarget = { width: 420, height: 600, rotation: 90 };
      const edit = { id, correction, perspectiveTarget };
      const lease = await fetch(
        `${server.url}/api/cameras/lease?id=${encodeURIComponent(id)}`,
        { signal: viewer.signal },
      );
      assert.equal(lease.status, 200);
      const preview = await fetch(
        `${server.url}/api/cameras/preview?id=${encodeURIComponent(id)}`,
        { signal: viewer.signal },
      );
      assert.equal(preview.status, 200);
      await preview.body.cancel();
      await checked(await post('/api/cameras/correction', edit));
      assert.equal((await get('/api/cameras')).deviceSession, null);
      await checked(
        await post('/api/setup/reconnect', {
          session: (await get('/api/setup')).setup.session,
        }),
      );
      const { deviceSession: session, cameras } = await get('/api/cameras');
      assert.ok(session);
      assert.equal(cameras[0].id, id);
      assert.equal(cameras[0].stream.state, 'running');
      assert.deepEqual(cameras[0].screens[0].correction, correction);
      assert.deepEqual(
        cameras[0].screens[0].perspectiveTarget,
        perspectiveTarget,
      );
      assert.equal(open.mock.calls.length, 1);
      viewer.abort();
      const { id: screen } = await checked(
        await post('/api/screens', { cameraId: id, name: 'Right' }),
      );
      await checked(
        await post('/api/cameras/correction', { ...edit, session, screen }),
      );
      assert.equal(
        (
          await post('/api/cameras/correction', {
            ...edit,
            session,
            screen: 'missing',
          })
        ).status,
        409,
      );
      await checked(
        await fetch(
          `${server.url}/api/cameras/correction?${new URLSearchParams({ id, session, screen })}`,
          { method: 'DELETE' },
        ),
      );
      const refreshed = (await get('/api/cameras')).cameras[0].screens;
      assert.ok(refreshed.find((s) => s.id === id).hasCorrection);
      assert.equal(refreshed.find((s) => s.id === screen).hasCorrection, false);
      assert.equal(
        refreshed.find((s) => s.id === screen).hasSavedPerspective,
        true,
      );
      await checked(await post('/api/arm/disconnect', { session }));
      assert.equal(
        (await post('/api/cameras/correction', { ...edit, session, screen }))
          .status,
        409,
      );
      assert.deepEqual(
        (await get('/api/cameras')).cameras[0].perspectiveTarget,
        perspectiveTarget,
      );
    },
  );
});

// Exercise the same HTTP renewal and websocket updates used by a fullscreen phone.
async function phone(server, token, savedScreenToken) {
  const url = new URL('/phone-calibration', server.url);
  url.searchParams.set('token', token);
  const page = await (
    await fetch(url, { headers: { Accept: 'application/json' } })
  ).json();
  url.protocol = 'ws:';
  url.pathname += '/session';
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const codes = page.markers.map((markup) =>
    Number(/data-code="(\d+)"/.exec(markup)[1]),
  );
  let sequence = 0;
  const receive = (send, match) =>
    new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeEventListener('message', listener);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for phone reply'));
      }, 3000);
      const listener = ({ data }) => {
        const value = data === 'pong' ? data : JSON.parse(data);
        if (match(value)) {
          cleanup();
          resolve(value);
        }
      };
      socket.addEventListener('message', listener);
      send();
    });
  const update = (request, revision = 1) =>
    socket.send(
      JSON.stringify({
        pageId: page.pageId,
        savedScreenToken,
        sequence: ++sequence,
        platform: 'android',
        displayMode: 'fullscreen',
        visible: true,
        markersPainted: Boolean(request),
        markerRequest: request,
        layout: {
          revision,
          width: 400,
          height: 800,
          screen: { width: 400, height: 800, devicePixelRatio: 1 },
          markers: calibrationPageMarkers(400, 800).map((m, i) => ({
            ...m,
            code: codes[i],
          })),
        },
      }),
    );
  return {
    page,
    socket,
    codes,
    update,
    receive,
    ping: () => socket.send('ping'),
  };
}

test('marker capture follows its phone from preview into only the matching screen without another pairing ticket', async () => {
  const markers = calibrationPageMarkers(400, 800);
  const svg = markers
    .map((m) =>
      markerSvg(m.code + 10).replace(
        '<svg ',
        `<svg x="${m.x + 30 - m.size / 2}" y="${m.y + 40 - m.size / 2}" width="${m.size}" height="${m.size}" `,
      ),
    )
    .join('');
  const jpeg = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="900"><rect width="500" height="900" fill="white"/>${svg}</svg>`,
    ),
  )
    .jpeg()
    .toBuffer();
  await workspace(jpeg, async ({ id, post, get, checked, server }) => {
    const { token } = await checked(
      await post(`/api/cameras/markers?id=${encodeURIComponent(id)}`),
    );
    const previewPath = `/api/cameras/markers?token=${token}`;
    const preview = await phone(server, token);
    let mapped;
    try {
      const initial = await preview.receive(
        () => preview.update(),
        (v) => v.view === 'markers',
      );
      await preview.receive(
        () => {
          preview.update(initial.markerRequest);
          preview.ping();
        },
        (v) => v === 'pong',
      );
      const { pageKey } = await get(previewPath);
      assert.ok(pageKey);
      const capture = await checked(
        await post(`${previewPath}&pageKey=${encodeURIComponent(pageKey)}`),
      );
      assert.equal(capture.validFrames, 8);
      const edit = {
        id,
        correction: capture.correction,
        perspectiveTarget: {
          width: capture.screenWidthPx,
          height: capture.screenHeightPx,
          rotation: 0,
        },
        evidence: capture.evidence,
      };
      assert.equal(
        (
          await post('/api/cameras/correction', {
            ...edit,
            id: 'another-camera',
          })
        ).status,
        409,
      );
      await checked(await post('/api/cameras/correction', edit));
      await preview.receive(
        () => {
          preview.update(initial.markerRequest, 2);
          preview.ping();
        },
        (v) => v === 'pong',
      );
      assert.equal((await post('/api/cameras/correction', edit)).status, 409);
      await checked(
        await post('/api/setup/reconnect', {
          session: (await get('/api/setup')).setup.session,
        }),
      );
      const sibling = await checked(
        await post('/api/screens', { cameraId: id, name: 'Right' }),
      );
      const open = (screen) =>
        post(
          `/api/devices/${encodeURIComponent(screen)}/calibration/open`,
          {},
        ).then(checked);
      await open(sibling.id);
      const pages = () =>
        post('/api/screen-pages', { action: 'list', cameraId: id }).then(
          checked,
        );
      assert.equal((await pages()).devices.length, 0);
      await Promise.all([open(id), open(id)]);
      const handoff = await preview.receive(preview.ping, (v) =>
        Boolean(v.pairingToken),
      );
      preview.socket.close();
      mapped = await phone(server, handoff.pairingToken);
      assert.notDeepEqual(mapped.codes, preview.codes);
      await mapped.receive(
        () => mapped.update(),
        (v) => Boolean(v.view),
      );
      const [device] = (await pages()).devices;
      assert.equal(device.screenId, id);
      assert.equal(device.mode, 'mapping');
      assert.equal(device.visible, true);
      assert.equal(device.fullscreen, true);
      const resumed = await checked(
        await post('/phone-calibration/register', {
          pageKey: mapped.page.pageKey,
          token: handoff.pairingToken,
        }),
      );
      assert.equal(
        new URL(resumed.url, server.url).searchParams.get('token'),
        handoff.pairingToken,
      );
      await open(sibling.id);
      assert.deepEqual(
        (await pages()).devices.map((p) => p.screenId),
        [id],
      );
      const screens = (await get('/api/cameras')).cameras[0].screens;
      assert.deepEqual(
        screens.find((s) => s.id === id).correction,
        edit.correction,
      );
      assert.equal(
        screens.find((s) => s.id === sibling.id).hasSavedPerspective,
        false,
      );
      // Pair a second phone to the sibling once. Next time it previews this
      // camera offline its saved geometry must return to the sibling.
      const session = await checked(
        await post('/api/marker-calibrations', {
          action: 'create',
          cameraId: id,
          screenIds: [sibling.id],
        }),
      );
      const display = await checked(
        await post('/api/screen-pages', {
          action: 'create-display',
          visionSessionId: session.id,
          targetId: sibling.id,
          visionToken: session.token,
        }),
      );
      const second = await checked(
        await post('/phone-calibration/register', {
          code: display.code,
          pageKey: crypto.randomUUID(),
        }),
      );
      const secondToken = new URL(second.url, server.url).searchParams.get(
        'token',
      );
      mapped.socket.close();
      await checked(
        await post('/api/arm/disconnect', {
          session: (await get('/api/setup')).setup.session,
        }),
      );
      const secondPreview = await checked(
        await post(`/api/cameras/markers?id=${encodeURIComponent(id)}`),
      );
      mapped = await phone(server, secondPreview.token, secondToken);
      const again = await mapped.receive(
        () => mapped.update(),
        (v) => v.view === 'markers',
      );
      await mapped.receive(
        () => {
          mapped.update(again.markerRequest);
          mapped.ping();
        },
        (v) => v === 'pong',
      );
      const prefix = `/api/cameras/markers?token=${secondPreview.token}`;
      const nextCapture = await checked(
        await post(
          `${prefix}&pageKey=${encodeURIComponent((await get(prefix)).pageKey)}`,
        ),
      );
      const changedTarget = { width: 800, height: 400, rotation: 90 };
      await checked(
        await post('/api/cameras/correction', {
          id,
          correction: { ...nextCapture.correction, rotation: 90 },
          perspectiveTarget: changedTarget,
          evidence: nextCapture.evidence,
        }),
      );
      assert.deepEqual(
        (await get('/api/cameras')).cameras[0].perspectiveTarget,
        changedTarget,
      );
      await checked(
        await post('/api/setup/reconnect', {
          session: (await get('/api/setup')).setup.session,
        }),
      );
      const active = (await get('/api/cameras')).cameras[0];
      assert.equal(active.previewScreenId, sibling.id);
      assert.deepEqual(
        active.screens.find((s) => s.id === id).perspectiveTarget,
        edit.perspectiveTarget,
      );
      assert.deepEqual(
        active.screens.find((s) => s.id === sibling.id).perspectiveTarget,
        changedTarget,
      );
      await open(id);
      await open(sibling.id);
      const returning = await mapped.receive(mapped.ping, (v) =>
        Boolean(v.pairingToken),
      );
      assert.equal(returning.pairingToken, secondToken);
      mapped.socket.close();
      mapped = await phone(server, returning.pairingToken);
      await mapped.receive(
        () => mapped.update(),
        (v) => Boolean(v.view),
      );
      assert.deepEqual(
        (await pages()).devices.filter((p) => p.visible).map((p) => p.screenId),
        [sibling.id],
      );
      // An unknown phone may preview the same glass, but neither installed
      // screen may inherit its result while both still have owners.
      mapped.socket.close();
      await checked(
        await post('/api/arm/disconnect', {
          session: (await get('/api/setup')).setup.session,
        }),
      );
      const stranger = await checked(
        await post(`/api/cameras/markers?id=${encodeURIComponent(id)}`),
      );
      mapped = await phone(server, stranger.token);
      const show = await mapped.receive(
        () => mapped.update(),
        (v) => v.view === 'markers',
      );
      await mapped.receive(
        () => {
          mapped.update(show.markerRequest);
          mapped.ping();
        },
        (v) => v === 'pong',
      );
      const path = `/api/cameras/markers?token=${stranger.token}`;
      const foreign = await checked(
        await post(
          `${path}&pageKey=${encodeURIComponent((await get(path)).pageKey)}`,
        ),
      );
      await checked(
        await post('/api/cameras/correction', {
          id,
          correction: foreign.correction,
          perspectiveTarget: { width: 100, height: 200, rotation: 0 },
          evidence: foreign.evidence,
        }),
      );
      await checked(
        await post('/api/setup/reconnect', {
          session: (await get('/api/setup')).setup.session,
        }),
      );
      assert.equal((await open(id)).pairingConflict, true);
      const unchanged = (await get('/api/cameras')).cameras[0];
      assert.deepEqual(
        unchanged.screens.find((s) => s.id === id).perspectiveTarget,
        edit.perspectiveTarget,
      );
      assert.deepEqual(
        unchanged.screens.find((s) => s.id === sibling.id).perspectiveTarget,
        changedTarget,
      );
      assert.equal((await pages()).devices.length, 2);
    } finally {
      preview.socket.close();
      mapped?.socket.close();
    }
  });
});
