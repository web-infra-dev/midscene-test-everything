import assert from 'node:assert/strict';
import { test } from '@rstest/core';
import type { HIDStatus } from '../dist/hardware/native/client.js';
import type { Connection } from '../dist/hardware/runtime/connections.js';
import { ConnectionManager } from '../dist/hardware/runtime/connections.js';
function fixture() {
  let changed!: (status: HIDStatus) => void;
  let released = false;
  let closed = 0;
  const manager = new ConnectionManager(
    {
      input: {
        subscribe(listener: (status: HIDStatus) => void) {
          changed = listener;
          return () => {
            released = true;
          };
        },
      },
    } as unknown as ConstructorParameters<typeof ConnectionManager>[0],
    {} as ConstructorParameters<typeof ConnectionManager>[1],
  );
  const c = {
    state: { id: 'connection', phase: 'ready' },
    config: { bluetoothPeerId: 'phone' },
    lifetime: new AbortController(),
    session: {
      async close() {
        closed++;
      },
    },
  };
  // biome-ignore lint/complexity/useLiteralKeys: Bracket access preserves type checking for non-public test hooks.
  manager['entries'].set('connection', c as Connection);
  // biome-ignore lint/complexity/useLiteralKeys: Bracket access preserves type checking for non-public test hooks.
  manager['watchBluetooth']();
  return {
    manager,
    c,
    changed: (status: HIDStatus) => changed(status),
    closed: () => closed,
    released: () => released,
  };
}
test('Bluetooth disconnect invalidates a ready device and cancels its work', () => {
  const f = fixture();
  f.changed({ state: 'advertising', hosts: [] });
  assert.equal(f.c.state.phase, 'failed');
  assert.equal(f.c.lifetime.signal.aborted, true);
  assert.equal(f.closed(), 1);
  f.changed({ state: 'advertising', hosts: [] });
  assert.equal(f.closed(), 1);
});
test('a different phone connecting does not make the bound phone ready', () => {
  const f = fixture();
  f.changed({
    state: 'connected',
    hosts: [{ id: 'other', name: 'other', reports: [1, 2, 3] }],
  });
  assert.equal(f.c.state.phase, 'failed');
});
test('all required report subscriptions preserve readiness; partial subscriptions invalidate it', () => {
  const f = fixture();
  f.changed({
    state: 'connected',
    hosts: [{ id: 'phone', name: 'phone', reports: [1, 2, 3] }],
  });
  assert.equal(f.c.state.phase, 'ready');
  f.changed({
    state: 'connected',
    hosts: [{ id: 'phone', name: 'phone', reports: [1] }],
  });
  assert.equal(f.c.state.phase, 'failed');
});
