import { supportsFlangeContact } from '@midscene/robotics-shared/setup-contracts';
import { Button, InputNumber, Modal, Space, Typography } from 'antd';
import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { SetupIllustration } from './components/robot-arm/SetupIllustration';
import { ToolSetupStep } from './components/robot-arm/ToolSetupStep';
import {
  type ToolAxis,
  axialTool,
  inferAxialTool,
} from './components/robot-arm/setup-draft';
import { t, useCalibrationLanguage } from './i18n';
import type { EffectiveCapabilities, ToolProfile } from './robot-arm-api';
import { speakCalibration } from './voice/calibration';

export interface MeasuredCalibrationSetup {
  width?: number;
  height?: number;
  tool: Pick<
    ToolProfile,
    'offsetMm' | 'contactDirection' | 'payload' | 'contactFrame'
  >;
}
/** Original tool setup controls, shared by standalone and embedded hosts. */
export function CalibrationSetup({
  capabilities,
  onSave,
  initial,
  onCancel,
  footer,
  showIllustration = true,
}: {
  footer?: HTMLElement | null;
  showIllustration?: boolean;
  capabilities?: EffectiveCapabilities;
  initial?: MeasuredCalibrationSetup;
  onCancel?(): void;
  onSave(input: MeasuredCalibrationSetup): Promise<void>;
}) {
  useCalibrationLanguage();
  useEffect(() => speakCalibration('toolSetup'), []);
  const id = useId();
  const inferred = initial && inferAxialTool(initial.tool);
  const [axis, setAxis] = useState<ToolAxis>(inferred?.axis ?? '-Z');
  const [length, setLength] = useState<number | null>(
    initial?.tool.contactFrame === 'flange' ? null : (inferred?.length ?? null),
  );
  const [payload, setPayload] = useState<
    | {
        massKg?: number | null;
        inertiaKgM2?: number | null;
      }
    | undefined
  >(initial?.tool.payload);
  const [custom, setCustom] = useState<
    Pick<ToolProfile, 'offsetMm' | 'contactDirection'> | undefined
  >(initial && !inferred ? initial.tool : undefined);
  const [advanced, setAdvanced] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  // InputNumber can emit an out-of-range value while the user is typing.
  // Keep the form renderable; reject invalid measurements on submission.
  const validLength = length !== null && Number.isFinite(length) && length >= 0;
  const optionalLength =
    !custom && axis === '-Z' && supportsFlangeContact(capabilities);
  const geometry = custom ?? axialTool(axis, validLength ? length : 0);
  const save = async () => {
    setPending(true);
    setError(undefined);
    try {
      const savedGeometry = custom ?? axialTool(axis, length, capabilities);
      if (capabilities?.payload && payload?.massKg == null)
        throw new Error(t('Tool Weight (kg)'));
      await onSave({
        tool: {
          ...savedGeometry,
          ...(payload?.massKg != null
            ? {
                payload: {
                  massKg: payload.massKg,
                  ...(payload.inertiaKgM2 != null
                    ? { inertiaKgM2: payload.inertiaKgM2 }
                    : {}),
                },
              }
            : {}),
        },
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };
  const actions = (
    <Space>
      {onCancel && (
        <Button disabled={pending} onClick={onCancel}>
          {t('Cancel')}
        </Button>
      )}
      <Button type="primary" loading={pending} onClick={() => void save()}>
        {t('Save and Continue')}
      </Button>
    </Space>
  );
  return (
    <section className="robot-setup-task-layout calibration-tool-setup">
      <div className="robot-setup-step-panel">
        <ToolSetupStep
          tool={{ ...geometry, payload }}
          custom={Boolean(custom)}
          capabilities={capabilities}
          axis={axis}
          length={length}
          optionalLength={optionalLength}
          disabled={pending}
          onAxisChange={setAxis}
          onLengthChange={setLength}
          onPayloadChange={setPayload}
          onOpenAdvanced={() => setAdvanced(true)}
        />
        {error && (
          <Typography.Paragraph type="danger" role="alert">
            {error}
          </Typography.Paragraph>
        )}
        {footer ? createPortal(actions, footer) : actions}
      </div>
      {showIllustration && (
        <aside className="robot-setup-guide-card">
          <figure className="robot-setup-media-slot">
            <SetupIllustration step="tool" />
            <figcaption className="robot-setup-reference-toolbar">
              {t('Setup illustration')}
            </figcaption>
          </figure>
          <Typography.Paragraph>
            {t(
              optionalLength
                ? 'Leave blank to calibrate using the flange pose at contact.'
                : 'Measure from the flange origin to the contact tip, including the holder.',
            )}
          </Typography.Paragraph>
        </aside>
      )}
      <Modal
        open={advanced}
        title={t('Advanced Tool Settings')}
        onCancel={() => setAdvanced(false)}
        onOk={() => setAdvanced(false)}
      >
        {(['offsetMm', 'contactDirection'] as const).map((field) => (
          <div key={field}>
            <Typography.Text>
              {t(
                field === 'offsetMm'
                  ? 'Measured Tool Offset (mm)'
                  : 'Tool Contact Direction',
              )}
            </Typography.Text>
            <Space>
              {(['x', 'y', 'z'] as const).map((key) => (
                <label key={key} htmlFor={`${id}-${field}-${key}`}>
                  {key.toUpperCase()}
                  <InputNumber
                    id={`${id}-${field}-${key}`}
                    value={geometry[field][key]}
                    onChange={(value) => {
                      if (value !== null)
                        setCustom({
                          ...geometry,
                          [field]: { ...geometry[field], [key]: value },
                        });
                    }}
                  />
                </label>
              ))}
            </Space>
          </div>
        ))}
        <Button onClick={() => setCustom(undefined)}>{t('Reset')}</Button>
      </Modal>
    </section>
  );
}
