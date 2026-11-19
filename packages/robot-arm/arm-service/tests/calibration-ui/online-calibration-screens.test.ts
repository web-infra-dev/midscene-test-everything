import { expect, it } from '@rstest/core';
import { selectOnlineCalibrationScreens } from '../../src/ui/calibration/online-calibration-screens';

const screens = [
  { id: 'desktop', pageKey: 'desktop-page' },
  { id: 'phone', pageKey: 'phone-page' },
];

it('keeps only screens whose bound pages are currently online and active', () => {
  expect(
    selectOnlineCalibrationScreens(screens, 'camera', [
      {
        cameraId: 'camera',
        mode: 'mapping',
        pageKey: 'desktop-page',
        visible: true,
      },
      {
        cameraId: 'camera',
        mode: 'waiting',
        pageKey: 'phone-page',
        visible: true,
      },
    ]).map((screen) => screen.id),
  ).toEqual(['desktop']);

  expect(
    selectOnlineCalibrationScreens(screens, 'camera', [
      {
        cameraId: 'camera',
        mode: 'mapping',
        screenId: 'desktop',
        visible: false,
      },
      {
        cameraId: 'camera',
        mode: 'markers',
        screenId: 'phone',
        visible: true,
      },
    ]).map((screen) => screen.id),
  ).toEqual(['phone']);
});
