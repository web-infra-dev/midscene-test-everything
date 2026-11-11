import { afterEach, expect, it, rstest } from '@rstest/core';
import type {
  AssistedCalibrationState,
  CalibrationBatchState,
  CalibrationSession,
  CalibrationSnapshot,
} from '../src/robot-arm-api';
import { robotCue, robotVoice } from '../src/voice/browser';
import {
  batchAnnouncements,
  calibrationAnnouncements,
} from '../src/voice/calibration';

const initial: CalibrationSnapshot = {
  session: null,
  setup: { prepared: true, phoneConnected: false },
  phone: { state: 'waiting', links: [] },
};
const pose = {
  frame: 'base' as const,
  positionMm: { x: 0, y: 0, z: 40 },
  orientation: { x: 0, y: 0, z: 0, w: 1 },
};
const capture = {
  index: 1,
  total: 3,
  phase: 'waiting' as const,
  readings: 0,
  progress: 0,
  target: { id: 'point', point: { x: 20, y: 20 } },
};
function session(
  stage: AssistedCalibrationState['stage'],
  data: Partial<AssistedCalibrationState> = {},
): AssistedCalibrationState {
  return {
    id: 'attempt',
    stage,
    samples: 0,
    anchors: [],
    points: [],
    verification: [],
    phoneConnected: true,
    ...data,
  };
}
function boundary(
  group: 'hover' | 'contact',
  index: number,
): CalibrationSession {
  return {
    id: 'boundary',
    robotProfileId: 'arm',
    toolProfileId: 'tool',
    screenProfileId: 'screen',
    status: 'active',
    stage: 'verification',
    revision: 1,
    dragMode: false,
    context: {
      adapterId: 'test',
      connectionIdentity: 'test',
      robotGeometryRevision: 1,
      toolGeometryRevision: 1,
      screenGeometryRevision: 1,
      verificationKey: 'check',
      workstationRevision: 1,
    },
    boundary: { hoverCorners: false, hoverEdges: false, hoverHuman: false },
    progress: { group, task: 'edges', index, total: 4 },
  };
}
function listen() {
  const voice = rstest.spyOn(robotVoice, 'notify').mockImplementation(() => {});
  const click = rstest.spyOn(robotCue, 'play').mockReturnValue(true);
  return {
    events: () => voice.mock.calls.map(([event]) => event),
    voice,
    click,
  };
}
afterEach(() => rstest.restoreAllMocks());

it('waits for changes in phone display mode, marker requests and actual mapping checks', () => {
  const { events } = listen();
  const announce = calibrationAnnouncements();
  announce(initial);
  const updatePhone = (phone: Partial<CalibrationSnapshot['phone']>) =>
    announce({ ...initial, phone: { ...initial.phone, ...phone } });
  updatePhone({ state: 'connected', displayRequirement: 'home-screen' });
  updatePhone({ state: 'connected', displayRequirement: 'fullscreen' });
  updatePhone({ state: 'connected' });
  updatePhone({ state: 'paused' });
  updatePhone({ state: 'reconnecting' });
  updatePhone({ state: 'connected' });
  const updateSetup = (setup: Partial<CalibrationSnapshot['setup']>) =>
    announce({
      ...initial,
      phone: { state: 'connected', links: [] },
      setup: { ...initial.setup, ...setup },
    });
  for (const attempt of [1, 1, 2])
    updateSetup({
      markerCapture: { request: String(attempt), attempt, captureAt: 10 },
    });
  for (const mappingCheck of [
    'checking',
    'failed',
    'failed',
    'checking',
    'confirmed',
  ] as const)
    updateSetup({ mappingCheck });
  expect(events()).toEqual([
    'phoneHomeScreen',
    'phoneFullscreen',
    'phoneReady',
    'phoneLost',
    'phoneReady',
    'markersCountdown',
    'markersRetry',
    'mappingStart',
    'mappingFailed',
    'mappingStart',
    'mappingDone',
  ]);
});

it('prioritizes loss of phone feedback when the same snapshot also changes a routine step', () => {
  const { events } = listen();
  const announce = calibrationAnnouncements();
  announce({ ...initial, phone: { state: 'connected', links: [] } });
  announce({
    ...initial,
    session: session('ready', { referencePosition: pose }),
    phone: { state: 'reconnecting', links: [] },
  });
  expect(events()).toEqual(['phoneLost']);
});

it('announces reference travel, sampling phases and boundary groups once per transition', () => {
  const { events, click, voice } = listen();
  const announce = calibrationAnnouncements();
  const send = (
    stage: AssistedCalibrationState['stage'],
    data?: Partial<AssistedCalibrationState>,
  ) => announce({ ...initial, session: session(stage, data) });
  send('completed');
  expect(events()).toEqual([]);
  send('ready', { referencePosition: pose, teachingId: 'saved' });
  send('collecting', { referenceTravel: 'approach', automaticPhase: 'local' });
  send('collecting', { capture, automaticPhase: 'local' });
  const grid = { capture, automaticPhase: 'grid' as const, samples: 1 };
  send('collecting', grid);
  send('collecting', { ...grid, capture: { ...capture, index: 2 } });
  send('collecting', { ...grid, referenceTravel: 'return' });
  send('collecting', grid);
  send('boundary-review');
  send('returning');
  send('safety');
  for (const group of ['hover', 'contact'] as const) {
    for (const index of [1, 2, 3])
      send('safety', { calibration: boundary(group, index) });
  }
  send('avoiding-camera');
  send('review');
  send('completed');
  expect(events()).toEqual([
    'samplingReady',
    'approachStart',
    'directionProbe',
    'autoSampling',
    'referenceReturn',
    'boundaryReview',
    'autoVerifying',
    'hover',
    'contact',
    'autoAvoiding',
    'autoReview',
    'autoCompleted',
  ]);
  expect(click.mock.calls).toEqual([['click']]);
  expect(voice).toHaveBeenCalledWith('contact', 2, 'calibration');
});

it('distinguishes the three taught positions, operator waits and a confirmed retry', () => {
  const { events, click } = listen();
  const announce = calibrationAnnouncements();
  announce(initial);
  const send = (s: AssistedCalibrationState) =>
    announce({ ...initial, session: s });
  send(session('ready'));
  send(session('positioning'));
  send(session('ready', { referencePosition: pose }));
  send(session('positioning-boundary'));
  send(
    session('ready', { referencePosition: pose, cameraBoundaryPosition: pose }),
  );
  send(
    session('ready', {
      referencePosition: pose,
      cameraBoundaryPosition: pose,
      teachingId: 'saved',
    }),
  );
  send(session('return-ready'));
  send(session('positioning-safe'));
  send(
    session('interrupted', {
      explorationMode: 'slide',
      collectionFailed: true,
    }),
  );
  send(session('collecting', { id: 'retry', samples: 2 }));
  send(
    session('interrupted', {
      id: 'retry',
      explorationMode: 'slide',
      collectionFailed: true,
      awaitingSocketRecovery: true,
    }),
  );
  expect(events()).toEqual([
    'teachReference',
    'teachReference',
    'samplingReady',
    'teachBoundary',
    'confirmCorridor',
    'samplingReady',
    'autoWaitingSafe',
    'recordSafe',
    'retryRegular',
    'autoStarted',
    'autoFailed',
  ]);
  expect(click).not.toHaveBeenCalled();
});

it('leaves batch acceptance to the coordinator and ignores polling repeats and stale revisions', () => {
  const { events } = listen();
  const screen = calibrationAnnouncements('batch');
  screen(initial);
  for (const stage of ['ready', 'collecting', 'review', 'completed'] as const)
    screen({ ...initial, session: session(stage) });
  expect(events()).toEqual(['autoStarted']);
  const announce = batchAnnouncements();
  const item = {
    deviceId: 'phone',
    screenId: 'phone',
    name: 'Phone',
    runIds: [],
    attempts: 1,
  };
  const update = (
    revision: number,
    status: CalibrationBatchState['status'],
    row: CalibrationBatchState['items'][number]['status'],
    phase?: string,
  ) =>
    announce({
      id: 'batch',
      revision,
      status,
      currentIndex: 0,
      items: [
        {
          ...item,
          status: row,
          progress: phase ? { phase, index: 1, total: 1 } : undefined,
        },
      ],
    });
  update(1, 'completed', 'completed'); // history on opening
  announce(null);
  update(1, 'waiting', 'awaiting-mapping');
  update(2, 'waiting', 'awaiting-placement');
  update(3, 'waiting', 'awaiting-placement');
  update(2, 'waiting', 'awaiting-mapping');
  update(4, 'waiting', 'awaiting-boundary-review');
  update(5, 'waiting', 'awaiting-acceptance', 'awaiting-safe-position');
  update(6, 'waiting', 'awaiting-acceptance', 'awaiting-acceptance');
  update(7, 'stopping', 'exploring');
  update(8, 'stopped', 'stopped');
  update(9, 'completed', 'completed');
  expect(events()).toEqual([
    'autoStarted',
    'mappingWaiting',
    'batchPlacement',
    'boundaryReview',
    'autoWaitingSafe',
    'autoReview',
    'batchStopping',
    'batchStopped',
    'batchCompleted',
  ]);
});
