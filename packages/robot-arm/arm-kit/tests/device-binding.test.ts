import { expect, it } from '@rstest/core';
import { ProfileStore } from '../src/runtime/profile-store.js';
import { fixture } from './fixtures.js';
it('preserves an accepted binding when a pending replacement is rejected, including after reload', async () => {
  const f = await fixture();
  try {
    const input = {
      ...f.store.list().workstation!,
      deviceId: 'phone-a',
      vision: f.store.list().workstation!.vision!,
      revision: 0,
    };
    const accepted = await f.store.acceptDeviceBinding(input);
    const pending = {
      ...f.calibration,
      id: 'pending',
      acceptanceStatus: 'pending' as const,
    };
    await f.store.saveCalibration(pending);
    await expect(
      f.store.acceptDeviceBinding({
        ...accepted,
        calibrationProfileId: pending.id,
      }),
    ).rejects.toMatchObject({ code: 'CALIBRATION_INVALID' });
    expect(f.store.deviceBinding('phone-a')).toEqual(accepted);
    const loaded = new ProfileStore(f.store.filePath);
    await loaded.load();
    expect(loaded.deviceBinding('phone-a')).toEqual(accepted);
  } finally {
    await f.cleanup();
  }
});
it('replaces only the chosen device and rejects stale concurrent acceptance', async () => {
  const f = await fixture();
  try {
    const input = {
      ...f.store.list().workstation!,
      vision: f.store.list().workstation!.vision!,
      revision: 0,
    };
    const a = await f.store.acceptDeviceBinding({ ...input, deviceId: 'a' });
    const b = await f.store.acceptDeviceBinding({ ...input, deviceId: 'b' });
    await f.store.saveCalibration({ ...f.calibration, id: 'new' });
    const replacement = await f.store.acceptDeviceBinding({
      ...a,
      calibrationProfileId: 'new',
    });
    expect(replacement.revision).toBe(a.revision + 1);
    expect(f.store.deviceBinding('b')).toEqual(b);
    await expect(
      f.store.acceptDeviceBinding({ ...a, calibrationProfileId: 'new' }),
    ).rejects.toMatchObject({ code: 'STALE_DEVICE' });
    expect(f.store.deviceBinding('a')).toEqual(replacement);
  } finally {
    await f.cleanup();
  }
});
