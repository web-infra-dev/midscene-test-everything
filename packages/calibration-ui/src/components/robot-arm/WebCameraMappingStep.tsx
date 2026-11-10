import {
  type CameraMappingAccuracy,
  mappingQualityWarnings,
} from '@midscene/robotics-shared/assisted-contracts';
import { Button, Spin } from 'antd';
import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AssistedCalibrationController } from '../../hooks/useAssistedCalibration';
import { useCameraMarkerMapping } from '../../hooks/useCameraMarkerMapping';
import { calibrationErrorText, t, useCalibrationLanguage } from '../../i18n';
import type {
  AssistedCalibrationInput,
  AssistedMappingInput,
} from '../../robot-arm-api';
import type { CameraProfile } from '../../types';
import { CalibrationQualityWarnings } from './CalibrationQualityWarnings';
export function WebCameraMappingStep({
  controller,
  camera,
  live,
  corrected,
  size,
  footer,
  onDetect,

  onPair,
  onContinue,
  output,
  input,
  correctionKey,
  editing = false,
  hasCorners = false,
  savedResult,
  checkDraft,
  onConfirm,
  saving = false,
}: {
  input?: AssistedCalibrationInput;
  output?: AssistedMappingInput;
  /** Saved correction geometry and capture settings, not the editor draft. */
  correctionKey?: string;
  editing?: boolean;
  hasCorners?: boolean;
  savedResult?: { verified: boolean };
  checkDraft?(): Promise<CameraMappingAccuracy | undefined>;
  onConfirm?(): Promise<void>;
  saving?: boolean;
  controller: AssistedCalibrationController;
  camera?: CameraProfile;
  live?: ReactNode;
  corrected?: ReactNode;
  size?: { width: number; height: number };
  footer: HTMLElement | null;
  onDetect?(): Promise<void>;
  onPair?(): void;
  onContinue(): void;
}) {
  useCalibrationLanguage((state) => state.language);
  const [detecting, setDetecting] = useState(false);
  const [continueRequested, setContinueRequested] = useState(false);
  const [error, setError] = useState<string>();
  const { setup, busy } = controller;
  const [attemptedCamera, setAttemptedCamera] = useState<string>();
  const autoDetectPending = Boolean(
    !savedResult &&
      onDetect &&
      camera?.online &&
      setup.phoneConnected &&
      setup.layout?.screen &&
      !editing &&
      !hasCorners &&
      attemptedCamera !== camera.id,
  );
  const { mapped, mappingBusy, mappingError, canMap, retry } =
    useCameraMarkerMapping({
      controller,
      camera,
      output,
      input,
      correctionKey,
      blocked:
        Boolean(savedResult) ||
        editing ||
        detecting ||
        saving ||
        autoDetectPending ||
        Boolean(error),
    });
  useEffect(() => {
    if (
      continueRequested &&
      mapped &&
      !editing &&
      !saving &&
      !busy &&
      !mappingBusy
    ) {
      setContinueRequested(false);
      onContinue();
    }
  }, [
    continueRequested,
    mapped,
    editing,
    saving,
    busy,
    mappingBusy,
    onContinue,
  ]);
  const check =
    setup.phoneConnected && camera?.online && !saving && !detecting
      ? checkDraft
      : undefined;
  const layoutKey = JSON.stringify([
    camera?.id,
    setup.layout,
    size?.width,
    size?.height,
  ]);
  const [result, setResult] = useState<{
    check: typeof check;
    layoutKey: string;
    accuracy?: CameraMappingAccuracy;
    error?: string;
  }>();
  useEffect(() => {
    if (!check) return;
    let active = true;
    const timer = setTimeout(run, 400);
    async function run() {
      try {
        const accuracy = await check!();
        if (active) setResult({ check, layoutKey, accuracy });
      } catch (cause) {
        if (!active) return;
        const error = cause instanceof Error ? cause.message : String(cause);
        setResult({ check, layoutKey, error });
      }
    }
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [check, layoutKey]);
  const current =
    check && result?.check === check && result.layoutKey === layoutKey
      ? result
      : undefined;
  const problem =
    error ??
    (editing ? current?.error : mappingError) ??
    controller.connectionError;
  const verified = editing
    ? Boolean(current && !current.error)
    : (savedResult?.verified ?? mapped);
  const accuracy = editing ? current?.accuracy : setup.mapping?.accuracy;
  const measuredLayout = editing ? setup.layout : setup.mapping?.layout;
  const warnings =
    accuracy && measuredLayout
      ? mappingQualityWarnings(accuracy, measuredLayout)
      : [];
  const confirm = async () => {
    setError(undefined);
    try {
      if (!setup.phoneConnected) {
        if (editing) await onConfirm?.();
        onPair?.();
        return;
      }
      if (editing) {
        await onConfirm?.();
        retry();
        setContinueRequested(true);
      } else if (verified) {
        onContinue();
      } else {
        retry();
        setContinueRequested(true);
      }
    } catch (error) {
      setContinueRequested(false);
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  const detect = async () => {
    setAttemptedCamera(camera?.id);
    setContinueRequested(false);
    setDetecting(true);
    setError(undefined);
    try {
      await onDetect?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetecting(false);
    }
  };
  useEffect(() => {
    if (!autoDetectPending || !canMap || busy || mappingBusy || detecting)
      return;
    void detect();
  }, [autoDetectPending, canMap, busy, mappingBusy, detecting]);
  return (
    <div className="robot-camera-mapping-header">
      <section className="robot-disclosure-body">
        <div className="robot-web-section-heading">
          <strong>{camera?.name}</strong>
          <span>
            {controller.phone.model ?? t('Phone')} ·{' '}
            {t(setup.phoneConnected ? 'Phone connected' : 'Connect Phone')}
          </span>
        </div>
        <div className="screen-range-card">
          <section>
            <header>
              <strong>{t('Live Preview')}</strong>
              <div className="range-actions">
                <Button
                  size="small"
                  loading={detecting}
                  disabled={
                    detecting ||
                    !onDetect ||
                    !camera?.online ||
                    !setup.phoneConnected ||
                    (!savedResult && !canMap) ||
                    busy ||
                    saving ||
                    mappingBusy
                  }
                  onClick={() => void detect()}
                >
                  {t('Detect screen markers')}
                </Button>
              </div>
            </header>
            <div className="screen-range-stage">{live}</div>
          </section>
          <section>
            <header>
              <strong>{t('Corrected View')}</strong>
              {size && (
                <small>
                  {size.width} × {size.height} px
                </small>
              )}
            </header>
            <div className="screen-range-stage">{corrected}</div>
          </section>
        </div>
        {hasCorners && !savedResult && (
          <span className="range-check-status">
            {t(
              'Drag the four corners to include the full display and system bars.',
            )}
          </span>
        )}
        <output className="range-check-status">
          {error ? (
            <span className="is-warning">{calibrationErrorText(error)}</span>
          ) : !setup.phoneConnected ? (
            <>
              {t(
                'Open the marker page on the target screen to detect its edges.',
              )}{' '}
              {onPair && (
                <Button type="link" size="small" onClick={onPair}>
                  {t('Connect Phone')}
                </Button>
              )}
              {savedResult &&
                controller.phone.displayRequirement &&
                t(
                  controller.phone.displayRequirement === 'home-screen'
                    ? 'Open the calibration page from the iOS Home Screen to continue.'
                    : 'Waiting for the phone to enter full screen…',
                )}
            </>
          ) : problem ? (
            <span className="is-warning">{calibrationErrorText(problem)}</span>
          ) : verified && warnings.length === 0 ? (
            <span className="is-success">
              ✓{' '}
              {t(
                'Page marker fit verified; screen edges require visual confirmation',
              )}
              {accuracy && (
                <>
                  {' · '}
                  {accuracy.validation.count > 0
                    ? t('{0} fit markers · {1} held out · maximum {2} CSS px', [
                        accuracy.fit.count,
                        accuracy.validation.count,
                        accuracy.validation.maxErrorCssPx.toFixed(2),
                      ])
                    : t(
                        '{0} fit markers · maximum fit error {1} CSS px · no check markers visible',
                        [
                          accuracy.fit.count,
                          accuracy.fit.maxErrorCssPx.toFixed(2),
                        ],
                      )}
                </>
              )}
            </span>
          ) : !verified && (check || mappingBusy) ? (
            <>
              <Spin size="small" /> {t('Checking page markers…')}
            </>
          ) : null}
        </output>
        <CalibrationQualityWarnings warnings={warnings} />
        {verified && (
          <span className="range-check-status">
            {t(
              'Check all four display edges, including the system bars, before continuing.',
            )}
          </span>
        )}
      </section>
      {footer &&
        createPortal(
          <Button
            type="primary"
            loading={saving || (continueRequested && mappingBusy)}
            disabled={
              (!editing &&
                ((!verified && !(mappingError && canMap)) ||
                  !setup.phoneConnected)) ||
              !hasCorners ||
              Boolean(controller.connectionError) ||
              busy ||
              mappingBusy ||
              detecting ||
              saving
            }
            onClick={() => void confirm()}
          >
            {t(
              savedResult
                ? 'Next'
                : mappingError && !editing
                  ? 'Retry and continue'
                  : 'Continue',
            )}
          </Button>,
          footer,
        )}
    </div>
  );
}
