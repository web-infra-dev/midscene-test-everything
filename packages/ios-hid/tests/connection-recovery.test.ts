import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { onTestFinished, test } from '@rstest/core';
import { IOSHIDDevice } from '../dist/device.js';
import { ConnectionManager } from '../dist/host/connections.js';
import type { DeviceConfig } from '../dist/types.js';

test('Device recovery replaces its lease, retains identity and supports retry without replaying actions', async () => {
  let lease = 0;
  let fail = false;
  let restores = 0;
  const actions: string[] = [];
  const closed: string[] = [];
  const ready = () => ({
    id: `lease-${lease}`,
    phase: 'ready',
    device: { id: 'saved-phone', name: 'Phone' },
  });
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/health') {
      res.end(JSON.stringify({ protocol: 1 }));
      return;
    }
    if (req.url === '/connections' && req.method === 'POST') lease++;
    if (req.url === '/devices/saved-phone/restore') {
      restores++;
      if (fail) {
        res.statusCode = 409;
        res.end(JSON.stringify({ error: 'Phone offline' }));
        return;
      }
      lease++;
    }
    if (req.method === 'DELETE') closed.push(req.url!);
    if (req.url?.endsWith('/actions')) actions.push(req.url);
    res.end(JSON.stringify(ready()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const device = new IOSHIDDevice({
    host: { url: `http://127.0.0.1:${address.port}`, token: 'test' },
  });
  onTestFinished(async () => {
    await device.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await device.connect({ interactive: false });
  await device.execute({ type: 'tap', point: { x: 10, y: 10 } });
  fail = true;
  await assert.rejects(device.refreshConnection(), /Phone offline/);
  await assert.rejects(device.execute({ type: 'home' }), /Phone offline/);
  fail = false;
  const first = device.refreshConnection();
  assert.equal(
    device.refreshConnection(),
    first,
    'simultaneous refreshes share one operation',
  );
  await first;
  assert.equal(device.id, 'saved-phone');
  await device.execute({ type: 'home' });
  assert.equal(restores, 2);
  assert.deepEqual(actions, [
    '/connections/lease-1/actions',
    '/connections/lease-2/actions',
  ]);
  assert.deepEqual(closed, ['/connections/lease-1']);
});

test('Host recovery reuses the exact camera binding without opening setup and fails for incomplete configuration', async () => {
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
    'http://localhost',
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
  saved.bluetoothPeerId = undefined;
  const incomplete = manager.begin({ id: saved.id }, true);
  await manager.get(incomplete.id).opening;
  assert.equal(manager.get(incomplete.id).state.phase, 'failed');
  assert.equal(manager.get(incomplete.id).setup, undefined);
  assert.equal(opened.length, 1);
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
    'http://localhost',
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
