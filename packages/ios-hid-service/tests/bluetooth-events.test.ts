import assert from 'node:assert/strict';
import { chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from '@rstest/core';
import {
  type HIDStatus,
  NativeHIDClient,
} from '../dist/hardware/native/client.js';
test('initial snapshot, subscription changes and unsubscribe work without polling', async () => {
  const helper = fileURLToPath(
    new URL('./fixtures/hid-events.mjs', import.meta.url),
  );
  await chmod(helper, 0o755);
  const client = new NativeHIDClient(async () => helper);
  let resolveInitial!: (status: HIDStatus) => void;
  const initial = new Promise<HIDStatus>((resolve) => {
    resolveInitial = resolve;
  });
  const received: HIDStatus[] = [];
  const unsubscribe = client.subscribe((value) => {
    received.push(value);
    resolveInitial(value);
  });
  try {
    assert.deepEqual((await initial).hosts, []);
    const hosts = [
      { id: 'test-peer', name: '蓝牙设备 · test', reports: [1, 2, 3] },
    ];
    await client.request({ method: 'simulate', hosts });
    assert.deepEqual(received.at(-1)!.hosts, hosts);
    await client.request({ method: 'simulate', hosts: [] });
    assert.deepEqual(received.at(-1)!.hosts, []);
    unsubscribe();
    const count = received.length;
    await client.request({ method: 'simulate', hosts });
    assert.equal(received.length, count);
  } finally {
    unsubscribe();
    await client.close();
  }
});
