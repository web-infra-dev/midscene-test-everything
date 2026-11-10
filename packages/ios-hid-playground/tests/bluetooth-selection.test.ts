import assert from 'node:assert/strict';
import { test } from '@rstest/core';
import {
  bluetoothLabel,
  resolveBluetoothSelection,
} from '../src/ui/bluetooth-selection.js';

const hosts = [
  { id: 'phone-a', name: '测试机', address: '20:0E:2B:12:3E:5B' },
  { id: 'phone-b', name: '个人手机', address: '90:2C:09:D5:6A:BC' },
];
test('auto-selects only a sole available phone; multiple phones need a selection', () => {
  assert.equal(resolveBluetoothSelection(undefined, hosts, []), undefined);
  assert.equal(
    resolveBluetoothSelection(undefined, hosts, ['phone-a']),
    'phone-b',
  );
  assert.equal(resolveBluetoothSelection(undefined, [hosts[0]], []), 'phone-a');
  assert.equal(resolveBluetoothSelection(undefined, [], []), undefined);
});
test('keeps an explicit selection through snapshots, renaming and reconnects', () => {
  const preferred = 'phone-a';
  assert.equal(resolveBluetoothSelection(preferred, hosts, []), preferred);
  assert.equal(resolveBluetoothSelection(preferred, [hosts[1]], []), undefined);
  assert.equal(
    resolveBluetoothSelection(preferred, [hosts[0]], ['phone-a']),
    undefined,
  );
  assert.equal(
    resolveBluetoothSelection(
      preferred,
      hosts.map((p) => ({ ...p, name: '新名称' })),
      [],
    ),
    preferred,
  );
});
test('shows names directly and disambiguates duplicate names with address suffixes', () => {
  assert.equal(bluetoothLabel(hosts[0], hosts), '测试机');
  const duplicate = { ...hosts[1], name: hosts[0].name };
  assert.equal(
    bluetoothLabel(hosts[0], [hosts[0], duplicate]),
    '测试机 · 3E:5B',
  );
  assert.equal(
    bluetoothLabel(duplicate, [hosts[0], duplicate]),
    '测试机 · 6A:BC',
  );
});
