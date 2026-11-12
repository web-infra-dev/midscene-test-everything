import { Button, InputNumber, Space, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import { t } from '../../i18n';
import type { EffectiveCapabilities } from '../../robot-arm-api';
import { ToolDirectionPicker } from './ToolGeometry';
import { ToolPayloadFields } from './ToolPayloadFields';
import {
  type SetupFieldError,
  type SetupProfile,
  type ToolAxis,
  inferAxialTool,
} from './setup-draft';
import { recommendedToolAxis } from './setup-draft';

function customGeometry(tool: SetupProfile) {
  const offset = tool.offsetMm ?? {};
  const direction = tool.contactDirection ?? {};
  return {
    offset: ['x', 'y', 'z']
      .map((axis) => `${axis.toUpperCase()} ${offset[axis] ?? '—'}`)
      .join(' · '),
    direction: ['x', 'y', 'z']
      .map((axis) => `${axis.toUpperCase()} ${direction[axis] ?? '—'}`)
      .join(' · '),
  };
}

export function ToolSetupStep({
  tool,
  custom,
  capabilities,
  axis,
  length,
  optionalLength,
  disabled,
  fieldError,
  onAxisChange,
  onLengthChange,
  onPayloadChange,
  onOpenAdvanced,
  extra,
}: {
  tool: SetupProfile;
  custom: boolean;
  capabilities?: EffectiveCapabilities;
  axis?: ToolAxis;
  length: number | null;
  optionalLength: boolean;
  disabled: boolean;
  fieldError?: SetupFieldError;
  onAxisChange: (axis: ToolAxis) => void;
  onLengthChange: (length: number | null) => void;
  onPayloadChange: (payload: {
    massKg?: number | null;
    inertiaKgM2?: number | null;
  }) => void;
  onOpenAdvanced: () => void;
  extra?: ReactNode;
}) {
  const inferred = inferAxialTool(tool);
  const recommendation = recommendedToolAxis(capabilities);
  const selectedAxis = inferred?.axis ?? axis ?? recommendation.axis;
  const axisError =
    fieldError?.path === 'mountingAxis' ? fieldError.message : undefined;
  const lengthError =
    fieldError?.path === 'effectiveLength' ? fieldError.message : undefined;
  const payloadError =
    fieldError?.kind === 'tool' && fieldError.path.startsWith('payload.')
      ? fieldError
      : undefined;
  if (custom) {
    const geometry = customGeometry(tool);
    return (
      <div className="robot-setup-step-panel">
        <div className="robot-setup-custom-card">
          <div>
            <Typography.Text strong>{t('Custom Mounting')}</Typography.Text>
            <Typography.Paragraph type="secondary">
              {t(
                'This tool has an offset or angled mounting. Review the measured values before continuing.',
              )}
            </Typography.Paragraph>
            <Typography.Text type="secondary">
              {t('Offset: {0} mm', [geometry.offset])}
            </Typography.Text>
            <br />
            <Typography.Text type="secondary">
              {t('Contact direction: {0}', [geometry.direction])}
            </Typography.Text>
          </div>
          <Button disabled={disabled} onClick={onOpenAdvanced}>
            {t('Edit Custom Mounting')}
          </Button>
        </div>
        {capabilities?.payload && (
          <ToolPayloadFields
            value={tool.payload}
            constraints={capabilities.payload}
            disabled={disabled}
            error={payloadError}
            onChange={onPayloadChange}
            showInertia={false}
          />
        )}
        {extra}
      </div>
    );
  }
  return (
    <div className="robot-setup-step-panel">
      {recommendation.locked ? (
        <div className="robot-form-field" data-setup-field="tool/mountingAxis">
          <span>{t('Tool Mounting Direction')}</span>
          <div className="robot-tool-locked-direction">
            <span aria-hidden="true">↓</span>
            <Typography.Text strong>{t('Straight Down')}</Typography.Text>
            <Tag>{t('Fixed for This Robot')}</Tag>
          </div>
          {axisError && (
            <span className="robot-field-error" role="alert">
              {axisError}
            </span>
          )}
        </div>
      ) : (
        <ToolDirectionPicker
          axis={selectedAxis}
          disabled={disabled}
          onChange={onAxisChange}
          error={axisError}
        />
      )}
      <label
        className="robot-form-field"
        data-setup-field="tool/effectiveLength"
        htmlFor="setup-tool-length"
      >
        <span>{t('Stylus Length (mm)')}</span>
        <InputNumber
          id="setup-tool-length"
          aria-label={t('Stylus Length (mm)')}
          value={length}
          disabled={disabled}
          status={lengthError ? 'error' : undefined}
          aria-invalid={Boolean(lengthError)}
          onChange={onLengthChange}
        />
        <span className="robot-field-help">
          {t(
            optionalLength
              ? 'Leave blank to calibrate using the flange pose at contact.'
              : 'Measure from the flange origin to the contact tip, including the holder.',
          )}
        </span>
        {lengthError && (
          <span className="robot-field-error" role="alert">
            {lengthError}
          </span>
        )}
      </label>
      {capabilities?.payload && (
        <ToolPayloadFields
          value={tool.payload}
          constraints={capabilities.payload}
          disabled={disabled}
          error={payloadError}
          onChange={onPayloadChange}
          showInertia={false}
        />
      )}
      {extra}
      <Space wrap>
        <Button type="link" disabled={disabled} onClick={onOpenAdvanced}>
          {t('Advanced Tool Settings')}
        </Button>
      </Space>
    </div>
  );
}
