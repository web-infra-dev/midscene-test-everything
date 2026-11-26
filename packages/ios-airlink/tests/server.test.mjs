import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DeviceConfigStore } from '../dist/hardware/config/store.js';
import { runServer } from '../dist/server.js';
import { DeviceWorkspaces } from '../dist/workspaces.js';

test('LAN clients can discover saved devices with a token, while setup stays local', async (t) => {
  const service = await runServer(0, {
    accessToken: 'test-token',
    listDevices: async () => [
      {
        id: 'phone-1',
        name: 'Test iPhone',
        bluetoothPeerId: 'private-peer',
        screen: { source: 'usb', deviceId: 'private-usb' },
      },
    ],
  });
  t.after(() => service.close());
  assert.equal(service.server.address().address, '0.0.0.0');
  const base = `http://127.0.0.1:${service.port}`;
  const lan = { Host: `mac-mini.local:${service.port}` };
  const request = (path, headers = lan) =>
    new Promise((resolve, reject) => {
      get(`${base}${path}`, { headers }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('error', reject);
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            json: () => JSON.parse(body),
          }),
        );
      }).on('error', reject);
    });

  assert.equal((await request('/devices')).status, 401);
  const authenticated = { ...lan, Authorization: 'Bearer test-token' };
  const devices = await (await request('/devices', authenticated)).json();
  assert.deepEqual(devices, {
    devices: [
      {
        id: 'phone-1',
        name: 'Test iPhone',
        screenSource: 'usb',
        status: 'offline',
        path: '/devices/phone-1',
      },
    ],
  });
  assert.equal(
    (await request('/devices/phone-1/api/info', authenticated)).status,
    200,
  );
  assert.equal((await request('/devices/phone-1/api/info')).status, 401);
  assert.equal((await request('/devices/phone-1/api/docs/')).status, 200);
  assert.equal(
    (await request('/devices/unknown/api/info', authenticated)).status,
    404,
  );
  assert.equal(
    (await request('/ios-airlink/workspaces', authenticated)).status,
    403,
  );
  assert.equal(
    (await request('/ios-airlink/token', authenticated)).status,
    403,
  );
  assert.equal((await request('/ios-airlink/token', {})).status, 403);
  assert.deepEqual(
    await (
      await request('/ios-airlink/token', {
        'X-Midscene-Playground': 'workspace',
      })
    ).json(),
    { token: 'test-token' },
  );
  assert.equal((await request('/', authenticated)).status, 403);
  const localManager = await request('/', {});
  assert.equal(localManager.status, 200);
});

test(
  'manager setup and remote control share a service-owned phone',
  { timeout: 10000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'ios-airlink-test-'));
    const peer = { id: 'peer', name: 'Test iPhone', reports: [1, 2, 3] };
    const frame = {
      jpeg: Buffer.from('test-image'),
      receivedAt: 1,
      sequence: 1,
      width: 1,
      height: 1,
    };
    const preview = {
      getFrame: async () => frame,
      getSetupInfo: () => ({
        state: 'streaming',
        name: 'Test receiver',
        pin: '1234',
      }),
      close: async () => {},
    };
    const actions = [];
    let closed = false;
    const runtime = {
      input: {
        subscribe: () => () => {},
        status: async () => ({ hosts: [peer] }),
        listPeers: async () => [peer],
      },
      openScreen: async () => preview,
      open: async (_config, screen) => {
        assert.equal(screen, preview);
        return {
          screenshot: async () => frame,
          execute: async (action) => actions.push(action),
          close: async () => {
            closed = true;
          },
        };
      },
      close: async () => {},
    };
    const service = await runServer(0, {
      accessToken: 'test-token',
      workspaces: new DeviceWorkspaces(
        runtime,
        new DeviceConfigStore(directory),
      ),
    });
    t.after(async () => {
      await service.close();
      await rm(directory, { recursive: true, force: true });
    });
    const origin = `http://127.0.0.1:${service.port}`;
    const base = `${origin}/ios-airlink/workspaces`;
    const workspaceHeaders = { 'X-Midscene-Playground': 'workspace' };
    const created = await fetch(base, {
      method: 'POST',
      headers: workspaceHeaders,
    });
    assert.equal(created.status, 200);
    const { id } = await created.json();
    const url = `${base}/${id}`;
    const post = (url, body, headers) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    const connecting = post(
      `${url}/session`,
      { source: 'airplay', bluetoothPeerId: peer.id },
      { 'X-Midscene-Playground': 'setup' },
    );
    let setupId;
    for (let i = 0; i < 50 && !setupId; i++) {
      const [workspace] = await (await fetch(base)).json();
      setupId = workspace.state?.setupId;
      if (!setupId) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(setupId, 'workspace exposes the in-process setup session');
    const setup = `${url}/ios-airlink/setup/${setupId}`;
    assert.equal(
      (await (await fetch(`${setup}/state`)).json()).source,
      'airplay',
    );
    assert.equal((await post(`${setup}/select`, {}, {})).status, 403);
    const setupHeaders = { 'X-Midscene-Setup': setupId };
    assert.equal((await post(`${setup}/select`, {}, setupHeaders)).status, 200);
    assert.equal(await (await fetch(`${setup}/frame`)).text(), 'test-image');
    assert.equal(
      (
        await post(
          `${setup}/confirm`,
          { confirmed: true, bluetoothPeerId: peer.id },
          setupHeaders,
        )
      ).status,
      200,
    );
    const connected = await connecting;
    assert.equal(connected.status, 200);
    const deviceId = (await connected.json()).state.device.id;
    assert.equal((await fetch(`${setup}/state`)).status, 410);
    const managedFrame = await (await fetch(`${url}/screenshot`)).json();
    assert.equal(
      managedFrame.screenshot,
      `data:image/jpeg;base64,${frame.jpeg.toString('base64')}`,
    );

    const authorization = { Authorization: 'Bearer test-token' };
    const { devices } = await (
      await fetch(`${origin}/devices`, { headers: authorization })
    ).json();
    assert.deepEqual(devices, [
      {
        id: deviceId,
        name: peer.name,
        screenSource: 'airplay',
        status: 'available',
        path: `/devices/${deviceId}`,
      },
    ]);
    const api = `${origin}/devices/${deviceId}/api`;
    const info = await (
      await fetch(`${api}/info`, { headers: authorization })
    ).json();
    assert.equal(info.name, peer.name);
    assert.equal(info.pointerType, 'touch');
    assert.deepEqual(info.primitives, [
      'tap',
      'doubleClick',
      'longPress',
      'dragAndDrop',
      'swipe',
      'typeText',
      'keyboardPress',
      'clearInput',
      'scroll',
      'backButton',
      'homeButton',
    ]);
    assert.equal(
      (await post(`${api}/primitives/homeButton`, {}, authorization)).status,
      200,
    );
    assert.equal(
      (
        await post(
          `${api}/primitives/doubleClick`,
          { point: { x: 0, y: 0 } },
          authorization,
        )
      ).status,
      200,
    );
    assert.deepEqual(actions, [
      { type: 'home' },
      { type: 'doubleTap', point: { x: 0, y: 0 } },
    ]);
    assert.equal(
      (await fetch(url, { method: 'DELETE', headers: workspaceHeaders }))
        .status,
      200,
    );
    assert.equal(closed, true);
  },
);

test(
  'Bluetooth loss cancels control and a device URL never follows a workspace to another phone',
  { timeout: 10000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'ios-airlink-lease-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const store = new DeviceConfigStore(directory);
    const peers = ['a', 'b'].map((id) => ({
      id,
      name: id,
      reports: [1, 2, 3],
    }));
    for (const peer of peers) {
      await store.save({
        id: peer.id,
        name: peer.name,
        bluetoothPeerId: peer.id,
        screen: { source: 'usb', deviceId: peer.id },
      });
    }
    const listeners = new Set();
    const actionStarted = Promise.withResolvers();
    const actions = [];
    const runtime = {
      input: {
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        listPeers: async () => peers,
      },
      open: async ({ id }) => ({
        screenshot: async () => ({ jpeg: Buffer.from('image') }),
        async execute(action, signal) {
          actions.push({ id, action });
          if (action.type !== 'home') return;
          const cancelled = new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          });
          actionStarted.resolve();
          await cancelled;
        },
        close: async () => {},
      }),
      close: async () => {},
    };
    const workspaces = new DeviceWorkspaces(runtime, store);
    const { apiBase } = await workspaces.create();
    const service = await runServer(0, {
      accessToken: 'test-token',
      workspaces,
    });
    t.after(() => service.close());
    const base = `http://127.0.0.1:${service.port}`;
    const auth = { Authorization: 'Bearer test-token' };
    const setup = { 'X-Midscene-Playground': 'setup' };
    const request = (path, headers = auth) => fetch(base + path, { headers });
    const post = (path, body, headers = auth) =>
      fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    const connect = async (id) => {
      const response = await post(
        `${apiBase}/session`,
        { id, source: 'saved' },
        setup,
      );
      assert.equal(response.status, 200, await response.text());
    };
    const primitive = (id, name) =>
      post(`/devices/${id}/api/primitives/${name}`, {});
    const dropA = () => {
      for (const notify of listeners) notify({ hosts: [peers[1]] });
    };

    await connect('a');
    const running = primitive('a', 'homeButton');
    await actionStarted.promise;
    dropA();
    assert.equal((await running).status, 500);
    const offline = await primitive('a', 'backButton');
    assert.equal(offline.status, 500);
    assert.match((await offline.json()).error, /offline/);

    const refresh = await post(
      `${apiBase}/refresh`,
      {},
      { 'X-Midscene-Playground': 'workspace' },
    );
    assert.equal(refresh.status, 200, await refresh.text());
    assert.equal((await primitive('a', 'backButton')).status, 200);

    dropA();
    // Refresh the manager snapshot, as the workspace health check also does.
    await (await request('/ios-airlink/workspaces')).json();
    assert.equal(
      (await post(`${apiBase}/ios-airlink/cancel`, {}, setup)).status,
      200,
    );
    await connect('b');
    assert.equal((await primitive('a', 'backButton')).status, 500);
    assert.deepEqual(actions, [
      { id: 'a', action: { type: 'home' } },
      { id: 'a', action: { type: 'back' } },
    ]);
    assert.equal((await primitive('b', 'backButton')).status, 200);
    assert.equal(actions.at(-1).id, 'b');
  },
);

test('the same phone calibration URL works before setup and after a service restart', async (t) => {
  let calibration;
  const options = {
    accessToken: 'test-token',
    workspaces: {
      mount(_app, _inUse, phoneCalibration) {
        calibration = phoneCalibration;
      },
      async close() {},
    },
  };
  let service = await runServer(0, options);
  t.after(() => service?.close());
  const phone = calibration.forPeer('phone');
  const [link] = phone.status(service.port).links;
  assert.ok(link);
  assert.equal(calibration.forPeer('phone'), phone);
  assert.notEqual(calibration.forPeer('other-phone'), phone);
  const page = new URL(link.url);
  page.hostname = '127.0.0.1';
  const request = () =>
    new Promise((resolve, reject) => {
      get(page, { headers: { Host: `mac-mini.local:${page.port}` } }, (res) => {
        res.resume();
        res.once('end', () => resolve(res.statusCode));
        res.once('error', reject);
      }).once('error', reject);
    });
  assert.equal(await request(), 200);
  assert.equal((await fetch(new URL(page.pathname, page))).status, 403);
  const socketURL = new URL(page);
  socketURL.protocol = 'ws:';
  socketURL.pathname = '/phone-calibration/session';
  const connect = async () => {
    const socket = new WebSocket(socketURL);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return socket;
  };
  const socket = await connect();
  const port = service.port;
  await service.close();
  service = undefined;
  service = await runServer(port, options);
  assert.equal(await request(), 200);
  assert.equal(
    calibration.forPeer('phone').status(port).links[0].url,
    link.url,
  );
  const reconnected = await connect();
  reconnected.close();
  socket.close();
});
