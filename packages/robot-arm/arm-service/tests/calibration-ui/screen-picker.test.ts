import { expect, it } from '@rstest/core';
import { shouldShowScreenPicker } from '../../src/ui/calibration/screen-picker';

it('keeps later-step selectors while hiding the camera-mapping selector', () => {
  const base = {
    markerOpen: false,
    batchActive: false,
    screenCount: 2,
    soleScreen: false,
  };

  expect(shouldShowScreenPicker({ ...base, step: 1 })).toBe(false);
  expect(shouldShowScreenPicker({ ...base, step: 2 })).toBe(true);
  expect(shouldShowScreenPicker({ ...base, step: 3 })).toBe(true);
  expect(shouldShowScreenPicker({ ...base, step: 3, soleScreen: true })).toBe(
    false,
  );
  expect(shouldShowScreenPicker({ ...base, step: 2, batchActive: true })).toBe(
    false,
  );
});
