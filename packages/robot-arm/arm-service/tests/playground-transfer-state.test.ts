import { afterEach, expect, it, rstest } from '@rstest/core';
import { createTransferStore } from '../src/ui/transfers';
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
const config = (id: string) => ({
  version: `version-${id}`,
  calibration: {
    id,
    toolProfileId: 'tool',
    observationPose: {
      frame: 'base',
      positionMm: { x: 1, y: 2, z: 3 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
  },
  routes: [],
});
afterEach(() => rstest.unstubAllGlobals());

it('ignores a delayed target load after switching devices', async () => {
  let finish!: (response: Response) => void;
  rstest.stubGlobal(
    'fetch',
    rstest.fn((url) =>
      String(url).includes('/b/')
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(
            json(config(String(url).includes('/c/') ? 'c' : 'a')),
          ),
    ),
  );
  const store = createTransferStore('a');
  await store.getState().load();
  const old = store.getState().select('b');
  await store.getState().select('c');
  finish(json(config('b')));
  await old;
  expect(store.getState().target?.calibration.id).toBe('c');
  expect(store.getState().targetId).toBe('c');
  expect(store.getState().confirmed).toBe(false);
  store.getState().dispose();
});

it('requires complete measured coordinates, sends both revision snapshots, and resets confirmation on edits', async () => {
  const post = rstest.fn();
  rstest.stubGlobal(
    'fetch',
    rstest.fn(async (url, options) => {
      if (options.method === 'POST') {
        post(JSON.parse(options.body));
        return json(config('a'));
      }
      return json(config(String(url).includes('/b/') ? 'b' : 'a'));
    }),
  );
  const store = createTransferStore('a');
  await store.getState().load();
  await store.getState().select('b');
  store.getState().add();
  store.getState().confirm(true);
  await store.getState().verify();
  expect(post).not.toHaveBeenCalled();
  expect(store.getState().error?.code).toBe('WAYPOINT_REQUIRED');
  for (const axis of ['x', 'y', 'z'] as const)
    store.getState().edit(0, axis, 100);
  expect(store.getState().confirmed).toBe(false);
  store.getState().confirm(true);
  await store.getState().verify();
  expect(post).toHaveBeenCalledWith({
    targetId: 'b',
    sourceVersion: 'version-a',
    targetVersion: 'version-b',
    confirmed: true,
    waypoints: [
      {
        ...config('a').calibration.observationPose,
        positionMm: { x: 100, y: 100, z: 100 },
      },
    ],
  });
  expect(store.getState().dirty).toBe(false);
  store.getState().dispose();
});

it('aborts in-flight verification when the editor closes', async () => {
  let signal!: AbortSignal;
  rstest.stubGlobal(
    'fetch',
    rstest.fn(async (url, options) => {
      if (options.method === 'POST')
        return new Promise<Response>((_resolve, reject) => {
          signal = options.signal;
          signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        });
      return json(config(String(url).includes('/b/') ? 'b' : 'a'));
    }),
  );
  const store = createTransferStore('a');
  await store.getState().load();
  await store.getState().select('b');
  store.getState().confirm(true);
  const verifying = store.getState().verify();
  store.getState().dispose();
  await verifying;
  expect(signal.aborted).toBe(true);
});
