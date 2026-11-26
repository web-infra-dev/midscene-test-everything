import { supportsFlangeContact } from '@midscene/robotics-shared/setup-contracts';
import {
  Button,
  Checkbox,
  InputNumber,
  Modal,
  Segmented,
  Space,
  Typography,
} from 'antd';
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
type ToolGeometry = Pick<ToolProfile, 'offsetMm' | 'contactDirection'>;
type ToolOffsetDraft = {
  offsetMm: { x: number; y: number; z: number | null };
  contactDirection: ToolGeometry['contactDirection'];
};
type MeasuredGeometryDraft = {
  mode: 'length' | 'offset';
  length: number | null;
  custom: ToolOffsetDraft | undefined;
};

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
  const [custom, setCustom] = useState<ToolGeometry | undefined>(
    initial && !inferred ? initial.tool : undefined,
  );
  const [coaxialConfirmed, setCoaxialConfirmed] = useState(
    initial?.tool.contactFrame === 'flange',
  );
  const [advanced, setAdvanced] = useState<MeasuredGeometryDraft>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  // InputNumber can emit an out-of-range value while the user is typing.
  // Keep the form renderable; reject invalid measurements on submission.
  const validLength = length !== null && Number.isFinite(length) && length >= 0;
  const flangeSupported = supportsFlangeContact(capabilities);
  const hasMeasuredGeometry = Boolean(custom) || validLength;
  const axialGeometry = axialTool(axis, validLength ? length : 0);
  const geometry = custom ?? axialGeometry;
  const advancedGeometry = advanced?.custom ?? {
    offsetMm: {
      ...axialGeometry.offsetMm,
      z: flangeSupported && !validLength ? null : axialGeometry.offsetMm.z,
    },
    contactDirection: axialGeometry.contactDirection,
  };
  const openAdvanced = () => {
    setAdvanced({
      mode:
        flangeSupported && !custom && axis === '-Z' && validLength
          ? 'length'
          : 'offset',
      length,
      custom,
    });
  };
  const canApplyAdvanced =
    advanced?.mode === 'length'
      ? advanced.length !== null &&
        Number.isFinite(advanced.length) &&
        advanced.length >= 0
      : advancedGeometry.offsetMm.z !== null;
  const applyAdvanced = () => {
    if (!advanced || !canApplyAdvanced) return;
    if (advanced.mode === 'length') {
      setAxis('-Z');
      setLength(advanced.length);
      setCustom(undefined);
    } else if (advanced.custom) {
      const { offsetMm, contactDirection } = advanced.custom;
      if (offsetMm.z === null) return;
      setCustom({
        offsetMm: { ...offsetMm, z: offsetMm.z },
        contactDirection,
      });
    } else {
      setCustom(undefined);
    }
    setCoaxialConfirmed(false);
    setAdvanced(undefined);
  };
  const save = async () => {
    setPending(true);
    setError(undefined);
    try {
      const savedGeometry =
        flangeSupported && coaxialConfirmed
          ? axialTool('-Z', null, capabilities)
          : (custom ?? axialTool(axis, length));
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
      <Button
        type="primary"
        disabled={flangeSupported && !coaxialConfirmed && !hasMeasuredGeometry}
        loading={pending}
        onClick={() => void save()}
      >
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
          mountingConfirmation={
            flangeSupported && (
              <div className="robot-form-field">
                <Checkbox
                  checked={coaxialConfirmed}
                  disabled={pending}
                  onChange={(event) =>
                    setCoaxialConfirmed(event.target.checked)
                  }
                >
                  {t(
                    'I confirm the stylus points straight down and is coaxial with the flange.',
                  )}
                </Checkbox>
                {!coaxialConfirmed && hasMeasuredGeometry && (
                  <Typography.Text type="secondary">
                    {t('Using measured tool geometry')}
                  </Typography.Text>
                )}
              </div>
            )
          }
          disabled={pending}
          onAxisChange={setAxis}
          onLengthChange={setLength}
          onPayloadChange={setPayload}
          onOpenAdvanced={openAdvanced}
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
            <SetupIllustration step="tool" showCoaxialMount={flangeSupported} />
            <figcaption className="robot-setup-reference-toolbar">
              {t('Setup illustration')}
            </figcaption>
          </figure>
          {!flangeSupported && (
            <Typography.Paragraph>
              {t(
                'Measure from the flange origin to the contact tip, including the holder.',
              )}
            </Typography.Paragraph>
          )}
        </aside>
      )}
      <Modal
        open={Boolean(advanced)}
        title={t('Advanced Tool Settings')}
        okText={t('Apply')}
        okButtonProps={{ disabled: !canApplyAdvanced }}
        onCancel={() => setAdvanced(undefined)}
        onOk={applyAdvanced}
      >
        {advanced && (
          <div className="robot-setup-step-panel">
            {flangeSupported && (
              <Segmented<MeasuredGeometryDraft['mode']>
                value={advanced.mode}
                options={[
                  { value: 'length', label: t('Stylus Length') },
                  { value: 'offset', label: t('Custom Mounting') },
                ]}
                onChange={(mode) => setAdvanced({ ...advanced, mode })}
              />
            )}
            {advanced.mode === 'length' ? (
              <label className="robot-form-field" htmlFor={`${id}-length`}>
                <span>{t('Stylus Length (mm)')}</span>
                <InputNumber
                  id={`${id}-length`}
                  min={0}
                  value={advanced.length}
                  onChange={(length) => setAdvanced({ ...advanced, length })}
                />
                <span className="robot-field-help">
                  {t(
                    'Measure from the flange origin to the contact tip, including the holder.',
                  )}
                </span>
              </label>
            ) : (
              <>
                {(['offsetMm', 'contactDirection'] as const).map((field) => (
                  <div key={field} className="robot-form-field">
                    <Typography.Text>
                      {t(
                        field === 'offsetMm'
                          ? 'Measured Tool Offset (mm)'
                          : 'Tool Contact Direction',
                      )}
                    </Typography.Text>
                    <Space wrap>
                      {(['x', 'y', 'z'] as const).map((key) => (
                        <label key={key} htmlFor={`${id}-${field}-${key}`}>
                          {key.toUpperCase()}
                          <InputNumber
                            id={`${id}-${field}-${key}`}
                            value={advancedGeometry[field][key]}
                            onChange={(value) => {
                              if (
                                value === null &&
                                (field !== 'offsetMm' ||
                                  key !== 'z' ||
                                  !flangeSupported)
                              )
                                return;
                              setAdvanced({
                                ...advanced,
                                custom: {
                                  ...advancedGeometry,
                                  [field]: {
                                    ...advancedGeometry[field],
                                    [key]: value,
                                  },
                                },
                              });
                            }}
                          />
                        </label>
                      ))}
                    </Space>
                  </div>
                ))}
                <Button
                  onClick={() =>
                    setAdvanced({ ...advanced, custom: undefined })
                  }
                >
                  {t('Reset')}
                </Button>
              </>
            )}
          </div>
        )}
      </Modal>
    </section>
  );
}
