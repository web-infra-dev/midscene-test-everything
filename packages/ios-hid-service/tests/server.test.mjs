import assert from 'node:assert/strict';
import { get } from 'node:http';
import { test } from 'node:test';
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

  assert.equal((await request('/api/docs/')).status, 200);
  const schema = await (await request('/api/openapi.json')).json();
  assert.ok(schema.paths['/api/v1/devices']);
  assert.equal((await request('/api/v1/devices')).status, 401);
  const authenticated = { ...lan, Authorization: 'Bearer test-token' };
  const devices = await (
    await request('/api/v1/devices', authenticated)
  ).json();
  assert.deepEqual(devices, {
    devices: [
      {
        id: 'phone-1',
        name: 'Test iPhone',
        screenSource: 'usb',
        status: 'offline',
      },
    ],
  });
  assert.equal(
    (await request('/ios-hid/workspaces', authenticated)).status,
    403,
  );
  assert.equal((await request('/', authenticated)).status, 403);
  const localManager = await request('/', {});
  assert.equal(localManager.status, 200);
  assert.equal((await request('/api/docs/swagger-initializer.js')).status, 200);
});

test('manager can connect, preview and remove a device without a task server', async (t) => {
  let state;
  let listener;
  const manager = {
    onStateChange: (notify) => {
      listener = notify;
      return () => {
        listener = undefined;
      };
    },
    getSnapshot: () => ({ state, source: 'usb' }),
    refreshConnectionState: async () => state,
    connect: async () => {
      state = {
        phase: 'ready',
        device: { id: 'phone-1', name: 'Test iPhone' },
      };
      listener?.();
    },
    screenshot: async () => ({
      jpeg: Buffer.from('test-image'),
      receivedAt: 1,
    }),
    destroySession: async () => {
      state = undefined;
    },
  };
  const service = await runServer(0, {
    accessToken: 'test-token',
    workspaces: new DeviceWorkspaces(() => manager, false),
  });
  t.after(() => service.close());
  const base = `http://127.0.0.1:${service.port}/ios-hid/workspaces`;
  const headers = { 'X-Midscene-Playground': 'workspace' };
  const created = await fetch(base, { method: 'POST', headers });
  assert.equal(created.status, 200);
  const { id } = await created.json();
  const url = `${base}/${id}`;
  const connected = await fetch(`${url}/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Midscene-Playground': 'setup',
    },
    body: JSON.stringify({
      source: 'usb',
      deviceId: 'usb',
      bluetoothPeerId: 'peer',
    }),
  });
  assert.equal(connected.status, 200);
  assert.equal((await connected.json()).state.device.id, 'phone-1');
  const frame = await (await fetch(`${url}/screenshot`)).json();
  assert.match(frame.screenshot, /^data:image\/jpeg;base64,/);
  assert.equal((await fetch(`${url}/execute`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(url, { method: 'DELETE', headers })).status, 200);
  assert.equal(state, undefined);
});
