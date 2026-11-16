import assert from 'node:assert/strict';
import { rstest, test } from '@rstest/core';
import { DeviceConnection } from '../dist/device-connection.js';
import { LocalDevice } from '../dist/hardware/runtime/local-device.js';
test('screen health can fail and recover independently of Bluetooth state', async () => {
  let bad = false;
  rstest
    .spyOn(LocalDevice.prototype, 'connect')
    .mockImplementation(async (options) => {
      assert.ok(options?.onState);
      options.onState({
        id: 'lease',
        phase: 'ready',
        device: { id: 'phone', name: 'phone' },
      });
    });
  rstest
    .spyOn(LocalDevice.prototype, 'getConnectionState')
    .mockImplementation(async () => ({
      id: 'lease',
      phase: 'ready',
      device: { id: 'phone', name: 'phone' },
    }));
  rstest
    .spyOn(LocalDevice.prototype, 'screenshot')
    .mockImplementation(async () => {
      if (bad) throw Error('no frames');
      return {
        jpeg: Buffer.alloc(1),
        width: 1,
        height: 1,
        sequence: 1,
        receivedAt: 1,
      };
    });
  rstest
    .spyOn(LocalDevice.prototype, 'destroy')
    .mockImplementation(async () => {});
  const manager = new DeviceConnection(
    {} as ConstructorParameters<typeof DeviceConnection>[0],
  );
  await manager.connect({
    source: 'usb',
    deviceId: 'usb',
    bluetoothPeerId: 'bt',
  });
  assert.equal((await manager.refreshConnectionState())!.phase, 'ready');
  assert.equal(manager.getSnapshot().screenError, undefined);
  bad = true;
  // biome-ignore lint/complexity/useLiteralKeys: Bracket access preserves type checking for non-public test hooks.
  manager['lastScreenCheck'] = 0;
  await manager.refreshConnectionState();
  assert.equal(
    manager.getSnapshot().state!.phase,
    'ready',
    'Bluetooth state remains distinct from picture health',
  );
  assert.match(manager.getSnapshot().screenError!, /画面/);
  bad = false;
  // biome-ignore lint/complexity/useLiteralKeys: Bracket access preserves type checking for non-public test hooks.
  manager['lastScreenCheck'] = 0;
  await manager.refreshConnectionState();
  assert.equal(manager.getSnapshot().screenError, undefined);
  manager.updateBluetoothStatus([{ id: 'bt', reports: [1, 2, 3] }]);
  assert.equal(manager.getSnapshot().state!.phase, 'ready');
  manager.updateBluetoothStatus([]);
  assert.equal(
    manager.getSnapshot().state!.phase,
    'failed',
    'native unsubscribe immediately invalidates the cached workspace state',
  );
  await manager.destroySession();
});
