import { expect, it } from '@rstest/core';
import {
  screensWithoutDraft,
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

it('does not mount the Add Screen draft until it is committed', () => {
  const screens = [{ id: 'existing' }, { id: 'draft' }];
  expect(
    screensWithoutDraft(screens, 'draft').map((screen) => screen.id),
  ).toEqual(['existing']);
  expect(screensWithoutDraft(screens, undefined)).toHaveLength(2);
});
