import { Alert, Button, Modal, Popconfirm, Space, Typography } from 'antd';
import { MapPin } from 'lucide-react';
import { useState } from 'react';
import { useDeviceControls } from '../../hooks/useDeviceControls';
import { t, useLanguage } from '../../i18n';
import { MotionSettings } from './MotionSettings';

/** Original safe-position operations, bound to the selected camera's Device. */
export function DeviceSettings({
  id,
  onRecorded,
}: { id: string; onRecorded?(): void }) {
  const arm = useDeviceControls(id);
  const language = useLanguage();
  const [open, setOpen] = useState(false);
  const state = arm.state?.state;
  const disabled =
    arm.busy ||
    !arm.data ||
    !state?.connected ||
    !state.enabled ||
    state.moving ||
    state.dragMode ||
    arm.state?.operation?.status === 'running';
  const submit = (mode: 'return' | 'record') => {
    void arm
      .run(async () => {
        const result = await arm.api.safePosition(mode);
        if (mode === 'record') onRecorded?.();
        return result;
      })
      .catch(() => undefined);
  };
  return (
    <>
      <MotionSettings arm={arm} showLabel />
      <Button icon={<MapPin size={16} />} onClick={() => setOpen(true)}>
        {language === 'zh' ? '安全点' : 'Safe position'}
      </Button>
      <Modal
        open={open}
        className="robot-settings-detail"
        title={
          <>
            <MapPin size={18} />
            {language === 'zh' ? '安全点' : 'Safe position'}
          </>
        }
        footer={null}
        onCancel={() => {
          if (!arm.busy) setOpen(false);
        }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            {t('Move clear of the screen, exit Drag Mode, then save.')}
          </Typography.Text>
          {arm.data && (
            <div className="settings-position-grid">
              {Object.entries(
                arm.data.calibration.observationPose.positionMm,
              ).map(([axis, value]) => (
                <div key={axis}>
                  <span>{axis.toUpperCase()}</span>
                  <strong>
                    {Number(value).toFixed(2)} <small>mm</small>
                  </strong>
                </div>
              ))}
            </div>
          )}
          {!arm.data && (
            <Alert type="info" message={t('Screen Calibration is required.')} />
          )}
          {state && !state.enabled && (
            <Alert
              type="info"
              message={
                language === 'zh'
                  ? '请先在标定界面确认负载并使能机械臂。'
                  : 'Confirm the payload and enable the arm in calibration first.'
              }
            />
          )}
          <Space wrap>
            <Popconfirm
              title={t('Return to Safe Position?')}
              disabled={disabled}
              onConfirm={() => submit('return')}
            >
              <Button type="primary" disabled={disabled} loading={arm.busy}>
                {t('Return to Safe Position')}
              </Button>
            </Popconfirm>
            <Popconfirm
              title={
                language === 'zh'
                  ? '将当前位置保存为安全点？'
                  : 'Save current position as the safe position?'
              }
              disabled={disabled}
              onConfirm={() => submit('record')}
            >
              <Button disabled={disabled} loading={arm.busy}>
                {t('Save Current Position')}
              </Button>
            </Popconfirm>
            <Button
              disabled={arm.busy}
              onClick={() => void arm.refresh().catch(() => undefined)}
            >
              {language === 'zh' ? '重新加载' : 'Reload'}
            </Button>
          </Space>
          {arm.error && <Alert type="error" message={arm.error} />}
        </Space>
      </Modal>
      {arm.error && !open && (
        <Typography.Text type="danger">{arm.error}</Typography.Text>
      )}
    </>
  );
}
