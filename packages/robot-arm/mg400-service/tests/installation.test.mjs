import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rstest, test } from '@rstest/core';
test('A configured endpoint uses the startup endpoint and exposes no browser network configuration', async () => {
  const { startArmPlayground } = await import('../src/server/index.ts');
  const directory = await mkdtemp(join(tmpdir(), 'playground-mg400-'));
  rstest.stubEnv('MIDSCENE_ARM_DATA_DIR', directory);
  let server;
  try {
    server = await startArmPlayground({
      port: 0,
      connection: { adapter: 'test-arm', options: { host: '127.0.0.1' } },
      createAdapter() {
        throw new Error('Adapter created before connect');
      },
    });
    const { setup } = await (await fetch(`${server.url}/api/setup`)).json();
    assert.equal(setup.connection.options.host, '127.0.0.1');
    for (const [route, method] of [
      ['network-ports', 'GET'],
      ['network-prepare', 'POST'],
      ['network-check', 'POST'],
      ['connection', 'POST'],
    ]) {
      const response = await fetch(`${server.url}/api/setup/${route}`, {
        method,
      });
      assert.equal(response.status, 404, route);
    }
  } finally {
    await server?.close();
    rstest.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});

test('reopens the prior installation profile on reconnect and isolates a changed controller', async () => {
  const { InstallationRegistry } = await import(
    '@midscene/arm-kit/internal/server/installation-registry'
  );
  const { fixture } = await import(
    '@midscene/arm-kit/internal/testkit/fixtures'
  );
  const { CodeSetup } = await import('../src/server/code-setup.ts');
  const directory = await mkdtemp(join(tmpdir(), 'playground-profile-'));
  rstest.stubEnv('MIDSCENE_ARM_DATA_DIR', directory);
  try {
    const registry = new InstallationRegistry(process.cwd());
    await registry.load();
    const options = {
      host: '192.168.1.6',
      dashboardPort: 29999,
      motionPort: 30003,
      feedbackPort: 30004,
    };
    const prior = await registry.used({
      adapter: 'mg400',
      adapterOptions: options,
      installationId: 'existing-device',
    });
    await mkdir(join(directory, prior.stateDirectory), { recursive: true });
    const previous = await fixture();
    try {
      await copyFile(
        previous.store.filePath,
        join(directory, prior.stateDirectory, 'profiles.json'),
      );
    } finally {
      await previous.cleanup();
    }
    async function open(host) {
      let result;
      const setup = new CodeSetup(
        {
          getArm: () => undefined,
          replace: async (_, store, id) => {
            await store.load();
            result = {
              id,
              calibrations: store
                .list()
                .calibrations.map((record) => record.id),
            };
          },
        },
        () => ({ id: 'dobot-mg400', connectionIdentity: host }),
        undefined,
        { adapter: 'mg400', options: { ...options, host } },
      );
      await setup.initialize();
      await setup.reconnect({ session: setup.session });
      return result;
    }
    assert.deepEqual(await open(options.host), {
      id: 'existing-device',
      calibrations: ['calibration'],
    });
    const other = await open('192.168.1.7');
    assert.notEqual(other.id, 'existing-device');
    assert.deepEqual(other.calibrations, []);
    assert.equal((await open('192.168.1.7')).id, other.id);
  } finally {
    rstest.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});
