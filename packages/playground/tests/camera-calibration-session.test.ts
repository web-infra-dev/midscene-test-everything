import { expect, it } from '@rstest/core';
import { CameraCalibrationSession } from '../src/server/camera-calibration-session';
import type { CameraScreenInfo } from '../src/server/camera-screens';

const screens: CameraScreenInfo[] = [
  {
    id: 'base',
    name: 'Screen 1',
    base: true,
    hasCorrection: false,
  },
  {
    id: 'screen-2',
    name: 'Screen 2',
    base: false,
    hasCorrection: false,
  },
];

const detection = {
  correction: {
    sourceWidth: 1920,
    sourceHeight: 1080,
    rotation: 0 as const,
    points: {
      topLeft: { x: 100, y: 100 },
      topRight: { x: 500, y: 100 },
      bottomRight: { x: 500, y: 900 },
      bottomLeft: { x: 100, y: 900 },
    },
  },
  jpeg: 'frame',
  markerIds: [10, 11, 12, 13],
  validFrames: 4,
  frameCount: 8,
  jitterPx: 0.2,
  errorPx: 0.4,
  screenWidthPx: 400,
  screenHeightPx: 800,
  rotation: 0 as const,
};

it('serializes simultaneous phone scans so each gets a distinct screen', async () => {
  const session = new CameraCalibrationSession('camera', screens);
  const [first, second] = await Promise.all([
    session.bind({} as never),
    session.bind({} as never),
  ]);
  expect(new Set([first.token, second.token]).size).toBe(2);
  expect(session.status()).toMatchObject([
    { name: 'Screen 1', claimed: true },
    { name: 'Screen 2', claimed: true },
  ]);
});

it('binds phones in order and detects every claimed screen in one run', async () => {
  const session = new CameraCalibrationSession('camera', screens);
  const phones = [
    await session.bind({} as never),
    await session.bind({} as never),
  ];
  for (const phone of phones) {
    phone.status = () => ({ state: 'ready', pageKey: 'page' });
    phone.capture = async () => detection;
  }
  const results = await session.detect(
    {} as never,
    new AbortController().signal,
  );
  expect(results).toMatchObject([
    { base: true, ok: true, name: 'Screen 1' },
    { base: false, ok: true, name: 'Screen 2' },
  ]);
  expect(session.status()).toMatchObject([
    { name: 'Screen 1', claimed: true, state: 'ready' },
    { name: 'Screen 2', claimed: true, state: 'ready' },
  ]);

  const acquired: (string | undefined)[] = [];
  const saved: (string | undefined)[] = [];
  const cameras = {
    async acquire(_id: string, _owner: string, screenId?: string) {
      acquired.push(screenId);
      return {
        async checkCorrection() {},
        async setPerspective(_correction: unknown, _target: unknown) {
          saved.push(screenId);
        },
      };
    },
    async release() {},
  };
  const applied = await session.apply(cameras as never);
  expect(applied.applied).toHaveLength(2);
  expect(applied.failed).toHaveLength(0);
  expect(acquired).toEqual([undefined, 'screen-2']);
  expect(saved).toEqual([undefined, 'screen-2']);
});
