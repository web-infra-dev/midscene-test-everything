import assert from 'node:assert/strict';
import type { ConnectionState } from '@midscene/ios-hid';
import { IOSHIDDevice } from '@midscene/ios-hid';
import { rstest, test } from '@rstest/core';
import { IOSHIDSessionManager } from '../dist/platform.js';

test('connection callbacks publish setup, ready, failure and teardown without state polling', async () => {
  let update!: (state: ConnectionState) => void;
  let finish!: () => void;
  rstest
    .spyOn(IOSHIDDevice.prototype, 'connect')
    .mockImplementation(async (options) => {
      assert.ok(options?.onState);
      update = options.onState;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
  rstest
    .spyOn(IOSHIDDevice.prototype, 'destroy')
    .mockImplementation(async () => {});
  const manager = new IOSHIDSessionManager();
  const snapshots: ReturnType<IOSHIDSessionManager['getSnapshot']>[] = [];
  const unsubscribe = manager.onStateChange(() =>
    snapshots.push(manager.getSnapshot()),
  );
  const connecting = manager.createSession({
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
    setupUrl: 'http://127.0.0.1:1234/setup/camera-session',
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

test('recovery retains the Agent and waits for a fresh frame; failure can be retried', async () => {
  const ready: ConnectionState = {
    id: 'lease',
    phase: 'ready',
    device: { id: 'phone', name: 'iPhone' },
  };
  rstest
    .spyOn(IOSHIDDevice.prototype, 'connect')
    .mockImplementation(async (options) => {
      options?.onState?.(ready);
    });
  const destroy = rstest
    .spyOn(IOSHIDDevice.prototype, 'destroy')
    .mockImplementation(async () => {});
  let finishFrame!: (value: string) => void;
  const screenshot = rstest
    .spyOn(IOSHIDDevice.prototype, 'screenshotBase64')
    .mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishFrame = resolve;
        }),
    );
  rstest
    .spyOn(IOSHIDDevice.prototype, 'getConnectionState')
    .mockImplementation(async () => ready);
  rstest
    .spyOn(IOSHIDDevice.prototype, 'refreshConnection')
    .mockImplementation(async (options) => {
      options?.onState?.(ready);
    });
  const manager = new IOSHIDSessionManager();
  const session = await manager.createSession({
    source: 'usb',
    deviceId: 'usb',
    bluetoothPeerId: 'bt',
  });
  const agent = session.agentFactory();
  manager.updateBluetoothStatus([]);
  const recovery = manager.refreshDevice();
  assert.equal(manager.refreshDevice(), recovery);
  // Allow the input lease to become ready, while the new frame remains pending.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(manager.getSnapshot().refreshing, true);
  assert.equal(manager.getConnectionState()!.phase, 'connecting');
  finishFrame('image');
  await recovery;
  assert.equal(manager.getConnectionState()!.phase, 'ready');
  assert.equal(manager.getSnapshot().refreshing, false);
  assert.equal(destroy.mock.calls.length, 0);
  screenshot.mockRejectedValueOnce(new Error('Camera unavailable'));
  await assert.rejects(manager.refreshDevice(), /Camera unavailable/);
  assert.equal(manager.getConnectionState()!.phase, 'failed');
  screenshot.mockResolvedValue('image');
  await manager.refreshDevice();
  assert.equal(manager.getConnectionState()!.phase, 'ready');
  assert.ok(agent, 'original Agent survives both recovery attempts');
  await manager.destroySession();
  assert.equal(destroy.mock.calls.length, 1);
});
