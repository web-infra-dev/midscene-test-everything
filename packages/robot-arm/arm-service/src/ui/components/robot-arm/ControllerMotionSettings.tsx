import {
  Alert,
  Button,
  InputNumber,
  Modal,
  Space,
  Spin,
  Typography,
} from 'antd';
import { Gauge } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { RobotArmController } from '../../hooks/useRobotArm';
import { t, useLanguage } from '../../i18n';
import {
  RobotArmApiError,
  type ControllerMotionSettings as Settings,
} from '../../robot-arm-api';
import { RobotDialogTitle } from './RobotDialogTitle';

const fields = [
  ['globalSpeedPercent', 'Global Speed (%)'],
  ['linearSpeed', 'XYZ Speed (mm/s)'],
  ['linearAcceleration', 'XYZ Acceleration (mm/s²)'],
  ['linearJerk', 'XYZ Jerk (mm/s³)'],
] as const;

function settingsError(error: unknown): string {
  if (error instanceof RobotArmApiError) {
    if (error.code === 'STALE_CONTROLLER_SETTINGS')
      return t('Controller parameters changed. Reload before saving.');
    if (error.code === 'CONTROLLER_SETTINGS_NOT_IDLE')
      return t(
        'Disable the robot and wait until it is stationary and fault-free before saving.',
      );
    if (error.code === 'CONTROLLER_SETTINGS_UNCONFIRMED')
      return t(
        'Controller parameter application is unconfirmed. Reload and check the saved values.',
      );
  }
  return t('Controller motion settings failed: {0}', [
    error instanceof Error ? error.message : String(error),
  ]);
}

export function ControllerMotionSettings({ arm }: { arm: RobotArmController }) {
  useLanguage();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<Settings>();
  const [draft, setDraft] = useState<Partial<Settings['values']>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const epoch = useRef(0);
  const installation =
    arm.setup?.installationId ?? arm.adapter?.connectionIdentity;
  useEffect(() => {
    setOpen(false);
    setDisabling(false);
    setSaving(false);
    setLoading(false);
    epoch.current++;
    return () => {
      epoch.current++;
    };
  }, [installation]);
  const supported = arm.capabilities?.controls.includes(
    'control.motion-settings',
  );
  const busy =
    arm.busy ||
    saving ||
    disabling ||
    arm.state?.operation?.status === 'running';
  const canSave =
    !busy &&
    !loading &&
    snapshot &&
    !arm.state?.state.enabled &&
    arm.state?.state.connected &&
    !arm.state?.state.moving &&
    !arm.state?.state.dragMode &&
    !arm.state?.softwarePaused &&
    !arm.state?.recoveryRequired &&
    !arm.state?.state.faults.length;
  const load = async () => {
    const token = ++epoch.current;
    setLoading(true);
    setSnapshot(undefined);
    setError(undefined);
    setSaved(false);
    try {
      const value = await arm.api.controllerMotionSettings();
      if (epoch.current !== token) return;
      setSnapshot(value);
      setDraft(value.values);
    } catch (e) {
      if (epoch.current === token) setError(settingsError(e));
    } finally {
      if (epoch.current === token) setLoading(false);
    }
  };
  const disable = async () => {
    if (
      busy ||
      !arm.state?.state.enabled ||
      !arm.capabilities?.controls.includes('control.disable')
    )
      return;
    const token = epoch.current;
    setDisabling(true);
    setError(undefined);
    await arm
      .run(async () => {
        try {
          await arm.api.disable();
        } catch (e) {
          if (epoch.current === token) setError(settingsError(e));
          throw e;
        }
      })
      .finally(() => {
        if (epoch.current === token) setDisabling(false);
      });
  };
  const close = () => {
    if (saving || disabling) return;
    epoch.current++;
    setOpen(false);
  };
  const save = async () => {
    if (!canSave) return;
    const values = {} as Settings['values'];
    for (const [key] of fields) {
      const value = draft[key];
      const range = snapshot.ranges[key];
      if (
        value === undefined ||
        !Number.isFinite(value) ||
        value < range.min ||
        value > range.max ||
        (key === 'globalSpeedPercent' && !Number.isInteger(value))
      ) {
        setError(t('Enter values within the controller ranges.'));
        return;
      }
      values[key] = value;
    }
    const token = epoch.current;
    setSaving(true);
    setError(undefined);
    setSaved(false);
    await arm
      .run(async () => {
        try {
          const result = await arm.api.updateControllerMotionSettings({
            revision: snapshot.revision,
            values,
          });
          if (epoch.current === token) {
            setSnapshot(result);
            setDraft(result.values);
            setSaved(true);
          }
        } catch (e) {
          if (epoch.current === token) {
            setError(settingsError(e));
            setSnapshot(undefined);
          }
          throw e;
        }
      })
      .finally(() => {
        if (epoch.current === token) setSaving(false);
      });
  };
  if (!supported) return null;
  return (
    <>
      <Button
        icon={<Gauge size={18} />}
        disabled={Boolean(busy || !arm.state?.state.connected)}
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        {t('Controller Motion Parameters')}
      </Button>
      <Modal
        open={open}
        title={<RobotDialogTitle title={t('Controller Motion Parameters')} />}
        onCancel={close}
        closable={saving || disabling ? false : { 'aria-label': t('Close') }}
        maskClosable={!saving && !disabling}
        className="robot-dialog robot-controller-motion-dialog"
        centered
        width={620}
        footer={
          <div className="robot-controller-motion-footer">
            {arm.state?.state.enabled &&
              arm.capabilities?.controls.includes('control.disable') && (
                <Button
                  loading={disabling}
                  disabled={Boolean(
                    (busy && !disabling) || !arm.state?.state.connected,
                  )}
                  onClick={() => void disable()}
                >
                  {t('Disable')}
                </Button>
              )}
            <Button
              disabled={loading || saving || disabling}
              onClick={() => void load()}
            >
              {t('Reload')}
            </Button>
            <Button disabled={saving || disabling} onClick={close}>
              {t('Close')}
            </Button>
            <Button
              type="primary"
              loading={saving}
              disabled={!canSave}
              onClick={() => void save()}
            >
              {t('Save and Apply')}
            </Button>
          </div>
        }
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Paragraph>
            {t(
              'Controller limits affect subsequent robot motions. Screen action ratios still apply.',
            )}
          </Typography.Paragraph>
          {arm.state?.state.enabled && (
            <Alert
              type="info"
              showIcon
              message={t(
                'Disable the robot before applying controller motion parameters.',
              )}
            />
          )}
          {error && <Alert type="error" showIcon message={error} />}
          {saved && (
            <Alert
              type="success"
              showIcon
              message={t(
                'Saved and application requested. Verify actual speed with a test motion.',
              )}
            />
          )}
          {loading ? (
            <Spin />
          ) : (
            snapshot && (
              <div className="robot-form-grid">
                {fields.map(([key, label]) => (
                  <label
                    className="robot-form-field"
                    key={key}
                    htmlFor={`${fieldId}-${key}`}
                  >
                    <span>{t(label)}</span>
                    <InputNumber
                      id={`${fieldId}-${key}`}
                      aria-label={t(label)}
                      min={snapshot.ranges[key].min}
                      max={snapshot.ranges[key].max}
                      value={draft[key]}
                      disabled={Boolean(busy)}
                      onChange={(value) => {
                        setSaved(false);
                        setDraft((current) => ({
                          ...current,
                          [key]: value ?? undefined,
                        }));
                      }}
                    />
                    <Typography.Text type="secondary">
                      {snapshot.ranges[key].min}–{snapshot.ranges[key].max}
                    </Typography.Text>
                  </label>
                ))}
              </div>
            )
          )}
        </Space>
      </Modal>
    </>
  );
}
