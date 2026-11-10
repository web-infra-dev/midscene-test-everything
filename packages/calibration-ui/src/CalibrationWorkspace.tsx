import { armUiTheme } from '@midscene/arm-kit-shared';
import type {
  CameraCorrection,
  PerspectiveValiditySummary,
} from '@midscene/arm-kit-shared/contracts';
import {
  Alert,
  Button,
  ConfigProvider,
  Modal,
  Space,
  Spin,
  Steps,
  Typography,
} from 'antd';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { CalibrationPanel } from './CalibrationPanel';
import {
  CalibrationSetup,
  type MeasuredCalibrationSetup,
} from './CalibrationSetup';
import { CameraCornerEditor } from './CameraCornerEditor';
import { CorrectedPreview } from './CorrectedPreview';
import { createCalibrationClient } from './client';
import { PerspectiveObservationCard } from './components/PerspectiveObservationCard';
import { WebCameraMappingStep } from './components/robot-arm/WebCameraMappingStep';
import { useAssistedCalibration } from './hooks/useAssistedCalibration';
import { usePerspectiveValidity } from './hooks/usePerspectiveValidity';
import { CalibrationLanguageProvider, t, useCalibrationLanguage } from './i18n';
import { calibrationPowerControl } from './power-state';
import type {
  AssistedCalibrationInput,
  AssistedMappingInput,
  CalibrationProfile,
  EffectiveCapabilities,
} from './robot-arm-api';
import type { RuntimeState } from './robot-arm-api';
import type { CameraProfile } from './types';
import { VoiceSettings } from './voice/VoiceSettings';
import { useBrowserVoice } from './voice/browser';
import './styles.less';
import './standalone/page.less';
export interface Configuration {
  deviceId: string;
  capabilities: EffectiveCapabilities;
  input?: AssistedCalibrationInput;
  installationTaught?: boolean;
  output?: AssistedMappingInput;
  camera: CameraProfile;
  correction?: CameraCorrection;
  correctionOutput?: { width: number; height: number };
  correctionKey?: string;
  perspectiveValidity?: PerspectiveValiditySummary;
  result?: CalibrationProfile;
  ready: boolean;
  armState?: RuntimeState;
  editable?: boolean;
  measuredSetup?: MeasuredCalibrationSetup;
}
async function requestAt<T>(
  base: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(90000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error?.message ??
        data.error ??
        `Request failed (${response.status})`,
    );
  return data as T;
}
export function CalibrationWorkspace({
  baseUrl = '/api/calibration',
  onComplete,
  embedded = false,
  cancelAction,
}: {
  embedded?: boolean;
  cancelAction?: ReactNode;
  baseUrl?: string;
  onComplete?: () => void;
}) {
  useBrowserVoice(!embedded);
  const base = baseUrl.replace(/\/+$/, '');
  const request = useCallback(
    <T,>(path: string, body?: unknown) => requestAt<T>(base, path, body),
    [base],
  );
  const language = useCalibrationLanguage((state) => state.language);
  const setLanguage = useCalibrationLanguage((state) => state.setLanguage);
  const client = useMemo(
    () => createCalibrationClient({ baseUrl: base }),
    [base],
  );
  const [config, setConfig] = useState<Configuration>();
  const perspective = usePerspectiveValidity(
    base,
    Boolean(config?.correction),
    config?.correctionKey,
  );
  const [error, setError] = useState<string>();
  const [pollError, setPollError] = useState<string>();
  const [reviewCamera, setReviewCamera] = useState(false);
  const review = useAssistedCalibration(client, config?.deviceId, reviewCamera);
  const [reviewFooter, setReviewFooter] = useState<HTMLDivElement | null>(null);
  const [acceptedRevision, setAcceptedRevision] = useState<number>();
  const reviewSize =
    config?.correctionOutput ?? config?.output ?? review.setup.layout?.screen;
  const [editingSetup, setEditingSetup] = useState(false);
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const [navigation, setNavigation] = useState<HTMLDivElement | null>(null);
  const [panelStep, setPanelStep] = useState(1);
  const refresh = useCallback(async () => {
    const next = await request<Configuration>('/configuration');
    setConfig(next);
    setError(undefined);
    setPollError(undefined);
  }, [request]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await request<Configuration>('/configuration');
        if (!disposed) {
          setConfig(next);
          setPollError(undefined);
        }
      } catch (error) {
        if (!disposed)
          setPollError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!disposed) timer = setTimeout(() => void poll(), 2000);
      }
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [request]);
  const align = useCallback(
    async (signal: AbortSignal) => {
      const next = await requestAt<Configuration>(
        base,
        '/camera/align',
        {},
        signal,
      );
      if (!next.input && !signal.aborted) {
        const setup = await client.assistedCalibrationSetup();
        if (!signal.aborted) setAcceptedRevision(setup.layout?.revision);
      }
      if (!signal.aborted) setConfig(next);
    },
    [base, client],
  );
  return (
    <ConfigProvider theme={armUiTheme}>
      <CalibrationLanguageProvider>
        <main className={`calibration-page${embedded ? ' is-embedded' : ''}`}>
          <header className="calibration-shell-header">
            <div className="calibration-shell-heading">
              <div>
                <Typography.Text type="secondary">
                  {t('Calibration')}
                </Typography.Text>
                <Typography.Title level={2}>
                  {t(
                    reviewCamera
                      ? 'Camera correction'
                      : (panelStep === 2 && !config?.input) || editingSetup
                        ? 'Touch Tool'
                        : [
                            'Connect Phone',
                            'Camera correction',
                            'Arm calibration',
                          ][panelStep],
                  )}
                </Typography.Title>
              </div>
              <Space>
                {!embedded && <VoiceSettings compact />}
                {cancelAction}
                {!embedded && (
                  <Button
                    onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
                  >
                    {language === 'zh' ? 'English' : '中文'}
                  </Button>
                )}
              </Space>
            </div>
            {reviewCamera && (
              <div className="calibration-shell-progress">
                <Steps
                  size="small"
                  current={0}
                  items={[
                    'Camera correction',
                    'Touch Tool',
                    'Arm calibration',
                  ].map((title) => ({ title: t(title) }))}
                />
              </div>
            )}
            <div
              hidden={reviewCamera}
              className="calibration-shell-progress"
              ref={setNavigation}
            >
              {((panelStep === 2 && !config?.input) || editingSetup) && (
                <Steps
                  size="small"
                  current={1}
                  onChange={(next) => {
                    if (next === 0 && config?.correction) setReviewCamera(true);
                  }}
                  items={[
                    'Camera correction',
                    'Touch Tool',
                    'Arm calibration',
                  ].map((title, i) => ({
                    title: t(title),
                    disabled: i === 2 || (i === 0 && !config?.correction),
                  }))}
                />
              )}
            </div>
          </header>
          <div className="calibration-shell-body">
            <div className="calibration-shell-content">
              <PerspectiveObservationCard
                observation={perspective}
                screenName={config?.camera.name}
                onRecalibrate={() => setReviewCamera(true)}
              />
              {(error || pollError) && (
                <Alert
                  type="error"
                  showIcon
                  message={error || pollError}
                  action={
                    <Button
                      onClick={() =>
                        void refresh().catch((error) => setError(String(error)))
                      }
                    >
                      {t('Retry')}
                    </Button>
                  }
                />
              )}
              {reviewCamera && config?.correction && (
                <WebCameraMappingStep
                  controller={review}
                  camera={config.camera}
                  hasCorners
                  savedResult={{
                    verified: Boolean(
                      review.setup.layout &&
                        (config.input
                          ? config.correctionKey &&
                            review.setup.mapping?.layout.revision ===
                              review.setup.layout.revision &&
                            review.setup.mapping?.vision.fingerprint ===
                              config.correctionKey
                          : acceptedRevision === review.setup.layout.revision),
                    ),
                  }}
                  size={reviewSize}
                  live={
                    <CameraCornerEditor
                      value={config.correction}
                      src={`${base}/camera/preview`}
                      disabled
                    />
                  }
                  corrected={
                    reviewSize && (
                      <CorrectedPreview
                        correction={config.correction}
                        size={reviewSize}
                        src={`${base}/camera/preview`}
                      />
                    )
                  }
                  footer={reviewFooter}
                  onDetect={
                    config.editable &&
                    !(
                      review.session?.stage === 'interrupted' &&
                      review.session.samples > 0
                    ) &&
                    !(
                      review.session?.stage === 'ready' &&
                      (review.session.referencePosition ||
                        review.session.safePosition)
                    )
                      ? () => align(AbortSignal.timeout(90000))
                      : undefined
                  }
                  onContinue={() => setReviewCamera(false)}
                />
              )}
              <div hidden={reviewCamera}>
                {!config ? (
                  !error && !pollError && <Spin />
                ) : (panelStep === 2 && !config.input) || editingSetup ? (
                  <CalibrationSetup
                    footer={footer}
                    capabilities={config.capabilities}
                    initial={config.measuredSetup}
                    onCancel={
                      config.input ? () => setEditingSetup(false) : undefined
                    }
                    onSave={async (input) => {
                      const phone = await client.calibrationPhoneStatus();
                      if (
                        phone.state !== 'connected' ||
                        phone.displayRequirement
                      )
                        throw new Error(
                          t(
                            phone.displayRequirement === 'home-screen'
                              ? 'Open the calibration page from the iOS Home Screen to continue.'
                              : 'Keep the phone page visible in full screen to continue.',
                          ),
                        );
                      const next = await request<Configuration>(
                        '/configuration',
                        input,
                      );
                      setPanelStep(1);
                      setConfig(next);
                      setEditingSetup(false);
                    }}
                  />
                ) : (
                  <CalibrationPanel
                    showSessionCancel={cancelAction === undefined}
                    footerContainer={footer}
                    navigationContainer={navigation}
                    onStepChange={setPanelStep}
                    onEditSetup={() => {
                      if (config.editable) {
                        setEditingSetup(true);
                      }
                    }}
                    controls={
                      !config.ready ? (
                        <CalibrationPowerButton
                          config={config}
                          apply={async (action) => {
                            const next = await request<Configuration>(
                              `/${action}`,
                              {
                                confirmed: true,
                              },
                            );
                            setConfig(next);
                          }}
                        />
                      ) : undefined
                    }
                    client={client}
                    {...config}
                    ready={
                      config.ready && perspective.summary?.state !== 'invalid'
                    }
                    preview={
                      <img
                        className="calibration-preview"
                        src={`${base}/camera/preview`}
                        alt={config.camera.name}
                      />
                    }
                    onReviewCamera={
                      config.correction
                        ? () => setReviewCamera(true)
                        : undefined
                    }
                    onAlign={align}
                    onComplete={onComplete}
                    completionLabel={
                      embedded ? 'Open Workspace' : 'Finish Calibration'
                    }
                  />
                )}
              </div>
            </div>
          </div>
          <footer className="calibration-shell-footer">
            {reviewCamera && (
              <div className="arm-calibration-footer" ref={setReviewFooter} />
            )}
            <div hidden={reviewCamera}>
              <div className="arm-calibration-footer" ref={setFooter} />
            </div>
          </footer>
        </main>
      </CalibrationLanguageProvider>
    </ConfigProvider>
  );
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
      ? 'Check Recovery'
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
            await apply(confirming);
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
