import assert from 'node:assert/strict';
import { test } from '@rstest/core';
import { DeviceSession } from '../dist/runtime/device-session.js';
test('missing pictures prevent keyboard input as well as pointer actions', async () => {
  let sent = 0;
  let released = 0;
  const device = new DeviceSession(
    { id: 'phone', name: 'Phone', screen: { source: 'usb' } },
    {
      getFrame: async () => {
        throw Error('no picture');
      },
      close: async () => {},
    },
    {
      execute: async () => {
        sent++;
      },
      releaseAll: async () => {
        released++;
      },
    } as unknown as ConstructorParameters<typeof DeviceSession>[2],
    () => {},
  );
  await assert.rejects(
    device.execute({ type: 'key', key: 'Enter' }),
    /no picture/,
  );
  assert.equal(sent, 0);
  assert.equal(released, 1);
});
