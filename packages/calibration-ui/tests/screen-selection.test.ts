import { expect, it } from '@rstest/core';
import { selectableScreens } from '../src/screen-selection';

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
