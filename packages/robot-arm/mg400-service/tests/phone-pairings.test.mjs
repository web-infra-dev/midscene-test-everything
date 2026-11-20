import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from '@rstest/core';
import { PhonePairings } from '../src/server/phone-pairings.ts';
import { screenConnectPage } from '../src/server/screen-connect-page.ts';

test('the Home Screen pairing entry requests edge-to-edge display on iOS', () => {
  const html = screenConnectPage();
  assert.match(html, /viewport-fit=cover/);
  assert.match(
    html,
    /name="apple-mobile-web-app-status-bar-style" content="black-translucent"/,
  );
});

test('camera pairing survives a new server instance and concurrent creation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'phone-pairings-'));
  try {
    const file = join(dir, 'pairings.json');
    const first = new PhonePairings(file);
    await first.load();
    const [a, b] = await Promise.all([
      first.token('phone-camera'),
      first.token('phone-camera'),
    ]);
    assert.equal(a, b);
    const other = await first.token('other-camera');
    assert.notEqual(other, a);
    const restarted = new PhonePairings(file);
    await restarted.load();
    assert.equal(await restarted.token('phone-camera'), a);
    assert.equal(restarted.camera(a), 'phone-camera');
    assert.equal(restarted.camera('invalid'), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
