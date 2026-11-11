import { expect, it } from '@rstest/core';
import {
  needsPhoneConnectionBeforeAddScreen,
  selectableScreens,
} from '../src/screen-selection';

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

it('connects phone pages before creating the first screen targets', () => {
  expect(needsPhoneConnectionBeforeAddScreen([], 'camera')).toBe(true);
  expect(
    needsPhoneConnectionBeforeAddScreen(
      [{ cameraId: 'camera', markerSlot: 1 }],
      'camera',
    ),
  ).toBe(true);
  expect(
    needsPhoneConnectionBeforeAddScreen(
      [{ cameraId: 'camera', hasCorrection: true }, { cameraId: 'camera' }],
      'camera',
    ),
  ).toBe(false);
});
