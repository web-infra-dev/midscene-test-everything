import { afterEach, expect, it, rstest } from '@rstest/core';
import type {
  AssistedCalibrationState,
  CalibrationBatchState,
  CalibrationSession,
  CalibrationSnapshot,
} from '../../src/ui/calibration/robot-arm-api';
import { robotCue, robotVoice } from '../../src/ui/calibration/voice/browser';
import {
  batchAnnouncements,
  calibrationAnnouncements,
} from '../../src/ui/calibration/voice/calibration';

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

it('keeps phone setup, marker capture and mapping silent', () => {
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
  expect(events()).toEqual([]);
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

it('announces travel and boundary checks without narrating routine sampling phases', () => {
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
  send('avoiding-camera');
  send('review');
  send('review');
  send('completed');
  expect(events()).toEqual([
    'approachStart',
    'referenceReturn',
    'autoVerifying',
    'autoAvoiding',
    'autoReview',
  ]);
  expect(click.mock.calls).toEqual([['click']]);
  expect(voice).toHaveBeenCalledWith('referenceReturn', 2, 'calibration');
});

it('announces automatic shared parking once, including a retry after interruption', () => {
  const { events } = listen();
  const announce = batchAnnouncements();
  const batch: CalibrationBatchState = {
    id: 'batch',
    revision: 1,
    status: 'running',
    currentIndex: 0,
    items: [
      {
        deviceId: 'phone',
        screenId: 'phone',
        name: 'Phone',
        attempts: 1,
        runIds: [],
        status: 'completed',
      },
    ],
  };
  announce(batch);
  const parking = {
    ...batch,
    currentIndex: 1,
    automaticSharedParking: true as const,
  };
  announce({ ...parking, revision: 2 });
  announce({ ...parking, revision: 3 });
  announce({ ...batch, currentIndex: 1, status: 'failed', revision: 4 });
  announce({ ...parking, revision: 5 });
  announce({ ...batch, status: 'completed', revision: 6 });
  announce({ ...batch, status: 'completed', revision: 7 });
  expect(events()).toEqual([
    'autoAvoiding',
    'autoFailed',
    'autoAvoiding',
    'batchCompleted',
  ]);
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
  expect(events()).toEqual(['autoFailed', 'autoStarted', 'autoFailed']);
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
  expect(events()).toEqual(['autoStarted']);
  update(6, 'waiting', 'awaiting-acceptance', 'awaiting-acceptance');
  update(7, 'waiting', 'awaiting-acceptance', 'awaiting-acceptance');
  update(8, 'stopping', 'exploring');
  update(9, 'stopped', 'stopped');
  expect(events()).toEqual(['autoStarted', 'autoReview', 'batchStopping']);
});
