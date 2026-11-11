import assert from 'node:assert/strict';
import { IOSHIDDevice } from '@midscene/ios-hid';
import { rstest, test } from '@rstest/core';
import { DeviceConnection } from '../dist/device-connection.js';
test('screen health can fail and recover independently of Bluetooth state', async () => {
  let bad = false;
  rstest
    .spyOn(IOSHIDDevice.prototype, 'connect')
    .mockImplementation(async (options) => {
      assert.ok(options?.onState);
      options.onState({
        id: 'lease',
        phase: 'ready',
        device: { id: 'phone', name: 'phone' },
      });
    });
  rstest
    .spyOn(IOSHIDDevice.prototype, 'getConnectionState')
    .mockImplementation(async () => ({
      id: 'lease',
      phase: 'ready',
      device: { id: 'phone', name: 'phone' },
    }));
  rstest
    .spyOn(IOSHIDDevice.prototype, 'screenshotBase64')
    .mockImplementation(async () => {
      if (bad) throw Error('no frames');
      return 'data:image/jpeg;base64,AA==';
    });
  rstest
    .spyOn(IOSHIDDevice.prototype, 'destroy')
    .mockImplementation(async () => {});
  const manager = new DeviceConnection();
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
