import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from '@rstest/core';
import { ProfileStore } from '../src/runtime/profile-store.js';

/**
 * Callers rebuild whole response trees from `list()` on every poll. Reusing the
 * snapshot is what keeps that off the event loop; it must still be replaced as
 * soon as a write commits.
 */
it('reuses an immutable profile snapshot until a write commits', async () => {
  const store = new ProfileStore(
    path.join(tmpdir(), `midscene-profiles-${randomUUID()}.json`),
  );
  const target = { id: 'screen', cameraId: 'camera', name: 'Screen' };
  await store.saveScreenTarget(target);
  const first = store.list();
  expect(() => first.screenTargets!.push(target)).toThrow(TypeError);
  expect(Reflect.set(first.screenTargets![0], 'name', 'Changed')).toBe(false);
  expect(store.list()).toBe(first);
  expect(store.list().screenTargets).toEqual([target]);
  await store.updateScreenTarget(target.id, { name: 'Renamed' });
  expect(store.list()).not.toBe(first);
  expect(store.list().screenTargets?.[0].name).toBe('Renamed');
});
