import type {
  AssistedCalibrationState,
  CalibrationQualityReading,
} from '@midscene/robotics-shared/assisted-contracts';
import { CALIBRATION_RELATIVE_SLACK } from '@midscene/robotics-shared/assisted-contracts';
import { Alert, Button, Typography } from 'antd';
import { useState } from 'react';
import { t } from '../../i18n';

export function CalibrationQualityWarnings({
  warnings,
  advisory = false,
  dismissible = false,
}: {
  warnings?: CalibrationQualityReading[];
  advisory?: boolean;
  dismissible?: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || !warnings?.length) return null;
  return (
    <Alert
      type="warning"
      showIcon
      message={t(
        advisory
          ? 'Calibration quality warning'
          : 'Review calibration measurements',
      )}
      description={
        <>
          {t('Review targets allow {0}% relative measurement error.', [
            CALIBRATION_RELATIVE_SLACK * 100,
          ])}
          <ul>
            {warnings.map(({ label, percent, minimum, targetPercent }) => (
              <li key={label}>
                {t(
                  minimum
                    ? '{0} {1}% (target ≥{2}%)'
                    : '{0} {1}% (target ≤{2}%)',
                  [t(label), percent.toFixed(2), targetPercent],
                )}
              </li>
            ))}
          </ul>
          {dismissible && (
            <Button size="small" onClick={() => setDismissed(true)}>
              {t('Got it')}
            </Button>
          )}
        </>
      }
    />
  );
}

export function ExplorationQualitySummary({
  quality,
  advisory,
}: {
  quality?: AssistedCalibrationState['explorationQuality'];
  advisory?: boolean;
}) {
  if (!quality) return null;
  const { gridRmsMm, holdoutMaxMm, coverage, shortSideMm } = quality;
  const values = [
    gridRmsMm.toFixed(2),
    holdoutMaxMm.toFixed(2),
    (coverage * 100).toFixed(1),
  ];
  return (
    <>
      <Typography.Paragraph>
        {shortSideMm
          ? t(
              'Grid RMS {0} mm ({3}% of short edge) · Holdout maximum {1} mm ({4}%) · Coverage {2}%',
              [
                ...values,
                ((gridRmsMm / shortSideMm) * 100).toFixed(2),
                ((holdoutMaxMm / shortSideMm) * 100).toFixed(2),
              ],
            )
          : t(
              'Grid RMS {0} mm · Holdout maximum {1} mm · Coverage {2}%',
              values,
            )}
      </Typography.Paragraph>
      <CalibrationQualityWarnings
        warnings={quality.warnings}
        advisory={advisory}
      />
    </>
  );
}
