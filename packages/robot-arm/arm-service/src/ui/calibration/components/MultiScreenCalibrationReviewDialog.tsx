import type {
  DetectionFrame,
  MarkerCalibrationSession,
  MarkerCalibrationTarget,
} from '@midscene/robotics-shared/marker-contracts';
import { Alert, Button, Card, Modal, Space, Tag, Typography } from 'antd';
import { Check, Crosshair, ScanLine } from 'lucide-react';
import { useEffect } from 'react';
import { t } from '../i18n';
import { hasMultipleCalibrationTargets } from '../multi-screen-review';
import { speakCalibration } from '../voice/calibration';

export function MultiScreenCalibrationReviewDialog({
  session,
  frames,
  open,
  applying = false,
  error,
  retryingTargetId,
  onApply,
  onClose,
  onReview,
  onRetry,
}: {
  session?: MarkerCalibrationSession;
  frames: Partial<Record<string, DetectionFrame>>;
  open: boolean;
  applying?: boolean;
  /** Why the automatic apply did not run; kept visible instead of a toast. */
  error?: string;
  retryingTargetId?: string;
  onApply: () => void;
  onClose: () => void;
  onReview: (
    target: MarkerCalibrationTarget,
    frame: DetectionFrame | undefined,
  ) => void;
  onRetry: (target: MarkerCalibrationTarget) => void;
}) {
  const succeeded = session?.targets.filter(
    (target) => target.state === 'succeeded' && target.result,
  );
  const hasResult = Boolean(succeeded?.length);
  const visible = open && hasMultipleCalibrationTargets(session);
  useEffect(() => {
    if (visible && session)
      speakCalibration(hasResult ? 'markerReview' : 'markerFailed');
  }, [visible, session?.id, hasResult]);
  return (
    <Modal
      centered
      open={visible}
      title={t('Multi-screen calibration results')}
      width="min(820px, calc(100vw - 32px))"
      closable={!applying}
      maskClosable={!applying}
      onCancel={applying ? undefined : onClose}
      footer={
        <Space>
          <Button disabled={applying} onClick={onClose}>
            {t('Close')}
          </Button>
          <Button
            disabled={!succeeded?.length || Boolean(retryingTargetId)}
            icon={<Check size={16} />}
            loading={applying}
            onClick={onApply}
            type="primary"
          >
            {t('Apply All Results')}
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Typography.Paragraph>
          {t(
            'Each screen has its own perspective result. Review or retry screens individually, then apply all successful results together.',
          )}
        </Typography.Paragraph>
        {error ? (
          <Alert
            description={error}
            message={t('The detected screens were not applied automatically.')}
            showIcon
            type="error"
          />
        ) : null}
        {!succeeded?.length ? (
          <Alert
            showIcon
            type="error"
            message={t('No screen produced a usable calibration result')}
          />
        ) : null}
        <div className="calibration-result-list">
          {(session?.targets ?? []).map((target, index) => {
            const result = target.result;
            const frame = frames[target.id];
            return (
              <Card
                key={target.id}
                size="small"
                title={`${index + 1}. ${target.name}`}
                extra={
                  <Tag color={result ? 'success' : 'error'}>{target.state}</Tag>
                }
                actions={[
                  <Button
                    key="review"
                    type="link"
                    disabled={!result}
                    icon={<ScanLine size={15} />}
                    onClick={() => {
                      if (result) onReview(target, frame);
                    }}
                  >
                    {t('Review Result')}
                  </Button>,
                  <Button
                    key="retry"
                    type="link"
                    loading={retryingTargetId === target.id}
                    disabled={Boolean(
                      retryingTargetId && retryingTargetId !== target.id,
                    )}
                    icon={<Crosshair size={15} />}
                    onClick={() => onRetry(target)}
                  >
                    {t('Recalibrate This Screen')}
                  </Button>,
                ]}
              >
                {result ? (
                  <Space wrap size={[18, 6]}>
                    <span>
                      {t(
                        result.method === 'temporal'
                          ? 'Calibration Positions'
                          : 'Markers',
                      )}
                      : {result.markerIds.length}/
                      {result.method === 'temporal' ? 13 : 6}
                    </span>
                    <span>
                      {t('Valid Frames')}: {result.validFrames}/
                      {result.frameCount}
                    </span>
                    <span>
                      {t('Reprojection Error')}:{' '}
                      {result.reprojectionRmsePx.toFixed(2)} px
                    </span>
                    <span>
                      {t('Output Size')}: {result.screenWidthPx} ×{' '}
                      {result.screenHeightPx}
                    </span>
                  </Space>
                ) : (
                  <Alert
                    showIcon
                    type="error"
                    message={target.error ? t(target.error) : ''}
                  />
                )}
              </Card>
            );
          })}
        </div>
      </Space>
    </Modal>
  );
}
