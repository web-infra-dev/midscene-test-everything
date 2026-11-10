import assert from 'node:assert/strict';
import { afterAll, test } from '@rstest/core';
import { useConnection } from '../src/ui/connection';

const originalFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = originalFetch;
});
const response = (value) => ({ ok: true, json: async () => value });

test('concurrent status readers share one request and receive the runtime snapshot', async () => {
  let finish;
  let calls = 0;
  globalThis.fetch = () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const first = useConnection.getState().check();
  const second = useConnection.getState().check();
  assert.equal(calls, 1);
  const runtime = { state: { connected: true, enabled: false } };
  finish(response({ phase: 'connected', runtime, setupSession: 'one' }));
  await Promise.all([first, second]);
  assert.deepEqual(useConnection.getState().runtime, runtime);
  assert.equal(useConnection.getState().setupSession, 'one');
});

test('a failed poll clears the old runtime and a later poll can recover', async () => {
  globalThis.fetch = async () => {
    throw new Error('Service unavailable');
  };
  await useConnection.getState().check();
  assert.equal(useConnection.getState().phase, 'error');
  assert.equal(useConnection.getState().runtime, undefined);
  globalThis.fetch = async () =>
    response({ phase: 'connected', runtime: { state: { connected: true } } });
  await useConnection.getState().check();
  assert.equal(useConnection.getState().phase, 'connected');
  assert.equal(useConnection.getState().error, undefined);
});

test('a status response started before disconnect cannot restore stale connected state', async () => {
  let finish;
  globalThis.fetch = async (url) =>
    url.endsWith('/disconnect')
      ? response({ phase: 'disconnected' })
      : new Promise((resolve) => {
          finish = resolve;
        });
  const pending = useConnection.getState().check();
  await useConnection.getState().disconnect();
  finish(
    response({ phase: 'connected', runtime: { state: { connected: true } } }),
  );
  await pending;
  assert.equal(useConnection.getState().phase, 'disconnected');
  assert.equal(useConnection.getState().runtime, undefined);
});

test('connecting state keeps polling until automatic camera startup completes', async () => {
  useConnection.setState({ phase: 'disconnected', controlPending: undefined });
  let calls = 0;
  globalThis.fetch = async () =>
    response({ phase: ++calls === 1 ? 'connecting' : 'connected' });
  await useConnection.getState().check();
  assert.equal(useConnection.getState().phase, 'connecting');
  await useConnection.getState().check();
  assert.equal(useConnection.getState().phase, 'connected');
  assert.equal(calls, 2);
});

test('polling during disconnect cannot start a read that later resurrects the old session', async () => {
  let finish;
  let reads = 0;
  globalThis.fetch = (url) => {
    if (url.endsWith('/disconnect'))
      return new Promise((resolve) => {
        finish = resolve;
      });
    reads++;
    return Promise.resolve(
      response({ phase: 'connected', setupSession: 'old' }),
    );
  };
  const disconnecting = useConnection.getState().disconnect();
  await useConnection.getState().check();
  finish(response({ phase: 'disconnected', setupSession: 'next' }));
  await disconnecting;
  assert.equal(reads, 0);
  assert.equal(useConnection.getState().setupSession, 'next');
  assert.equal(useConnection.getState().phase, 'disconnected');
});
