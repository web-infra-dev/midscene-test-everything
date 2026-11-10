import assert from 'node:assert/strict';
import { test } from '@rstest/core';
import {
  DeviceConfigStore,
  DeviceSelectionRequired,
} from '../dist/config/store.js';
import type { DeviceConfig } from '../dist/types.js';
const saved: DeviceConfig[] = [
  {
    id: 'a',
    name: 'iPhone',
    bluetoothPeerId: 'bt-a',
    screen: { source: 'usb', deviceId: 'usb-a' },
  },
  {
    id: 'b',
    name: 'iPhone',
    bluetoothPeerId: 'bt-b',
    screen: { source: 'camera', cameraId: 'cam-b' },
    camera: { cameraId: 'cam-b' } as NonNullable<DeviceConfig['camera']>,
  },
];
test('a new unnamed Bluetooth phone gets its own configuration', () => {
  const store = new DeviceConfigStore();
  // biome-ignore lint/complexity/useLiteralKeys: Bracket access preserves type checking for non-public test hooks.
  store['devices'] = saved;
  const result = store.resolve({
    bluetoothPeerId: 'bt-new',
    screen: { source: 'usb', deviceId: 'usb-new' },
  });
  assert.notEqual(result.id, 'a');
  assert.notEqual(result.id, 'b');
  assert.equal(result.bluetoothPeerId, 'bt-new');
});
test('explicit physical bindings recover the matching saved profile', () => {
  const store = new DeviceConfigStore();
  // biome-ignore lint/complexity/useLiteralKeys: Bracket access preserves type checking for non-public test hooks.
  store['devices'] = saved;
  assert.equal(
    store.resolve({
      bluetoothPeerId: 'bt-a',
      screen: { source: 'usb', deviceId: 'usb-a' },
    }).id,
    'a',
  );
  assert.equal(
    store.resolve({ screen: { source: 'camera', cameraId: 'cam-b' } }).id,
    'b',
  );
});
test('ambiguous implicit selection still requires choosing a device', () => {
  const store = new DeviceConfigStore();
  // biome-ignore lint/complexity/useLiteralKeys: Bracket access preserves type checking for non-public test hooks.
  store['devices'] = saved;
  assert.throws(() => store.resolve({}), DeviceSelectionRequired);
  assert.equal(store.resolve({ id: 'a' }).id, 'a');
});
