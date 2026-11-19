import { SCREEN_PRESS_DEPTH_RANGE_MM } from '@midscene/robotics-shared/contracts';
import {
  Alert,
  App,
  Button,
  InputNumber,
  Modal,
  Select,
  Space,
  Typography,
} from 'antd';
import { SlidersHorizontal } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { DeviceControls } from '../../hooks/useDeviceControls';
import { t, useLanguage } from '../../i18n';
import type {
  MotionAcceleration,
  MotionSpeed,
  ScreenProfile,
} from '../../robot-arm-api';
import { screenRateModes } from './motion-validation';
import { contactRateRange, validateMotionSettings } from './motion-validation';

type MotionKey =
  | 'pressDepthMm'
  | 'safeHeightMm'
  | 'contactMs'
  | 'swipeEndpointHoldMs'
  | 'longPressMs'
  | 'dragHoldMs'
  | 'successorStartLeadMs'
  | 'releaseSpeedFactor'
  | 'releaseAccelerationFactor';

type MotionDraft = Partial<Record<MotionKey, number | null>> & {
  actionSpeed: MotionSpeed;
  actionAcceleration: MotionAcceleration;
};

const timingFields: Array<{ key: MotionKey; label: string }> = [
  { key: 'pressDepthMm', label: 'Press Depth (mm)' },
  { key: 'safeHeightMm', label: 'Safe Height (mm)' },
  { key: 'contactMs', label: 'Tap Contact Time (ms)' },
  { key: 'swipeEndpointHoldMs', label: 'Swipe Endpoint Hold (ms)' },
  { key: 'longPressMs', label: 'Long Press (ms)' },
  { key: 'dragHoldMs', label: 'Drag Endpoint Hold (ms)' },
  { key: 'successorStartLeadMs', label: 'Successor Start Lead (ms)' },
  { key: 'releaseSpeedFactor', label: 'Release Speed Factor' },
  { key: 'releaseAccelerationFactor', label: 'Release Acceleration Factor' },
];

const formatRange = (value: number) => Number(value.toFixed(3)).toString();

function rateValue(rate: MotionSpeed | MotionAcceleration): number | null {
  if (rate.kind === 'ratio') return rate.value;
  if ('mmPerSecond' in rate) return rate.mmPerSecond;
  if ('mmPerSecondSquared' in rate) return rate.mmPerSecondSquared;
  if ('degreesPerSecond' in rate) return rate.degreesPerSecond;
  if ('degreesPerSecondSquared' in rate) return rate.degreesPerSecondSquared;
  return null;
}

/**
 * Global motion parameters for the selected screen. They stay part of the
 * screen Profile, so calibration geometry remains untouched; only timing and
 * speed fields change.
 */
export function MotionSettings({
  arm,
  className,
  showLabel = false,
}: {
  arm: DeviceControls;
  className?: string;
  showLabel?: boolean;
}) {
  const language = useLanguage();
  const { message } = App.useApp();
  const fieldId = useId();
  const screen = arm.profiles.screens.find(
    (item) => item.id === arm.profiles.workstation?.screenProfileId,
  );
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MotionDraft>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const initializedFor = useRef<string>();
  useEffect(() => {
    if (!open) {
      // Reopening starts from the saved Profile again, including values the
      // operator discarded with Cancel.
      initializedFor.current = undefined;
      return;
    }
    if (!screen) return;
    // The console polls /profiles once a second, and every poll delivers a new
    // object with the same values. Resetting the draft on that identity change
    // would silently undo whatever the operator is typing.
    if (initializedFor.current === screen.id) return;
    initializedFor.current = screen.id;
    setDraft({
      actionSpeed: structuredClone(screen.actionSpeed),
      actionAcceleration: structuredClone(screen.actionAcceleration),
      pressDepthMm: screen.pressDepthMm,
      safeHeightMm: screen.safeHeightMm,
      contactMs: screen.contactMs,
      swipeEndpointHoldMs: screen.swipeEndpointHoldMs,
      longPressMs: screen.longPressMs,
      dragHoldMs: screen.dragHoldMs,
      successorStartLeadMs: screen.successorStartLeadMs,
      releaseSpeedFactor: screen.releaseSpeedFactor,
      releaseAccelerationFactor: screen.releaseAccelerationFactor,
    });
    setError(undefined);
  }, [open, screen]);
  const disabled = Boolean(
    saving || arm.busy || arm.state?.operation?.status === 'running',
  );
  const setNumber = (key: MotionKey, value: number | null) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  const rate = (key: 'speed' | 'acceleration') => {
    const path = key === 'speed' ? 'actionSpeed' : 'actionAcceleration';
    const modes = screenRateModes(arm.capabilities, key);
    const current = draft?.[path];
    // Contact stages accept ratio or linear rates only; other units cannot be
    // produced here and keep their stored value unless the operator changes it.
    const kind =
      current?.kind === 'ratio' || current?.kind === 'linear'
        ? current.kind
        : undefined;
    const label = key === 'speed' ? t('Base Speed') : t('Base Acceleration');
    const range =
      current && kind
        ? contactRateRange(arm.capabilities, key, kind)
        : undefined;
    const unit =
      kind === 'linear'
        ? key === 'speed'
          ? 'mm/s'
          : 'mm/s²'
        : t('Ratio (0–1)');
    return (
      <label className="robot-form-field" htmlFor={`${fieldId}-${path}`}>
        <span>{label}</span>
        <Space.Compact block>
          {modes.length > 1 && (
            <Select
              aria-label={t('{0} Unit', [label])}
              value={kind}
              disabled={disabled}
              options={modes.map((mode) => ({
                value: mode,
                label:
                  mode === 'ratio'
                    ? t('Ratio (0–1)')
                    : key === 'speed'
                      ? 'mm/s'
                      : 'mm/s²',
              }))}
              onChange={(mode) =>
                setDraft((value) =>
                  value
                    ? {
                        ...value,
                        [path]:
                          mode === 'ratio'
                            ? { kind: mode, value: 1 }
                            : {
                                kind: mode,
                                [key === 'speed'
                                  ? 'mmPerSecond'
                                  : 'mmPerSecondSquared']: 1,
                              },
                      }
                    : value,
                )
              }
            />
          )}
          <InputNumber
            id={`${fieldId}-${path}`}
            aria-label={label}
            value={current ? rateValue(current) : null}
            min={0}
            disabled={disabled}
            onChange={(value) =>
              setDraft((existing) => {
                if (!existing || !existing[path]) return existing;
                const next = value ?? 0;
                return {
                  ...existing,
                  [path]:
                    existing[path].kind === 'ratio'
                      ? { kind: 'ratio', value: next }
                      : {
                          kind: 'linear',
                          [key === 'speed'
                            ? 'mmPerSecond'
                            : 'mmPerSecondSquared']: next,
                        },
                };
              })
            }
          />
        </Space.Compact>
        <Typography.Text type="secondary">
          {range && range.min <= range.max
            ? `${unit} · ${t(
                'Allowed base range: {0}–{1}. Covers every contact stage.',
                [formatRange(range.min), formatRange(range.max)],
              )}`
            : unit}
        </Typography.Text>
      </label>
    );
  };
  const save = async () => {
    if (!screen || !draft) return;
    const candidate = { ...screen, ...draft } as ScreenProfile;
    try {
      validateMotionSettings(candidate, arm.capabilities);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await arm.run(() => arm.api.putScreen(screen.id, candidate));
      message.success(t('Motion settings saved.'));
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Button
        type="text"
        className={className}
        aria-label={t('Motion Settings')}
        title={t('Motion Settings')}
        icon={<SlidersHorizontal size={18} />}
        disabled={Boolean(!screen || arm.busy)}
        onClick={() => setOpen(true)}
      >
        {showLabel && (
          <span className="robot-status-bar-label">{t('Motion Settings')}</span>
        )}
      </Button>
      <Modal
        open={open}
        className="robot-dialog robot-settings-detail"
        width={720}
        title={
          <>
            <SlidersHorizontal size={18} />
            {t('Motion Settings')}
          </>
        }
        onCancel={() => setOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setOpen(false)} disabled={saving}>
              {t('Cancel')}
            </Button>
            <Button
              type="primary"
              loading={saving}
              disabled={disabled || !draft}
              onClick={() => void save()}
            >
              {t('Save Motion Settings')}
            </Button>
          </Space>
        }
      >
        <div className="robot-motion-settings-dialog">
          <Typography.Paragraph type="secondary">
            {t(
              'Speed, contact and release values for {0}. Saving does not enable or move the robot and keeps the existing calibration geometry.',
              [screen?.name ?? t('the selected screen')],
            )}
          </Typography.Paragraph>
          {error && <Alert type="error" showIcon message={error} />}
          <h4>
            {language === 'zh' ? '速度与加速度' : 'Speed and acceleration'}
          </h4>
          <div className="robot-form-grid">
            {rate('speed')}
            {rate('acceleration')}
          </div>
          <h4>{language === 'zh' ? '接触与时序' : 'Contact and timing'}</h4>
          <div className="robot-form-grid">
            {timingFields.map((field) => (
              <label
                className="robot-form-field"
                key={field.key}
                htmlFor={`${fieldId}-${field.key}`}
              >
                <span>{t(field.label)}</span>
                <InputNumber
                  id={`${fieldId}-${field.key}`}
                  aria-label={t(field.label)}
                  value={draft?.[field.key] ?? null}
                  min={
                    field.key === 'pressDepthMm'
                      ? SCREEN_PRESS_DEPTH_RANGE_MM.min
                      : 0
                  }
                  max={
                    field.key === 'pressDepthMm'
                      ? SCREEN_PRESS_DEPTH_RANGE_MM.max
                      : undefined
                  }
                  disabled={disabled}
                  onChange={(value) => setNumber(field.key, value)}
                />
              </label>
            ))}
          </div>
        </div>
      </Modal>
    </>
  );
}
