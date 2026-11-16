import assert from 'node:assert/strict';
import { rstest, test } from '@rstest/core';
import { DeviceConnection } from '../dist/device-connection.js';
import { LocalDevice } from '../dist/hardware/runtime/local-device.js';
import type { ConnectionState } from '../dist/hardware/types.js';

test('connection callbacks publish setup, ready, failure and teardown without state polling', async () => {
  let update!: (state: ConnectionState) => void;
  let finish!: () => void;
  rstest
    .spyOn(LocalDevice.prototype, 'connect')
    .mockImplementation(async (options) => {
      assert.ok(options?.onState);
      update = options.onState;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
  rstest
    .spyOn(LocalDevice.prototype, 'destroy')
    .mockImplementation(async () => {});
  const manager = new DeviceConnection(
    {} as ConstructorParameters<typeof DeviceConnection>[0],
  );
  const snapshots: ReturnType<DeviceConnection['getSnapshot']>[] = [];
  const unsubscribe = manager.onStateChange(() =>
    snapshots.push(manager.getSnapshot()),
  );
  const connecting = manager.connect({
    source: 'camera',
    cameraId: 'camera',
    bluetoothPeerId: 'phone',
  });
  update({ id: 'lease', phase: 'connecting' });
  assert.equal(snapshots.at(-1)!.state!.phase, 'connecting');
  update({
    id: 'lease',
    phase: 'setup-required',
    setupKind: 'camera',
    setupId: 'camera-session',
  });
  assert.equal(snapshots.at(-1)!.state!.setupKind, 'camera');
  assert.equal(snapshots.at(-1)!.state!.setupId, 'camera-session');
  assert.equal(Reflect.get(snapshots.at(-1)!.state!, 'setupUrl'), undefined);
  update({
    id: 'lease',
    phase: 'ready',
    device: { id: 'phone', name: 'iPhone' },
  });
  assert.equal(snapshots.at(-1)!.state!.phase, 'ready');
  finish();
  await connecting;
  manager.updateBluetoothStatus([]);
  assert.equal(snapshots.at(-1)!.state!.phase, 'failed');
  await manager.destroySession();
  assert.equal(snapshots.at(-1)!.state, undefined);
  const count = snapshots.length;
  unsubscribe();
  await manager.destroySession();
  assert.equal(
    snapshots.length,
    count,
    'removed listeners receive no further updates',
  );
});

test('recovery waits for a fresh frame; failure can be retried', async () => {
  const ready: ConnectionState = {
    id: 'lease',
    phase: 'ready',
    device: { id: 'phone', name: 'iPhone' },
  };
  rstest
    .spyOn(LocalDevice.prototype, 'connect')
    .mockImplementation(async (options) => {
      options?.onState?.(ready);
    });
  const destroy = rstest
    .spyOn(LocalDevice.prototype, 'destroy')
    .mockImplementation(async () => {});
  const frame = {
    jpeg: Buffer.alloc(1),
    width: 1,
    height: 1,
    sequence: 1,
    receivedAt: 1,
  };
  let finishFrame!: (value: typeof frame) => void;
  const screenshot = rstest
    .spyOn(LocalDevice.prototype, 'screenshot')
    .mockImplementation(
      () =>
        new Promise<typeof frame>((resolve) => {
          finishFrame = resolve;
        }),
    );
  rstest
    .spyOn(LocalDevice.prototype, 'getConnectionState')
    .mockImplementation(async () => ready);
  rstest
    .spyOn(LocalDevice.prototype, 'refreshConnection')
    .mockImplementation(async (options) => {
      options?.onState?.(ready);
    });
  const manager = new DeviceConnection(
    {} as ConstructorParameters<typeof DeviceConnection>[0],
  );
  await manager.connect({
    source: 'usb',
    deviceId: 'usb',
    bluetoothPeerId: 'bt',
  });
  manager.updateBluetoothStatus([]);
  const recovery = manager.refreshDevice();
  assert.equal(manager.refreshDevice(), recovery);
  // Allow the input lease to become ready, while the new frame remains pending.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(manager.getSnapshot().refreshing, true);
  assert.equal(manager.getConnectionState()!.phase, 'connecting');
  finishFrame(frame);
  await recovery;
  assert.equal(manager.getConnectionState()!.phase, 'ready');
  assert.equal(manager.getSnapshot().refreshing, false);
  assert.equal(destroy.mock.calls.length, 0);
  screenshot.mockRejectedValue(new Error('Camera unavailable'));
  await assert.rejects(manager.refreshDevice(), /Camera unavailable/);
  assert.equal(manager.getConnectionState()!.phase, 'failed');
  screenshot.mockResolvedValue(frame);
  await manager.refreshDevice();
  assert.equal(manager.getConnectionState()!.phase, 'ready');
  await manager.destroySession();
  assert.equal(destroy.mock.calls.length, 1);
});
