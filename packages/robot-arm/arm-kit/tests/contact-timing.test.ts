import { describe, expect, it } from '@rstest/core';
import type { MotionResult } from '../src/contracts.js';
import { executeContactPlan } from '../src/screen-interaction/contact-executor.js';
import type { ScreenMotionHost } from '../src/screen-interaction/service.js';
import { TestRobotAdapter } from '../src/testkit/test-adapter.js';
import { fixture, pose } from './fixtures.js';

/**
 * A Simulator with no push channel, which is what an installation running with
 * `feedbackPort: 0` looks like to the screen layer.
 */
class PollingOnlySimulator extends TestRobotAdapter {
  override latestToolVectorSample() {
    return undefined;
  }
}

/**
 * Tolerance for a window measured through a 25 ms observer: one sampling
 * interval of slack on each side, plus room for a missed tick.
 */
const POLL_TOLERANCE_MS = 60;

describe('contact window timing', () => {
  it('anchors the press window on the passive plane crossing', async () => {
    const f = await fixture();
    try {
      const result = await f.runtime.execute(
        f.request({ type: 'tap', point: { x: 500, y: 250 } }),
      );
      expect(result.arrivalSource).toBe('feedback-plane-crossing');
      expect(result.targetContactMs).toBe(f.screen.contactMs);
      // The hold closes the loop on the window rather than on the wait, so it
      // waits only what the anchor left: time already spent arriving is not
      // added on top of the requested press.
      expect(result.scheduledHoldMs).toBeGreaterThanOrEqual(0);
      expect(result.scheduledHoldMs).toBeLessThanOrEqual(
        result.targetContactMs,
      );
      // The measured window is the requested press, within the observer's
      // sampling interval. A window stretched by arrival confirmation would
      // exceed this bound, which is the regression this guards.
      expect(result.contactMs, JSON.stringify(result)).toBeGreaterThanOrEqual(
        result.targetContactMs - POLL_TOLERANCE_MS,
      );
      expect(result.contactMs, JSON.stringify(result)).toBeLessThanOrEqual(
        result.targetContactMs + POLL_TOLERANCE_MS,
      );
      expect(result.timingOverrunMs).toBeLessThanOrEqual(POLL_TOLERANCE_MS);
    } finally {
      await f.cleanup();
    }
  });

  it('keeps watching through the hold when arrival precedes physical contact', async () => {
    const f = await fixture();
    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    let sample = { pose: pose(0, 0, 31), receivedAt: Date.now() };
    let entryArrivedAt = 0;
    let crossedAt = 0;
    const host: ScreenMotionHost = {
      adapter: {} as ScreenMotionHost['adapter'],
      target: () => undefined,
      preflight: async () => undefined,
      beginSequence: async () => undefined,
      stable: async () => undefined,
      safeLift: (p) => p,
      latestToolVector: () => sample,
      move: async (p): Promise<MotionResult> => {
        const now = Date.now();
        // The entry move confirms arrival while the tool is still above the
        // plane; the lift moves back above it. Only the hold sees the crossing.
        if (p.positionMm.z > 30) sample = { pose: p, receivedAt: now };
        else if (!entryArrivedAt) entryArrivedAt = now;
        return {
          status: 'completed',
          completedAt: new Date(now).toISOString(),
          submittedAt: now,
          arrivedAt: now,
        };
      },
      hold: async (ms) => {
        if (!crossedAt && Date.now() - entryArrivedAt >= 12) {
          sample = { pose: pose(0, 0, 29), receivedAt: Date.now() };
          crossedAt = sample.receivedAt;
        }
        await sleep(Math.min(ms, 5));
      },
    };
    try {
      const result = await executeContactPlan(
        host,
        {
          contact: pose(0, 0, 29),
          entryLift: pose(0, 0, 51),
          lift: pose(0, 0, 51),
          entryOptions: {},
          releaseOptions: {},
          traverseOptions: {},
          holdMs: 60,
          holdMode: 'target',
        },
        f.calibration,
        { robot: f.robot, tool: f.tool, screen: f.screen },
      );
      expect(crossedAt).toBeGreaterThan(entryArrivedAt);
      expect(result.arrivalSource).toBe('feedback-plane-crossing');
      expect(result.contactStartedAt).toBe(crossedAt);
      expect(result.scheduledHoldMs).toBeGreaterThan(0);
      expect(result.contactMs).toBeGreaterThanOrEqual(60 - POLL_TOLERANCE_MS);
      expect(result.contactMs).toBeLessThanOrEqual(60 + POLL_TOLERANCE_MS);
      // Releasing the tool takes a few samples; the measured overrun, not a
      // zero-cost release, is what this guard allows for.
      expect(result.timingStatus).not.toBe('unmeasurable');
      expect(result.timingOverrunMs).toBeLessThanOrEqual(POLL_TOLERANCE_MS);
    } finally {
      await f.cleanup();
    }
  });

  it('falls back to the driver arrival sample without a push channel', async () => {
    const f = await fixture(
      4,
      10,
      new PollingOnlySimulator({
        jointCount: 4,
        motionDurationMs: 10,
        initialPose: pose(100, -50, 100),
      }),
    );
    try {
      const result = await f.runtime.execute(
        f.request({ type: 'tap', point: { x: 500, y: 250 } }),
      );
      expect(result.arrivalSource).toBe('driver-arrival-sample');
      // Without a passive channel the press window is not measurable, and an
      // unmeasurable window is absent rather than reported as zero.
      expect(result.contactMs).toBeUndefined();
      expect(result.timingOverrunMs).toBeUndefined();
      expect(result.timingStatus).toBe('unmeasurable');
      expect(result.executionMode).toBe('terminal');
      expect(result.degradationReason).toBeTruthy();
    } finally {
      await f.cleanup();
    }
  });

  it('applies a timing change to the next action without recreating the context', async () => {
    const f = await fixture();
    try {
      const before = await f.runtime.execute(
        f.request({ type: 'tap', point: { x: 500, y: 250 } }),
      );
      expect(before.targetContactMs).toBe(60);
      const contextKey = f.store.contextKey(f.binding, f.calibration.id);
      await f.runtime.putScreen({ ...f.screen, contactMs: 200 });
      // No reinitialisation, no new Device and no recalibration: the Profile is
      // read per action, so the next one already uses the new value.
      const after = await f.runtime.execute(
        f.request({ type: 'tap', point: { x: 500, y: 250 } }),
      );
      expect(after.targetContactMs).toBe(200);
      expect(f.store.contextKey(f.binding, f.calibration.id)).toBe(contextKey);
      expect(f.store.getCalibration(f.calibration.id)).toEqual(f.calibration);
    } finally {
      await f.cleanup();
    }
  });

  it('refuses a successor lead that would consume the whole press', async () => {
    const f = await fixture();
    try {
      // A lead equal to the target window would dispatch the release before the
      // press is complete, so the profile is refused rather than clamped.
      await expect(
        f.runtime.putScreen({ ...f.screen, successorStartLeadMs: 60 }),
      ).rejects.toMatchObject({ code: 'INVALID_PROFILE' });
      await expect(
        f.runtime.putScreen({
          ...f.screen,
          swipeEndpointHoldMs: 60,
          successorStartLeadMs: 59,
        }),
      ).resolves.toMatchObject({ successorStartLeadMs: 59 });
    } finally {
      await f.cleanup();
    }
  });

  it('reports the endpoint hold as the press target for a drag', async () => {
    const f = await fixture();
    try {
      const result = await f.runtime.execute(
        f.request({
          type: 'dragAndDrop',
          from: { x: 250, y: 250 },
          to: { x: 750, y: 250 },
        }),
      );
      expect(result.action).toBe('dragAndDrop');
      expect(result.targetContactMs).toBe(80);
      // A drag's window includes the intended traverse, so it is longer than the
      // endpoint hold; the overrun measures only the hold's own segment.
      expect(result.contactMs, JSON.stringify(result)).toBeGreaterThan(
        result.targetContactMs,
      );
      expect(
        result.timingOverrunMs,
        JSON.stringify(result),
      ).toBeLessThanOrEqual(POLL_TOLERANCE_MS);
    } finally {
      await f.cleanup();
    }
  });
});
