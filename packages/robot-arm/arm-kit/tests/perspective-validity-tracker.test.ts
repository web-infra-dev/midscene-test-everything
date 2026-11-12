import { expect, it } from '@rstest/core';
import { PerspectiveValidityTracker } from '../src/camera/perspective-validity-tracker.js';
import type { PerspectiveValidityResult } from '../src/camera/perspective-validity.js';

function raw(
  state: 'invalid' | 'valid' | 'unverified',
): PerspectiveValidityResult {
  return {
    state,
    verdict:
      state === 'invalid'
        ? 'mismatch'
        : state === 'valid'
          ? 'aligned'
          : 'uncertain',
    confidence: 'high',
    reasonCode:
      state === 'invalid'
        ? 'SHIFTED'
        : state === 'valid'
          ? 'ALIGNED'
          : 'INSUFFICIENT_EVIDENCE',
    driftPx: state === 'valid' ? 0 : 7,
    driftRatio: state === 'valid' ? 0 : 0.025,
    scaleDelta: 0,
    rotationDeg: 0,
    fitResidualPx: 1,
    screenWidthPx: 280,
    sourceWidth: 1280,
    sourceHeight: 720,
    edges: [],
    texture: { inside: 1, outside: 1, ratio: 1 },
    band: { widthsPx: [0, 0, 0, 0], foreignSides: [], maxRatio: 0 },
  };
}

it('retains a measured mismatch across weak frames instead of alternating to unverified', () => {
  const tracker = new PerspectiveValidityTracker();
  tracker.observe({
    cameraId: 'camera',
    key: 'preset',
    frameId: 1,
    at: 0,
    raw: raw('invalid'),
  });
  for (let frameId = 2; frameId < 8; frameId++) {
    const result = tracker.observe({
      cameraId: 'camera',
      key: 'preset',
      frameId,
      at: frameId * 750,
      raw: raw('unverified'),
    });
    expect(result.state).toBe('invalid');
    expect(result.temporal).toMatchObject({
      currentState: 'unverified',
      retainedMismatch: true,
      mismatchFrameId: 1,
    });
  }
});

it('requires three distinct aligned frames over 1.5 seconds before recovering', () => {
  const tracker = new PerspectiveValidityTracker();
  const observe = (
    frameId: number,
    at: number,
    state: 'invalid' | 'valid' | 'unverified',
  ) =>
    tracker.observe({
      cameraId: 'camera',
      key: 'preset',
      frameId,
      at,
      raw: raw(state),
    });
  observe(1, 0, 'invalid');
  expect(observe(2, 750, 'valid').state).toBe('invalid');
  expect(observe(2, 2250, 'valid').state).toBe('invalid');
  expect(observe(3, 1500, 'valid').state).toBe('invalid');
  expect(observe(4, 2250, 'valid').state).toBe('valid');
});

it('discards recovery evidence on an uncertain frame and resets for new calibration', () => {
  const tracker = new PerspectiveValidityTracker();
  tracker.observe({
    cameraId: 'camera',
    key: 'old',
    frameId: 1,
    at: 0,
    raw: raw('invalid'),
  });
  tracker.observe({
    cameraId: 'camera',
    key: 'old',
    frameId: 2,
    at: 750,
    raw: raw('valid'),
  });
  tracker.observe({
    cameraId: 'camera',
    key: 'old',
    frameId: 3,
    at: 1500,
    raw: raw('unverified'),
  });
  expect(
    tracker.observe({
      cameraId: 'camera',
      key: 'old',
      frameId: 4,
      at: 2250,
      raw: raw('valid'),
    }).temporal?.recoveryFrames,
  ).toBe(1);
  expect(
    tracker.observe({
      cameraId: 'camera',
      key: 'new',
      frameId: 5,
      at: 3000,
      raw: raw('unverified'),
    }).state,
  ).toBe('unverified');
});

it('keeps mismatch across a capture restart while rebuilding recovery from distinct new frames', () => {
  const tracker = new PerspectiveValidityTracker();
  const observe = (
    frameId: number,
    at: number,
    state: 'invalid' | 'valid' | 'unverified',
  ) =>
    tracker.observe({
      cameraId: 'camera',
      key: 'preset',
      frameId,
      at,
      raw: raw(state),
    });
  observe(50, 0, 'invalid');
  expect(observe(51, 750, 'valid').state).toBe('invalid');
  expect(observe(1, 1500, 'valid').temporal?.recoveryFrames).toBe(1);
  expect(observe(2, 2250, 'valid').state).toBe('invalid');
  expect(observe(3, 3000, 'valid').state).toBe('valid');
});

it('rejects out-of-order evidence and requires recovery again after a long frame gap', () => {
  const tracker = new PerspectiveValidityTracker();
  const observe = (
    frameId: number,
    at: number,
    state: 'invalid' | 'valid' | 'unverified',
  ) =>
    tracker.observe({
      cameraId: 'camera',
      key: 'preset',
      frameId,
      at,
      raw: raw(state),
    });
  observe(1, 0, 'invalid');
  observe(2, 750, 'valid');
  expect(observe(3, 700, 'valid').temporal?.recoveryFrames).toBe(1);
  expect(observe(4, 6000, 'valid').temporal?.recoveryFrames).toBe(1);
  expect(observe(5, 6750, 'valid').state).toBe('invalid');
  expect(observe(6, 7500, 'valid').state).toBe('valid');
});
