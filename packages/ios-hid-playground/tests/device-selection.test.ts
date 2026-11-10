import assert from 'node:assert/strict';
import type { IOSHIDDeviceOptions, ScreenOptions } from '@midscene/ios-hid';
import { IOSHIDDevice } from '@midscene/ios-hid';
import { rstest, test } from '@rstest/core';
import { IOSHIDSessionManager } from '../dist/platform.js';

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
    const manager = new IOSHIDSessionManager();
    await manager.createSession({
      source,
      name: 'Selected phone',
      bluetoothPeerId: 'single-connected-peer',
      ...input,
    });
    assert.equal(options.bluetoothPeerId, 'single-connected-peer');
    assert.deepEqual(options.screen, expected);
    await assert.rejects(
      manager.createSession({ source, ...input }),
      /Disconnect/,
    );
    await manager.destroySession();
  });
}

test('does not silently choose hardware when selection is missing', async () => {
  const connect = rstest
    .spyOn(IOSHIDDevice.prototype, 'connect')
    .mockImplementation(async () => {});
  const manager = new IOSHIDSessionManager();
  for (const source of ['usb', 'camera']) {
    await assert.rejects(manager.createSession({ source }), /请选择/);
  }
  assert.equal(connect.mock.calls.length, 0);
});
