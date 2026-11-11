import type { CameraMappingAccuracy } from '@midscene/arm-kit-shared/assisted-contracts';
import { Alert, Button, Spin, Steps } from 'antd';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { CalibrationClient } from './client';
import { PhonePairStep } from './components/robot-arm/PhonePairStep';
import { WebCalibrationWorkspace } from './components/robot-arm/WebCalibrationWorkspace';
import { WebCameraMappingStep } from './components/robot-arm/WebCameraMappingStep';
import { useAssistedCalibration } from './hooks/useAssistedCalibration';
import { calibrationErrorText, t, useCalibrationLanguage } from './i18n';
import type {
  AssistedCalibrationInput,
  AssistedMappingInput,
  CalibrationProfile,
} from './robot-arm-api';
import type { CameraProfile } from './types';
import { speakCalibration } from './voice/calibration';

/** Shared wizard. Hosts supply camera preview/editor; all calibration commands use one client. */
function CalibrationPanelContent(props: {
  client: CalibrationClient;
  deviceId: string;
  input?: AssistedCalibrationInput;
  output?: AssistedMappingInput;
  camera?: CameraProfile;
  correctionKey?: string;
  result?: CalibrationProfile;
  preview?: ReactNode;
  mappingPreview?: ReactNode;
  correctedPreview?: ReactNode;
  outputSize?: { width: number; height: number };
  checkDraft?(): Promise<CameraMappingAccuracy | undefined>;
  onConfirmMapping?(): Promise<void>;
  savingMapping?: boolean;
  controls?: ReactNode;
  showSessionCancel?: boolean;
  ready?: boolean;
  editing?: boolean;
  onDetect?(): Promise<void>;
  onAlign?(signal: AbortSignal): Promise<void>;
  onComplete?(): void | Promise<void>;
  completionLabel?: string;
  footerContainer?: HTMLElement | null;
  navigationContainer?: HTMLElement | null;
  onStepChange?(step: number): void;
  onEditSetup?(): void;
  onReviewCamera?(): void;
}) {
  useCalibrationLanguage((state) => state.language);
  const controller = useAssistedCalibration(props.client, props.deviceId, true);
  const [step, setStep] = useState(props.onAlign ? 1 : 0);
  const advance = useCallback(() => setStep(2), []);
  const [localFooter, setFooter] = useState<HTMLDivElement | null>(null);
  const footer = props.footerContainer ?? localFooter;
  useEffect(() => props.onStepChange?.(step), [step, props.onStepChange]);
  const [error, setError] = useState<string>();
  const [pairing, setPairing] = useState(false);
  useEffect(() => {
    if (controller.setup.phoneConnected) setPairing(false);
  }, [controller.setup.phoneConnected]);
  const beforeLeave = useRef<(() => Promise<void>) | null>(null);
  const registerLeave = useCallback((handler: (() => Promise<void>) | null) => {
    beforeLeave.current = handler;
  }, []);
  const setupLocked =
    controller.busy ||
    Boolean(
      controller.session &&
        !['ready', 'completed', 'interrupted', 'cancelled'].includes(
          controller.session.stage,
        ),
    );
  const changeStep = async (next: number) => {
    if (props.onAlign && next === 0) next = 1;
    if (props.onAlign && next === 2) return;
    if (
      next === 2 &&
      (!controller.setup.mapping || !controller.setup.phoneConnected)
    )
      return;
    if (next === step) return;
    setError(undefined);
    try {
      if (controller.busy)
        throw new Error(
          t('Wait for the current calibration command to finish.'),
        );
      if (next === 1 && props.onAlign && props.onReviewCamera) {
        props.onReviewCamera();
        return;
      }
      if (next === 2 && props.editing)
        throw new Error(t('Confirm the screen area before continuing.'));
      if (!props.onAlign) await beforeLeave.current?.();
      setStep(next);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <section className="arm-calibration-panel">
      {props.onAlign && props.navigationContainer ? (
        createPortal(
          <Steps
            size="small"
            current={step === 1 ? 0 : 2}
            items={['Camera correction', 'Touch Tool', 'Arm calibration'].map(
              (title, index) => ({
                title: t(title),
                disabled:
                  step === 2 &&
                  index < 2 &&
                  (setupLocked ||
                    (index === 1 && !controller.setup.phoneConnected)),
              }),
            )}
            onChange={(next) => {
              if (
                next === 1 &&
                step === 2 &&
                controller.setup.phoneConnected &&
                !setupLocked
              )
                props.onEditSetup?.();
              if (next === 0) void changeStep(1);
            }}
          />,
          props.navigationContainer,
        )
      ) : props.navigationContainer ? (
        createPortal(
          <Steps
            size="small"
            current={step + 1}
            onChange={(next) => {
              if (next === 0) {
                if (controller.busy) return;
                void (beforeLeave.current?.() ?? Promise.resolve())
                  .then(() => props.onEditSetup?.())
                  .catch((error) => setError(String(error)));
              } else void changeStep(next - 1);
            }}
            items={[
              'Touch Tool',
              'Connect Phone',
              'Camera correction',
              'Arm calibration',
            ].map((title, index) => ({
              title: t(title),
              status:
                index === step + 1
                  ? ('process' as const)
                  : index === 0 ||
                      (index === 1 && controller.setup.phoneConnected) ||
                      (index === 2 && controller.setup.mapping) ||
                      (index === 3 && controller.session?.stage === 'completed')
                    ? ('finish' as const)
                    : ('wait' as const),
            }))}
          />,
          props.navigationContainer,
        )
      ) : (
        <Steps
          current={step}
          onChange={(next) => void changeStep(next)}
          items={['Connect Phone', 'Camera correction', 'Calibration'].map(
            (title) => ({ title: t(title) }),
          )}
        />
      )}
      {error && <Alert type="error" showIcon message={error} />}
      {step === 0 && (
        <PhonePairStep
          controller={controller}
          footer={footer}
          onContinue={() => void changeStep(1)}
        />
      )}
      {step === 1 && props.onAlign && (
        <AutomaticScreenStep
          controller={controller}
          align={props.onAlign}
          advance={advance}
        />
      )}
      {step === 1 && !props.onAlign && (
        <WebCameraMappingStep
          controller={controller}
          camera={props.camera}
          live={props.mappingPreview ?? props.preview}
          hasCorners={Boolean(props.mappingPreview)}
          corrected={props.correctedPreview}
          size={props.outputSize}
          input={props.input}
          output={props.output}
          correctionKey={props.correctionKey}
          footer={footer}
          editing={props.editing}
          checkDraft={props.checkDraft}
          onConfirm={props.onConfirmMapping}
          saving={props.savingMapping}
          onDetect={props.onDetect}
          onPair={() => void changeStep(0)}
          onContinue={() => void changeStep(2)}
        />
      )}
      {step === 2 && pairing && !controller.setup.phoneConnected && (
        <PhonePairStep
          controller={controller}
          footer={null}
          onContinue={() => setPairing(false)}
        />
      )}
      {step === 2 && (props.input || !props.onAlign) && (
        <WebCalibrationWorkspace
          controller={controller}
          result={props.result}
          footer={footer}
          preview={props.preview}
          controls={props.controls}
          showSessionCancel={props.showSessionCancel}
          readyToStart={Boolean(props.ready && controller.setup.phoneConnected)}
          readyToCapture={Boolean(
            props.ready && controller.setup.phoneConnected,
          )}
          readyToVerify={Boolean(
            props.ready && controller.setup.phoneConnected,
          )}
          onActivated={async () => {}}
          onBeforeLeaveChange={registerLeave}
          onCheckCamera={() => void changeStep(1)}
          onConnectPhone={() => setPairing(true)}
          onReturn={props.onComplete}
          completionLabel={props.completionLabel}
        />
      )}
      {!props.footerContainer && (
        <div className="arm-calibration-footer" ref={setFooter} />
      )}
    </section>
  );
}

function AutomaticScreenStep({
  controller,
  align,
  advance,
}: {
  controller: ReturnType<typeof useAssistedCalibration>;
  align(signal: AbortSignal): Promise<void>;
  advance(): void;
}) {
  const { session, phone } = controller;
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string>();
  const resume = Boolean(session && session.stage !== 'cancelled');
  const ready = phone.state === 'connected' && !phone.displayRequirement;
  useEffect(() => {
    if (resume) {
      advance();
      return;
    }
    setError(undefined);
    if (!ready) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void align(abort.signal)
        .then(() => {
          if (!abort.signal.aborted) advance();
        })
        .catch((cause) => {
          if (!abort.signal.aborted) {
            speakCalibration('mappingFailed');
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        });
    }, 0);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [ready, attempt, align, advance, resume]);
  if (phone.state === 'connected' && phone.displayRequirement)
    return (
      <output>
        {t(
          phone.displayRequirement === 'home-screen'
            ? 'Open the calibration page from the iOS Home Screen to continue.'
            : 'Waiting for the phone to enter full screen…',
        )}
      </output>
    );
  if (error)
    return (
      <Alert
        type="error"
        showIcon
        message={calibrationErrorText(error)}
        action={
          <Button
            onClick={() => {
              setAttempt((n) => n + 1);
            }}
          >
            {t('Retry')}
          </Button>
        }
      />
    );
  if (!ready)
    return (
      <PhonePairStep
        controller={controller}
        footer={null}
        onContinue={() => {}}
      />
    );
  return (
    <output>
      <Spin size="small" /> {t('Checking page markers…')}
    </output>
  );
}

/** Switching devices creates an isolated view/store; the SDK retains the calibration session. */
export function CalibrationPanel(
  props: Parameters<typeof CalibrationPanelContent>[0],
) {
  return <CalibrationPanelContent key={props.deviceId} {...props} />;
}
