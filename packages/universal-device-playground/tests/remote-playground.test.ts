import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from '@rstest/core';
import { launchUniversalDevicePlayground } from '../dist/index.js';

test('Playground tabs independently claim, preview, control and release devices', async () => {
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
  const otherPeer = { ...peer, id: 'other-peer', name: 'Other iPhone' };
  const profile = {
    id: 'phone-1',
    name: peer.name,
    screen: { source: 'usb', deviceId: 'usb' },
    bluetoothPeerId: peer.id,
  };
  const otherProfile = {
    ...profile,
    id: 'phone-2',
    name: otherPeer.name,
    screen: { source: 'usb', deviceId: 'other-usb' },
    bluetoothPeerId: otherPeer.id,
  };
  await store.save(profile);
  await store.save(otherProfile);
  const token = 'test-token';
  const calls: unknown[] = [];
  const screenshot = (id: string) => Buffer.from(`screenshot ${id}`);
  const liveFrame = (id: string) => Buffer.from(`live frame ${id}`);
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
        listPeers: async () => [peer, otherPeer],
      },
      open: async ({ id }: { id: string }) => ({
        openPreview: () => {
          previewReaders++;
          return {
            getFrame: async () => ({ jpeg: liveFrame(id), sequence: 1 }),
            close: async () => {
              if (id === profile.id) closePreview();
            },
          };
        },
        screenshot: async () => ({
          jpeg: screenshot(id),
          width: 200,
          height: 400,
          sequence: 1,
          receivedAt: Date.now(),
        }),
        execute: async (action: unknown) => {
          calls.push({ id, action });
        },
        close: async () => {},
      }),
      close: async () => {},
    },
    store,
  );
  const workspace = await workspaces.create();
  const otherWorkspace = await workspaces.create();
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
  const page = await fetch(origin);
  const setup = await page.text();
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
  for (const [apiBase, id] of [
    [workspace.apiBase, profile.id],
    [otherWorkspace.apiBase, otherProfile.id],
  ]) {
    const device = await post(
      host,
      `${apiBase}/session`,
      { id, source: 'saved' },
      {
        'X-Midscene-Playground': 'setup',
      },
    );
    assert.equal(device.status, 200, await device.text());
  }
  const deviceRoute = (id: string, connection: string) =>
    `/devices/${id}/${connection.repeat(32)}`;
  const leftRoute = deviceRoute(profile.id, 'a');
  const rightRoute = deviceRoute(otherProfile.id, 'b');
  const connect = (deviceId: string, route: string) =>
    post(origin, `${route}/session`, { host, token, deviceId });
  const list = async (): Promise<{ id: string; status: string }[]> =>
    (await (await post(origin, '/open-device/devices', { host, token })).json())
      .devices;
  assert.ok((await list()).every(({ status }) => status === 'available'));
  for (const connected of await Promise.all([
    connect(profile.id, leftRoute),
    connect(otherProfile.id, rightRoute),
  ])) {
    assert.equal(connected.status, 200, await connected.text());
  }
  assert.ok((await list()).every(({ status }) => status === 'busy'));
  assert.equal((await fetch(origin + leftRoute)).status, 200);
  assert.equal(
    (await (await fetch(`${origin}/session`)).json()).connected,
    false,
  );
  const info = await (await fetch(`${origin}${leftRoute}/runtime-info`)).json();
  assert.equal(info.preview.kind, 'mjpeg');
  assert.equal(info.preview.mjpegPath, `${leftRoute}/mjpeg`);
  async function readLive(id: string, route: string) {
    const live = await fetch(`${origin}${route}/mjpeg`, {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(live.status, 200);
    assert.match(
      live.headers.get('content-type') ?? '',
      /^multipart\/x-mixed-replace; boundary=/,
    );
    const reader = live.body!.getReader();
    let data = Buffer.alloc(0);
    while (!data.includes(liveFrame(id))) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      data = Buffer.concat([data, Buffer.from(chunk.value!)]);
    }
    assert.match(data.toString(), /Content-Type: image\/jpeg/);
    return reader;
  }
  const [reader, otherReader] = await Promise.all([
    readLive(profile.id, leftRoute),
    readLive(otherProfile.id, rightRoute),
  ]);
  const secondReader = await readLive(profile.id, leftRoute);
  await secondReader.cancel();
  assert.equal(previewReaders, 2);

  const duplicate = await connect(profile.id, deviceRoute(profile.id, 'c'));
  assert.equal(duplicate.ok, false);
  const removal = await fetch(host + workspace.apiBase, {
    method: 'DELETE',
    headers: { 'X-Midscene-Playground': 'workspace' },
  });
  assert.equal(removal.status, 409);
  const preview = await fetch(`${origin}${rightRoute}/screenshot`);
  assert.equal(preview.status, 200);
  assert.equal(
    (await preview.json()).screenshot,
    `data:image/jpeg;base64,${screenshot(otherProfile.id).toString('base64')}`,
  );
  const tap = (route: string) =>
    post(origin, `${route}/interact`, { actionType: 'Tap', x: 20, y: 30 });
  assert.equal((await tap(leftRoute)).status, 200);
  const disconnect = (route: string) =>
    fetch(`${origin}${route}/session`, { method: 'DELETE' });
  assert.equal((await disconnect(leftRoute)).status, 200);
  await previewClosed;
  await reader.cancel().catch(() => {});
  assert.equal(
    (await list()).find(({ id }) => id === profile.id)?.status,
    'available',
  );
  assert.equal((await tap(rightRoute)).status, 200);
  assert.deepEqual(
    calls,
    [profile, otherProfile].map(({ id }) => ({
      id,
      action: { type: 'tap', point: { x: 20, y: 30 } },
    })),
  );
  await otherReader.cancel();

  assert.equal((await connect(profile.id, leftRoute)).status, 200);
  const status = async (route: string) =>
    (await (await fetch(`${origin}${route}/open-device/session-status`)).json())
      .ended;
  for (const notify of listeners) notify({ hosts: [otherPeer] });
  const interrupted = await fetch(`${origin}${leftRoute}/screenshot`);
  assert.equal(interrupted.ok, false);
  assert.equal(await status(leftRoute), true);
  assert.equal(await status(rightRoute), false);
  assert.equal((await disconnect(rightRoute)).status, 200);
});
