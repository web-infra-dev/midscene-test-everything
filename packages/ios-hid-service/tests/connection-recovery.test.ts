import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { onTestFinished, test } from '@rstest/core';
import { ConnectionManager } from '../dist/hardware/runtime/connections.js';
import type { DeviceConfig } from '../dist/hardware/types.js';

test('Service recovery reuses the exact camera binding without opening setup and fails for incomplete configuration', async () => {
  const saved: DeviceConfig = {
    id: 'saved-camera',
    name: 'Phone',
    bluetoothPeerId: 'bt-phone',
    screen: { source: 'camera', cameraId: 'camera' },
    camera: { cameraId: 'camera' } as NonNullable<DeviceConfig['camera']>,
  };
  const opened: DeviceConfig[] = [];
  const manager = new ConnectionManager(
    {
      input: {
        subscribe: () => () => {},
        listPeers: async () => [
          { id: 'bt-phone', name: 'Bluetooth phone', reports: [1, 2, 3] },
        ],
      },
      open: async (config: DeviceConfig) => {
        opened.push(structuredClone(config));
        return { close: async () => {} };
      },
    } as unknown as ConstructorParameters<typeof ConnectionManager>[0],
    {
      resolve: () => structuredClone(saved),
      save: async () => {},
    } as unknown as ConstructorParameters<typeof ConnectionManager>[1],
  );
  const initial = manager.begin({ id: saved.id }, true);
  await manager.get(initial.id).opening;
  assert.equal(manager.get(initial.id).state.phase, 'ready');
  assert.equal(manager.get(initial.id).setup, undefined);
  assert.equal(opened[0].name, 'Bluetooth phone');
  assert.equal(manager.get(initial.id).state.device?.name, 'Bluetooth phone');
  assert.deepEqual(opened, [
    { ...saved, name: 'Bluetooth phone', modelName: undefined },
  ]);
  await manager.close(manager.get(initial.id));
  const reconnect = manager.begin({ id: saved.id });
  await manager.get(reconnect.id).opening;
  assert.equal(manager.get(reconnect.id).state.phase, 'ready');
  assert.equal(manager.get(reconnect.id).setup, undefined);
  await manager.close(manager.get(reconnect.id));
  saved.bluetoothPeerId = undefined;
  const incomplete = manager.begin({ id: saved.id }, true);
  await manager.get(incomplete.id).opening;
  assert.equal(manager.get(incomplete.id).state.phase, 'failed');
  assert.equal(manager.get(incomplete.id).setup, undefined);
  assert.equal(opened.length, 2);
});

test('AirPlay recovery automatically resumes the saved binding when mirroring returns', async () => {
  const saved: DeviceConfig = {
    id: 'saved-airplay',
    name: 'Phone',
    bluetoothPeerId: 'bt',
    screen: { source: 'airplay' },
  };
  let verified = false;
  let opened = 0;
  let mirroring = false;
  let notify = () => {};
  const preview = {
    getSetupInfo: () => ({
      name: 'Receiver',
      pin: '1234',
      state: mirroring ? 'streaming' : 'waiting',
    }),
    subscribeSetup: (listener: () => void) => {
      notify = listener;
      return () => {
        notify = () => {};
      };
    },
    getFrame: async () => ({ jpeg: Buffer.from('jpeg'), width: 8, height: 16 }),
    close: async () => {},
  };
  const manager = new ConnectionManager(
    {
      input: {
        subscribe: () => () => {},
        listPeers: async () => [
          { id: 'bt', name: 'Bluetooth phone', reports: [1, 2, 3] },
        ],
      },
      openScreen: async () => {
        opened++;
        return preview;
      },
      open: async (config: DeviceConfig, screen: unknown) => {
        assert.equal(config.id, saved.id);
        assert.equal(screen, preview);
        verified = true;
        return { close: async () => {} };
      },
    } as unknown as ConstructorParameters<typeof ConnectionManager>[0],
    {
      resolve: () => structuredClone(saved),
      save: async () => {},
    } as unknown as ConstructorParameters<typeof ConnectionManager>[1],
  );
  const initial = manager.begin({ id: saved.id }, true);
  const connection = manager.get(initial.id);
  assert.equal(connection.state.phase, 'setup-required');
  assert.ok(connection.setup);
  assert.equal(verified, false, 'no pointer verification before mirroring');
  const server = createServer((req, res) => {
    void connection.setup!.handle(req, res, req.url!).catch((error: Error) => {
      res.writeHead(400).end(JSON.stringify({ error: error.message }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  onTestFinished(async () => {
    await manager.close(connection);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const post = (path: string, body: unknown) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Midscene-Setup': connection.setup!.id,
      },
      body: JSON.stringify(body),
    });
  assert.equal((await post('/select', {})).status, 200);
  assert.equal(verified, false);
  mirroring = true;
  notify();
  await connection.opening;
  assert.equal(connection.state.phase, 'ready');
  assert.equal(verified, true);
  assert.equal(opened, 1, 'automatic recovery transfers the same receiver');
});
