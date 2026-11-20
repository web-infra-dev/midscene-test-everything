import type { CalibrationPreviewPositions } from '@midscene/robotics-shared/assisted-contracts';
import type { PerspectiveTarget } from '@midscene/robotics-shared/camera/vision-types';
import type {
  CameraCorrection,
  PerspectiveValiditySummary,
} from '@midscene/robotics-shared/contracts';
import { Alert, Button, Modal, Typography } from 'antd';
import { useState } from 'react';
import type { MeasuredCalibrationSetup } from './CalibrationSetup';
import { t } from './i18n';
import { calibrationPowerControl } from './power-state';
import type {
  AssistedCalibrationInput,
  AssistedMappingInput,
  CalibrationProfile,
  EffectiveCapabilities,
  RuntimeState,
} from './robot-arm-api';
import type { CameraProfile } from './types';
import { speakCalibration } from './voice/calibration';

export interface Configuration {
  deviceId: string;
  capabilities: EffectiveCapabilities;
  input?: AssistedCalibrationInput;
  installationTaught?: boolean;
  mappingReady?: boolean;
  output?: AssistedMappingInput;
  camera: CameraProfile;
  correction?: CameraCorrection;
  previewPositions?: CalibrationPreviewPositions;
  correctionOutput?: { width: number; height: number };
  /** Enforced rectangle of the live corrected preview. */
  perspectiveTarget?: PerspectiveTarget;
  correctionKey?: string;
  perspectiveValidity?: PerspectiveValiditySummary;
  result?: CalibrationProfile;
  ready: boolean;
  armState?: RuntimeState;
  editable?: boolean;
  measuredSetup?: MeasuredCalibrationSetup;
}

export function CalibrationPowerButton({
  config,
  apply,
}: {
  config: Configuration;
  apply: (action: 'enable' | 'payload' | 'recover') => Promise<void>;
}) {
  const control = calibrationPowerControl(
    config.armState,
    config.capabilities,
    Boolean(config.editable),
  );
  const label =
    control.action === 'recover'
      ? config.armState?.requiresOperatorRecovery === false
        ? 'Waiting for controller recovery'
        : 'Check Recovery'
      : control.action === 'payload'
        ? 'Sync Tool Payload'
        : 'Enable Robot';
  const [confirming, setConfirming] = useState<typeof control.action>();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string>();
  const stale = confirming !== undefined && confirming !== control.action;
  return (
    <>
      <Button
        disabled={control.disabled || pending}
        onClick={() => {
          setFailure(undefined);
          if (control.action === 'enable') speakCalibration('confirmEnable', 2);
          if (control.action === 'recover')
            speakCalibration('checkRecovery', 2);
          setConfirming(control.action);
        }}
      >
        {t(label)}
      </Button>
      <Modal
        title={t(label)}
        open={confirming !== undefined}
        confirmLoading={pending}
        closable={!pending}
        maskClosable={!pending}
        cancelButtonProps={{ disabled: pending }}
        okButtonProps={{ disabled: control.disabled || stale }}
        onCancel={() => {
          if (!pending) setConfirming(undefined);
        }}
        onOk={async () => {
          if (!confirming || pending || control.disabled || stale) return;
          setPending(true);
          setFailure(undefined);
          try {
            if (confirming === 'payload') speakCalibration('payload');
            await apply(confirming);
            if (confirming === 'payload') speakCalibration('payloadDone');
            setConfirming(undefined);
          } catch (error) {
            setFailure(error instanceof Error ? error.message : String(error));
          } finally {
            setPending(false);
          }
        }}
      >
        <Typography.Paragraph>
          {t(
            confirming === 'recover'
              ? 'Check recovery while the robot is stationary and fault-free. This does not enable or move the robot.'
              : confirming === 'payload'
                ? 'Sync saved tool payload without disabling the robot?'
                : 'Confirm the tool configuration and ensure the workspace is clear before enabling the robot.',
          )}
        </Typography.Paragraph>
        {stale && (
          <Alert
            type="warning"
            showIcon
            message={t(
              'Robot state changed. Close this dialog and confirm the current operation again.',
            )}
          />
        )}
        {failure && <Alert type="error" showIcon message={failure} />}
      </Modal>
    </>
  );
}
