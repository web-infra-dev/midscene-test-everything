import { Checkbox, InputNumber, Typography } from 'antd';
import { useId } from 'react';
import { t, useCalibrationLanguage } from '../../i18n';
import type { PayloadConstraints } from '../../robot-arm-api';

type DraftPayload = { massKg?: number | null; inertiaKgM2?: number | null };
export function ToolPayloadFields({
  value,
  constraints,
  disabled,
  error,
  onChange,
  showInertia = true,
}: {
  value?: DraftPayload;
  constraints?: PayloadConstraints;
  disabled: boolean;
  error?: { path: string; message: string };
  onChange: (payload: DraftPayload) => void;
  showInertia?: boolean;
}) {
  useCalibrationLanguage();
  const id = useId();
  if (!constraints) return null;
  const field = (key: 'massKg' | 'inertiaKgM2', label: string) => {
    const range = constraints[key];
    return (
      <label
        className="robot-form-field"
        data-setup-field={`tool/payload.${key}`}
        htmlFor={`${id}-${key}`}
      >
        <span>{label}</span>
        <InputNumber
          id={`${id}-${key}`}
          aria-label={label}
          min={range?.min}
          max={range?.max}
          value={value?.[key] ?? null}
          disabled={disabled}
          status={error?.path === `payload.${key}` ? 'error' : undefined}
          aria-invalid={error?.path === `payload.${key}`}
          onChange={(number) => onChange({ ...value, [key]: number })}
        />
        {error?.path === `payload.${key}` && (
          <span className="robot-field-error" role="alert">
            {error.message}
          </span>
        )}
      </label>
    );
  };
  const inertia = Boolean(
    value && Object.prototype.hasOwnProperty.call(value, 'inertiaKgM2'),
  );
  return (
    <fieldset className="robot-fieldset">
      <legend>{t('Tool Payload')}</legend>
      {field('massKg', t('Tool Weight (kg)'))}
      <Typography.Paragraph type="secondary">
        {t(
          'Weigh the stylus, holder and adapters together. Supported mass: {0}–{1} kg. The weight is applied when the robot is enabled.',
          [constraints.massKg.min, constraints.massKg.max],
        )}
      </Typography.Paragraph>
      {showInertia && constraints.inertiaKgM2 && (
        <>
          <Checkbox
            checked={inertia}
            disabled={disabled}
            onChange={(event) => {
              if (event.target.checked)
                onChange({ ...value, inertiaKgM2: null });
              else {
                const { inertiaKgM2: _inertia, ...mass } = value ?? {};
                onChange(mass);
              }
            }}
          >
            {t('Advanced: Specify Measured Inertia')}
          </Checkbox>
          {inertia &&
            field('inertiaKgM2', t('Measured Payload Inertia (kg·m²)'))}
        </>
      )}
    </fieldset>
  );
}
