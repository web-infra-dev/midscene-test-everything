import { afterEach, expect, it, rstest } from '@rstest/core';
import {
  type AutomaticExplorationMode,
  type CalibrationPageUpdate,
  type WebPoint,
  calibrationPageMarkers,
} from '../src/assisted-contracts.js';
import { AutomaticCapture } from '../src/calibration/exploration/capture.js';
import { phonePointMm, screenContact } from '../src/calibration/geometry.js';
import { fixture, pose } from './fixtures.js';
rstest.mock('node:timers/promises', () => ({
  setTimeout: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
}));
afterEach(() => rstest.useRealTimers());
it.each([
  'standard',
  'fast',
  'slide',
  'stream',
  'page-reload',
  'missing-ack',
  'slow-ack',
  'transient-touch',
  'ambiguous',
  'cancel',
] as const)(
  'bridges upstream sampling to phone current snapshots: %s',
  async (mode) => {
    const f = await fixture();
    rstest.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'performance',
      ],
    });
    const abort = new AbortController();
    const height = mode === 'slide' ? 782 : 800;
    const layout = {
      revision: 1,
      width: 400,
      height,
      screen: { width: 400, height, devicePixelRatio: 1 },
      markers: calibrationPageMarkers(400, height),
    };
    let current = pose(50, -50, 40);
    let sequence = 0;
    let touching = false;
    const started = performance.now();
    let movesAtTransient: number | undefined;
    const motions: Array<{ z: number; speedRatio: number }> = [];
    const displayedTargets = new Map<number, WebPoint>();
    let collector: AutomaticCapture;
    const send = () => {
      const capture = collector.snapshot().capture;
      if (capture?.targets)
        displayedTargets.set(capture.index, capture.target.point);
      const point = {
        x: current.positionMm.x * 4,
        y: -current.positionMm.y * 8,
      };
      const contact = touching
        ? { id: 'pen', motionRevision: 0, point }
        : undefined;
      const step = capture?.step;
      const update: CalibrationPageUpdate = {
        pageId:
          mode === 'page-reload' && motions.length > 1 ? 'new-page' : 'page',
        sequence: ++sequence,
        visible: true,
        layout,
        contact,
        targetReady: capture?.target.id,
        streamStepFeedback: mode === 'stream',
        stepFeedback:
          step &&
          mode !== 'missing-ack' &&
          !(mode === 'slow-ack' && performance.now() - started < 3000)
            ? {
                ...step,
                outcome:
                  mode === 'ambiguous'
                    ? 'unknown'
                    : touching
                      ? 'touched'
                      : step.phase === 'prepare'
                        ? 'ready'
                        : 'no_touch',
                point: touching ? point : undefined,
              }
            : undefined,
      };
      if (
        mode === 'transient-touch' &&
        movesAtTransient === undefined &&
        step?.phase === 'result' &&
        collector.phoneObservations.at(-1)?.purpose === 'search'
      ) {
        movesAtTransient = motions.length;
        collector.receive({
          ...update,
          stepFeedback: { ...step, outcome: 'touched', point },
        });
        update.sequence = ++sequence;
      }
      collector.receive(update);
    };
    collector = new AutomaticCapture(
      layout,
      f.tool.offsetMm,
      () => queueMicrotask(send),
      (['fast', 'slide'].includes(mode)
        ? mode
        : mode === 'stream'
          ? 'fast'
          : 'standard') as AutomaticExplorationMode,
    );
    send();
    const timer = setInterval(send, 20);
    const job = collector
      .run(
        {
          signal: abort.signal,
          check: () => abort.signal.throwIfAborted(),
          read: async () => current,
          move: async (target, options) => {
            current = structuredClone(target);
            if (options?.speed?.kind !== 'ratio')
              throw new Error('Expected a speed ratio');
            motions.push({
              z: target.positionMm.z,
              speedRatio: options.speed.value,
            });
            touching = current.positionMm.z <= (touching ? 32 : 30);
            if (mode === 'cancel' && motions.length === 2)
              abort.abort(new Error('operator stopped'));
            if (mode === 'slow-ack') {
              expect(performance.now() - started).toBeGreaterThanOrEqual(3000);
              abort.abort(new Error('first move after delayed confirmation'));
            }
            send();
          },
        },
        current,
        {
          tool: f.tool,
          screen: {
            ...f.screen,
            pixelWidth: 401,
            pixelHeight: height + 1,
            actionSpeed: { kind: 'ratio', value: 0.8 },
          },
          webToImage: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        },
      )
      .then(
        () => undefined,
        (error) => error as Error,
      );
    try {
      await rstest.advanceTimersByTimeAsync(60000);
      const error = await job;
      if (['standard', 'fast', 'slide', 'stream'].includes(mode)) {
        expect(error).toBeUndefined();
        expect(collector.localPoints).toHaveLength(3);
        expect(collector.points).toHaveLength(mode === 'standard' ? 9 : 6);
        if (mode === 'standard') {
          const finalPresses = motions.filter(
            (motion) => motion.speedRatio === 0.2,
          );
          const samples = [...collector.localPoints, ...collector.points];
          expect(finalPresses.map((motion) => motion.z)).toEqual(
            samples.map((sample) => sample.probeStep!.after.positionMm.z),
          );
          for (const motion of motions.filter(
            (motion) => motion.speedRatio !== 0.2,
          ))
            expect(motion.speedRatio).toBeCloseTo(0.08);
        } else {
          // Probe steps keep the fast contact factor; travel legs may run at
          // the faster travel factor (B2).
          for (const motion of motions) {
            const probe = Math.abs(motion.speedRatio - 0.2) < 0.005;
            const travel = Math.abs(motion.speedRatio - 0.48) < 0.005;
            expect(probe || travel).toBe(true);
          }
          expect(motions.some((motion) => motion.speedRatio > 0.4)).toBe(true);
        }
        expect(collector.upstreamResult).toBeDefined();
        const sampledTargets = collector.upstreamResult!.grid.map(
          ({ target }) => target.css,
        );
        expect([...displayedTargets.values()]).toEqual(sampledTargets);
        expect(collector.snapshot().capture?.targets).toEqual(sampledTargets);
      } else {
        expect(error).toBeInstanceOf(Error);
        expect(collector.upstreamResult).toBeUndefined();
        if (mode === 'missing-ack' || mode === 'ambiguous')
          expect(motions).toHaveLength(0);
        if (mode === 'missing-ack')
          expect(error).toMatchObject({ code: 'PHONE_STEP_TIMEOUT' });
        if (mode === 'transient-touch') {
          expect(error).toMatchObject({ code: 'PHONE_TOUCH_UNSTABLE' });
          expect(movesAtTransient).toBeGreaterThan(0);
          expect(motions).toHaveLength(movesAtTransient!);
        }
        if (mode === 'slow-ack') expect(motions).toHaveLength(1);
      }
    } finally {
      clearInterval(timer);
      rstest.useRealTimers();
      await f.cleanup();
    }
  },
);
it('uses the same full-screen coordinates for phone verification and image actions', async () => {
  const f = await fixture();
  try {
    const c = { ...f.calibration, geometryFrame: 'screen' as const };
    const metric = phonePointMm(c, f.screen, { x: 200, y: 400 });
    expect(metric.x).toBeCloseTo(100);
    expect(metric.y).toBeCloseTo(50);
    const point = screenContact(c, f.screen, { x: 499.5, y: 249.5 });
    expect(point.x).toBeCloseTo(c.origin.x + 100);
    expect(point.y).toBeCloseTo(c.origin.y - 50);
  } finally {
    await f.cleanup();
  }
});

it('forwards upstream motion ratios through the runtime instead of forcing one percent', async () => {
  const f = await fixture();
  try {
    const move = rstest.spyOn(f.adapter, 'moveLinear');
    await f.runtime.collectAutomaticPoints(f.binding, (host) =>
      host.move(pose(100, -50, 101), {
        speed: { kind: 'ratio', value: 0.025 },
        acceleration: { kind: 'ratio', value: 0.025 },
        timeoutMs: 10000,
      }),
    );
    expect(move).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        speed: { kind: 'ratio', value: 0.025 },
        acceleration: { kind: 'ratio', value: 0.025 },
      }),
    );
  } finally {
    await f.cleanup();
  }
});
