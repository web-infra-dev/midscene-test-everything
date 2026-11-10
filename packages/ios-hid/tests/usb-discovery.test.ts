interface DiscoverySnapshot {
  pid: number;
  sequence: number;
  devices: { id: string; name: string; model: string }[];
}
import assert from 'node:assert/strict';
import { chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from '@rstest/core';
import { USBDiscoveryClient } from '../dist/native/usb-discovery.js';

test('refreshes share one helper, correlate replies, recover after exit and stop with the Host', async () => {
  const helper = fileURLToPath(
    new URL('./fixtures/usb-discovery.mjs', import.meta.url),
  );
  await chmod(helper, 0o755);
  let starts = 0;
  const client = new USBDiscoveryClient(async () => {
    starts++;
    return helper;
  });
  try {
    const results = (await Promise.all([
      client.list(),
      client.list(),
      client.list(),
    ])) as DiscoverySnapshot[];
    assert.equal(starts, 1, 'concurrent discovery starts only one process');
    assert.equal(new Set(results.map((item) => item.pid)).size, 1);
    assert.deepEqual(
      results.map((item) => item.sequence),
      [1, 2, 3],
      'out-of-order replies go to their original request',
    );
    assert.deepEqual(
      results.map((item) => item.devices.length),
      [1, 0, 1],
      'fresh empty results are not masked by cached devices',
    );
    // biome-ignore lint/complexity/useLiteralKeys: Bracket access preserves type checking for non-public test hooks.
    const exited = client['child']!;
    await assert.rejects(client.list(), /USB discovery exited/);
    assert.equal(exited.exitCode, 17);
    const recovered = (await client.list()) as DiscoverySnapshot;
    assert.equal(starts, 2);
    assert.notEqual(recovered.pid, results[0].pid);
    // biome-ignore lint/complexity/useLiteralKeys: Bracket access preserves type checking for non-public test hooks.
    const running = client['child']!;
    await client.close();
    assert.notEqual(
      running.exitCode,
      null,
      'close waits for helper termination',
    );
    await assert.rejects(client.list(), /closed/);
    assert.equal(starts, 2, 'closed clients never respawn');
  } finally {
    await client.close();
  }
});
