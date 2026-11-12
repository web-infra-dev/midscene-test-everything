import { expect, test } from '@rstest/core';
import { PreviewGesture } from '../src/ui/preview/gesture';
import type { PreviewScreenGeometry } from '../src/ui/preview/projection';
import { createScreenProjections } from '../src/ui/preview/projection';

const screen: PreviewScreenGeometry = {
  id: 'screen-a',
  name: 'Screen A',
  correction: {
    points: {
      topLeft: { x: 100, y: 100 },
      topRight: { x: 700, y: 100 },
      bottomRight: { x: 700, y: 300 },
      bottomLeft: { x: 100, y: 300 },
    },
    sourceWidth: 800,
    sourceHeight: 400,
    rotation: 0,
  },
  target: { width: 801, height: 401, rotation: 0 },
  pixelWidth: 801,
  pixelHeight: 401,
  calibrationId: 'cal-a',
};

const make = () =>
  new PreviewGesture({
    projections: createScreenProjections([screen], 800, 400),
    longPressEnabled: true,
  });

test('sends a tap only after release inside the screen', () => {
  const gesture = make();
  expect(gesture.start(1, { x: 400, y: 200 }, 0).kind).toBe('started');
  expect(gesture.draft?.type).toBe('tap');
  expect(gesture.end(1, { x: 400, y: 200 }, 80)).toMatchObject({
    screenId: 'screen-a',
    action: { type: 'tap', point: { x: 400, y: 200 } },
  });
});

test('does not turn a short hold into a long press and keeps release timing', () => {
  const gesture = make();
  gesture.start(1, { x: 400, y: 200 }, 0);
  expect(gesture.end(1, { x: 400, y: 200 }, 499)?.action.type).toBe('tap');
  gesture.start(2, { x: 400, y: 200 }, 0);
  expect(gesture.tick(600)?.type).toBe('longPress');
  expect(gesture.end(2, { x: 400, y: 200 }, 700)).toMatchObject({
    action: { type: 'longPress', point: { x: 400, y: 200 } },
  });
});

test('turns a moved hold into a clipped swipe and rejects a zero-length path', () => {
  const gesture = make();
  gesture.start(1, { x: 400, y: 200 }, 0);
  const draft = gesture.move(1, { x: 500, y: 200 }, 200);
  expect(draft).toMatchObject({
    type: 'swipe',
    screenFrom: { x: 400, y: 200 },
    screenTo: { x: 533, y: 200 },
  });
  expect(gesture.end(1, { x: 500, y: 200 }, 400)).toMatchObject({
    action: { type: 'swipe', durationMs: 400 },
  });
  gesture.start(2, { x: 400, y: 200 }, 0);
  expect(gesture.end(2, { x: 400, y: 200 }, 50)?.action.type).toBe('tap');
});

test('swipes entering from outside clip at the screen edge and taps outside are ignored', () => {
  const gesture = make();
  gesture.start(1, { x: 50, y: 200 }, 0);
  expect(gesture.screen).toBeUndefined();
  expect(gesture.end(1, { x: 50, y: 200 }, 20)).toBeUndefined();
  gesture.start(2, { x: 50, y: 200 }, 0);
  const draft = gesture.move(2, { x: 200, y: 200 }, 100);
  expect(draft).toMatchObject({
    type: 'swipe',
    screenFrom: { x: 0, y: 200 },
  });
  const result = gesture.end(2, { x: 200, y: 200 }, 300);
  expect(result?.action).toMatchObject({
    type: 'swipe',
    from: { x: 0, y: 200 },
    durationMs: 300,
  });
});

test('cancels the gesture on pointer loss or source change', () => {
  const gesture = make();
  gesture.start(1, { x: 400, y: 200 }, 0);
  gesture.cancel();
  expect(gesture.active).toBe(false);
  expect(gesture.end(1, { x: 400, y: 200 }, 10)).toBeUndefined();
});
