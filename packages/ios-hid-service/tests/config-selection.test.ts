import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from '@rstest/core';
import {
  DeviceConfigStore,
  DeviceSelectionRequired,
} from '../dist/hardware/config/store.js';
import type { DeviceConfig } from '../dist/hardware/types.js';
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

test('Bluetooth identity and source select independently of saved display names', () => {
  const store = new DeviceConfigStore();
  // biome-ignore lint/complexity/useLiteralKeys: Seed legacy records without hardware.
  store['devices'] = [
    { ...saved[0], name: '测试机' },
    {
      id: 'airplay',
      name: 'iPhone',
      bluetoothPeerId: 'bt-a',
      screen: { source: 'airplay' },
    },
  ];
  assert.equal(
    store.resolve({
      bluetoothPeerId: 'bt-a',
      screen: { source: 'usb', deviceId: 'usb-a' },
    }).id,
    'a',
  );
  assert.equal(
    store.resolve({ bluetoothPeerId: 'bt-a', screen: { source: 'airplay' } })
      .id,
    'airplay',
  );
  const camera = store.resolve({
    bluetoothPeerId: 'bt-a',
    screen: { source: 'camera', cameraId: 'cam' },
  });
  assert.notEqual(camera.id, 'a');
  assert.notEqual(camera.id, 'airplay');
});

test('repeat setup retains profile identity and discards saved calibration without mutating it', () => {
  const store = new DeviceConfigStore();
  const profile = {
    ...saved[1],
    pointerMotion: { version: 'old' },
  } as unknown as DeviceConfig;
  // biome-ignore lint/complexity/useLiteralKeys: Seed a calibrated profile without hardware.
  store['devices'] = [profile];
  const options = {
    bluetoothPeerId: 'bt-b',
    screen: { source: 'camera', cameraId: 'cam-b' },
  } as const;
  assert.deepEqual(store.resolve(options).camera, profile.camera);
  const reset = store.resolve({ ...options, reuseConfiguration: false });
  assert.equal(reset.id, profile.id);
  assert.equal(reset.bluetoothPeerId, 'bt-b');
  assert.equal(reset.camera, undefined);
  assert.equal(reset.pointerMotion, undefined);
  assert.deepEqual(store.resolve(options).camera, profile.camera);
});

test('legacy duplicates migrate to the last saved phone/source and saves replace that pair', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ios-config-'));
  try {
    const airplay: DeviceConfig = {
      id: 'airplay',
      name: 'iPhone',
      bluetoothPeerId: 'bt-a',
      screen: { source: 'airplay' },
    };
    const latest = { ...saved[0], id: 'latest', name: '测试机' };
    await writeFile(
      join(directory, 'devices.json'),
      JSON.stringify({
        version: 1,
        devices: [saved[0], saved[1], airplay, latest],
      }),
    );
    const store = new DeviceConfigStore(directory);
    await store.load();
    assert.deepEqual(store.list(), [saved[1], airplay, latest]);
    assert.equal(
      JSON.parse(await readFile(join(directory, 'devices.json'), 'utf8'))
        .devices.length,
      3,
    );
    const updated = { ...latest, name: 'Bluetooth phone' };
    await store.save(updated);
    await store.save(updated);
    const reloaded = new DeviceConfigStore(directory);
    await reloaded.load();
    assert.deepEqual(reloaded.list(), [saved[1], airplay, updated]);
    await reloaded.save({ ...updated, id: 'replacement' });
    assert.equal(reloaded.list().length, 3);
    assert.equal(
      reloaded.resolve({ bluetoothPeerId: 'bt-a', screen: { source: 'usb' } })
        .id,
      'replacement',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('changing source by profile ID preserves the previous source and resolves the new pair', () => {
  const store = new DeviceConfigStore();
  // biome-ignore lint/complexity/useLiteralKeys: Seed records without hardware.
  store['devices'] = saved;
  const airplay = store.resolve({ id: 'a', screen: { source: 'airplay' } });
  assert.notEqual(airplay.id, 'a');
  assert.equal(airplay.bluetoothPeerId, 'bt-a');
  assert.equal(store.resolve({ id: 'a' }).screen.source, 'usb');
});
