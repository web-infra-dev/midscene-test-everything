// Speed-work guard for the automatic exploration path.
//
// Each trace is produced through the production bridge (`AutomaticCapture`) with
// a deterministic phone, a tilted screen and fake timers. Standard retains its
// exact reference trace. Fast checks sliding samples, work budgets and parity
// between request-based and streamed phone feedback.
//
// Regenerate with: UPDATE_GOLDEN=1 pnpm --filter @midscene/arm-kit exec rstest \
//   run tests/exploration-measurement-trace.test.ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { afterEach, expect, it, rstest } from '@rstest/core';
import {
  type CalibrationPageUpdate,
  calibrationPageMarkers,
} from '../src/assisted-contracts.js';
import type { AutomaticExplorationMode } from '../src/assisted-contracts.js';
import { AutomaticCapture } from '../src/calibration/exploration/capture.js';
import { fitExploration } from '../src/calibration/exploration/fit.js';
import { fixture, pose } from './fixtures.js';

// The sampler and the phone observation wait with `node:timers/promises`, which
// fake timers do not intercept. Route it through the faked global timer instead.
rstest.mock('node:timers/promises', () => ({
  setTimeout: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
}));
afterEach(() => {
  rstest.useRealTimers();
});

const GOLDEN = new URL(
  './golden/exploration-measurement-trace.json',
  import.meta.url,
);

const round = (value: number, digits = 3) =>
  Number(value.toFixed(digits)) as number;

/** Work budget per scenario; a speed change may only lower these. */
const BUDGETS: Record<string, { moves: number; phoneResults: number }> = {
  // The tilted fixture takes several independently released height sweeps.
  fast: { moves: 85, phoneResults: 75 },
  standard: { moves: 163, phoneResults: 143 },
  // Streaming trades host requests for pushed frames: the page sends several
  // frames per confirmation, but the host only issues one prepare request.
  stream: { moves: 85, phoneResults: 640 },
};

type Scenario = 'fast' | 'standard' | 'stream';

async function trace(mode: Scenario) {
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
  const layout = {
    revision: 1,
    width: 400,
    height: 800,
    screen: { width: 400, height: 800, devicePixelRatio: 1 },
    markers: calibrationPageMarkers(400, 800),
  };
  let current = pose(50, -50, 40);
  let sequence = 0;
  let touching = false;
  const moves: Array<{
    x: number;
    y: number;
    z: number;
    speedRatio: number;
  }> = [];
  const phoneResults: Array<{
    outcome: string;
    point?: { x: number; y: number };
  }> = [];
  const timing: Record<string, number> = {};
  const reads = { count: 0 };
  // Tilted screen in the mock world. The slope keeps the plane non-trivial
  // while staying inside the fast-mode tilt and height-range limits.
  const surfaceZ = (x: number, y: number) =>
    30 + 0.02 * (x - 50) + 0.015 * (y + 50);
  let collector: AutomaticCapture;
  const send = () => {
    const capture = collector.snapshot().capture;
    const point = {
      x: round(current.positionMm.x * 4),
      y: round(-current.positionMm.y * 8),
    };
    const step = capture?.step;
    const update: CalibrationPageUpdate = {
      pageId: 'page',
      sequence: ++sequence,
      visible: true,
      layout,
      contact: touching ? { id: 'pen', motionRevision: 0, point } : undefined,
      targetReady: capture?.target.id,
      streamStepFeedback: mode === 'stream',
      stepFeedback: step
        ? {
            ...step,
            outcome: touching
              ? 'touched'
              : step.phase === 'prepare'
                ? 'ready'
                : 'no_touch',
            point: touching ? point : undefined,
          }
        : undefined,
    };
    if (update.stepFeedback?.phase === 'result')
      phoneResults.push({
        outcome: update.stepFeedback.outcome,
        ...(update.stepFeedback.point && { point: update.stepFeedback.point }),
      });
    collector.receive(update);
  };
  collector = new AutomaticCapture(
    layout,
    f.tool.offsetMm,
    () => queueMicrotask(send),
    (mode === 'standard' ? 'standard' : 'slide') as AutomaticExplorationMode,
  );
  send();
  const timer = setInterval(send, 20);
  const job = collector.run(
    {
      signal: abort.signal,
      check: () => abort.signal.throwIfAborted(),
      read: async () => {
        reads.count++;
        return current;
      },
      move: async (target, options) => {
        current = structuredClone(target);
        if (options?.speed?.kind !== 'ratio')
          throw new Error('Expected a speed ratio');
        moves.push({
          x: round(target.positionMm.x),
          y: round(target.positionMm.y),
          z: round(target.positionMm.z),
          speedRatio: round(options.speed.value, 4),
        });
        // Light-contact hysteresis: a held pointer releases two millimetres high.
        touching =
          current.positionMm.z <=
          surfaceZ(current.positionMm.x, current.positionMm.y) +
            (touching ? 2 : 0);
        send();
        return current;
      },
    },
    current,
    {
      tool: f.tool,
      screen: {
        ...f.screen,
        pixelWidth: 400,
        pixelHeight: 800,
        actionSpeed: { kind: 'ratio', value: 0.8 },
      },
      webToImage: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      onTiming: (event: string) => {
        timing[event] = (timing[event] ?? 0) + 1;
      },
    },
  );
  let settled = false;
  const settle = () => {
    settled = true;
  };
  void job.then(settle, settle);
  try {
    for (let step = 0; step < 600 && !settled; step++)
      await rstest.advanceTimersByTimeAsync(1000);
    await job;
    const collection = collector.upstreamResult;
    if (!collection) throw new Error('Exploration returned no samples');
    const result = fitExploration(
      collection,
      f.tool,
      f.runtime.capabilities,
      {
        id: 'trace',
        robotProfileId: f.binding.robotProfileId,
        toolProfileId: f.binding.toolProfileId,
        screenProfileId: f.binding.screenProfileId,
        robotGeometryRevision: f.robot.geometryRevision,
        toolGeometryRevision: f.tool.geometryRevision,
        screenGeometryRevision: f.screen.geometryRevision,
      },
      mode !== 'standard',
    );
    const toSample = (point: {
      contact: { x: number; y: number; z: number };
      screen: { x: number; y: number };
      zSource: string;
    }) => ({
      x: round(point.contact.x),
      y: round(point.contact.y),
      z: round(point.contact.z),
      screenX: round(point.screen.x),
      screenY: round(point.screen.y),
      zSource: point.zSource,
    });
    return {
      trace: {
        moves,
        phoneResults,
        samples: [
          ...collection.probes.map((probe) => ({
            role: 'probe',
            ...toSample(probe),
          })),
          ...collection.grid.map((sample) => ({
            role: sample.target.role,
            ...toSample(sample),
          })),
        ],
        evidence: {
          samplingMode: result.evidence.samplingMode,
          planeSource: result.evidence.planeSource,
          planeRmseMm: round(result.evidence.planeRmseMm, 4),
          measuredPlaneSamples: result.evidence.measuredPlaneSamples,
          predictedSamples: result.evidence.predictedSamples,
          predictedFraction: round(result.evidence.predictedFraction ?? 0, 4),
          predictedHeightResidualMaxMm: round(
            result.evidence.predictedHeightResidualMaxMm ?? 0,
            4,
          ),
          measuredHeightRangeMm:
            result.evidence.measuredHeightRangeMm === undefined
              ? null
              : round(result.evidence.measuredHeightRangeMm, 4),
          validationMaxMm: round(result.evidence.validationMaxMm, 4),
          validationHeightMaxMm:
            result.evidence.validationHeightMaxMm === undefined
              ? null
              : round(result.evidence.validationHeightMaxMm, 4),
          surfaceMaxMm: round(result.evidence.surfaceMaxMm ?? 0, 4),
          gridRmsPx: round(result.evidence.gridRmsPx, 4),
          gridRmsMm: round(result.evidence.gridRmsMm, 4),
          coverage: round(result.evidence.coverage, 4),
        },
        calls: {
          moves: moves.length,
          reads: reads.count,
          phoneResults: phoneResults.length,
        },
        timing,
      },
      moves: moves.length,
      phoneResults: phoneResults.length,
    };
  } finally {
    clearInterval(timer);
    rstest.useRealTimers();
    await f.cleanup();
  }
}

it('keeps the standard measurement trace and work budget stable', async () => {
  const measured = await trace('standard');
  const goldenPath = GOLDEN;
  const readGolden = async () => {
    try {
      return JSON.parse(await readFile(goldenPath, 'utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      return {};
    }
  };
  if (process.env.UPDATE_GOLDEN === '1') {
    const golden = await readGolden();
    golden.standard = measured.trace;
    await mkdir(new URL('./golden/', import.meta.url), { recursive: true });
    await writeFile(goldenPath, `${JSON.stringify(golden, null, 2)}\n`, 'utf8');
  }
  const golden = await readGolden();
  expect(measured.trace).toEqual(golden.standard);
  const budget = BUDGETS.standard;
  expect(measured.moves).toBeLessThanOrEqual(budget.moves);
  expect(measured.phoneResults).toBeLessThanOrEqual(budget.phoneResults);
}, 40000);

it('collects the same fast sliding measurements with both phone feedback modes', async () => {
  const fast = await trace('fast');
  const stream = await trace('stream');
  expect(stream.trace.samples).toEqual(fast.trace.samples);
  expect(stream.trace.moves).toEqual(fast.trace.moves);
  expect(stream.trace.evidence).toEqual(fast.trace.evidence);
  expect(stream.trace.timing).toEqual(fast.trace.timing);
  expect(
    fast.trace.samples
      .filter((sample) => sample.role === 'fit')
      .map((sample) => sample.zSource),
  ).toEqual(Array(4).fill('predicted'));
  expect(fast.trace.evidence.measuredPlaneSamples).toBeGreaterThanOrEqual(3);
  expect(fast.moves).toBeLessThanOrEqual(BUDGETS.fast.moves);
  expect(fast.phoneResults).toBeLessThanOrEqual(BUDGETS.fast.phoneResults);
  expect(stream.moves).toBeLessThanOrEqual(BUDGETS.stream.moves);
  expect(stream.phoneResults).toBeLessThanOrEqual(BUDGETS.stream.phoneResults);
}, 40000);
