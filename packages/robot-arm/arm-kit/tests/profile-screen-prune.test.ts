import { expect, it } from '@rstest/core';
import type { CalibrationSession } from '../src/contracts.js';
import { fixture } from './fixtures.js';

/** A screen profile is created per calibration run, so deleting one must take
 * its calibrations and sessions with it instead of leaving them orphaned. */
it('deletes a screen profile together with its calibrations and sessions', async () => {
  const f = await fixture();
  try {
    const spare = await f.store.putScreen({
      ...f.screen,
      id: 'spare',
      name: 'Spare',
    });
    await f.store.saveCalibration({
      ...f.calibration,
      id: 'spare-calibration',
      screenProfileId: spare.id,
      screenGeometryRevision: spare.geometryRevision,
      screenRevision: spare.revision,
    });
    await f.store.saveSession({
      id: 'spare-session',
      screenProfileId: spare.id,
      status: 'completed',
    } as unknown as CalibrationSession);

    const removed = await f.store.deleteScreenProfile(spare.id);
    expect(removed).toEqual({ screens: 1, calibrations: 1, sessions: 1 });
    expect(f.store.list().screens.map((screen) => screen.id)).toEqual([
      f.screen.id,
    ]);
    expect(f.store.list().calibrations.map((entry) => entry.id)).toEqual([
      f.calibration.id,
    ]);
    expect(f.store.list().sessions ?? []).toEqual([]);
  } finally {
    await f.cleanup();
  }
});

it('refuses to delete a screen profile that is still bound', async () => {
  const f = await fixture();
  try {
    await expect(f.store.deleteScreenProfile(f.screen.id)).rejects.toThrow(
      'still bound',
    );
    expect(f.store.list().screens.map((screen) => screen.id)).toEqual([
      f.screen.id,
    ]);
  } finally {
    await f.cleanup();
  }
});

it('prunes only screen profiles that nothing references', async () => {
  const f = await fixture();
  try {
    await f.store.putScreen({ ...f.screen, id: 'spare', name: 'Spare' });
    const removed = await f.store.pruneUnreferencedScreens();
    expect(removed.screens).toBe(1);
    expect(f.store.list().screens.map((screen) => screen.id)).toEqual([
      f.screen.id,
    ]);
  } finally {
    await f.cleanup();
  }
});
