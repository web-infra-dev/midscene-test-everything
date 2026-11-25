import { expect, it } from '@rstest/core';
import { type CartesianPose, RobotArmError } from '../src/contracts.js';
import { TestRobotAdapter } from '../src/testkit/test-adapter.js';
import { fixture, pose } from './fixtures.js';

it.each([false, true])(
  'restarts only the interrupted logo stroke (second timeout: %s)',
  async (failAgain) => {
    const adapter = new TestRobotAdapter({
      initialPose: pose(100, -50, 100),
      motionDurationMs: 5,
    });
    const starts: CartesianPose[] = [];
    adapter.driver.beginLinearSequence = async (targets) => {
      starts.push(targets[0].pose);
      const attempt = starts.length;
      const move = async (index: number) => {
        const { pose, options } = targets[index];
        const submittedAt = Date.now();
        const handle = await adapter.moveLinear(pose, options);
        await handle.wait({ timeoutMs: 1000 });
        return {
          id: `${attempt}-${index}`,
          submittedAt,
          acceptedAt: Date.now(),
        };
      };
      const finish = async () => ({
        status: 'completed' as const,
        completedAt: new Date().toISOString(),
        pose: await adapter.getPose(),
      });
      return {
        check() {},
        dispose() {},
        submit: move,
        submitQueued: async () => {
          if (attempt === 3 || (failAgain && attempt === 4))
            throw new RobotArmError('SEQUENCE_FAULT_STATE_STALE', 'stale', 409);
          return move(targets.length - 2);
        },
        waitForHandoff: async () => ({
          candidateReachedAt: Date.now(),
          confirmedAt: Date.now(),
          pose: await adapter.getPose(),
        }),
        waitForCurrent: finish,
        finish,
      };
    };
    const f = await fixture(4, 5, adapter);
    try {
      const resets: number[] = [];
      const drawing = f.runtime.drawSavedLogo(
        f.request({ type: 'tap', point: { x: 1, y: 1 } }),
        f.store.list().workstation!.vision!,
        {
          viewport: { width: 400, height: 800 },
          prepare: async () => undefined,
          check() {},
          finish() {},
          retryStroke: async (stroke) => {
            resets.push(stroke);
            const lifted = await adapter.getPose();
            expect(lifted.positionMm.x).toBeCloseTo(starts[2].positionMm.x);
            expect(lifted.positionMm.y).toBeCloseTo(starts[2].positionMm.y);
            expect(lifted.positionMm.z).toBeCloseTo(50);
          },
        },
      );
      if (failAgain) {
        await expect(drawing).rejects.toMatchObject({
          code: 'RECOVERY_REQUIRED',
        });
        expect(f.runtime.requiresOperatorRecovery).toBe(true);
        expect(f.store.list().pendingOperation?.requiresOperatorRecovery).toBe(
          true,
        );
        expect(starts).toHaveLength(4);
      } else {
        await drawing;
        expect(f.runtime.requiresOperatorRecovery).toBe(false);
        expect(starts).toHaveLength(7);
      }
      expect(resets).toEqual([3]);
      expect(starts[3]).toEqual(starts[2]);
    } finally {
      await f.cleanup();
    }
  },
);
