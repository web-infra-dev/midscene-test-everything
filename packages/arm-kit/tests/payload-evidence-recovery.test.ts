import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, rstest } from '@rstest/core';
import type {
  PayloadApplicationSnapshot,
  PayloadConstraints,
  ToolPayload,
} from '../src/contracts.js';
import { RobotDriverBoundary } from '../src/kernel/driver-boundary.js';
import {
  ProfileStore,
  RobotActionAuditStore,
  RobotArmRuntime,
} from '../src/runtime.js';
import { TestRobotAdapter } from '../src/testkit/test-adapter.js';
import { pose } from './fixtures.js';

const payloadLimits: PayloadConstraints = { massKg: { min: 0, max: 3 } };
const savedPayload: ToolPayload = { massKg: 0.1 };

/**
 * Reproduces the MG400 behaviour that lost a finished batch: resetting a
 * command channel invalidates the payload evidence while the controller keeps
 * its configuration, and the adapter re-adopts the reported load once fresh
 * feedback is available again. Nothing here is MG400-specific beyond that order.
 */
class PayloadEvidenceAdapter extends TestRobotAdapter {
  readonly payloadLimits = payloadLimits;
  readonly payloadRequiresDisabled = true;
  private reads = 0;
  /** Remaining samples that still report the invalidated evidence. */
  private missingReads = 0;
  private snapshot: PayloadApplicationSnapshot;

  constructor() {
    super({
      jointCount: 4,
      motionDurationMs: 10,
      initialPose: pose(100, -50, 100),
    });
    this.snapshot = this.snapshotFor('unconfirmed');
    Object.assign(this.driver, {
      enableWithPayload: async (payload: ToolPayload) => {
        await this.enable();
        this.adoptReadback(payload);
      },
      appliedPayload: () =>
        this.snapshot.status === 'confirmed'
          ? this.snapshot.applied
          : undefined,
      readPayloadApplication: () => {
        if (this.missingReads > 0) {
          this.missingReads--;
          return {
            ...this.snapshot,
            status: 'unconfirmed' as const,
            applied: undefined,
          };
        }
        return structuredClone(this.snapshot);
      },
    });
  }
  private snapshotFor(
    status: 'confirmed' | 'unconfirmed',
    payload: ToolPayload = savedPayload,
    reason: PayloadApplicationSnapshot['reason'] = 'service-start',
  ): PayloadApplicationSnapshot {
    const confirmedAt = new Date().toISOString();
    this.reads++;
    return {
      status,
      sessionId: 'session',
      generation: this.reads,
      updatedAt: confirmedAt,
      ...(status === 'confirmed'
        ? {
            applied: {
              payload: { ...payload },
              confirmedAt,
              source: 'controller-readback' as const,
            },
          }
        : { reason }),
    };
  }
  /** Fresh feedback after a reconnect: the controller still holds this load. */
  adoptReadback(payload: ToolPayload = savedPayload) {
    this.snapshot = this.snapshotFor('confirmed', payload);
    this.missingReads = 0;
  }
  /** A reset channel: `reads` samples report no payload evidence at all. */
  loseEvidence(
    reads = 0,
    reason: PayloadApplicationSnapshot['reason'] = 'connection-lost',
  ) {
    this.snapshot = this.snapshotFor('unconfirmed', savedPayload, reason);
    this.missingReads = reads;
  }
}

async function setup() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'midscene-robot-arm-payload-'),
  );
  const adapter = new PayloadEvidenceAdapter();
  const store = new ProfileStore(path.join(directory, 'profiles.json'));
  const auditStore = new RobotActionAuditStore({
    filePath: path.join(directory, 'audit.jsonl'),
  });
  const robot = await store.putRobot({
    id: 'robot',
    name: 'Robot',
    adapterId: adapter.id,
    connectionIdentity: adapter.connectionIdentity,
    installation: 'Fixed',
  });
  const tool = await store.putTool({
    id: 'tool',
    name: 'Tool',
    offsetMm: { x: 0, y: 0, z: 0 },
    contactDirection: { x: 0, y: 0, z: -1 },
    payload: savedPayload,
  });
  const runtime = new RobotArmRuntime({
    adapter,
    profileStore: store,
    auditStore,
  });
  await runtime.initialize();
  adapter.adoptReadback();
  await runtime.lifecycle('enable', {
    robotProfileId: robot.id,
    toolProfileId: tool.id,
    toolRevision: tool.revision,
  });
  return {
    adapter,
    auditStore,
    store,
    runtime,
    binding: { robotProfileId: robot.id, toolProfileId: tool.id },
    async cleanup() {
      if (
        path.dirname(directory) !== os.tmpdir() ||
        !path.basename(directory).startsWith('midscene-robot-arm-payload-')
      )
        throw new Error('Unsafe fixture cleanup path');
      try {
        if ((await adapter.getState()).connected) await runtime.shutdown();
        else await adapter.disconnect();
      } finally {
        await auditStore.flush();
        await rm(directory, { recursive: true, force: true, maxRetries: 5 });
      }
    },
  };
}

it('reconfirms the saved payload after a reset channel instead of failing the run', async () => {
  const f = await setup();
  try {
    // The channel resets just before the first probe: two samples report no
    // evidence, and fresh feedback covers the reconnect shortly afterwards.
    f.adapter.loseEvidence(2);
    const restored = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      f.adapter.adoptReadback();
    })();
    const recheck: boolean[] = [];
    await f.runtime.collectAutomaticPoints(
      { ...f.binding, onPayloadRecheck: (waiting) => recheck.push(waiting) },
      async (host) => {
        await host.move(pose(110, -50, 100));
      },
    );
    await restored;
    expect(f.adapter.movements).toEqual([pose(110, -50, 100)]);
    // The wait is reported, so the batch can show it, and it ends before motion.
    expect(recheck).toEqual([true, false]);
    expect((await f.runtime.state()).recoveryRequired).toBe(false);
    // Connecting already evaluated the preconditions, before any screen work.
    await f.auditStore.flush();
    expect(
      f.auditStore
        .recent(20)
        .some((record) => record.detail?.control === 'connection-preflight'),
    ).toBe(true);
  } finally {
    await f.cleanup();
  }
});

it('keeps an attempt alive when the channel resets during a move', async () => {
  const f = await setup();
  const original = RobotDriverBoundary.prototype.moveLinear;
  const move = rstest.spyOn(RobotDriverBoundary.prototype, 'moveLinear');
  // The socket resets while the first probe is travelling. Fresh feedback
  // restores the readback a moment later, but the in-attempt checks run before
  // that: they must not turn a recoverable evidence gap into a failed attempt.
  move
    .mockImplementationOnce(function (
      this: RobotDriverBoundary,
      ...args: Parameters<typeof original>
    ) {
      f.adapter.loseEvidence(3);
      setTimeout(() => f.adapter.adoptReadback(), 60);
      return original.apply(this, args);
    })
    .mockImplementation(function (
      this: RobotDriverBoundary,
      ...args: Parameters<typeof original>
    ) {
      return original.apply(this, args);
    });
  const work = rstest.fn(
    async (
      host: Parameters<
        Parameters<typeof f.runtime.collectAutomaticPoints>[1]
      >[0],
    ) => {
      await host.move(pose(110, -50, 100));
      await host.move(pose(120, -50, 100));
    },
  );
  const recheck: boolean[] = [];
  try {
    await f.runtime.collectAutomaticPoints(
      { ...f.binding, onPayloadRecheck: (waiting) => recheck.push(waiting) },
      work,
    );
    expect(work).toHaveBeenCalledTimes(1);
    // Both probes ran once: the gap was waited out instead of replaying them.
    expect(f.adapter.movements).toEqual([
      pose(110, -50, 100),
      pose(120, -50, 100),
    ]);
    expect((await f.runtime.state()).recoveryRequired).toBe(false);
    expect(f.store.list().pendingOperation).toBeUndefined();
  } finally {
    move.mockRestore();
    await f.cleanup();
  }
});

it('still refuses motion when the controller reports a different payload', async () => {
  const f = await setup();
  try {
    // A real configuration mismatch is not evidence the adapter can rebuild.
    f.adapter.adoptReadback({ massKg: 0.4 });
    const recheck: boolean[] = [];
    await expect(
      f.runtime.collectAutomaticPoints(
        { ...f.binding, onPayloadRecheck: (waiting) => recheck.push(waiting) },
        async (host) => {
          await host.move(pose(110, -50, 100));
        },
      ),
    ).rejects.toMatchObject({ code: 'TOOL_PAYLOAD_NOT_APPLIED' });
    expect(f.adapter.movements).toEqual([]);
    expect(recheck).toEqual([]);
  } finally {
    await f.cleanup();
  }
});
