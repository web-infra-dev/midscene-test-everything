import { expect, it } from '@rstest/core';
import { hasMultipleCalibrationTargets } from '../../src/ui/calibration/multi-screen-review';

it('offers the aggregate review only for multiple calibration targets', () => {
  expect(hasMultipleCalibrationTargets(undefined)).toBe(false);
  expect(hasMultipleCalibrationTargets({ targets: [] })).toBe(false);
  expect(hasMultipleCalibrationTargets({ targets: [{}] })).toBe(false);
  expect(hasMultipleCalibrationTargets({ targets: [{}, {}] })).toBe(true);
});
