import assert from 'node:assert/strict';
import { onTestFinished, test } from '@rstest/core';
import { launchIOSHIDPlayground } from '../dist/index.js';

test('Playground discovers, claims, previews and releases one device from the service', async () => {
  // The service is built alongside the Playground, but is not its runtime dependency.
  const serviceModule = new URL(
    '../../ios-hid-service/dist/server.js',
    import.meta.url,
  ).href;
  const workspaceModule = new URL(
    '../../ios-hid-service/dist/workspaces.js',
    import.meta.url,
  ).href;
  const { runServer } = await import(serviceModule);
  const { DeviceWorkspaces } = await import(workspaceModule);
  const token = 'test-token';
  const calls: unknown[] = [];
  const profiles = [
    { id: 'phone-1', name: 'Test iPhone', screen: { source: 'usb' } },
  ];
  const jpeg = Buffer.from('simulated frame');
  const workspaces = new DeviceWorkspaces(
    () => ({
      onStateChange: () => () => {},
      getSnapshot: () => ({
        state: {
          phase: 'ready',
          device: { id: 'phone-1', name: 'Test iPhone' },
        },
        source: 'usb',
      }),
      refreshConnectionState: async () => {},
      screenshot: async () => ({
        jpeg,
        width: 200,
        height: 400,
        sequence: 1,
        receivedAt: Date.now(),
      }),
      execute: async (action: unknown) => {
        calls.push(action);
      },
      destroySession: async () => {},
    }),
    false,
  );
  const workspace = await workspaces.create();
  const service = await runServer(0, {
    accessToken: token,
    listDevices: async () => profiles,
    workspaces,
  });
  onTestFinished(() => service.close());
  const playground = await launchIOSHIDPlayground({
    port: 0,
    openBrowser: false,
    verbose: false,
  });
  onTestFinished(() => playground.close());
  const origin = `http://127.0.0.1:${playground.port}`;
  const host = `http://127.0.0.1:${service.port}`;
  const setup = await (await fetch(origin)).text();
  assert.match(setup, /\/ios-hid\/ui\/connect\.js/);
  const extension = await (
    await fetch(`${origin}/ios-hid/ui/connect.js`)
  ).text();
  assert.match(extension, /name="token" type="password"/);
  const upstream = setup;
  const bundle = upstream.match(/src="(\/static\/js\/index\.[^"]+\.js)"/)?.[1];
  assert.ok(bundle, 'the task page serves the upstream Playground bundle');
  const script = await fetch(origin + bundle);
  assert.equal(script.status, 200);
  await script.arrayBuffer();

  const post = (
    base: string,
    path: string,
    body: unknown,
    headers?: Record<string, string>,
  ) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const input = { host, token, deviceId: 'phone-1' };
  const auth = { Authorization: `Bearer ${token}` };
  const list = async () =>
    (await (await post(origin, '/ios-hid/devices', { host, token })).json())
      .devices;
  assert.equal((await list())[0].status, 'available');
  const connected = await post(origin, '/session', input);
  assert.equal(connected.status, 200, await connected.text());
  assert.equal((await list())[0].status, 'busy');
  const duplicate = await post(
    host,
    '/api/v1/sessions',
    { deviceId: 'phone-1' },
    auth,
  );
  assert.equal(duplicate.status, 409);
  const removal = await fetch(host + workspace.apiBase, {
    method: 'DELETE',
    headers: { 'X-Midscene-Playground': 'workspace' },
  });
  assert.equal(removal.status, 409);
  const preview = await fetch(`${origin}/screenshot`);
  assert.equal(preview.status, 200);
  assert.match((await preview.json()).screenshot, /^data:image\/jpeg;base64,/);
  const tap = await post(origin, '/interact', {
    actionType: 'Tap',
    x: 20,
    y: 30,
  });
  assert.equal(tap.status, 200, await tap.text());
  assert.deepEqual(calls, [{ type: 'tap', point: { x: 20, y: 30 } }]);
  assert.equal(
    (await fetch(`${origin}/session`, { method: 'DELETE' })).status,
    200,
  );
  assert.equal((await list())[0].status, 'available');
});
