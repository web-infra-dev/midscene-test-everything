import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeAdapter } from '@midscene/arm-kit/internal/testkit';
import { rstest, test } from '@rstest/core';
import { startArmPlayground } from '../src/server/index.ts';

import { PlaygroundDevices } from '../src/server/devices.ts';

test('code-configured arm connects, reports its own settings, retries and releases the server', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'playground-server-'));
  rstest.stubEnv('MIDSCENE_ARM_DATA_DIR', directory);
  rstest.stubEnv('MIDSCENE_RUN_DIR', directory);
  const discover = rstest
    .spyOn(PlaygroundDevices.prototype, 'startAll')
    .mockResolvedValue(undefined);
  let attempts = 0;
  const values = {
    globalSpeedPercent: 25,
    linearSpeed: 20,
    linearAcceleration: 30,
    linearJerk: 50,
  };
  const settings = {
    revision: 'initial',
    receivedAt: new Date().toISOString(),
    values,
    ranges: Object.fromEntries(
      Object.keys(values).map((key) => [
        key,
        { min: 1, max: 100, default: 20 },
      ]),
    ),
  };
  const updateMotionSettings = rstest.fn(async (request) => ({
    ...settings,
    values: request.values,
  }));
  const server = await startArmPlayground({
    deviceAccessToken: 'test-token',
    createAdapter() {
      if (++attempts === 1) throw new Error('Serial port unavailable');
      const adapter = createFakeAdapter();
      adapter.driver.readMotionSettings = async () => settings;
      adapter.driver.updateMotionSettings = updateMotionSettings;
      return adapter;
    },
  });
  async function connect() {
    const { setup } = await (await fetch(`${server.url}/api/setup`)).json();
    return fetch(`${server.url}/api/setup/reconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: setup.session }),
    });
  }
  try {
    assert.equal(attempts, 0);
    const managerPage = await fetch(server.url);
    assert.equal(managerPage.status, 200);
    assert.match(
      await managerPage.text(),
      /<title>Dobot MG400 Arm Service Manager<\/title>/,
    );
    const phonePage = await fetch(`${server.url}/s`);
    assert.equal(phonePage.status, 200);
    assert.match(phonePage.headers.get('content-type'), /text\/html/);
    const credentialsUrl = `${server.url}/api/arm/open-device`;
    assert.equal((await fetch(credentialsUrl)).status, 403);
    const managerHeaders = { 'X-Midscene-Manager': '1' };
    assert.equal(
      (
        await fetch(credentialsUrl, {
          headers: { ...managerHeaders, Origin: 'https://example.test' },
        })
      ).status,
      403,
    );
    const unexpectedHostStatus = await new Promise((resolve, reject) => {
      get(
        credentialsUrl,
        { headers: { ...managerHeaders, Host: 'example.test' } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      ).once('error', reject);
    });
    assert.equal(unexpectedHostStatus, 403);
    const credentials = await fetch(credentialsUrl, {
      headers: managerHeaders,
    });
    assert.equal(credentials.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await credentials.json(), {
      token: 'test-token',
      devices: [],
    });
    const devicesUrl = `${server.url}/devices`;
    assert.equal((await fetch(devicesUrl)).status, 401);
    assert.deepEqual(
      await (
        await fetch(devicesUrl, {
          headers: { Authorization: 'Bearer test-token' },
        })
      ).json(),
      { devices: [] },
    );

    assert.equal(
      (
        await fetch(`${server.url}/api/setup`, {
          headers: { Origin: server.url },
        })
      ).status,
      200,
    );
    assert.equal((await connect()).status, 500);
    assert.equal((await connect()).status, 200);
    const arm = await (await fetch(`${server.url}/api/arm`)).json();
    assert.equal(arm.phase, 'connected');
    assert.equal(arm.control?.manualBusy, false);
    assert.equal(arm.control?.positionUnknown, false);
    const unavailableAction = await fetch(
      `${server.url}/api/devices/cam/actions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: { type: 'tap', point: { x: 10, y: 10 } },
        }),
      },
    );
    assert.equal(unavailableAction.status, 409);
    assert.equal((await unavailableAction.json()).code, 'VISION_UNAVAILABLE');
    const endpoint = `${server.url}/api/setup/motion-settings`;
    assert.deepEqual(await (await fetch(endpoint)).json(), settings);
    const updated = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: arm.setupSession,
        revision: 'initial',
        values: { ...values, linearSpeed: 42 },
      }),
    });
    assert.equal((await updated.json()).values.linearSpeed, 42);
    assert.equal(updateMotionSettings.mock.calls.length, 1);
    assert.equal(arm.adapter.name, 'Independent adapter fake');
    // Disabled outline checks do not open a camera or calibration host.
    const outlineHost = rstest
      .spyOn(PlaygroundDevices.prototype, 'ensureHost')
      .mockResolvedValue({
        async handle(_req, res) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ validity: { state: 'invalid' } }));
          return true;
        },
      });
    try {
      const check = await fetch(
        `${server.url}/api/devices/cam/calibration/camera/validity`,
      );
      assert.equal(check.status, 200);
      assert.deepEqual(await check.json(), { skipped: 'disabled' });
      assert.equal(outlineHost.mock.calls.length, 0);
    } finally {
      outlineHost.mockRestore();
    }
    assert.equal(
      (await fetch(`${server.url}/api/setup/network-ports`)).status,
      404,
    );
    const activateImaging = rstest
      .spyOn(PlaygroundDevices.prototype, 'activateCameraImaging')
      .mockResolvedValue({
        state: 'ready',
        screenId: 'left',
        active: true,
      });
    try {
      const activation = await fetch(
        `${server.url}/api/cameras/imaging/activate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'cam', screenId: 'left' }),
        },
      );
      assert.equal(activation.status, 200);
      assert.deepEqual(await activation.json(), {
        imaging: {
          state: 'ready',
          screenId: 'left',
          active: true,
        },
      });
      assert.deepEqual(activateImaging.mock.calls[0], ['cam', 'left']);
    } finally {
      activateImaging.mockRestore();
    }
    assert.equal(
      (
        await fetch(`${server.url}/api/arm/stop`, {
          method: 'POST',
          headers: { Origin: 'https://other.example' },
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(`${server.url}/api/arm/disconnect`, { method: 'POST' }))
        .status,
      200,
    );
    assert.equal((await connect()).status, 200);
    assert.equal(attempts, 3);
  } finally {
    await Promise.all([server.close(), server.close()]);
    discover.mockRestore();
    rstest.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
  await assert.rejects(fetch(server.url));
});

test('auto discovery starts once, exposes failure, and retries with the discovered controller', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'playground-discovery-'));
  rstest.stubEnv('MIDSCENE_ARM_DATA_DIR', directory);
  const cameras = rstest
    .spyOn(PlaygroundDevices.prototype, 'startAll')
    .mockResolvedValue();
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  let probes = 0;
  const hosts = [];
  let server;
  try {
    server = await startArmPlayground({
      connection: { adapter: 'test-arm', options: {} },
      discoverHost: async () => {
        if (++probes === 1) {
          await waiting;
          throw new Error('No controller found');
        }
        return '192.168.2.6';
      },
      createAdapter(host) {
        hosts.push(host);
        return createFakeAdapter();
      },
    });
    const read = async (route) => (await fetch(server.url + route)).json();
    assert.equal((await read('/api/arm')).phase, 'connecting');
    release();
    const { setup } = await read('/api/setup');
    assert.equal(setup.error, 'No controller found');
    assert.deepEqual(hosts, []);
    const retry = await fetch(`${server.url}/api/setup/reconnect`, {
      method: 'POST',
      body: JSON.stringify({ session: setup.session }),
    });
    assert.equal(retry.status, 200);
    const arm = await read('/api/arm');
    assert.equal(arm.phase, 'connected');
    assert.equal(arm.host, '192.168.2.6');
    assert.deepEqual(hosts, ['192.168.2.6']);
    assert.equal(probes, 2);
  } finally {
    release();
    await server?.close();
    cameras.mockRestore();
    rstest.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});
