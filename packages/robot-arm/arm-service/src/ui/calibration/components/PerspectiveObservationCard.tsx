import { Alert, Button, Space, Typography } from 'antd';
import { useEffect } from 'react';
import type { PerspectiveObservation } from '../hooks/usePerspectiveValidity';
import { t, useLanguage } from '../i18n';
import { speakCalibration } from '../voice/calibration';

/** A compact finding; raw frames remain visible beside the calibration controls. */
export function PerspectiveObservationCard({
  observation,
  screenName,
  onRecalibrate,
}: {
  observation: PerspectiveObservation;
  screenName?: string;
  onRecalibrate?: () => void;
}) {
  useLanguage();
  const validity = observation.summary;
  const review =
    validity?.state === 'invalid' ||
    validity?.state === 'suspected' ||
    (validity?.state === 'unverified' &&
      validity.driftRatio >= 0.005 &&
      (observation.check?.validity.edges.filter(
        (edge) => edge.class === 'on-edge',
      ).length ?? 0) >= 3);
  const invalid = validity?.state === 'invalid';
  useEffect(() => {
    if (invalid) speakCalibration('perspectiveInvalid', 2);
  }, [invalid, screenName]);
  if (!review && !observation.error) return null;
  const title = invalid
    ? t('Perspective correction is out of date')
    : observation.error
      ? t('Outline verification unavailable')
      : t('Outline may have shifted');
  return (
    <Alert
      className="perspective-observation"
      showIcon
      type={invalid ? 'error' : 'warning'}
      message={screenName ? `${screenName} · ${title}` : title}
      description={
        <Space direction="vertical" size={4}>
          <span>
            {t(
              invalid
                ? 'AI screenshots and taps use the wrong position until you recalibrate.'
                : observation.error
                  ? 'Keep the camera running. Outline verification will retry automatically.'
                  : 'The outline may be off the display area; review it and recalibrate.',
            )}
          </span>
          {validity && review && (
            <Typography.Text type="secondary">
              {t('Drift {0}% of screen width', [
                (validity.driftRatio * 100).toFixed(1),
              ])}
            </Typography.Text>
          )}
          {observation.check?.validity.temporal?.retainedMismatch && (
            <Typography.Text type="secondary">
              {t(
                'A confirmed mismatch needs stable aligned frames before recovery.',
              )}
            </Typography.Text>
          )}
        </Space>
      }
      action={
        review && onRecalibrate ? (
          <Button size="small" onClick={onRecalibrate}>
            {t('Recalibrate')}
          </Button>
        ) : undefined
      }
    />
  );
}
