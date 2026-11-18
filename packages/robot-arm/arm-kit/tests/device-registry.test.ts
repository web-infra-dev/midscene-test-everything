import { expect, it, rstest } from '@rstest/core';
import { DeviceRegistry } from '../src/camera/device-registry.js';

it('can serve a stale camera list without probing the devices again', async () => {
  let now = 0;
  const listDevices = rstest.fn(async () => [
    { id: 'camera', name: 'Camera', backend: 'avfoundation' as const },
  ]);
  const registry = new DeviceRegistry(
    {
      listDevices,
      openStream: async () => {
        throw new Error('not used');
      },
    } as never,
    { ttlMs: 100, now: () => now },
  );
  await registry.list({ refresh: true });
  now = 10_000;

  // A connected workspace renders repeatedly; it must keep using the list it
  // already has instead of starting an ffmpeg probe next to the live capture.
  expect(await registry.listDevices({ cachedOnly: true })).toHaveLength(1);
  expect(listDevices).toHaveBeenCalledTimes(1);

  // An explicit refresh is still allowed to probe.
  await registry.listDevices({ refresh: true });
  expect(listDevices).toHaveBeenCalledTimes(2);
});

it('forwards hardware controls to the underlying camera backend', async () => {
  const control = { deviceId: 'camera' };
  const openHardwareControl = rstest.fn(async () => control);
  const registry = new DeviceRegistry({
    listDevices: async () => [],
    openStream: async () => {
      throw new Error('not used');
    },
    openHardwareControl,
  } as never);

  await expect(registry.openHardwareControl('camera')).resolves.toBe(control);
  expect(openHardwareControl).toHaveBeenCalledWith('camera');
});
