import { armUiTheme } from '@midscene/arm-kit-shared';
import type { CalibrationPreviewPositions } from '@midscene/arm-kit-shared/assisted-contracts';
import type {
  CalibrationBatchState,
  WorkstationScreenState,
} from '@midscene/arm-kit-shared/assisted-contracts';
import type { CameraCorrection } from '@midscene/arm-kit-shared/contracts';
import { markerCaptureRecommended } from '@midscene/arm-kit-shared/marker-contracts';
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
  Tabs,
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
import { ExplorationQualitySummary } from './components/robot-arm/CalibrationQualityWarnings';
import { CameraMappingStep } from './components/robot-arm/CameraMappingStep';
import { ExplorationProgress } from './components/robot-arm/ExplorationProgress';
import { InstallationTeaching } from './components/robot-arm/InstallationTeaching';
import { PhoneConnectDialog } from './components/robot-arm/PhoneConnectDialog';
import { ScreenOutlines } from './components/robot-arm/ScreenOutlines';
import { SetupIllustration } from './components/robot-arm/SetupIllustration';
import { TeachingDiagram } from './components/robot-arm/TeachingDiagram';
import { WebCalibrationWorkspace } from './components/robot-arm/WebCalibrationWorkspace';
import { useAssistedCalibration } from './hooks/useAssistedCalibration';
import { useCameraPhoneReadiness } from './hooks/useCameraPhoneReadiness';
import { usePerspectiveValidity } from './hooks/usePerspectiveValidity';
import {
  CalibrationLanguageProvider,
  calibrationErrorText,
  t,
  useLanguage,
} from './i18n';
import {
  RobotVisionApiError,
  RobotVisionClient,
  ScreenCalibClient,
  markerRequest,
} from './marker-client';
import { cameraPreviewUrl } from './preview-url';
import {
  needsPhoneConnectionBeforeAddScreen,
  selectableScreens,
} from './screen-selection';
import { TeachingClient } from './teaching-client';
import { isRequiredPhonePage } from './utils/phone-readiness';
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
  previewPositions?: CalibrationPreviewPositions;
}

interface SingleStatus {
  phase: string;
  attemptId?: string;
  error?: string;
}

/** The original camera → teaching → calibration flow inside the host's wizard. */
export function GuidedCalibrationWorkspace({
  id,
  cameraId,
  onClose,
  onScreenChange,
  initialStep = 0,
}: {
  id: string;
  cameraId: string;
  onClose(screenId?: string): void;
  onScreenChange?(id: string): void;
  initialStep?: 0 | 1;
}) {
  return (
    <ConfigProvider theme={armUiTheme}>
      <App className="guided-calibration-root">
        <CalibrationLanguageProvider>
          <GuidedContent
            id={id}
            cameraId={cameraId}
            onClose={onClose}
            onScreenChange={onScreenChange}
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
  onScreenChange,
  initialStep,
}: {
  id: string;
  cameraId: string;
  onClose(screenId?: string): void;
  onScreenChange?(id: string): void;
  initialStep: 0 | 1;
}) {
  useLanguage();
  const { message } = App.useApp();
  const [selectedId, setSelectedId] = useState(id);
  const [step, setStep] = useState<number>(initialStep);
  const initialStepPending = useRef(true);
  const resumeCalibration = useRef<string>();
  const restoringMapping = useRef<string>();
  const [loadedConfig, setConfig] = useState<Configuration>();
  const config =
    loadedConfig?.deviceId === selectedId ? loadedConfig : undefined;
  const [screens, setScreens] = useState<BoundScreen[]>([]);
  const [states, setStates] = useState<WorkstationScreenState[]>([]);
  const [screenListError, setScreenListError] = useState<string>();
  const [error, setError] = useState<string>();
  const [mappingError, setMappingError] = useState<string>();
  const [singleFailure, setSingleFailure] = useState<SingleStatus>();
  const [loadError, setLoadError] = useState<string>();
  const [closing, setClosing] = useState(false);
  const [illustrationContainer, setIllustrationContainer] =
    useState<HTMLDivElement | null>(null);
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const [phonesOpen, setPhonesOpen] = useState(false);
  /** Add Screen starts from phone pairing until the camera has a mapping. */
  const [phoneConnectionForAddScreen, setPhoneConnectionForAddScreen] =
    useState(false);
  /** Auto-create every connected page only for an explicit initial setup. */
  const [
    firstScreenCalibrationForConnection,
    setFirstScreenCalibrationForConnection,
  ] = useState(false);
  const [markerOpen, setMarkerOpen] = useState(initialStep === 1);
  /** The marker session was opened for a newly created Add Screen target. */
  const [markerAdd, setMarkerAdd] = useState(false);
  /** The manual corner editor, handed over from a failed marker pass. */
  const [perspectiveEditor, setPerspectiveEditor] = useState(false);
  const [retryId, setRetryId] = useState<string>();
  const [markerSession, setMarkerSession] =
    useState<MarkerCalibrationCreateResult>();
  const [review, setReview] = useState<
    MarkerCalibrationDetectionResponse & { token: string }
  >();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewing, setReviewing] = useState<{
    target: MarkerCalibrationTarget;
    frame?: DetectionFrame;
  }>();
  const [applying, setApplying] = useState(false);
  const [batch, setBatch] = useState<CalibrationBatchState | null>();
  const batchActive = Boolean(
    batch && ['running', 'waiting', 'stopping'].includes(batch.status),
  );
  const [single, setSingle] = useState<SingleStatus & { screenId: string }>();
  const lease = single?.screenId === selectedId ? single : undefined;
  const singleActive =
    lease?.phase === 'running' || lease?.phase === 'completed';
  const singleQueued =
    lease?.phase === 'starting' ||
    lease?.phase === 'queued' ||
    lease?.phase === 'cancelling';
  const singleBusy = singleQueued || lease?.phase === 'running';
  const [checkedScreen, setCheckedScreen] = useState<string>();
  const autoOpened = useRef<string>();
  /** Add Screen targets until the marker pass is committed or canceled. */
  const pendingAddedScreen = useRef<{
    previous?: string;
    knownIds: string[];
  }>();
  /** The manual corner editor took over the pending Add Screen target. */
  const keepPendingAddedScreen = useRef(false);
  /** One Add Screen request at a time; a double click must not open two. */
  const addingScreen = useRef(false);
  const startingSingle = useRef<Promise<SingleStatus>>();
  const cancellingSingle = useRef(false);
  const batchPanel = useRef<CalibrationBatchPanelHandle>(null);
  const batchClient = useMemo(() => new BatchClient(cameraId), [cameraId]);
  const markerClient = useMemo(
    () => new RobotVisionClient(cameraId),
    [cameraId],
  );
  const pageClient = useMemo(() => new ScreenCalibClient(cameraId), [cameraId]);
  const base = `/api/devices/${encodeURIComponent(selectedId)}/calibration`;
  const client = useMemo(
    () =>
      createCalibrationClient({ baseUrl: base, attemptId: lease?.attemptId }),
    [base, lease?.attemptId],
  );
  const controller = useAssistedCalibration(
    client,
    JSON.stringify([selectedId, lease?.attemptId]),
    // The events endpoint exists only after /open has prepared this screen.
    !batchActive && config?.deviceId === selectedId,
  );
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
      savedScreens.map((s) => `${s.id}:${s.name}:${s.pageKey}`).join('|'),
    ],
  );
  const phoneReadiness = useCameraPhoneReadiness({
    active: true,
    api: pageClient,
    cameras: phoneCameras,
    cameraId,
  });
  const knownScreens = selectableScreens(screens, cameraId);
  const selected = screens.find((s) => s.id === selectedId);
  const phonePage = phoneReadiness.connection?.devices.find(
    (page) =>
      selected &&
      page.visible &&
      page.mode !== 'waiting' &&
      isRequiredPhonePage(page, cameraId, [selected]),
  );
  const phoneConnected = Boolean(phonePage);
  const phoneFullscreen = Boolean(phonePage?.fullscreen);
  /**
   * Recalibration targets: calibrated screens and screens that already own a
   * marker slot. The first pass starts empty and adds one target per phone page
   * in scan order, so a fresh two-screen setup detects both in one pass.
   */
  const markerScreens = screens.filter(
    (screen) =>
      screen.cameraId === cameraId &&
      (screen.hasCorrection || screen.markerSlot !== undefined),
  );
  const markerScreensKey = markerScreens
    .map((screen) => `${screen.id}:${screen.name}:${screen.pageKey}`)
    .join('|');
  const existing = useMemo(
    () =>
      markerScreens.map((screen) => ({
        id: screen.id,
        name: screen.name,
        pageKey: screen.pageKey,
      })),
    [markerScreensKey],
  );
  const selectScreen = useCallback((next: string) => {
    resumeCalibration.current = undefined;
    restoringMapping.current = undefined;
    setCheckedScreen(undefined);
    autoOpened.current = undefined;
    setSelectedId(next);
    setSingle(undefined);
    setReview(undefined);
    setReviewOpen(false);
    setReviewing(undefined);
    setRetryId(undefined);
    setMarkerSession(undefined);
    setMarkerOpen(false);
    setPhoneConnectionForAddScreen(false);
    setFirstScreenCalibrationForConnection(false);
    setMarkerAdd(false);
    setPerspectiveEditor(false);
    setApplying(false);
    setSingleFailure(undefined);
    setMappingError(undefined);
    setError(undefined);
  }, []);
  const currentStep = useRef(step);
  currentStep.current = step;
  const reportedSingleFailure = useRef<string>();
  const refreshSequence = useRef(0);
  const currentBase = useRef(base);
  currentBase.current = base;
  const refresh = useCallback(
    async (signal = AbortSignal.timeout(15000)) => {
      if (currentBase.current !== base || signal.aborted) return;
      const sequence = ++refreshSequence.current;
      const stale = () =>
        signal.aborted ||
        currentBase.current !== base ||
        sequence !== refreshSequence.current;
      const [next, listed] = await Promise.all([
        markerRequest<Configuration>(
          `${base}/configuration${currentStep.current === 2 ? '?teaching' : ''}`,
          undefined,
          signal,
        ),
        markerRequest<{ screens: BoundScreen[] }>(
          '/api/screens',
          undefined,
          signal,
        ),
      ]);
      if (stale()) return;
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
      const openingScreen = initialStepPending.current && !fallback;
      if (fallback) selectScreen(fallback.id);
      else if (initialStepPending.current) {
        initialStepPending.current = false;
        if (!next.input && initialStep !== 1) {
          setStep(0);
          setMarkerOpen(false);
        } else if (
          initialStep === 1 ||
          !next.correction ||
          next.mappingReady === false ||
          next.perspectiveValidity?.state === 'invalid'
        ) {
          if (
            initialStep !== 1 &&
            next.correction &&
            next.perspectiveValidity?.state !== 'invalid'
          )
            resumeCalibration.current = selectedId;
          setStep(1);
        } else {
          setStep(next.installationTaught ? 3 : 2);
        }
      }
      const [running, status] = await Promise.allSettled([
        batchClient.calibrationBatch(signal),
        markerRequest<SingleStatus>(`${base}/status`, undefined, signal),
      ]);
      if (stale()) return;
      if (running.status === 'fulfilled') setBatch(running.value);
      const singleStatus =
        status.status === 'fulfilled' ? status.value : undefined;
      if (!singleStatus || startingSingle.current || cancellingSingle.current)
        return;
      setCheckedScreen(running.status === 'fulfilled' ? selectedId : undefined);
      const inBatch =
        running.status === 'fulfilled' &&
        running.value &&
        ['running', 'waiting', 'stopping'].includes(running.value.status);
      const busy =
        !inBatch &&
        ['queued', 'running', 'cancelling'].includes(singleStatus.phase);
      const completed = !inBatch && singleStatus.phase === 'completed';
      setSingle(
        busy || completed
          ? { ...singleStatus, screenId: selectedId }
          : undefined,
      );
      if (busy || inBatch || (completed && openingScreen && initialStep !== 1))
        setStep(3);
      else if (
        !completed &&
        next.mappingReady === false &&
        currentStep.current === 3
      ) {
        if (next.correction && next.perspectiveValidity?.state !== 'invalid')
          resumeCalibration.current = selectedId;
        setStep(1);
      }
      setSingleFailure(
        singleStatus.phase === 'error' &&
          singleStatus.attemptId !== reportedSingleFailure.current
          ? singleStatus
          : undefined,
      );
    },
    [base, batchClient, cameraId, initialStep, selectedId],
  );
  /** Seed the next screen's config so a selection change does not blank it. */
  const preloadConfiguration = useCallback(async (screenId: string) => {
    try {
      return await markerRequest<Configuration>(
        `/api/devices/${encodeURIComponent(screenId)}/calibration/configuration`,
        undefined,
        AbortSignal.timeout(15000),
      );
    } catch {
      return undefined;
    }
  }, []);
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
      const saved = await markerRequest<Configuration>(
        `${base}/camera/correction`,
        correction,
      );
      // Page mapping needs the saved tool setup; a bench that has not saved it
      // yet keeps the perspective and maps during the tool step.
      if (currentBase.current !== base) return;
      if (saved.output) {
        try {
          await client.mapAssistedCalibration(saved.output);
          if (currentBase.current === base) setMappingError(undefined);
        } catch (cause) {
          if (currentBase.current === base)
            setMappingError(
              cause instanceof Error ? cause.message : String(cause),
            );
        }
      }
      await refresh();
    },
    [base, client, refresh],
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
    setMappingError(undefined);
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
              selectScreen(fallback.id);
              return;
            }
          }
          const openedScreen = await markerRequest<{
            pairingConflict?: boolean;
            awaitingPreview?: boolean;
          }>(`${base}/open`, {}, signal);
          if (openedScreen.pairingConflict && !signal.aborted)
            setError(
              t(
                'The preview phone does not match this screen’s saved binding. Use the bound phone or release the binding first.',
              ),
            );
          opened = !openedScreen.awaitingPreview;
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
    setLoadError(undefined);
    void poll();
    return () => {
      refreshSequence.current++;
      abort.abort();
      clearTimeout(timer);
    };
  }, [base, cameraId, refresh, selectedId]);
  const current = batch?.items[batch.currentIndex];
  const awaitingBatchPhone =
    batch?.status === 'waiting' &&
    (current?.status === 'awaiting-phone' ||
      current?.status === 'awaiting-mapping');
  const waitingForScreen =
    (phonesOpen && !phoneConnected) ||
    states.some(
      (state) =>
        state.cameraId === cameraId &&
        state.screenId === selectedId &&
        state.status === 'mapping-required',
    );
  const screenListInterval = awaitingBatchPhone
    ? 1500
    : batchActive || singleBusy
      ? undefined
      : waitingForScreen
        ? 1500
        : 10_000;
  useEffect(() => {
    setScreenListError(undefined);
    if (step !== 3 || screenListInterval === undefined) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let pending = false;
    let failures = 0;
    const poll = async () => {
      clearTimeout(timer);
      if (abort.signal.aborted || document.hidden || pending) return;
      pending = true;
      try {
        const nextStates = await batchClient.screens(abort.signal);
        if (!abort.signal.aborted) {
          failures = 0;
          setStates(nextStates);
          setScreenListError(undefined);
        }
      } catch (cause) {
        if (!abort.signal.aborted && ++failures >= 2)
          setScreenListError(
            cause instanceof Error && cause.name === 'TimeoutError'
              ? 'Screen list refresh timed out'
              : 'Could not refresh the screen list',
          );
      } finally {
        pending = false;
        if (!abort.signal.aborted && !document.hidden)
          timer = setTimeout(refreshScreenList, screenListInterval);
      }
    };
    const refreshScreenList = () => void poll();
    refreshScreenList();
    window.addEventListener('focus', refreshScreenList);
    document.addEventListener('visibilitychange', refreshScreenList);
    return () => {
      abort.abort();
      clearTimeout(timer);
      window.removeEventListener('focus', refreshScreenList);
      document.removeEventListener('visibilitychange', refreshScreenList);
    };
  }, [
    batchClient,
    step,
    selectedId,
    screenListInterval,
    batch?.status,
    phoneConnected,
    config?.mappingReady,
  ]);
  const markerKey = useMemo(
    () => ({ id: cameraId, deviceId: cameraId }),
    [cameraId],
  );
  const activeId = batchActive && current ? current.deviceId : selectedId;
  useEffect(() => onScreenChange?.(activeId), [activeId, onScreenChange]);
  const activeScreen = screens.find((screen) => screen.id === activeId);
  const activeConfig = config?.deviceId === activeId ? config : undefined;
  const perspective = usePerspectiveValidity(
    `/api/devices/${encodeURIComponent(activeId)}/calibration`,
    Boolean(activeConfig?.correction ?? activeScreen?.correction),
    activeConfig?.correctionKey ?? JSON.stringify(activeScreen?.correction),
  );
  const perspectiveState = (
    perspective.summary ?? activeConfig?.perspectiveValidity
  )?.state;
  const outlineBlocked = perspectiveState === 'invalid';
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
        previewPositions:
          entry.id === activeId && !outlineBlocked
            ? activeConfig
              ? activeConfig.previewPositions
              : entry.previewPositions
            : undefined,
        active: entry.id === activeId,
        validity:
          entry.id === activeId ? perspective.summary?.state : undefined,
      },
    ];
  });
  const progressClient = useMemo(
    () =>
      createCalibrationClient({
        baseUrl: `/api/devices/${encodeURIComponent(activeId)}/calibration`,
      }),
    [activeId],
  );
  const progress = useAssistedCalibration(
    progressClient,
    activeId,
    step === 3 && batchActive,
    'batch',
  );
  const cancelSingle = async () => {
    autoOpened.current = selectedId;
    const opening = startingSingle.current;
    const status = opening ? await opening : lease;
    if (
      !status?.attemptId ||
      !['running', 'queued', 'cancelling'].includes(status.phase)
    )
      return;
    cancellingSingle.current = true;
    ++refreshSequence.current;
    setSingle({ ...status, screenId: selectedId, phase: 'cancelling' });
    try {
      await markerRequest(
        `${base}/cancel`,
        { attemptId: status.attemptId },
        AbortSignal.timeout(15000),
      );
      if (currentBase.current === base) setSingle(undefined);
    } finally {
      cancellingSingle.current = false;
      await refresh();
    }
  };
  const checkCameraBeforeCalibration = async () => {
    if (cancellingSingle.current) return;
    try {
      await cancelSingle();
      if (currentBase.current !== base) return;
      setError(undefined);
      setRetryId(undefined);
      setPerspectiveEditor(false);
      setStep(1);
      setFirstScreenCalibrationForConnection(false);
      setMarkerAdd(false);
      setMarkerOpen(true);
    } catch (cause) {
      if (currentBase.current === base)
        setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const close = async () => {
    setClosing(true);
    try {
      if (batchActive && batch)
        await batchClient.calibrationBatchCommand(batch.id, {
          revision: batch.revision,
          action: 'stop',
        });
      await cancelSingle();
      if (config?.armState?.state.dragMode && teaching)
        await teaching.exitDrag();
      const pending = pendingAddedScreen.current;
      pendingAddedScreen.current = undefined;
      // Closing the wizard is a cancel for a screen that was only added and
      // never calibrated; a calibrated one was already cleared by `detected`.
      if (pending) await discardPendingAddedScreen(pending);
      setFirstScreenCalibrationForConnection(false);
      setMarkerAdd(false);
      onClose(selectedId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setClosing(false);
    }
  };
  const detected = useCallback(
    async (
      _session: unknown,
      result: MarkerCalibrationDetectionResponse,
      _targets: string[],
      token: string,
    ) => {
      if (currentBase.current !== base) return;
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
            markerCaptureRecommended(target.result),
        );
      if (!confident) {
        setReview({ ...result, token });
        setReviewOpen(true);
        return;
      }
      setApplying(true);
      try {
        const applied = await markerClient.applyMarkerCalibration(
          session.id,
          token,
        );
        if (currentBase.current !== base) return;
        const failures = Object.values(applied.mappingErrors);
        setMappingError(failures.join('\n') || undefined);
        if (failures.length) setError(failures.join('\n'));
        else void message.success(t('Camera mapping applied automatically'));
        pendingAddedScreen.current = undefined;
        keepPendingAddedScreen.current = false;
        await refresh();
        if (currentBase.current !== base) return;
        setReview(undefined);
        setReviewOpen(false);
        setMarkerOpen(false);
        setFirstScreenCalibrationForConnection(false);
        setMarkerAdd(false);
      } catch (cause) {
        if (currentBase.current !== base) return;
        setReview({ ...result, token });
        setReviewOpen(true);
        setMappingError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (currentBase.current === base) setApplying(false);
      }
    },
    [base, markerClient, message, refresh],
  );
  /**
   * Add Screen creates the target before its marker pass. Cancelling that pass
   * must take the empty target back out, otherwise it keeps the screen picker
   * visible and leaves a screen nobody calibrated. A target that already has a
   * correction or a saved perspective is kept.
   */
  const discardPendingAddedScreen = useCallback(
    async ({
      previous,
      knownIds,
    }: {
      previous?: string;
      knownIds: string[];
    }) => {
      try {
        if (keepPendingAddedScreen.current) {
          keepPendingAddedScreen.current = false;
          return;
        }
        const listed = await markerRequest<{ screens: BoundScreen[] }>(
          '/api/screens',
        );
        const added = listed.screens.filter(
          (screen) =>
            screen.cameraId === cameraId &&
            !knownIds.includes(screen.id) &&
            !screen.hasCorrection &&
            !screen.hasSavedPerspective,
        );
        for (const screen of added)
          await pageClient.deleteScreen(cameraId, screen.id);
        if (currentBase.current !== base) return;
        await refresh();
        if (previous && listed.screens.some((screen) => screen.id === previous))
          selectScreen(previous);
      } catch (cause) {
        if (currentBase.current === base)
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [base, cameraId, pageClient, refresh, selectScreen],
  );
  const markerClosed = useCallback(() => {
    const pending = pendingAddedScreen.current;
    pendingAddedScreen.current = undefined;
    if (currentBase.current === base) setMarkerOpen(false);
    setFirstScreenCalibrationForConnection(false);
    setMarkerAdd(false);
    if (pending) void discardPendingAddedScreen(pending);
  }, [base, discardPendingAddedScreen]);
  /**
   * A screen that is connected and bound has its markers on the page already,
   * so the camera step starts the perspective pass by itself: the dialog
   * detects, the result is applied above and the status flips to applied.
   * Closing the dialog keeps it closed for that screen.
   */
  const autoDetectStarted = useRef<string>();
  useEffect(() => {
    if (
      step !== 1 ||
      markerOpen ||
      perspectiveEditor ||
      batchActive ||
      closing ||
      config?.deviceId !== selectedId ||
      !config.correction ||
      perspectiveState !== 'valid' ||
      resumeCalibration.current !== selectedId
    )
      return;
    if (config.mappingReady) {
      resumeCalibration.current = undefined;
      setStep(config.installationTaught ? 3 : 2);
      return;
    }
    if (!phoneFullscreen || restoringMapping.current === base) return;
    restoringMapping.current = base;
    void client
      .mapAssistedCalibration()
      .then(() => refresh())
      .catch((cause) => {
        if (currentBase.current === base) {
          resumeCalibration.current = undefined;
          setMappingError(
            cause instanceof Error ? cause.message : String(cause),
          );
        }
      });
  }, [
    step,
    markerOpen,
    perspectiveEditor,
    batchActive,
    closing,
    config,
    selectedId,
    perspectiveState,
    phoneFullscreen,
    base,
    client,
    refresh,
  ]);
  useEffect(() => {
    if (step !== 1 || config?.deviceId !== selectedId) return;
    if (markerOpen) {
      autoDetectStarted.current = selectedId;
      return;
    }
    if (config.correction && !outlineBlocked) return;
    // Markers are only reported from a fullscreen page; opening the dialog
    // earlier would detect against a viewport the camera cannot trust.
    if (!phoneConnected || !phoneFullscreen) return;
    if (autoDetectStarted.current === selectedId) return;
    autoDetectStarted.current = selectedId;
    setFirstScreenCalibrationForConnection(false);
    setMarkerAdd(false);
    setMarkerOpen(true);
  }, [
    step,
    markerOpen,
    config?.correction,
    config?.mappingReady,
    outlineBlocked,
    phoneConnected,
    phoneFullscreen,
    selectedId,
  ]);
  const startSingle = useCallback(async () => {
    if (startingSingle.current) return;
    const opening = markerRequest<SingleStatus>(`${base}/start`, {});
    startingSingle.current = opening;
    ++refreshSequence.current;
    setSingle({ screenId: selectedId, phase: 'starting' });
    try {
      const status = await opening;
      if (currentBase.current === base)
        setSingle({ ...status, screenId: selectedId });
    } catch (error) {
      if (currentBase.current === base) setSingle(undefined);
      throw error;
    } finally {
      startingSingle.current = undefined;
    }
    await refresh();
  }, [base, refresh, selectedId]);
  const soleScreen =
    savedScreens.length === 1 && savedScreens[0].id === selectedId;
  useEffect(() => {
    if (step !== 3) {
      autoOpened.current = undefined;
      return;
    }
    if (
      !soleScreen ||
      !controller.setup.mapping ||
      checkedScreen !== selectedId ||
      batchActive ||
      closing ||
      !config?.ready ||
      outlineBlocked
    )
      return;
    if (lease || autoOpened.current === selectedId) return;
    autoOpened.current = selectedId;
    void startSingle().catch((cause) => {
      if (currentBase.current === base) setError(String(cause));
    });
  }, [
    step,
    soleScreen,
    controller.setup.mapping,
    checkedScreen,
    selectedId,
    batchActive,
    closing,
    config?.ready,
    outlineBlocked,
    lease,
    startSingle,
    base,
  ]);
  const recoveryMessages = {
    'manual-stop':
      'The robot was stopped manually. Confirm recovery before sampling.',
    'emergency-stop':
      'Emergency stop was triggered. Confirm recovery before sampling.',
    'socket-disconnect': controller.session?.awaitingSocketRecovery
      ? 'Connection interrupted. Checking readiness before returning to sampling setup.'
      : 'Check controller recovery before collecting points.',
    fault: 'Resolve the controller fault and confirm recovery before sampling.',
    pause: 'Resume the robot to continue calibration.',
    interruption: 'Check controller recovery before collecting points.',
  };
  const powerControl = config && !config.ready && (
    <CalibrationPowerButton
      key={base}
      config={config}
      apply={async (action) => {
        await markerRequest(`${base}/${action}`, { confirmed: true });
        await refresh();
      }}
    />
  );
  const titles = [
    'Touch Tool',
    'Camera Mapping',
    'Teach Installation',
    'Screen Calibration',
  ];
  const canVisit = (next: number) =>
    !batchActive &&
    !singleBusy &&
    !config?.armState?.state.moving &&
    !config?.armState?.state.dragMode &&
    (next === 0 || Boolean(config?.input)) &&
    (next < 2 || Boolean(config?.correction && controller.setup.mapping)) &&
    (next < 2 || !outlineBlocked) &&
    (next < 3 || Boolean(controller.setup.teaching));
  const batchAction = savedScreens.length > 1 && (
    <Button
      disabled={!config?.ready || outlineBlocked || singleBusy}
      onClick={() => batchPanel.current?.open()}
    >
      {t('Calibrate multiple screens')}
    </Button>
  );

  return (
    <main className="calibration-page is-embedded guided-calibration">
      <header className="calibration-shell-header">
        <div className="guided-toolbar">
          <h2>{t('Calibration')}</h2>
          <nav aria-label={t('Calibration')}>
            <ol className="guided-steps">
              {titles.map((title, index) => (
                <li key={title}>
                  <button
                    type="button"
                    aria-current={index === step ? 'step' : undefined}
                    disabled={!canVisit(index)}
                    onClick={() => {
                      resumeCalibration.current = undefined;
                      setStep(index);
                      if (index === 1) setMarkerOpen(false);
                    }}
                  >
                    <span aria-hidden="true">{index + 1}</span>
                    {t(title)}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <Space className="guided-toolbar-actions">
            {/* Step 2 has its own phone-page entry in the checklist; later
                steps still need this toolbar shortcut. */}
            {step > 1 && (
              <Button onClick={() => setPhonesOpen(true)}>
                {t('View Phone Page')}
              </Button>
            )}
            <Button loading={closing} onClick={() => void close()}>
              {t('Close')}
            </Button>
          </Space>
        </div>
      </header>
      <div className="calibration-shell-body">
        <div className="guided-calibration-layout">
          <div className="guided-calibration-flow">
            <PerspectiveObservationCard
              observation={perspective}
              screenName={activeScreen?.name}
              onRecalibrate={
                batchActive || singleBusy
                  ? undefined
                  : () => {
                      setStep(1);
                      setFirstScreenCalibrationForConnection(false);
                      setMarkerAdd(false);
                      setMarkerOpen(true);
                    }
              }
            />
            {step === 3 && singleFailure?.error && (
              <Alert
                type="error"
                showIcon
                message={calibrationErrorText(singleFailure.error)}
                closable
                onClose={() => {
                  reportedSingleFailure.current = singleFailure.attemptId;
                  setSingleFailure(undefined);
                }}
              />
            )}
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
            {screenListError && (
              <Alert type="warning" showIcon message={t(screenListError)} />
            )}
            {!config ? (
              !loadError && <Spin />
            ) : (
              <>
                {step === 0 && (
                  <CalibrationSetup
                    showIllustration={false}
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
                    // First pass: wait for every scanned page, allocate one
                    // target per page, then detect all targets in one pass.
                    <GuidedMarkerCalibration
                      variant="inline"
                      footerContainer={footer}
                      api={markerClient}
                      screenCalib={pageClient}
                      stream={markerKey}
                      displayName={config.camera.name}
                      autoCreateScreen
                      autoAddTarget={false}
                      firstScreenCalibration={
                        firstScreenCalibrationForConnection
                      }
                      key={selectedId}
                      existingScreens={
                        markerAdd ? [] : retryId ? undefined : existing
                      }
                      focusTargetId={markerAdd ? undefined : retryId}
                      resumeSession={
                        markerAdd || retryId ? markerSession : undefined
                      }
                      includeSucceededTargets={Boolean(retryId)}
                      keepSessionOnClose
                      onAdjustManually={() => {
                        // The operator chose the manual path, so the automatic
                        // pass must not reopen over the editor. The manual
                        // editor owns a just-created target; do not roll it back.
                        keepPendingAddedScreen.current = true;
                        autoDetectStarted.current = selectedId;
                        setPerspectiveEditor(true);
                      }}
                      onClose={markerClosed}
                      onDetected={detected}
                      onSessionCreated={setMarkerSession}
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
                      output={
                        config.perspectiveTarget ??
                        config.correctionOutput ??
                        config.output
                      }
                      validity={perspective.summary?.state}
                      phoneConnected={phoneConnected}
                      phoneFullscreen={phoneFullscreen}
                      mappingReady={Boolean(controller.setup.mapping)}
                      mapping={controller.setup.mapping}
                      mappingError={mappingError}
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
                                const deletingId = selectedId;
                                // Leave the screen before deleting it: config
                                // and validity polls for a disappearing id are
                                // what produced the transient error and flash.
                                const fallback = knownScreens.find(
                                  (screen) => screen.id !== deletingId,
                                );
                                setScreens((current) =>
                                  current.filter(
                                    (screen) => screen.id !== deletingId,
                                  ),
                                );
                                if (fallback) {
                                  const nextConfig = await preloadConfiguration(
                                    fallback.id,
                                  );
                                  if (nextConfig) setConfig(nextConfig);
                                  selectScreen(fallback.id);
                                }
                                try {
                                  await pageClient.deleteScreen(
                                    cameraId,
                                    deletingId,
                                  );
                                  setReview(undefined);
                                  setMarkerSession(undefined);
                                  setRetryId(undefined);
                                  // Do not call refresh(): it is bound to the
                                  // deleted screen's base and would request its
                                  // configuration again. The new base's poll
                                  // reloads the list and the fallback config.
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
                      key={selectedId}
                      onSelectScreen={selectScreen}
                      onAddScreen={async () => {
                        if (
                          needsPhoneConnectionBeforeAddScreen(
                            screens,
                            cameraId,
                            phoneReadiness.connection?.devices,
                          )
                        ) {
                          setPhoneConnectionForAddScreen(true);
                          setPhonesOpen(true);
                          return;
                        }
                        if (addingScreen.current) return;
                        addingScreen.current = true;
                        keepPendingAddedScreen.current = false;
                        let createdTarget: string | undefined;
                        try {
                          const knownIds = screens
                            .filter((s) => s.cameraId === cameraId)
                            .map((s) => s.id);
                          const name = `Screen ${screens.filter((s) => s.cameraId === cameraId).length + 1}`;
                          // Create a real new target first. Asking the marker
                          // service to allocate by name reuses a calibrated /
                          // bound screen, which made Add Screen reopen the old one.
                          createdTarget = (
                            await markerRequest<{ id: string }>(
                              '/api/screens',
                              {
                                cameraId,
                                name,
                              },
                            )
                          ).id;
                          const created =
                            await markerClient.createMarkerCalibration(
                              cameraId,
                              undefined,
                              undefined,
                              [createdTarget],
                            );
                          if (currentBase.current !== base) {
                            await pageClient
                              .deleteScreen(cameraId, createdTarget)
                              .catch(() => undefined);
                            createdTarget = undefined;
                            return;
                          }
                          setFirstScreenCalibrationForConnection(false);
                          setMarkerAdd(true);
                          setMarkerSession(created);
                          setRetryId(undefined);
                          pendingAddedScreen.current = {
                            previous: selectedId,
                            knownIds,
                          };
                          setMarkerOpen(true);
                        } catch (cause) {
                          if (createdTarget)
                            await pageClient
                              .deleteScreen(cameraId, createdTarget)
                              .catch(() => undefined);
                          setError(
                            cause instanceof Error
                              ? cause.message
                              : String(cause),
                          );
                        } finally {
                          addingScreen.current = false;
                        }
                      }}
                      onPair={() => setPhonesOpen(true)}
                      onDetect={() => {
                        if (!knownScreens.length) {
                          setPhoneConnectionForAddScreen(true);
                          setPhonesOpen(true);
                          return;
                        }
                        setRetryId(undefined);
                        setFirstScreenCalibrationForConnection(false);
                        setMarkerAdd(false);
                        setMarkerOpen(true);
                      }}
                      onApply={applyCorrection}
                      onConfirm={async () => {
                        try {
                          await controller.map(config.output);
                        } catch (cause) {
                          if (currentBase.current === base)
                            setMappingError(
                              cause instanceof Error
                                ? cause.message
                                : String(cause),
                            );
                          return;
                        }
                        if (currentBase.current === base)
                          setMappingError(undefined);
                        await refresh();
                      }}
                      onClear={config.correction ? clearCorrection : undefined}
                      onContinue={() =>
                        setStep(
                          !config.input ? 0 : config.installationTaught ? 3 : 2,
                        )
                      }
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
                      {powerControl}
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
                        onChange={selectScreen}
                      />
                    </Space>
                    <InstallationTeaching
                      illustrationContainer={illustrationContainer}
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
                    {!batchActive && !config.ready && (
                      <Alert
                        type="warning"
                        showIcon
                        message={t(
                          config.armState?.softwarePaused ||
                            config.armState?.state.paused
                            ? 'Resume the robot to continue calibration.'
                            : config.armState?.recoveryRequired
                              ? recoveryMessages[
                                  config.armState.recoveryReason ??
                                    'interruption'
                                ]
                              : 'Prepare the robot and tool payload before collecting points.',
                        )}
                        action={
                          !(
                            config.armState?.softwarePaused ||
                            config.armState?.state.paused
                          ) && powerControl
                        }
                      />
                    )}
                    {!batchActive && !soleScreen && (
                      <Select
                        aria-label={t('Calibration Screen')}
                        value={selectedId}
                        options={savedScreens.map((screen) => ({
                          value: screen.id,
                          label: screen.name,
                        }))}
                        disabled={
                          singleBusy ||
                          closing ||
                          config.armState?.state.dragMode ||
                          config.armState?.state.moving
                        }
                        style={{ minWidth: 180 }}
                        onChange={selectScreen}
                      />
                    )}
                    {lease?.phase === 'queued' && (
                      <Alert
                        type="info"
                        showIcon
                        message={t('Waiting for the Controller queue')}
                      />
                    )}
                    {(!soleScreen || batchActive) && (
                      <CalibrationBatchPanel
                        ref={batchPanel}
                        api={batchClient}
                        cameraId={cameraId}
                        screens={states}
                        disabled={
                          !config.ready ||
                          outlineBlocked ||
                          controller.busy ||
                          singleBusy
                        }
                        onChanged={refresh}
                      />
                    )}
                    {batchActive && current && (
                      <ActiveBatchScreen controller={progress} />
                    )}
                    {!batchActive &&
                      lease?.phase === 'completed' &&
                      batchAction}
                    {!batchActive && singleActive && (
                      <WebCalibrationWorkspace
                        key={JSON.stringify([selectedId, lease?.attemptId])}
                        controller={controller}
                        footer={footer}
                        result={config.result}
                        completedAttempt={lease?.phase === 'completed'}
                        onConnectPhone={() => setPhonesOpen(true)}
                        onCheckCamera={checkCameraBeforeCalibration}
                        cameraCheckRequired={outlineBlocked}
                        prepareFromTeaching={lease?.phase === 'running'}
                        readyToCapture={config.ready && !outlineBlocked}
                        readyToStart={config.ready && !outlineBlocked}
                        onActivated={refresh}
                        externalPreview
                        showSessionCancel={false}
                        onRestart={() =>
                          void startSingle().catch((cause) =>
                            setError(String(cause)),
                          )
                        }
                        onReturn={() => onClose(selectedId)}
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
                        <Button
                          type="primary"
                          loading={singleQueued}
                          disabled={!config.ready || singleQueued}
                          onClick={() => {
                            if (outlineBlocked || !controller.setup.mapping)
                              void checkCameraBeforeCalibration();
                            else
                              void startSingle().catch((cause) =>
                                setError(String(cause)),
                              );
                          }}
                        >
                          {t('Calibrate {0}', [selected?.name ?? selectedId])}
                        </Button>
                        {batchAction}
                        {savedScreens.length > 0 &&
                          savedScreens.every((screen) =>
                            states.some(
                              (state) =>
                                state.screenId === screen.id &&
                                state.cameraId === cameraId &&
                                state.status === 'ready',
                            ),
                          ) && (
                            <Button
                              loading={closing}
                              onClick={() => void close()}
                            >
                              {t('Finish calibration and return')}
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
            <aside className="guided-camera" aria-label={config.camera.name}>
              <Tabs
                size="small"
                defaultActiveKey="camera"
                tabBarExtraContent={
                  <Typography.Text
                    type="secondary"
                    className="guided-camera-name"
                    title={config.camera.name}
                  >
                    {config.camera.name}
                  </Typography.Text>
                }
                items={[
                  {
                    key: 'camera',
                    label: t('Live Preview'),
                    forceRender: true,
                    children: (
                      <div className="guided-preview-content">
                        <div className="guided-preview-frame">
                          <img
                            className="calibration-preview"
                            src={cameraPreviewUrl(
                              `/api/devices/${encodeURIComponent(activeId)}/calibration`,
                              'guided-preview',
                            )}
                            data-testid="calibration-live-camera"
                            alt={config.camera.name}
                          />
                          <ScreenOutlines outlines={asideOutlines} />
                        </div>
                        {step === 1 && (
                          <Typography.Text type="secondary">
                            {t(
                              'Keep the entire phone visible in the camera preview.',
                            )}
                          </Typography.Text>
                        )}
                        {step === 2 && (
                          <Typography.Text type="secondary">
                            {t(
                              'Check the whole arm directly before recording.',
                            )}
                          </Typography.Text>
                        )}
                      </div>
                    ),
                  },
                  {
                    key: 'illustration',
                    label: t('Setup illustration'),
                    forceRender: true,
                    children:
                      step === 2 && teaching ? (
                        <div ref={setIllustrationContainer} />
                      ) : step >= 2 ? (
                        <TeachingDiagram stage="reference" />
                      ) : (
                        <SetupIllustration
                          step={step === 0 ? 'tool' : 'camera'}
                        />
                      ),
                  },
                ]}
              />
            </aside>
          )}
        </div>
      </div>
      <footer className="calibration-shell-footer">
        <div className="arm-calibration-footer" ref={setFooter}>
          {step === 3 && !batchActive && singleBusy && (
            <Button
              type="primary"
              danger
              className="robot-cancel-calibration"
              loading={lease?.phase === 'cancelling'}
              onClick={() =>
                void cancelSingle().catch((cause) => setError(String(cause)))
              }
            >
              {t('Cancel Calibration')}
            </Button>
          )}
        </div>
      </footer>
      <PhoneConnectDialog
        open={phonesOpen}
        onClose={() => {
          setPhonesOpen(false);
          setPhoneConnectionForAddScreen(false);
        }}
        onContinue={
          phoneConnectionForAddScreen
            ? () => {
                setPhonesOpen(false);
                setPhoneConnectionForAddScreen(false);
                setRetryId(undefined);
                setFirstScreenCalibrationForConnection(
                  knownScreens.length === 0,
                );
                setMarkerAdd(knownScreens.length > 0);
                setMarkerOpen(true);
              }
            : undefined
        }
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
          setFirstScreenCalibrationForConnection(false);
          setMarkerAdd(false);
          setMarkerOpen(true);
        }}
        onApply={() => {
          if (!review) return;
          setError(undefined);
          setApplying(true);
          void markerClient
            .applyMarkerCalibration(review.session.id, review.token)
            .catch((cause) => {
              if (
                currentBase.current === base &&
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
                  review.token,
                  true,
                );
              throw cause;
            })
            .then(async (result) => {
              if (currentBase.current !== base) return;
              const failures = Object.values(result.mappingErrors);
              setMappingError(failures.join('\n') || undefined);
              if (failures.length) setError(failures.join('\n'));
              pendingAddedScreen.current = undefined;
              keepPendingAddedScreen.current = false;
              await refresh();
              if (currentBase.current !== base) return;
              setReview(undefined);
              setReviewOpen(false);
              setMarkerOpen(false);
            })
            .catch((cause) => {
              if (currentBase.current === base)
                setError(
                  cause instanceof Error ? cause.message : String(cause),
                );
            })
            .finally(() => {
              if (currentBase.current === base) setApplying(false);
            });
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
}: {
  container: HTMLElement;
  children: ReactNode;
}) {
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
        <ExplorationQualitySummary quality={session?.explorationQuality} />
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
