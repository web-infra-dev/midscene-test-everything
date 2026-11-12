import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, rstest } from '@rstest/core';
import {
  type RobotActionAuditRecord,
  RobotArmError,
} from '../src/contracts.js';
import { RobotActionAuditStore, RobotArmRuntime } from '../src/runtime.js';
import { fixture } from './fixtures.js';

const directories: string[] = [];
async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'midscene-robot-arm-audit-'),
  );
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const readRecords = async (file: string): Promise<RobotActionAuditRecord[]> => {
  const raw = await readFile(file, 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as RobotActionAuditRecord);
};

describe('audit store', () => {
  it('appends parseable records with increasing sequence numbers', async () => {
    const directory = await tempDirectory();
    const file = path.join(directory, 'nested', 'audit.jsonl');
    const store = new RobotActionAuditStore({ filePath: file });
    await store.record({
      kind: 'control',
      id: 'a',
      outcome: 'completed',
      detail: { control: 'enable' },
    });
    await store.record({
      kind: 'action',
      id: 'b',
      outcome: 'stopped',
      error: 'interrupted',
      detail: { action: 'tap' },
    });
    await store.record({ kind: 'drag', id: 'c', outcome: 'failed' });
    await store.flush();

    const records = await readRecords(file);
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(records.map((r) => r.kind)).toEqual(['control', 'action', 'drag']);
    expect(records[1].error).toBe('interrupted');
    expect(records[1].detail).toEqual({ action: 'tap' });
    expect(records.every((r) => typeof r.at === 'string')).toBe(true);
    expect(store.status()).toMatchObject({
      enabled: true,
      written: 3,
      failures: 0,
    });
  });

  it('rotates to a single .1 file instead of growing without bound', async () => {
    const directory = await tempDirectory();
    const file = path.join(directory, 'audit.jsonl');
    const store = new RobotActionAuditStore({
      filePath: file,
      maxBytes: 400,
    });
    for (let index = 0; index < 12; index++)
      await store.record({
        kind: 'control',
        id: `id-${index}`,
        outcome: 'completed',
        detail: { padding: 'x'.repeat(60) },
      });
    await store.flush();

    const rotated = await readFile(`${file}.1`, 'utf8');
    const current = await readRecords(file);
    const rotatedRecords = rotated
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as RobotActionAuditRecord);

    // Exactly one previous file is retained, so earlier epochs are dropped by
    // design: this is a bounded trail, not an archive. What must hold is that
    // the retained window is contiguous, ordered and duplicate-free.
    expect(rotatedRecords.length).toBeGreaterThan(0);
    expect(current.length).toBeGreaterThan(0);
    expect(current[0].seq).toBe(
      rotatedRecords[rotatedRecords.length - 1].seq + 1,
    );
    const sequences = [...rotatedRecords, ...current].map(
      (record) => record.seq,
    );
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(sequences).toEqual(
      [...sequences].sort((left, right) => left - right),
    );
    expect((await stat(file)).size).toBeLessThanOrEqual(400);
    // Only one rotation target ever exists.
    await expect(stat(`${file}.2`)).rejects.toThrow();
  });

  it('reads its own tail back so a query works after a restart', async () => {
    const directory = await tempDirectory();
    const file = path.join(directory, 'audit.jsonl');
    const first = new RobotActionAuditStore({ filePath: file });
    await first.record({ kind: 'control', id: 'one', outcome: 'completed' });
    await first.record({ kind: 'action', id: 'two', outcome: 'failed' });
    await first.flush();

    const second = new RobotActionAuditStore({ filePath: file });
    await second.load();
    expect(second.recent(10).map((r) => r.id)).toEqual(['two', 'one']);
    // Sequence numbers continue rather than restarting at 1.
    await second.record({ kind: 'control', id: 'three', outcome: 'completed' });
    await second.flush();
    expect((await readRecords(file)).map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  it('skips a torn final line instead of refusing the whole file', async () => {
    const directory = await tempDirectory();
    const file = path.join(directory, 'audit.jsonl');
    await writeFile(
      file,
      `${JSON.stringify({ schemaVersion: 1, seq: 1, at: 'now', kind: 'control', id: 'ok', outcome: 'completed' })}\n{"schemaVersion":1,"seq":2,"at":"no`,
      'utf8',
    );
    const store = new RobotActionAuditStore({ filePath: file });
    await store.load();
    expect(store.recent(10).map((r) => r.id)).toEqual(['ok']);
    expect(store.status().written).toBe(0);
  });

  it('returns records newest first and honours the limit', async () => {
    const directory = await tempDirectory();
    const store = new RobotActionAuditStore({
      filePath: path.join(directory, 'audit.jsonl'),
    });
    for (const id of ['a', 'b', 'c'])
      await store.record({ kind: 'control', id, outcome: 'completed' });
    await store.flush();
    expect(store.recent(2).map((r) => r.id)).toEqual(['c', 'b']);
    expect(store.recent().map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('does nothing at all when disabled', async () => {
    const directory = await tempDirectory();
    for (const disabled of ['0', '', false] as const) {
      const file = path.join(directory, 'audit.jsonl');
      const store = new RobotActionAuditStore({ filePath: disabled });
      expect(store.enabled).toBe(false);
      await expect(
        store.record({ kind: 'control', id: 'x', outcome: 'completed' }),
      ).resolves.toBeUndefined();
      await store.flush();
      expect(store.status()).toMatchObject({
        enabled: false,
        written: 0,
        failures: 0,
      });
      await expect(stat(file)).rejects.toThrow();
    }
  });

  it('bounds the in-memory index so a long run cannot grow without limit', async () => {
    const directory = await tempDirectory();
    const store = new RobotActionAuditStore({
      filePath: path.join(directory, 'audit.jsonl'),
      recentLimit: 2,
    });
    for (const id of ['a', 'b', 'c', 'd'])
      await store.record({ kind: 'control', id, outcome: 'completed' });
    await store.flush();
    expect(store.recent(50).map((r) => r.id)).toEqual(['d', 'c']);
    // The file still holds everything; only the index is bounded.
    expect(await readRecords(store.filePath!)).toHaveLength(4);
    expect(store.status().records).toBe(2);
    expect(store.status().written).toBe(4);
  });

  it('counts and reports a write failure without rejecting', async () => {
    const directory = await tempDirectory();
    // The parent of the audit path is a file, so every write must fail.
    const blocker = path.join(directory, 'not-a-directory');
    await writeFile(blocker, 'x', 'utf8');
    const errors: unknown[] = [];
    const store = new RobotActionAuditStore({
      filePath: path.join(blocker, 'audit.jsonl'),
      onError: (error) => errors.push(error),
    });
    await expect(
      store.record({ kind: 'control', id: 'x', outcome: 'completed' }),
    ).resolves.toBeUndefined();
    await store.flush();
    expect(store.status().failures).toBeGreaterThan(0);
    expect(store.status().written).toBe(0);
    expect(errors.length).toBeGreaterThan(0);
    // The record is still queryable in memory even though it never reached disk.
    expect(store.recent(5).map((r) => r.id)).toEqual(['x']);
  });
});

describe('audit trail wired into the runtime', () => {
  it('retains failed clear request, response and raw angles across audit reload', async () => {
    const f = await fixture();
    try {
      const details = {
        command: 'ClearAlarms',
        request: { alarms: true },
        response: { status: true },
        lastState: { raw: { alarms: [[70]], jointCoordinate: [0, 0, 0, 524] } },
      };
      rstest
        .spyOn(f.adapter, 'clearFaults')
        .mockRejectedValue(
          new RobotArmError('STATE_UNCONFIRMED', 'Still faulted', 504, details),
        );
      await expect(f.runtime.lifecycle('clearFaults')).rejects.toMatchObject({
        code: 'STATE_UNCONFIRMED',
      });
      await f.auditStore.flush();
      const reloaded = new RobotActionAuditStore({
        filePath: f.auditStore.status().filePath,
      });
      await reloaded.load();
      expect(reloaded.recent(1)[0]).toMatchObject({
        outcome: 'failed',
        error: 'Still faulted',
        errorDetails: { code: 'STATE_UNCONFIRMED', status: 504, details },
      });
    } finally {
      rstest.restoreAllMocks();
      await f.cleanup();
    }
  });
  it('records a completed action with its bindings and timings', async () => {
    const f = await fixture();
    try {
      const result = await f.runtime.execute(
        f.request({ type: 'tap', point: { x: 500, y: 250 } }),
      );
      await f.auditStore.flush();
      const record = f.auditStore
        .recent(20)
        .find((entry) => entry.kind === 'action');
      expect(record).toBeDefined();
      expect(record!.outcome).toBe('completed');
      expect(record!.id).toBe(result.requestId);
      expect(record!.detail).toMatchObject({
        action: 'tap',
        totalDurationMs: expect.any(Number),
        bindings: {
          robotProfileId: f.binding.robotProfileId,
          toolProfileId: f.binding.toolProfileId,
          screenProfileId: f.binding.screenProfileId,
        },
      });
      // The press window is recorded separately from the requested hold, so a
      // window stretched by arrival confirmation stays visible in the trail.
      expect(record!.detail?.timing).toMatchObject({
        targetContactMs: f.screen.contactMs,
        scheduledHoldMs: expect.any(Number),
        timingOverrunMs: expect.any(Number),
        arrivalSource: expect.any(String),
      });
      // The measured arrival pose rides along; no extra controller round trip.
      expect(record!.detail?.actualPose).toBeDefined();
    } finally {
      await f.cleanup();
    }
  });

  it('records an interrupted action with its interruption outcome', async () => {
    const f = await fixture(4, 300);
    try {
      const running = expect(
        f.runtime.execute(
          f.request({ type: 'tap', point: { x: 500, y: 250 } }),
        ),
      ).rejects.toThrow();
      // Let the motion reach the controller before interrupting it.
      await new Promise((resolve) => setTimeout(resolve, 120));
      await f.runtime.stop();
      await running;
      await f.auditStore.flush();

      const records = f.auditStore.recent(50);
      const action = records.find(
        (entry) => entry.kind === 'action' && entry.outcome === 'stopped',
      );
      expect(action).toBeDefined();
      expect(
        records.some(
          (entry) =>
            entry.kind === 'control' &&
            entry.detail?.control === 'stop' &&
            entry.outcome === 'completed',
        ),
      ).toBe(true);
    } finally {
      await f.cleanup();
    }
  });

  it('records an emergency stop even though it bypasses the lease', async () => {
    const f = await fixture(4, 300);
    try {
      const running = expect(
        f.runtime.execute(
          f.request({ type: 'tap', point: { x: 500, y: 250 } }),
        ),
      ).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 120));
      await f.runtime.emergencyStop();
      await running;
      await f.auditStore.flush();

      const records = f.auditStore.recent(50);
      const stop = records.find(
        (entry) =>
          entry.kind === 'control' && entry.detail?.control === 'emergencyStop',
      );
      expect(stop).toBeDefined();
      expect(stop!.outcome).toBe('completed');
      // It interrupted a live action, which is the case release() cannot see.
      expect(stop!.detail?.interruptedAction).toBe(true);
      expect(
        records.some(
          (entry) => entry.kind === 'action' && entry.outcome === 'stopped',
        ),
      ).toBe(true);
    } finally {
      await f.cleanup();
    }
  });

  it('records calibration session commands with their stage transition', async () => {
    const f = await fixture();
    try {
      const session = await f.runtime.startCalibration(
        f.binding,
        f.calibration.id,
      );
      const captured = await f.runtime.calibrationCommand(session.id, {
        commandId: 'cmd-1',
        expectedRevision: session.revision,
        type: 'return-observation',
        accepted: true,
      });
      await f.auditStore.flush();

      const records = f.auditStore.recent(50);
      expect(
        records.some(
          (entry) =>
            entry.kind === 'calibration' &&
            entry.detail?.control === 'start-session' &&
            entry.id === session.id,
        ),
      ).toBe(true);
      const command = records.find(
        (entry) => entry.detail?.control === 'session-command',
      );
      expect(command).toBeDefined();
      expect(command!.detail).toMatchObject({
        commandId: 'cmd-1',
        command: 'return-observation',
        stageBefore: 'observation',
        stageAfter: captured.stage,
      });
    } finally {
      await f.cleanup();
    }
  });

  it('records a failed control with its error', async () => {
    const f = await fixture();
    try {
      // A calibration session cannot start while the arm is disabled.
      await f.runtime.lifecycle('disable');
      await expect(
        f.runtime.startCalibration(f.binding, f.calibration.id),
      ).rejects.toMatchObject({
        code: 'NOT_ENABLED',
      });
      await f.auditStore.flush();
      const failure = f.auditStore
        .recent(50)
        .find((entry) => entry.outcome === 'failed');
      expect(failure).toBeDefined();
      expect(failure!.error).toContain('Robot is not ready for motion');
    } finally {
      await f.cleanup();
    }
  });

  it('keeps acting when the audit file cannot be written', async () => {
    const f = await fixture();
    try {
      const directory = await tempDirectory();
      const blocker = path.join(directory, 'not-a-directory');
      await writeFile(blocker, 'x', 'utf8');
      const broken = new RobotActionAuditStore({
        filePath: path.join(blocker, 'audit.jsonl'),
      });
      // A second runtime over the same, already-enabled controller: the whole
      // point is that auditing cannot get in the way of the operation.
      const runtime = new RobotArmRuntime({
        adapter: f.adapter,
        profileStore: f.store,
        auditStore: broken,
      });

      const result = await runtime.execute(
        f.request({ type: 'tap', point: { x: 500, y: 250 } }),
      );
      expect(result.action).toBe('tap');
      await expect(runtime.emergencyStop()).resolves.toBeUndefined();
      await broken.flush();
      expect(broken.status().failures).toBeGreaterThan(0);
      expect(broken.status().written).toBe(0);
    } finally {
      await f.cleanup();
    }
  });

  it('adds no controller traffic of its own', async () => {
    const f = await fixture();
    try {
      const calls = { getState: 0, getPose: 0, moveLinear: 0 };
      const counting = new Proxy(f.adapter, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver);
          if (property === 'driver')
            return new Proxy(target.driver, {
              get(driver, method) {
                const operation = Reflect.get(driver, method);
                const key = method === 'readPose' ? 'getPose' : method;
                if (typeof key !== 'string' || !(key in calls))
                  return operation;
                return (...args: unknown[]) => {
                  calls[key as keyof typeof calls]++;
                  return operation.apply(driver, args);
                };
              },
            });
          if (typeof value === 'function' && property in calls) {
            const key = property as keyof typeof calls;
            return (...args: unknown[]) => {
              calls[key]++;
              return (value as (...a: unknown[]) => unknown).apply(
                target,
                args,
              );
            };
          }
          return value;
        },
      }) as typeof f.adapter;

      const runOnce = async (auditStore?: RobotActionAuditStore) => {
        const runtime = new RobotArmRuntime({
          adapter: counting,
          profileStore: f.store,
          ...(auditStore ? { auditStore } : {}),
        });
        await runtime.execute(
          f.request({ type: 'tap', point: { x: 500, y: 250 } }),
        );
      };

      await runOnce(f.auditStore);
      const withAudit = { ...calls };
      for (const key of Object.keys(calls) as (keyof typeof calls)[])
        calls[key] = 0;
      // `filePath: '0'` disables auditing, so any difference is the audit path.
      await runOnce(new RobotActionAuditStore({ filePath: '0' }));

      expect(withAudit.getPose).toBeGreaterThan(0);
      expect(withAudit).toEqual(calls);
    } finally {
      await f.cleanup();
    }
  });
});
