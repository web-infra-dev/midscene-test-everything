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
it('reuses the profile snapshot until a write commits', async () => {
  const store = new ProfileStore(
    path.join(tmpdir(), `midscene-profiles-${randomUUID()}.json`),
  );
  const first = store.list();
  expect(store.list()).toBe(first);
  await store.clearOperation();
  expect(store.list()).not.toBe(first);
});
