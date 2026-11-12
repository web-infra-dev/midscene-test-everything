import { describe, expect, it } from '@rstest/core';
import {
  assertSafeObservation,
  screenPlaneHeight,
} from '../src/calibration/verification/safe-position.js';
import type {
  CalibrationCommand,
  CalibrationSession,
} from '../src/contracts.js';
import { fixture, pose } from './fixtures.js';

const command = (
  session: CalibrationSession,
  type: CalibrationCommand['type'],
  accepted?: boolean,
): CalibrationCommand => ({
  commandId: crypto.randomUUID(),
  expectedRevision: session.revision,
  type,
  accepted,
});
async function observation(f: Awaited<ReturnType<typeof fixture>>) {
  return f.runtime.startCalibration(f.binding, f.calibration.id);
}
describe('pending calibration safe return', () => {
  it('requires explicit confirmation and leaves the pending calibration unaccepted', async () => {
    const f = await fixture();
    try {
      const session = await observation(f);
      await expect(
        f.runtime.calibrationCommand(
          session.id,
          command(session, 'return-observation'),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_STAGE' });
      expect(f.adapter.movements).toHaveLength(0);
      expect(f.runtime.getSession(session.id).candidate?.acceptanceStatus).toBe(
        'pending',
      );
    } finally {
      await f.cleanup();
    }
  });
  it('lifts off the screen before traversing to the saved pose and does not verify hover or contact', async () => {
    const f = await fixture();
    try {
      const session = await observation(f);
      f.adapter.setPoseForTesting(pose(40, -20, 30));
      const result = await f.runtime.calibrationCommand(
        session.id,
        command(session, 'return-observation', true),
      );
      expect(f.adapter.movements).toHaveLength(2);
      expect(f.adapter.movements[0].positionMm).toEqual({
        x: 40,
        y: -20,
        z: 50,
      });
      expect(f.adapter.movements[1]).toEqual(
        session.candidate!.observationPose,
      );
      expect(result.stage).toBe('verification');
      expect(result.candidate?.acceptanceStatus).toBe('pending');
      expect(result.boundary?.hoverHuman).toBe(false);
      expect(result.candidate?.verification).toBeUndefined();
    } finally {
      await f.cleanup();
    }
  });
  it('rejects a saved pose with insufficient clearance before submitting any motion', async () => {
    const f = await fixture();
    try {
      await f.store.saveCalibration({
        ...f.calibration,
        observationPose: pose(100, -50, 35),
      });
      const session = await observation(f);
      await expect(
        f.runtime.calibrationCommand(
          session.id,
          command(session, 'return-observation', true),
        ),
      ).rejects.toMatchObject({ code: 'UNSAFE_OBSERVATION' });
      expect(f.adapter.movements).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  });
  it('rejects lifting a low pose outside the screen contact envelope', async () => {
    const f = await fixture();
    try {
      const session = await observation(f);
      f.adapter.setPoseForTesting(pose(250, -50, 30));
      await expect(
        f.runtime.calibrationCommand(
          session.id,
          command(session, 'return-observation', true),
        ),
      ).rejects.toMatchObject({ code: 'UNSAFE_RECOVERY' });
      expect(f.adapter.movements).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  });
  it('measures clearance at the tool tip and rejects a degenerate return direction', () => {
    const geometry = {
      plane: { normal: { x: 0, y: 0, z: -1 }, offset: -30 },
      inward: { x: 0, y: 0, z: -1 },
    };
    expect(
      screenPlaneHeight(geometry, pose(0, 0, 70), { x: 0, y: 0, z: -30 }),
    ).toBe(-10);
    expect(() =>
      assertSafeObservation(
        geometry,
        pose(0, 0, 70),
        { x: 0, y: 0, z: -30 },
        20,
      ),
    ).toThrow();
    expect(() =>
      screenPlaneHeight({ ...geometry, inward: { x: 1, y: 0, z: 0 } }, pose(), {
        x: 0,
        y: 0,
        z: 0,
      }),
    ).toThrow();
  });
});
