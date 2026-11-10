import {
  type CalibrationQualityReading,
  needsQualityReview,
} from '../../assisted-contracts.js';
import type {
  AutoCalibrationEvidence,
  PlaneQuality,
  ScreenProfile,
} from '../../contracts.js';
import { SAMPLED_SURFACE_LIMIT_MM } from '../surface.js';

/** XY errors use the measured short edge. Z errors use the supported surface compensation range. */
export function explorationQualityWarnings(
  screen: Pick<ScreenProfile, 'physicalWidthMm' | 'physicalHeightMm'>,
  plane: PlaneQuality,
  evidence: AutoCalibrationEvidence,
  fastBoundary = false,
): CalibrationQualityReading[] {
  const short = Math.min(screen.physicalWidthMm, screen.physicalHeightMm);
  const long = Math.max(screen.physicalWidthMm, screen.physicalHeightMm);
  const readings: CalibrationQualityReading[] = [
    {
      label: 'Grid RMS',
      percent: (evidence.gridRmsMm / short) * 100,
      targetPercent: fastBoundary ? 0.5 : 1,
    },
    {
      label: 'Holdout maximum',
      percent: (evidence.validationMaxMm / short) * 100,
      targetPercent: fastBoundary ? 1 : 1.5,
    },
    {
      label: 'Touch coverage',
      percent: evidence.coverage * 100,
      targetPercent: 60,
      minimum: true,
    },
    {
      label: 'Plane RMS',
      percent:
        (Math.max(plane.rmseMm, evidence.planeRmseMm) /
          SAMPLED_SURFACE_LIMIT_MM) *
        100,
      targetPercent: 25,
    },
    {
      label: 'Plane inliers',
      percent: (plane.inliers / plane.total) * 100,
      targetPercent: 80,
      minimum: true,
    },
    {
      label: 'Plane sample span',
      percent:
        Math.min(plane.minorSpanMm / short, plane.majorSpanMm / long) * 100,
      targetPercent: 25,
      minimum: true,
    },
  ];
  // Older recordings predate these diagnostics and enforced their nominal targets when fitted.
  if (evidence.validationHeightMaxMm !== undefined)
    readings.push({
      label: 'Holdout height error',
      percent:
        (evidence.validationHeightMaxMm / SAMPLED_SURFACE_LIMIT_MM) * 100,
      targetPercent: 50,
    });
  if (evidence.axisSkewRatio !== undefined)
    readings.push({
      label: 'Screen axis skew',
      percent: evidence.axisSkewRatio * 100,
      targetPercent: 3,
    });
  return readings.filter(needsQualityReview);
}
