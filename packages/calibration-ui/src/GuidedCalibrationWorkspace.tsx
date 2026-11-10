import { armUiTheme } from '@midscene/arm-kit-shared';
import type {
  CalibrationBatchState,
  WorkstationScreenState,
} from '@midscene/arm-kit-shared/assisted-contracts';
import type { CameraCorrection } from '@midscene/arm-kit-shared/contracts';
import type {
  DetectionFrame,
  MarkerCalibrationCreateResult,
  MarkerCalibrationDetectionResponse,
  MarkerCalibrationTarget,
} from '@midscene/arm-kit-shared/marker-contracts';
import {
  Alert,
  App,
  Button,
  ConfigProvider,
  Modal,
  Select,
  Space,
  Spin,
  Steps,
  Typography,
} from 'antd';
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CalibrationSetup } from './CalibrationSetup';
import {
  CalibrationPowerButton,
  type Configuration,
} from './CalibrationWorkspace';
import { CameraCornerEditor } from './CameraCornerEditor';
import { CorrectedPreview } from './CorrectedPreview';
import { BatchClient } from './batch-client';
import { createCalibrationClient } from './client';
import { MarkerCalibrationDialog } from './components/MarkerCalibrationDialog';
import { MultiScreenCalibrationReviewDialog } from './components/MultiScreenCalibrationReviewDialog';
import { PerspectiveObservationCard } from './components/PerspectiveObservationCard';
import {
  CalibrationBatchPanel,
  type CalibrationBatchPanelHandle,
} from './components/robot-arm/CalibrationBatchPanel';
import { CameraMappingStep } from './components/robot-arm/CameraMappingStep';
import { ExplorationProgress } from './components/robot-arm/ExplorationProgress';
import { InstallationTeaching } from './components/robot-arm/InstallationTeaching';
import { PhoneConnectDialog } from './components/robot-arm/PhoneConnectDialog';
import { ScreenOutlines } from './components/robot-arm/ScreenOutlines';
import { WebCalibrationWorkspace } from './components/robot-arm/WebCalibrationWorkspace';
import { useAssistedCalibration } from './hooks/useAssistedCalibration';
import { useCameraPhoneReadiness } from './hooks/useCameraPhoneReadiness';
import { usePerspectiveValidity } from './hooks/usePerspectiveValidity';
import { CalibrationLanguageProvider, t, useLanguage } from './i18n';
import {
  RobotVisionApiError,
  RobotVisionClient,
  ScreenCalibClient,
  markerRequest,
} from './marker-client';
import { TeachingClient } from './teaching-client';
import './styles.less';
import './standalone/page.less';
import './migrated-calibration.less';
interface BoundScreen {
  id: string;
  cameraId: string;
  name: string;
  pageKey?: string;
  hasCorrection?: boolean;
  hasSavedPerspective?: boolean;
  markerSlot?: number;
  correction?: CameraCorrection;
}

/** The original camera → teaching → calibration flow inside the host's wizard. */
export function GuidedCalibrationWorkspace({
  id,
  cameraId,
  onClose,
  initialStep = 0,
}: { id: string; cameraId: string; onClose(): void; initialStep?: 0 | 1 }) {
  return (
    <ConfigProvider theme={armUiTheme}>
      <App className="guided-calibration-root">
        <CalibrationLanguageProvider>
          <GuidedContent
            id={id}
            cameraId={cameraId}
            onClose={onClose}
            initialStep={initialStep}
          />
        </CalibrationLanguageProvider>
      </App>
    </ConfigProvider>
  );
}
function GuidedContent({
  id,
  cameraId,
  onClose,
  initialStep,
}: { id: string; cameraId: string; onClose(): void; initialStep: 0 | 1 }) {
  useLanguage();
  const { message } = App.useApp();
  const [selectedId, setSelectedId] = useState(id);
  const [step, setStep] = useState<number>(initialStep);
  const initialStepPending = useRef(true);
  const [config, setConfig] = useState<Configuration>();
  const [screens, setScreens] = useState<BoundScreen[]>([]);
  const [states, setStates] = useState<WorkstationScreenState[]>([]);
  const [error, setError] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const [closing, setClosing] = useState(false);
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const [phonesOpen, setPhonesOpen] = useState(false);
  const [markerOpen, setMarkerOpen] = useState(initialStep === 1);
  /** The manual corner editor, handed over from a failed marker pass. */
  const [perspectiveEditor, setPerspectiveEditor] = useState(false);
  const [retryId, setRetryId] = useState<string>();
  const [markerSession, setMarkerSession] =
    useState<MarkerCalibrationCreateResult>();
  /** The session credential, kept outside state so detection can apply. */
  const markerToken = useRef<string>();
  const [review, setReview] = useState<MarkerCalibrationDetectionResponse>();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewing, setReviewing] = useState<{
    target: MarkerCalibrationTarget;
    frame?: DetectionFrame;
  }>();
  const [applying, setApplying] = useState(false);
  const [batch, setBatch] = useState<CalibrationBatchState | null>();
  const [batchActive, setBatchActive] = useState(false);
  const [singleActive, setSingleActive] = useState(false);
  const [singleQueued, setSingleQueued] = useState(false);
  const singlePending = useRef(false);
  const batchPanel = useRef<CalibrationBatchPanelHandle>(null);
  const batchClient = useMemo(() => new BatchClient(cameraId), [cameraId]);
  const markerClient = useMemo(
    () => new RobotVisionClient(cameraId),
    [cameraId],
  );
  const pageClient = useMemo(() => new ScreenCalibClient(cameraId), [cameraId]);
  const base = `/api/devices/${encodeURIComponent(selectedId)}/calibration`;
  const client = useMemo(
    () => createCalibrationClient({ baseUrl: base }),
    [base],
  );
  const controller = useAssistedCalibration(client, selectedId, !batchActive);
  const teaching = useMemo(
    () =>
      config?.input
        ? new TeachingClient(base, {
            ...config.input,
            screenProfileId: selectedId,
          })
        : undefined,
    [
      base,
      config?.input?.robotProfileId,
      config?.input?.toolProfileId,
      cameraId,
      selectedId,
    ],
  );
  const savedScreens = screens.filter(
    (s) => s.cameraId === cameraId && s.hasCorrection,
  );
  const phoneCameras = useMemo(
    () => [
      {
        id: cameraId,
        name: config?.camera.name ?? cameraId,
        online: true,
        screenCount: savedScreens.length,
        screens: savedScreens,
        screenBindings: savedScreens,
      },
    ],
    [
      cameraId,
      config?.camera.name,
      savedScreens.map((s) => `${s.id}:${s.name}`).join('|'),
    ],
  );
  const phoneReadiness = useCameraPhoneReadiness({
    active: true,
    api: pageClient,
    cameras: phoneCameras,
    cameraId,
  });
  const knownScreens = screens.filter(
    (s) =>
      s.cameraId === cameraId &&
      (s.hasCorrection || s.markerSlot !== undefined),
  );
  /*
   * The page reports its viewport only in fullscreen, so the camera mapping —
   * and the marker pass it depends on — waits for the operator to open the
   * page full screen. The selected screen's own page decides, with the first
   * page of the camera as the fallback for a page that is only page-key bound.
   */
  const cameraPages = (phoneReadiness.connection?.devices ?? []).filter(
    (device) => device.visible && device.cameraId === cameraId,
  );
  const phonePage =
    cameraPages.find((device) => device.screenId === selectedId) ??
    cameraPages[0];
  const phoneFullscreen = Boolean(phonePage?.fullscreen);
  const savedIds = knownScreens
    .map((s) => `${s.id}:${s.name}:${s.pageKey}`)
    .join('|');
  const existing = useMemo(
    () =>
      knownScreens.map((s) => ({ id: s.id, name: s.name, pageKey: s.pageKey })),
    [savedIds],
  );
  const currentBase = useRef(base);
  currentBase.current = base;
  const refresh = useCallback(
    async (signal = AbortSignal.timeout(15000)) => {
      const [next, listed] = await Promise.all([
        markerRequest<Configuration>(
          `${base}/configuration`,
          undefined,
          signal,
        ),
        markerRequest<{ screens: BoundScreen[] }>(
          '/api/screens',
          undefined,
          signal,
        ),
      ]);
      if (signal.aborted || currentBase.current !== base) return;
      setConfig(next);
      setScreens(listed.screens);
      /*
       * The camera step edits a screen, not the camera: a device id that has no
       * screen target cannot be selected, and showing it would render the raw
       * device path. Fall back to the camera's own screen, then the first one.
       */
      const selectable = listed.screens.filter(
        (screen) => screen.cameraId === cameraId,
      );
      const fallback = selectable.some((screen) => screen.id === selectedId)
        ? undefined
        : (selectable.find((screen) => screen.id === cameraId) ??
          selectable[0]);
      if (fallback) setSelectedId(fallback.id);
      else if (initialStepPending.current) {
        initialStepPending.current = false;
        if (!next.input) {
          setStep(0);
          setMarkerOpen(false);
        } else if (
          initialStep === 1 ||
          !next.correction ||
          next.perspectiveValidity?.state === 'invalid'
        ) {
          setStep(1);
        } else {
          setStep(next.installationTaught ? 3 : 2);
        }
      }
      const [running, status] = await Promise.allSettled([
        batchClient.calibrationBatch(signal),
        markerRequest<{ phase: string; error?: string }>(
          `${base}/status`,
          undefined,
          signal,
        ),
      ]);
      if (signal.aborted || currentBase.current !== base) return;
      if (running.status === 'fulfilled') setBatch(running.value);
      const singleStatus =
        status.status === 'fulfilled' ? status.value : undefined;
      if (
        singlePending.current &&
        singleStatus &&
        singleStatus.phase !== 'queued'
      ) {
        singlePending.current = false;
        setSingleQueued(false);
        if (['running', 'completed'].includes(singleStatus.phase))
          setSingleActive(true);
        else setError(singleStatus.error ?? t('Calibration cancelled'));
      }
    },
    [base, batchClient, cameraId, initialStep, selectedId],
  );
  const [connectingPage, setConnectingPage] = useState<string>();
  const connectPage = useCallback(
    async (id: string, camera: string, assignCamera = false) => {
      setConnectingPage(id);
      try {
        if (assignCamera) await pageClient.assignScreenDeviceCamera(id, camera);
        else
          await pageClient.assignScreenDevice(id, {
            role: 'mapping',
            cameraId: camera,
          });
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setConnectingPage(undefined);
      }
    },
    [pageClient, refresh],
  );
  /**
   * Saving the perspective is what confirms the camera mapping: the host keeps
   * the correction on that screen's camera session and rebuilds the page
   * mapping, so the later steps and the marker review read one geometry.
   */
  const applyCorrection = useCallback(
    async (correction: CameraCorrection) => {
      await markerRequest(`${base}/camera/correction`, correction);
      // Page mapping needs the saved tool setup; a bench that has not saved it
      // yet keeps the perspective and maps during the tool step.
      if (config?.input) {
        try {
          await client.mapAssistedCalibration();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
      await refresh();
    },
    [base, client, config?.input, refresh],
  );
  /**
   * Clearing keeps the screen, its page link and its marker slot; only the
   * framing the camera was applying is released, so the same glass can be
   * mapped again without pairing it a second time.
   */
  const clearCorrection = useCallback(async () => {
    const response = await fetch(`${base}/camera/correction`, {
      method: 'DELETE',
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data?.error?.message ??
          data?.error ??
          'Could not clear the perspective correction',
      );
    // Keep the correction cleared until the operator starts a new pass.
    autoDetectStarted.current = selectedId;
    await refresh();
  }, [base, refresh, selectedId]);
  useEffect(() => {
    const abort = new AbortController();
    let opened = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const signal = AbortSignal.any([
        abort.signal,
        AbortSignal.timeout(15000),
      ]);
      try {
        if (!opened) {
          const { screens: available } = await markerRequest<{
            screens: BoundScreen[];
          }>('/api/screens', undefined, signal);
          const selectable = available.filter(
            (screen) => screen.cameraId === cameraId,
          );
          if (!selectable.some((screen) => screen.id === selectedId)) {
            const fallback =
              selectable.find((screen) => screen.id === cameraId) ??
              selectable[0];
            if (fallback) {
              setSelectedId(fallback.id);
              return;
            }
          }
          await markerRequest(`${base}/open`, {}, signal);
          opened = true;
        }
        await refresh(signal);
        if (!abort.signal.aborted) setLoadError(undefined);
      } catch (cause) {
        opened = false;
        if (!abort.signal.aborted)
          setLoadError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 1500);
      }
    };
    setConfig(undefined);
    setLoadError(undefined);
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [base, cameraId, refresh, selectedId]);
  useEffect(() => {
    if (step !== 3) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const signal = AbortSignal.any([
        abort.signal,
        AbortSignal.timeout(15000),
      ]);
      try {
        const nextStates = await batchClient.screens(signal);
        if (!abort.signal.aborted) setStates(nextStates);
      } catch (cause) {
        if (!abort.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 1500);
      }
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [batchClient, step]);
  const markerKey = useMemo(
    () => ({ id: cameraId, deviceId: cameraId }),
    [cameraId],
  );
  const current = batch?.items[batch.currentIndex];
  const activeId = batchActive && current ? current.deviceId : selectedId;
  const perspective = usePerspectiveValidity(
    `/api/devices/${encodeURIComponent(activeId)}/calibration`,
    Boolean(config?.correction),
    config?.correctionKey,
  );
  const outlineBlocked =
    (perspective.summary ?? config?.perspectiveValidity)?.state === 'invalid';
  /*
   * Every screen with a saved perspective is drawn on the live preview at
   * once; the selected one carries the freshest correction and the verdict.
   */
  const asideOutlines = knownScreens.flatMap((entry) => {
    const fresh = config?.deviceId === entry.id ? config.correction : undefined;
    const quad =
      entry.id === activeId ? (fresh ?? entry.correction) : entry.correction;
    if (!quad) return [];
    return [
      {
        id: entry.id,
        name: entry.name,
        correction: quad,
        active: entry.id === activeId,
        validity:
          entry.id === activeId ? perspective.summary?.state : undefined,
      },
    ];
  });
  const single = useMemo(
    () =>
      createCalibrationClient({
        baseUrl: `/api/devices/${encodeURIComponent(activeId)}/calibration`,
      }),
    [activeId],
  );
  const progress = useAssistedCalibration(
    single,
    activeId,
    step === 3 && batchActive,
  );
  const beforeLeave = useRef<(() => Promise<void>) | null>(null);
  const registerLeave = useCallback((handler: (() => Promise<void>) | null) => {
    beforeLeave.current = handler;
  }, []);
  const close = async () => {
    setClosing(true);
    try {
      if (batchActive && batch)
        await batchClient.calibrationBatchCommand(batch.id, {
          revision: batch.revision,
          action: 'stop',
        });
      await beforeLeave.current?.();
      if (config?.armState?.state.dragMode && teaching)
        await teaching.exitDrag();
      await markerRequest(`${base}/cancel`, {}, AbortSignal.timeout(15000));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setClosing(false);
    }
  };
  const detected = useCallback(
    async (_session: unknown, result: MarkerCalibrationDetectionResponse) => {
      setRetryId(undefined);
      const { session } = result;
      /*
       * A result the workstation would trust is applied without a review pass:
       * the operator connected the screen to get a perspective, not a dialog.
       * Weak evidence still opens the review so nothing is applied blindly. The
       * layout check inside the detector already rejects a windowed page, so the
       * gate here is about frame evidence only.
       */
      const confident =
        session.targets.length > 0 &&
        session.targets.every(
          (target) =>
            target.state === 'succeeded' &&
            target.result !== undefined &&
            target.display?.fullscreen === true &&
            target.result.validFrames >= 4 &&
            target.result.cornerJitterPx <= 4 &&
            target.result.reprojectionRmsePx <= 4,
        );
      if (!confident) {
        setReview(result);
        setReviewOpen(true);
        return;
      }
      const token = markerToken.current;
      if (!token) {
        setReview(result);
        setReviewOpen(true);
        return;
      }
      setApplying(true);
      try {
        const result = await markerClient.applyMarkerCalibration(
          session.id,
          token,
        );
        const failures = Object.values(result.mappingErrors);
        if (failures.length) setError(failures.join('\n'));
        else void message.success(t('Camera mapping applied automatically'));
        await refresh();
        setReview(undefined);
        setReviewOpen(false);
        setMarkerOpen(false);
      } catch (cause) {
        setReview(result);
        setReviewOpen(true);
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setApplying(false);
      }
    },
    [markerClient, message, refresh],
  );
  const markerClosed = useCallback(() => setMarkerOpen(false), []);
  /**
   * A screen that is connected and bound has its markers on the page already,
   * so the camera step starts the perspective pass by itself: the dialog
   * detects, the result is applied above and the status flips to applied.
   * Closing the dialog keeps it closed for that screen.
   */
  const autoDetectStarted = useRef<string>();
  const phoneConnected = cameraPages.some((page) => page.mode !== 'waiting');
  useEffect(() => {
    if (step !== 1 || markerOpen || !config || config.correction) return;
    // Markers are only reported from a fullscreen page; opening the dialog
    // earlier would detect against a viewport the camera cannot trust.
    if (!phoneConnected || !phoneFullscreen) return;
    if (autoDetectStarted.current === selectedId) return;
    autoDetectStarted.current = selectedId;
    setMarkerOpen(true);
  }, [
    step,
    markerOpen,
    config?.correction,
    phoneConnected,
    phoneFullscreen,
    selectedId,
  ]);
  const startSingle = async () => {
    setSingleQueued(true);
    try {
      await markerRequest(`${base}/start`, {});
      singlePending.current = true;
    } catch (error) {
      singlePending.current = false;
      setSingleQueued(false);
      throw error;
    }
    await refresh();
  };
  const titles = [
    'Touch Tool',
    'Camera Mapping',
    'Teach Installation',
    'Screen Calibration',
  ];
  const canVisit = (next: number) =>
    !batchActive &&
    !singleActive &&
    !singleQueued &&
    !config?.armState?.state.moving &&
    !config?.armState?.state.dragMode &&
    (next === 0 || Boolean(config?.input)) &&
    (next < 2 || Boolean(config?.correction)) &&
    (next < 2 || !outlineBlocked) &&
    (next < 3 || Boolean(controller.setup.teaching));
  const selected = screens.find((s) => s.id === selectedId);
  return (
    <main className="calibration-page is-embedded guided-calibration">
      <header className="calibration-shell-header">
        <div className="calibration-shell-heading">
          <div>
            <Typography.Text type="secondary">
              {t('Calibration')}
            </Typography.Text>
            <Typography.Title level={2}>{t(titles[step])}</Typography.Title>
          </div>
          <Space>
            {step > 0 && (
              <Button onClick={() => setPhonesOpen(true)}>
                {t('View Phone Page')}
              </Button>
            )}
            <Button loading={closing} onClick={() => void close()}>
              {t('Close')}
            </Button>
          </Space>
        </div>
        <Steps
          size="small"
          current={step}
          items={titles.map((title, index) => ({
            title: t(title),
            disabled: !canVisit(index),
          }))}
          onChange={(next) => {
            if (canVisit(next)) {
              setStep(next);
              // The camera step opens on its checklist; marker detection is an
              // explicit action from the perspective row.
              if (next === 1) setMarkerOpen(false);
            }
          }}
        />
      </header>
      <div className="calibration-shell-body">
        <div className="guided-calibration-layout">
          <div className="guided-calibration-flow">
            <PerspectiveObservationCard
              observation={perspective}
              screenName={screens.find((s) => s.id === activeId)?.name}
              onRecalibrate={
                batchActive || singleActive || singleQueued
                  ? undefined
                  : () => {
                      setStep(1);
                      setMarkerOpen(true);
                    }
              }
            />
            {error && (
              <Alert
                type="error"
                showIcon
                message={error}
                closable
                onClose={() => setError(undefined)}
              />
            )}
            {loadError && <Alert type="error" showIcon message={loadError} />}
            {!config ? (
              !loadError && <Spin />
            ) : (
              <>
                {step === 0 && (
                  <CalibrationSetup
                    key={`${config.deviceId}:${config.input?.toolProfileId ?? ''}`}
                    capabilities={config.capabilities}
                    initial={config.measuredSetup}
                    footer={footer}
                    onSave={async (value) => {
                      await markerRequest(`${base}/configuration`, value);
                      await refresh();
                      setStep(1);
                      setMarkerOpen(false);
                    }}
                  />
                )}
                {step === 1 &&
                  (markerOpen ? (
                    <GuidedMarkerCalibration
                      variant="inline"
                      footerContainer={footer}
                      api={markerClient}
                      screenCalib={pageClient}
                      stream={markerKey}
                      displayName={config.camera.name}
                      autoCreateScreen
                      autoAddTarget={false}
                      firstScreenCalibration={!savedScreens.length}
                      existingScreens={retryId ? undefined : existing}
                      focusTargetId={retryId}
                      resumeSession={retryId ? markerSession : undefined}
                      includeSucceededTargets={Boolean(retryId)}
                      keepSessionOnClose
                      onAdjustManually={() => {
                        // The operator chose the manual path, so the automatic
                        // pass must not reopen over the editor.
                        autoDetectStarted.current = selectedId;
                        setPerspectiveEditor(true);
                      }}
                      onClose={markerClosed}
                      onDetected={detected}
                      onSessionCreated={(created) => {
                        markerToken.current = created.token;
                        setMarkerSession(created);
                      }}
                      existingScreenNames={screens
                        .filter((s) => s.cameraId === cameraId)
                        .map((s) => s.name)}
                    />
                  ) : (
                    <CameraMappingStep
                      camera={{
                        name: config.camera.name,
                        online: Boolean(config.camera.online),
                      }}
                      screens={knownScreens}
                      screenId={selectedId}
                      base={base}
                      correction={config.correction}
                      perspectiveOpen={perspectiveEditor}
                      onPerspectiveOpenChange={(open) => {
                        // Placing the corners by hand is a deliberate choice:
                        // keep the automatic pass from opening over the editor.
                        if (open) autoDetectStarted.current = selectedId;
                        setPerspectiveEditor(open);
                      }}
                      output={config.correctionOutput ?? config.output}
                      validity={perspective.summary?.state}
                      phoneConnected={phoneConnected}
                      phoneFullscreen={phoneFullscreen}
                      mappingReady={Boolean(controller.setup.mapping)}
                      footer={footer}
                      busy={controller.busy}
                      extra={
                        <Space wrap>
                          {review && (
                            <Button
                              size="small"
                              onClick={() => setReviewOpen(true)}
                            >
                              {t('Review and Apply')}
                            </Button>
                          )}
                          {selected?.hasSavedPerspective &&
                            !selected.hasCorrection && (
                              <Button
                                size="small"
                                danger
                                disabled={controller.busy}
                                onClick={async () => {
                                  if (
                                    !window.confirm(
                                      t(
                                        'Delete the saved perspective for this screen?',
                                      ),
                                    )
                                  )
                                    return;
                                  try {
                                    await pageClient.deletePerspective(
                                      cameraId,
                                      selectedId,
                                    );
                                    await refresh();
                                  } catch (cause) {
                                    setError(
                                      cause instanceof Error
                                        ? cause.message
                                        : String(cause),
                                    );
                                  }
                                }}
                              >
                                {t('Delete Saved Perspective')}
                              </Button>
                            )}
                          {knownScreens.some(
                            (screen) => screen.id === selectedId,
                          ) && (
                            <Button
                              size="small"
                              danger
                              disabled={controller.busy}
                              onClick={async () => {
                                if (
                                  !window.confirm(
                                    t('Delete this screen binding?'),
                                  )
                                )
                                  return;
                                try {
                                  await pageClient.deleteScreen(
                                    cameraId,
                                    selectedId,
                                  );
                                  setReview(undefined);
                                  setMarkerSession(undefined);
                                  setRetryId(undefined);
                                  await refresh();
                                } catch (cause) {
                                  setError(
                                    cause instanceof Error
                                      ? cause.message
                                      : String(cause),
                                  );
                                }
                              }}
                            >
                              {t('Delete Screen')}
                            </Button>
                          )}
                        </Space>
                      }
                      onSelectScreen={setSelectedId}
                      onAddScreen={async () => {
                        try {
                          const created =
                            await markerClient.createMarkerCalibration(
                              cameraId,
                              [
                                `Screen ${screens.filter((s) => s.cameraId === cameraId).length + 1}`,
                              ],
                            );
                          setMarkerSession(created);
                          setRetryId(created.targets[0].id);
                          setMarkerOpen(true);
                        } catch (cause) {
                          setError(
                            cause instanceof Error
                              ? cause.message
                              : String(cause),
                          );
                        }
                      }}
                      onPair={() => setPhonesOpen(true)}
                      onDetect={() => {
                        setRetryId(undefined);
                        setMarkerOpen(true);
                      }}
                      onApply={applyCorrection}
                      onConfirm={async () => {
                        await client.mapAssistedCalibration();
                        await refresh();
                      }}
                      onClear={config.correction ? clearCorrection : undefined}
                      onContinue={() => setStep(2)}
                      refresh={refresh}
                    />
                  ))}
                {step === 2 && teaching && (
                  <>
                    <Space className="guided-teaching-toolbar">
                      {controller.setup.teaching && (
                        <Button onClick={() => setStep(3)}>
                          {t('Next Step')}
                        </Button>
                      )}
                      {!config.ready && (
                        <CalibrationPowerButton
                          config={config}
                          apply={async (action) => {
                            await markerRequest(`${base}/${action}`, {
                              confirmed: true,
                            });
                            await refresh();
                          }}
                        />
                      )}
                      <Select
                        aria-label={t('Calibration Screen')}
                        value={selectedId}
                        options={savedScreens.map((s) => ({
                          value: s.id,
                          label: s.name,
                        }))}
                        style={{ minWidth: 180 }}
                        disabled={Boolean(
                          config.armState?.state.dragMode ||
                            config.armState?.state.moving,
                        )}
                        onChange={setSelectedId}
                      />
                    </Space>
                    <InstallationTeaching
                      api={teaching}
                      binding={teaching.binding}
                      screenName={selected?.name}
                      disabled={
                        Boolean(config.armState?.state.moving) || outlineBlocked
                      }
                      footer={footer}
                      externalPreview
                      onSaved={() => {
                        setStep(3);
                        void refresh();
                      }}
                    />
                  </>
                )}
                {step === 3 && (
                  <>
                    {singleQueued && (
                      <Alert
                        type="info"
                        showIcon
                        message={t('Waiting for the Controller queue')}
                      />
                    )}
                    <CalibrationBatchPanel
                      ref={batchPanel}
                      api={batchClient}
                      cameraId={cameraId}
                      screens={states}
                      disabled={
                        !config.ready ||
                        outlineBlocked ||
                        controller.busy ||
                        singleActive ||
                        singleQueued
                      }
                      onActiveChange={setBatchActive}
                      onChanged={refresh}
                    />
                    {batchActive && current && (
                      <ActiveBatchScreen controller={progress} />
                    )}
                    {!batchActive && singleActive && (
                      <WebCalibrationWorkspace
                        controller={controller}
                        footer={footer}
                        result={config.result}
                        readyToCapture={config.ready && !outlineBlocked}
                        readyToStart={config.ready && !outlineBlocked}
                        onActivated={refresh}
                        externalPreview
                        onBeforeLeaveChange={registerLeave}
                        onReturn={onClose}
                      />
                    )}
                    {!batchActive && !singleActive && footer && (
                      <WizardFooter container={footer}>
                        <Button
                          disabled={singleQueued}
                          onClick={() => setStep(2)}
                        >
                          {t('Previous Step')}
                        </Button>
                        {savedScreens.length > 1 ? (
                          <Button
                            type="primary"
                            disabled={!config.ready || outlineBlocked}
                            onClick={() => batchPanel.current?.open()}
                          >
                            {t('Start automatic calibration')}
                          </Button>
                        ) : (
                          <Button
                            type="primary"
                            loading={singleQueued}
                            disabled={
                              !config.ready || outlineBlocked || singleQueued
                            }
                            onClick={() =>
                              void startSingle().catch((cause) =>
                                setError(
                                  cause instanceof Error
                                    ? cause.message
                                    : String(cause),
                                ),
                              )
                            }
                          >
                            {t('Start automatic calibration')}
                          </Button>
                        )}
                      </WizardFooter>
                    )}
                  </>
                )}
              </>
            )}
          </div>
          {config && (
            <aside className="guided-camera" aria-label={t('Live Preview')}>
              <Typography.Text strong>
                {t('Live Preview')} · {config.camera.name}
              </Typography.Text>
              <div className="guided-preview-frame">
                <img
                  className="calibration-preview"
                  src={`/api/devices/${encodeURIComponent(activeId)}/calibration/camera/preview`}
                  data-testid="calibration-live-camera"
                  alt={config.camera.name}
                />
                <ScreenOutlines outlines={asideOutlines} />
              </div>
              {step === 1 && (
                <Typography.Text type="secondary">
                  {t('Keep the entire phone visible in the camera preview.')}
                </Typography.Text>
              )}
              {step === 2 && (
                <Typography.Text type="secondary">
                  {t('Check the whole arm directly before recording.')}
                </Typography.Text>
              )}
            </aside>
          )}
        </div>
      </div>
      <footer className="calibration-shell-footer">
        <div className="arm-calibration-footer" ref={setFooter} />
      </footer>
      <PhoneConnectDialog
        open={phonesOpen}
        onClose={() => setPhonesOpen(false)}
        readiness={phoneReadiness}
        cameras={phoneCameras}
        connectingDeviceId={connectingPage}
        onConnect={(id, camera) => void connectPage(id, camera)}
        onAssignCamera={(id, camera) => void connectPage(id, camera, true)}
        onRestoreHome={(id) => pageClient.restoreScreenDeviceHome(id)}
        onWake={async (id) => {
          await pageClient.wakeScreenDevice(id);
          await refresh();
        }}
        onForget={async (id) => {
          await pageClient.forgetScreenDevice(id);
          await refresh();
        }}
        onRenamePage={async (id, name) => {
          await pageClient.renameScreenDevice(id, name);
          await refresh();
        }}
        onRenameScreens={async (camera, names) => {
          for (const [id, name] of Object.entries(names))
            await pageClient.renameScreen(camera, id, name);
          await refresh();
        }}
      />
      <MultiScreenCalibrationReviewDialog
        session={review?.session}
        frames={review?.frames ?? {}}
        open={reviewOpen}
        applying={applying}
        error={error}
        retryingTargetId={retryId}
        onClose={() => setReviewOpen(false)}
        onReview={(target, frame) => setReviewing({ target, frame })}
        onRetry={(target) => {
          setReviewOpen(false);
          setRetryId(target.id);
          setMarkerOpen(true);
        }}
        onApply={() => {
          if (!review || !markerSession) return;
          setError(undefined);
          setApplying(true);
          void markerClient
            .applyMarkerCalibration(review.session.id, markerSession.token)
            .catch((cause) => {
              if (
                cause instanceof RobotVisionApiError &&
                cause.code === 'CALIBRATION_MISMATCH' &&
                window.confirm(
                  t(
                    'The outline does not match the phone screen. Apply it anyway?',
                  ),
                )
              )
                return markerClient.applyMarkerCalibration(
                  review.session.id,
                  markerSession.token,
                  true,
                );
              throw cause;
            })
            .then(async (result) => {
              await refresh();
              const failures = Object.values(result.mappingErrors);
              if (failures.length) setError(failures.join('\n'));
              setReview(undefined);
              setReviewOpen(false);
              setMarkerOpen(false);
            })
            .catch((cause) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            )
            .finally(() => setApplying(false));
        }}
      />
      <Modal
        open={Boolean(reviewing)}
        width="min(960px, 94vw)"
        footer={null}
        title={reviewing?.target.name}
        onCancel={() => setReviewing(undefined)}
      >
        {reviewing?.target.result &&
          reviewing.frame?.jpegBase64 &&
          (() => {
            const result = reviewing.target.result!;
            const correction: CameraCorrection = {
              points: result.points,
              sourceWidth: result.imageWidth,
              sourceHeight: result.imageHeight,
              rotation: result.rotation,
            };
            const src = `data:image/jpeg;base64,${reviewing.frame!.jpegBase64}`;
            return (
              <div className="robot-setup-task-layout">
                <CameraCornerEditor disabled value={correction} src={src} />
                <CorrectedPreview
                  correction={correction}
                  size={{
                    width: result.screenWidthPx,
                    height: result.screenHeightPx,
                  }}
                  src={src}
                />
              </div>
            );
          })()}
      </Modal>
    </main>
  );
}
import { createPortal } from 'react-dom';
function GuidedMarkerCalibration(
  props: ComponentProps<typeof MarkerCalibrationDialog>,
) {
  const [initial] = useState({
    existing: props.existingScreens,
    first: props.firstScreenCalibration,
  });
  return (
    <MarkerCalibrationDialog
      {...props}
      existingScreens={initial.existing}
      firstScreenCalibration={initial.first}
    />
  );
}
function WizardFooter({
  container,
  children,
}: { container: HTMLElement; children: ReactNode }) {
  return createPortal(
    <div className="robot-web-actions">{children}</div>,
    container,
  );
}
function ActiveBatchScreen({
  controller,
}: {
  controller: ReturnType<typeof useAssistedCalibration>;
}) {
  const session = controller.session;
  return (
    <div className="guided-batch-progress">
      <div>
        {session && <ExplorationProgress session={session} />}
        {session?.explorationQuality && (
          <Typography.Paragraph>
            {t('Grid RMS {0} mm · Holdout maximum {1} mm · Coverage {2}%', [
              session.explorationQuality.gridRmsMm.toFixed(2),
              session.explorationQuality.holdoutMaxMm.toFixed(2),
              Math.round(session.explorationQuality.coverage * 100),
            ])}
          </Typography.Paragraph>
        )}
        {session &&
          ['return-ready', 'positioning-safe'].includes(session.stage) && (
            <Typography.Paragraph>
              {t(
                'Boundary verification is complete. Record a Safe Position clear of the screen and camera; release the robot before recording.',
              )}
            </Typography.Paragraph>
          )}
        {controller.connectionError && (
          <Alert type="error" message={controller.connectionError} />
        )}
      </div>
    </div>
  );
}
