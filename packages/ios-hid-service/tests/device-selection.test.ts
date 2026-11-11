import assert from 'node:assert/strict';
import type { IOSHIDDeviceOptions, ScreenOptions } from '@midscene/ios-hid';
import { IOSHIDDevice } from '@midscene/ios-hid';
import { rstest, test } from '@rstest/core';
import { DeviceConnection } from '../dist/device-connection.js';

const cases: [
  ScreenOptions['source'],
  { deviceId?: string; cameraId?: string },
  ScreenOptions,
][] = [
  [
    'usb',
    { deviceId: 'usb-second' },
    { source: 'usb', deviceId: 'usb-second' },
  ],
  [
    'camera',
    { cameraId: 'camera-second' },
    { source: 'camera', cameraId: 'camera-second' },
  ],
  ['airplay', {}, { source: 'airplay' }],
];
for (const [source, input, expected] of cases) {
  test(`passes the selected ${source} device to the SDK`, async () => {
    let options!: IOSHIDDeviceOptions;
    rstest
      .spyOn(IOSHIDDevice.prototype, 'connect')
      .mockImplementation(async function (this: IOSHIDDevice) {
        // biome-ignore lint/complexity/useLiteralKeys: Bracket access preserves type checking for non-public test hooks.
        options = this['options'];
      });
    rstest
      .spyOn(IOSHIDDevice.prototype, 'destroy')
      .mockImplementation(async () => {});
    const manager = new DeviceConnection();
    await manager.connect({
      source,
      name: 'Selected phone',
      reuseConfiguration: false,
      bluetoothPeerId: 'single-connected-peer',
      ...input,
    });
    assert.equal(options.bluetoothPeerId, 'single-connected-peer');
    assert.equal(options.reuseConfiguration, false);
    assert.deepEqual(options.screen, expected);
    await assert.rejects(manager.connect({ source, ...input }), /Disconnect/);
    await manager.destroySession();
  });
}

test('does not silently choose hardware when selection is missing', async () => {
  const connect = rstest
    .spyOn(IOSHIDDevice.prototype, 'connect')
    .mockImplementation(async () => {});
  const manager = new DeviceConnection();
  for (const source of ['usb', 'camera', 'airplay']) {
    await assert.rejects(manager.connect({ source }), /请选择/);
  }
  assert.equal(connect.mock.calls.length, 0);
});
