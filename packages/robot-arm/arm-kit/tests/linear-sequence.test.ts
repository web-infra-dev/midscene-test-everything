import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  rstest,
} from '@rstest/core';
import { RobotArmError } from '../src/contracts.js';
import {
  type LinearSequencePort,
  type SequenceFeedback,
  createLinearMotionSequence,
  isSequenceObservationError,
} from '../src/driver/linear-sequence.js';
import { pose } from './fixtures.js';

beforeEach(() => {
  rstest.useFakeTimers();
  rstest.setSystemTime(1000);
});
afterEach(() => rstest.useRealTimers());

function fixture() {
  let actual = pose();
  let generation = 1;
  let frameId = 0;
  let stopped = false;
  let repeat = false;
  let available = true;
  let paused = false;
  let sample: SequenceFeedback = {
    sampleId: '0',
    connectionGeneration: generation,
    receivedAt: Date.now(),
    pose: actual,
  };
  const timer = setInterval(() => {
    if (paused) return;
    sample = {
      sampleId: repeat ? '0' : String(++frameId),
      connectionGeneration: generation,
      receivedAt: Date.now(),
      pose: actual,
    };
  }, 10);
  const terminal = rstest.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      status: 'completed' as const,
      completedAt: new Date().toISOString(),
      pose: actual,
    };
  });
  const release = rstest.fn(() => clearInterval(timer));
  const submitQueued = rstest.fn<
    NonNullable<LinearSequencePort['submitQueued']>
  >(async (targets) => {
    actual = targets.at(-1)!.pose;
    return {
      id: 'queued',
      acceptedAt: Date.now(),
      submittedAt: Date.now(),
    };
  });
  const sequence = createLinearMotionSequence(
    [
      { pose: pose(), options: { speed: { kind: 'ratio', value: 0.1 } } },
      {
        pose: pose(0, 0, 50),
        options: { speed: { kind: 'ratio', value: 0.1 } },
      },
      { pose: pose(10, 0, 50), options: {} },
      { pose: pose(10, 0, 60), options: {} },
    ],
    { timeoutMs: 1000 },
    {
      check: () => {
        if (stopped) throw new RobotArmError('ACTION_STOPPED', 'stopped');
      },
      feedback: () => (available ? sample : undefined),
      submit: rstest.fn(async (target) => {
        actual = target.pose;
        return {
          id: 'receipt',
          acceptedAt: Date.now(),
          submittedAt: Date.now(),
        };
      }),
      submitQueued,
      terminal,
      release,
      stopped: () => stopped,
    },
  );
  return {
    sequence,
    submitQueued,
    terminal,
    release,
    repeat: () => {
      repeat = true;
    },
    disconnect: () => {
      available = false;
    },
    reconnect: () => {
      generation++;
    },
    stop: () => {
      stopped = true;
    },
    pause: () => {
      paused = true;
    },
  };
}

describe('ordered linear sequence', () => {
  it('hands off without starting the delayed terminal barrier and retains ownership until finish', async () => {
    const f = fixture();
    await f.sequence.submit(0);
    const arrived = f.sequence.waitForHandoff();
    await rstest.advanceTimersByTimeAsync(40);
    expect(await arrived).toMatchObject({
      candidateReachedAt: 1010,
      confirmedAt: 1030,
    });
    expect(f.terminal).not.toHaveBeenCalled();
    await f.sequence.submit(1);
    const finishing = f.sequence.finish();
    await rstest.advanceTimersByTimeAsync(100);
    expect(f.release).not.toHaveBeenCalled();
    await rstest.advanceTimersByTimeAsync(400);
    expect((await finishing).status).toBe('completed');
    expect(f.terminal).toHaveBeenCalledTimes(1);
    expect(f.release).toHaveBeenCalledTimes(1);
  });
  it('tolerates a 300 ms scheduling gap but rejects a sample older than 500 ms', async () => {
    const f = fixture();
    f.pause();
    await rstest.advanceTimersByTimeAsync(300);
    await expect(f.sequence.submit(0)).resolves.toMatchObject({
      id: 'receipt',
    });
    await rstest.advanceTimersByTimeAsync(300);
    await expect(f.sequence.submit(1)).rejects.toMatchObject({
      code: 'SEQUENCE_FEEDBACK_UNAVAILABLE',
    });
  });
  it('queues intermediate targets after arrival and confirms the tail before the lift', async () => {
    const f = fixture();
    await f.sequence.submit(0);
    await expect(f.sequence.submitQueued!([10, 0])).rejects.toMatchObject({
      code: 'INVALID_SEQUENCE',
    });
    const landed = f.sequence.waitForHandoff();
    await rstest.advanceTimersByTimeAsync(40);
    await landed;
    await expect(f.sequence.submitQueued!([10, 10])).rejects.toMatchObject({
      code: 'INVALID_SEQUENCE',
    });
    await f.sequence.submitQueued!([10, 0]);
    expect(f.submitQueued).toHaveBeenCalledWith(
      [
        expect.objectContaining({ pose: pose(0, 0, 50) }),
        expect.objectContaining({ pose: pose(10, 0, 50) }),
      ],
      [10, 0],
    );
    await expect(f.sequence.submit(3)).rejects.toMatchObject({
      code: 'INVALID_SEQUENCE',
    });
    const closed = f.sequence.waitForCurrent();
    await rstest.advanceTimersByTimeAsync(500);
    await expect(closed).resolves.toMatchObject({ pose: pose(10, 0, 50) });
    await f.sequence.submit(3);
    const lifted = f.sequence.finish();
    await rstest.advanceTimersByTimeAsync(500);
    await expect(lifted).resolves.toMatchObject({ pose: pose(10, 0, 60) });
  });

  it('does not count repeated frames as three arrival samples', async () => {
    const f = fixture();
    f.repeat();
    await f.sequence.submit(0);
    const rejected = expect(f.sequence.waitForHandoff()).rejects.toMatchObject({
      code: 'SEQUENCE_FEEDBACK_LOST',
    });
    await rstest.advanceTimersByTimeAsync(550);
    await rejected;
    f.stop();
    f.sequence.dispose();
  });
  it('rejects a feedback connection change rather than reusing a stable old window', async () => {
    const f = fixture();
    await f.sequence.submit(0);
    const rejected = expect(f.sequence.waitForHandoff()).rejects.toMatchObject({
      code: 'SEQUENCE_FEEDBACK_LOST',
    });
    await rstest.advanceTimersByTimeAsync(10);
    f.reconnect();
    await rstest.advanceTimersByTimeAsync(20);
    await rejected;
    f.stop();
    f.sequence.dispose();
  });
  it('allows terminal-confirmed recovery after losing feedback, without restoring fast mode', async () => {
    const f = fixture();
    await f.sequence.submit(0);
    f.disconnect();
    expect(() => f.sequence.check()).toThrow(/feedback/i);
    const current = f.sequence.waitForCurrent();
    await rstest.advanceTimersByTimeAsync(500);
    await current;
    await f.sequence.submit(1, 'terminal');
    const finishing = f.sequence.finish();
    await rstest.advanceTimersByTimeAsync(500);
    await finishing;
    expect(f.terminal).toHaveBeenCalledTimes(2);
  });
  it('refuses another submission and disposal before arrival or confirmed Stop', async () => {
    const f = fixture();
    await f.sequence.submit(0);
    await expect(f.sequence.submit(1)).rejects.toMatchObject({
      code: 'INVALID_SEQUENCE',
    });
    expect(() => f.sequence.dispose()).toThrow(/completion or Stop/);
    f.stop();
    await expect(f.sequence.submit(1, 'terminal')).rejects.toMatchObject({
      code: 'ACTION_STOPPED',
    });
    f.sequence.dispose();
  });
  it('does not release ownership when the final confirmation fails', async () => {
    const f = fixture();
    await f.sequence.submit(0);
    f.terminal.mockRejectedValueOnce(
      new RobotArmError('MOTION_TIMEOUT', 'unknown completion'),
    );
    await expect(f.sequence.finish()).rejects.toMatchObject({
      code: 'MOTION_TIMEOUT',
    });
    expect(f.release).not.toHaveBeenCalled();
    f.stop();
    f.sequence.dispose();
  });
  it('prevents a successor from racing the final terminal observation', async () => {
    const f = fixture();
    await f.sequence.submit(0);
    const arrival = f.sequence.waitForHandoff();
    await rstest.advanceTimersByTimeAsync(40);
    await arrival;
    const finishing = f.sequence.finish();
    await expect(f.sequence.submit(1)).rejects.toMatchObject({
      code: 'ACTION_STOPPED',
    });
    await rstest.advanceTimersByTimeAsync(500);
    await finishing;
  });
});

it('recognizes observation errors from a separately bundled driver', () => {
  const error = Object.assign(
    new Error('Fresh Cartesian feedback is unavailable'),
    {
      name: 'RobotArmError',
      code: 'SEQUENCE_FEEDBACK_UNAVAILABLE',
      status: 409,
    },
  );
  expect(error).not.toBeInstanceOf(RobotArmError);
  expect(isSequenceObservationError(error)).toBe(true);
  expect(
    isSequenceObservationError(new RobotArmError('ROBOT_FAULT', 'Fault')),
  ).toBe(false);
});
