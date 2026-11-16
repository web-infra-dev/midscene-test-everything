import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from '@rstest/core';
import { launchUniversalDevicePlayground } from '../dist/index.js';

test('Playground discovers, claims, previews and releases one device from the service', async () => {
  // The service is built alongside the Playground, but is not its runtime dependency.
  const serviceModule = new URL(
    '../../ios-airlink/dist/server.js',
    import.meta.url,
  ).href;
  const workspaceModule = new URL(
    '../../ios-airlink/dist/workspaces.js',
    import.meta.url,
  ).href;
  const { runServer } = await import(serviceModule);
  const { DeviceWorkspaces } = await import(workspaceModule);
  const storeModule = new URL(
    '../../ios-airlink/dist/hardware/config/store.js',
    import.meta.url,
  ).href;
  const { DeviceConfigStore } = await import(storeModule);
  const directory = await mkdtemp(join(tmpdir(), 'hid-playground-test-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const store = new DeviceConfigStore(directory);
  const peer = { id: 'peer', name: 'Test iPhone', reports: [1, 2, 3] };
  const profile = {
    id: 'phone-1',
    name: peer.name,
    screen: { source: 'usb', deviceId: 'usb' },
    bluetoothPeerId: peer.id,
  };
  await store.save(profile);
  const token = 'test-token';
  const calls: unknown[] = [];
  const jpeg = Buffer.from('simulated frame');
  const liveJpeg = Buffer.from('live frame');
  let previewReaders = 0;
  let closePreview!: () => void;
  const previewClosed = new Promise<void>((resolve) => {
    closePreview = resolve;
  });
  const listeners = new Set<(status: { hosts: (typeof peer)[] }) => void>();
  const workspaces = new DeviceWorkspaces(
    {
      input: {
        subscribe(listener: (status: { hosts: (typeof peer)[] }) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        listPeers: async () => [peer],
      },
      open: async () => ({
        openPreview: () => {
          previewReaders++;
          return {
            getFrame: async () => ({ jpeg: liveJpeg, sequence: 1 }),
            close: async () => closePreview(),
          };
        },
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
        close: async () => {},
      }),
      close: async () => {},
    },
    store,
  );
  const workspace = await workspaces.create();
  const service = await runServer(0, { accessToken: token, workspaces });
  onTestFinished(() => service.close());
  const playground = await launchUniversalDevicePlayground({
    port: 0,
    openBrowser: false,
    verbose: false,
  });
  onTestFinished(() => playground.close());
  const origin = `http://127.0.0.1:${playground.port}`;
  const host = `http://127.0.0.1:${service.port}`;
  const setup = await (await fetch(origin)).text();
  const connectionBundle = setup.match(
    /src="(\/open-device\/ui\/[^"]*\/connect\.[^"]+\.js)"/,
  )?.[1];
  assert.ok(connectionBundle, 'the connection page includes its React bundle');
  const extension = await fetch(origin + connectionBundle);
  assert.equal(extension.status, 200);
  await extension.arrayBuffer();
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
  const device = await post(
    host,
    `${workspace.apiBase}/session`,
    { id: profile.id, source: 'saved' },
    { 'X-Midscene-Playground': 'setup' },
  );
  assert.equal(device.status, 200, await device.text());
  const input = { host, token, deviceId: 'phone-1' };
  const auth = { Authorization: `Bearer ${token}` };
  const list = async () =>
    (await (await post(origin, '/open-device/devices', { host, token })).json())
      .devices;
  assert.equal((await list())[0].status, 'available');
  const connected = await post(origin, '/session', input);
  assert.equal(connected.status, 200, await connected.text());
  assert.equal((await list())[0].status, 'busy');
  const info = await (await fetch(`${origin}/runtime-info`)).json();
  assert.equal(info.preview.kind, 'mjpeg');
  const live = await fetch(`${origin}/mjpeg`, {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(live.status, 200);
  assert.match(
    live.headers.get('content-type') ?? '',
    /^multipart\/x-mixed-replace; boundary=/,
  );
  const reader = live.body!.getReader();
  let data = Buffer.alloc(0);
  while (!data.includes(liveJpeg)) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    data = Buffer.concat([data, Buffer.from(chunk.value!)]);
  }
  assert.match(data.toString(), /Content-Type: image\/jpeg/);
  const second = await fetch(`${origin}/mjpeg`, {
    signal: AbortSignal.timeout(5000),
  });
  const secondReader = second.body!.getReader();
  assert.match(
    Buffer.from((await secondReader.read()).value!).toString(),
    /live frame/,
  );
  await secondReader.cancel();
  assert.equal(previewReaders, 1);

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
  await previewClosed;
  await reader.cancel().catch(() => {});
  assert.equal((await list())[0].status, 'available');

  assert.equal((await post(origin, '/session', input)).status, 200);
  const status = async () =>
    (await (await fetch(`${origin}/open-device/session-status`)).json()).ended;
  assert.equal(await status(), false);
  for (const notify of listeners) notify({ hosts: [] });
  const interrupted = await fetch(`${origin}/screenshot`);
  assert.equal(interrupted.ok, false);
  assert.equal(await status(), true);
  assert.equal(
    (await fetch(`${origin}/session`, { method: 'DELETE' })).status,
    200,
  );
  assert.equal(await status(), false);
});
