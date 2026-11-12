import { expect, it } from '@rstest/core';
import {
  automaticMarkerPages,
  calibrationTargetsAfterPairing,
  needsPhoneConnectionBeforeAddScreen,
  selectableScreens,
} from '../../src/ui/calibration/screen-selection';

it('keeps a removed phone out of automatic pairing while allowing new phones and explicit reassignment', () => {
  const targets = new Set(['harmony']);
  const remaining = [{ id: 'paired', screenId: 'harmony' }, { id: 'new' }];
  for (const screenId of ['removed', undefined]) {
    expect(
      automaticMarkerPages(
        [{ id: 'android', screenId }, ...remaining],
        targets,
        ['android'],
      ),
    ).toEqual(remaining);
  }
  const assigned = { id: 'android', screenId: 'replacement' };
  targets.add('replacement');
  expect(automaticMarkerPages([assigned], targets, ['android'])).toEqual([
    assigned,
  ]);
});

it('leaves a released phone available for explicit Add Screen after reopening marker detection', () => {
  const targets = new Set(['new-target']);
  const released = { id: 'android', cameraId: 'cam', mode: 'waiting' };
  const fresh = { id: 'new-phone', mode: 'waiting' };
  const pages = [released, fresh];
  expect(automaticMarkerPages(pages, targets)).toEqual([fresh]);
  expect(automaticMarkerPages(pages, targets, [], true)).toEqual(pages);
  expect(automaticMarkerPages(pages, targets, [released.id], true)).toEqual([
    fresh,
  ]);
});

it('keeps a newly added screen selectable before its first calibration', () => {
  const screens = [
    {
      id: 'calibrated',
      cameraId: 'camera',
      hasCorrection: true,
      markerSlot: 0,
    },
    { id: 'new', cameraId: 'camera' },
    { id: 'other', cameraId: 'other-camera' },
  ];
  expect(
    selectableScreens(screens, 'camera').map((screen) => screen.id),
  ).toEqual(['calibrated', 'new']);
});

it('starts the first pass on all visible phones paired with this camera', () => {
  const screens = [
    { id: 'camera', cameraId: 'camera' },
    { id: 'right', cameraId: 'camera' },
    { id: 'offline', cameraId: 'camera' },
  ];
  const pages = [
    { cameraId: 'camera', screenId: 'camera', visible: true },
    { cameraId: 'camera', screenId: 'right', visible: true },
    { cameraId: 'camera', screenId: 'offline', visible: false },
    { cameraId: 'other-camera', screenId: 'other', visible: true },
  ];
  for (const claimed of [[], ['camera'], ['camera', 'right']]) {
    expect(
      calibrationTargetsAfterPairing(
        screens,
        'camera',
        pages,
        new Set(claimed),
      ),
    ).toEqual({
      first: true,
      screenIds: ['camera', 'right'],
    });
  }
});

it('reuses the target claimed during pairing alongside a saved screen', () => {
  const screens = [
    { id: 'left', cameraId: 'camera', hasSavedPerspective: true },
    { id: 'right', cameraId: 'camera' },
  ];
  const pages = [
    { cameraId: 'camera', screenId: 'left' },
    { cameraId: 'camera', screenId: 'right' },
  ];
  expect(
    calibrationTargetsAfterPairing(screens, 'camera', pages, new Set(['left'])),
  ).toEqual({
    first: false,
    screenIds: ['right'],
  });
});

it('allocates a new target for a released page without reusing the remaining screen', () => {
  const screens = [{ id: 'left', cameraId: 'camera' }];
  for (const screenId of [undefined, 'removed']) {
    const pages = [
      { cameraId: 'camera', screenId: 'left' },
      { cameraId: 'camera', screenId },
    ];
    expect(
      calibrationTargetsAfterPairing(
        screens,
        'camera',
        pages,
        new Set(['left']),
      ),
    ).toEqual({
      first: false,
      screenIds: [],
    });
  }
});

it('connects phone pages before creating the first screen targets', () => {
  expect(needsPhoneConnectionBeforeAddScreen([], 'camera')).toBe(true);
  expect(
    needsPhoneConnectionBeforeAddScreen(
      [{ id: 'screen-1', cameraId: 'camera', markerSlot: 1 }],
      'camera',
    ),
  ).toBe(true);
  expect(
    needsPhoneConnectionBeforeAddScreen(
      [
        { id: 'screen-1', cameraId: 'camera', hasCorrection: true },
        { id: 'screen-2', cameraId: 'camera' },
      ],
      'camera',
    ),
  ).toBe(false);
  expect(
    needsPhoneConnectionBeforeAddScreen(
      [{ id: 'screen-1', cameraId: 'camera', hasCorrection: true }],
      'camera',
      [{ cameraId: 'camera' }],
    ),
  ).toBe(true);
  expect(
    needsPhoneConnectionBeforeAddScreen(
      [{ id: 'screen-1', cameraId: 'camera', hasCorrection: true }],
      'camera',
      [{ cameraId: 'camera', screenId: 'deleted-screen' }],
    ),
  ).toBe(true);
  expect(
    needsPhoneConnectionBeforeAddScreen(
      [{ id: 'screen-1', cameraId: 'camera', hasCorrection: true }],
      'camera',
      [{ cameraId: 'other-camera' }],
    ),
  ).toBe(false);
});
