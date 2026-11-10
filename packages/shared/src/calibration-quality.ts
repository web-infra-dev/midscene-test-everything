import type { CameraMappingAccuracy } from './assisted-contracts.js';

/** Percent of the reference named by the metric. Targets include 10% relative measurement slack. */
export interface CalibrationQualityReading {
  label: string;
  percent: number;
  targetPercent: number;
  minimum?: boolean;
}

export const CALIBRATION_RELATIVE_SLACK = 0.1;

export function needsQualityReview(reading: CalibrationQualityReading) {
  const { percent, targetPercent, minimum } = reading;
  if (!Number.isFinite(percent) || percent < 0) return true;
  return minimum
    ? percent < targetPercent * (1 - CALIBRATION_RELATIVE_SLACK)
    : percent > targetPercent * (1 + CALIBRATION_RELATIVE_SLACK);
}

export function mappingQualityWarnings(
  accuracy: CameraMappingAccuracy,
  layout: { width: number; height: number },
): CalibrationQualityReading[] {
  const shortSide = Math.min(layout.width, layout.height);
  const percent = (cssPx: number) => (cssPx / shortSide) * 100;
  return [
    {
      label: 'Fit marker mean error',
      percent: percent(accuracy.fit.meanErrorCssPx),
      targetPercent: 0.75,
    },
    {
      label: 'Fit marker maximum error',
      percent: percent(accuracy.fit.maxErrorCssPx),
      targetPercent: 1,
    },
    {
      label: 'Check marker mean error',
      percent: percent(accuracy.validation.meanErrorCssPx),
      targetPercent: 0.75,
    },
    {
      label: 'Check marker maximum error',
      percent: percent(accuracy.validation.maxErrorCssPx),
      targetPercent: 1,
    },
  ].filter(needsQualityReview);
}
