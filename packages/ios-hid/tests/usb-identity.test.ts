import assert from 'node:assert/strict';
import { test } from '@rstest/core';
import { enrichUSBDevices } from '../dist/screen/usb-identity.js';
const capture = (id: string, name: string) => ({
  id,
  name,
  model: 'iOS Device',
});
const identity = (id: string, name: string, productType: string) => ({
  id,
  name,
  productType,
});
test('formats ProductType as iPhone 13 while keeping the actual device name', () => {
  const [phone] = enrichUSBDevices(
    [capture('capture-a', '小明的 iPhone')],
    [identity('udid-a', '小明的 iPhone', 'iPhone14,5')],
  );
  assert.equal(phone.name, '小明的 iPhone');
  assert.equal(phone.modelName, 'iPhone 13');
});
test('multiple USB phones join by unique names, independent of discovery order', () => {
  const result = enrichUSBDevices(
    [capture('a', 'Alice'), capture('b', 'Bob')],
    [identity('b', 'Bob', 'iPhone15,5'), identity('a', 'Alice', 'iPhone14,5')],
  );
  assert.deepEqual(
    result.map((p) => p.modelName),
    ['iPhone 13', 'iPhone 15 Plus'],
  );
});
test('a capture UDID can disambiguate equal names', () => {
  const result = enrichUSBDevices(
    [
      capture('avfoundation:000081200000000000000001', 'iPhone'),
      capture('avfoundation:000081200000000000000002', 'iPhone'),
    ],
    [
      identity('00008120-0000000000000002', 'iPhone', 'iPhone15,5'),
      identity('00008120-0000000000000001', 'iPhone', 'iPhone14,5'),
    ],
  );
  assert.deepEqual(
    result.map((p) => p.modelName),
    ['iPhone 13', 'iPhone 15 Plus'],
  );
});
test('ambiguous equal names with different models never guess', () => {
  const result = enrichUSBDevices(
    [capture('a', 'iPhone'), capture('b', 'iPhone')],
    [
      identity('id-a', 'iPhone', 'iPhone14,5'),
      identity('id-b', 'iPhone', 'iPhone15,5'),
    ],
  );
  assert.ok(result.every((p) => p.modelName === undefined));
});
test('unknown models and unavailable metadata preserve usable capture discovery', () => {
  assert.equal(enrichUSBDevices([capture('a', 'Phone')], [])[0].name, 'Phone');
  assert.equal(
    enrichUSBDevices(
      [capture('a', 'Phone')],
      [identity('a', 'Phone', 'iPhone99,1')],
    )[0].modelName,
    undefined,
  );
});
