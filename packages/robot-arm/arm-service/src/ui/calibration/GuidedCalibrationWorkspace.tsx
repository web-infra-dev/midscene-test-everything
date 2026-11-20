import type { CalibrationPreviewPositions } from '@midscene/robotics-shared/assisted-contracts';
import type {
  CalibrationBatchState,
  WorkstationScreenState,
} from '@midscene/robotics-shared/assisted-contracts';
import {
  type CameraCorrection,
  SCREEN_DRIFT_DETECTION_ENABLED,
  isPayloadReadbackPending,
} from '@midscene/robotics-shared/contracts';
import { markerCaptureRecommended } from '@midscene/robotics-shared/marker-contracts';
import type {
  DetectionFrame,
  MarkerCalibrationCreateResult,
  MarkerCalibrationDetectionResponse,
  MarkerCalibrationTarget,
} from '@midscene/robotics-shared/marker-contracts';
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
import { useArmTheme } from '../theme';
import {
  CalibrationPowerButton,
  type Configuration,
} from './CalibrationPowerButton';
import { CalibrationSetup } from './CalibrationSetup';
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
  identifyScreen,
  markerRequest,
} from './marker-client';
import { hasMultipleCalibrationTargets } from './multi-screen-review';
import { selectOnlineCalibrationScreens } from './online-calibration-screens';
import { rawCameraPreviewUrl } from './preview-url';
import {
  shouldHideSelectedScreenOutline,
  shouldShowScreenOutlines,
} from './screen-outline-visibility';
import { shouldShowScreenPicker } from './screen-picker';
import {
  calibrationTargetsAfterPairing,
  connectedCalibrationScreenId,
  needsPhoneConnectionBeforeAddScreen,
  selectableScreens,
} from './screen-selection';
import { TeachingClient } from './teaching-client';
import { isRequiredPhonePage } from './utils/phone-readiness';
import './styles.less';
import './page.less';
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
  reviewInstallationOnOpen = false,
}: {
  id: string;
  cameraId: string;
  onClose(screenId?: string): void;
  onScreenChange?(id: string): void;
  initialStep?: 0 | 1;
  reviewInstallationOnOpen?: boolean;
}) {
  const theme = useArmTheme();
  return (
    <ConfigProvider theme={theme}>
      <App className="guided-calibration-root">
        <CalibrationLanguageProvider>
          <GuidedContent
            id={id}
            cameraId={cameraId}
            onClose={onClose}
            onScreenChange={onScreenChange}
            initialStep={initialStep}
            reviewInstallationOnOpen={reviewInstallationOnOpen}
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
  reviewInstallationOnOpen,
}: {
  id: string;
  cameraId: string;
  onClose(screenId?: string): void;
  onScreenChange?(id: string): void;
  initialStep: 0 | 1;
  reviewInstallationOnOpen: boolean;
}) {
  useLanguage();
  const { message } = App.useApp();
  const [selectedId, setSelectedId] = useState(id);
  // Keep the displayed device until the requested device and its attempt are ready.
  const [requestedId, setRequestedId] = useState(id);
  const requestedScreen = useRef(id);
  const displayedScreen = useRef(id);
  const switching = requestedId !== selectedId;
  const requestScreen = useCallback((next: string) => {
    requestedScreen.current = next;
    setRequestedId(next);
  }, []);
  const [step, setStep] = useState<number>(initialStep);
  const initialStepPending = useRef(true);
  const resumeCalibration = useRef<string>();
  const restoringMapping = useRef<string>();
  const [loadedConfig, setConfig] = useState<Configuration>();
  const config =
    loadedConfig?.deviceId === selectedId ? loadedConfig : undefined;
  const camera =
    loadedConfig?.camera.id === cameraId ? loadedConfig.camera : undefined;
  const flow = useRef<HTMLDivElement>(null);
  const footerShell = useRef<HTMLElement>(null);
  const previousHeight = useRef({ flow: 0, footer: 0 });
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
  const [claimedBeforePairing, setClaimedBeforePairing] =
    useState<ReadonlySet<string>>();
  /** Auto-create every connected page only for an explicit initial setup. */
  const [
    firstScreenCalibrationForConnection,
    setFirstScreenCalibrationForConnection,
  ] = useState(false);
  const [markerOpen, setMarkerOpen] = useState<boolean | string>(
    initialStep === 1,
  );
  /** Add Screen opened the marker session for explicit target IDs. */
  const [markerAdd, setMarkerAdd] = useState(false);
  const [detectionScreensOverride, setDetectionScreensOverride] =
    useState<ReadonlyArray<{ id: string; name: string; pageKey?: string }>>();
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
  /** The target created by this wizard's current Add Screen operation. */
  const pendingAddedScreen = useRef<string>();
  /** One Add Screen request at a time; a double click must not open two. */
  const addingScreen = useRef<AbortController>();
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
  useEffect(() => () => addingScreen.current?.abort(), [base]);
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
        name: camera?.name ?? cameraId,
        online: true,
        screenCount: savedScreens.length,
        screens: savedScreens,
        screenBindings: savedScreens,
      },
    ],
    [
      cameraId,
      camera?.name,
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
  const openScreenPairing = () => {
    const claimed = knownScreens.filter(
      (screen) =>
        screen.pageKey ||
        screen.hasCorrection ||
        screen.hasSavedPerspective ||
        phoneReadiness.connection?.devices.some(
          (page) => page.cameraId === cameraId && page.screenId === screen.id,
        ),
    );
    setClaimedBeforePairing(new Set(claimed.map((screen) => screen.id)));
    setPhonesOpen(true);
  };
  const selected = screens.find((s) => s.id === selectedId);
  const phonePage = phoneReadiness.connection?.devices.find(
    (page) =>
      selected &&
      page.visible &&
      page.mode !== 'waiting' &&
      isRequiredPhonePage(page, cameraId, [selected]),
  );
  const awaitingOriginTap = phonePage?.awaitingOriginTap === true;
  const phoneConnected = Boolean(phonePage);
  const phoneFullscreen = Boolean(phonePage?.fullscreen);
  /**
   * Recalibration targets: calibrated screens and screens that already own a
   * marker slot. The first pass starts empty and adds one target per phone page
   * in scan order, so a fresh two-screen setup detects both in one pass.
   */
  const allMarkerScreens = screens.filter(
    (screen) =>
      screen.cameraId === cameraId &&
      (screen.hasCorrection || screen.markerSlot !== undefined),
  );
  const markerScreens = selectOnlineCalibrationScreens(
    allMarkerScreens,
    cameraId,
    phoneReadiness.connection?.devices,
  );
  const detectionScreens = detectionScreensOverride ?? markerScreens;
  const markerScreensKey = detectionScreens
    .map((screen) => `${screen.id}:${screen.name}:${screen.pageKey}`)
    .join('|');
  const existing = useMemo(
    () =>
      detectionScreens.map((screen) => ({
        id: screen.id,
        name: screen.name,
        pageKey: screen.pageKey,
      })),
    [markerScreensKey],
  );
  const selectScreen = useCallback(
    (next: string) => {
      resumeCalibration.current = undefined;
      restoringMapping.current = undefined;
      setCheckedScreen(undefined);
      autoOpened.current = undefined;
      previousHeight.current = {
        flow: flow.current?.offsetHeight ?? 0,
        footer: footerShell.current?.offsetHeight ?? 0,
      };
      displayedScreen.current = next;
      requestScreen(next);
      setSelectedId(next);
      setSingle(undefined);
      setReview(undefined);
      setReviewOpen(false);
      setReviewing(undefined);
      setRetryId(undefined);
      setMarkerSession(undefined);
      setMarkerOpen(false);
      setClaimedBeforePairing(undefined);
      setFirstScreenCalibrationForConnection(false);
      setMarkerAdd(false);
      setPerspectiveEditor(false);
      setApplying(false);
      setSingleFailure(undefined);
      setMappingError(undefined);
      setError(undefined);
    },
    [requestScreen],
  );
  const connectedScreenId = connectedCalibrationScreenId(
    knownScreens,
    cameraId,
    phoneReadiness.connection?.devices ?? [],
    selectedId,
  );
  useEffect(() => {
    if (connectedScreenId && connectedScreenId !== selectedId)
      selectScreen(connectedScreenId);
  }, [connectedScreenId, selectScreen, selectedId]);
  const currentStep = useRef(step);
  currentStep.current = step;
  const reportedSingleFailure = useRef<string>();
  const refreshSequence = useRef(0);
  const currentBase = useRef(base);
  currentBase.current = base;
  const refreshScreen = useCallback(
    async (screenId: string, signal: AbortSignal) => {
      const target = `/api/devices/${encodeURIComponent(screenId)}/calibration`;
      if (requestedScreen.current !== screenId || signal.aborted) return;
      const sequence = ++refreshSequence.current;
      const stale = () =>
        signal.aborted ||
        requestedScreen.current !== screenId ||
        sequence !== refreshSequence.current;
      const [next, listed] = await Promise.all([
        markerRequest<Configuration>(
          `${target}/configuration${currentStep.current === 2 ? '?teaching' : ''}`,
          undefined,
          signal,
        ),
        markerRequest<{ screens: BoundScreen[] }>(
          '/api/screens',
          undefined,
          signal,
        ),
      ]);
      signal.throwIfAborted();
      if (stale()) return;
      const [running, status] = await Promise.allSettled([
        batchClient.calibrationBatch(signal),
        markerRequest<SingleStatus>(`${target}/status`, undefined, signal),
      ]);
      signal.throwIfAborted();
      if (stale()) return;
      if (displayedScreen.current !== screenId) {
        if (status.status === 'rejected') throw status.reason;
        if (running.status === 'rejected') throw running.reason;
        selectScreen(screenId);
      }
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
      const fallback = selectable.some((screen) => screen.id === screenId)
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
            resumeCalibration.current = screenId;
          setStep(1);
        } else {
          setStep(next.installationTaught && !reviewInstallationOnOpen ? 3 : 2);
        }
      }
      if (running.status === 'fulfilled') setBatch(running.value);
      const singleStatus =
        status.status === 'fulfilled' ? status.value : undefined;
      if (!singleStatus || startingSingle.current || cancellingSingle.current)
        return;
      setCheckedScreen(running.status === 'fulfilled' ? screenId : undefined);
      const inBatch =
        running.status === 'fulfilled' &&
        running.value &&
        ['running', 'waiting', 'stopping'].includes(running.value.status);
      const busy =
        !inBatch &&
        ['queued', 'running', 'cancelling'].includes(singleStatus.phase);
      const completed = !inBatch && singleStatus.phase === 'completed';
      setSingle(busy || completed ? { ...singleStatus, screenId } : undefined);
      if (
        busy ||
        inBatch ||
        (completed &&
          openingScreen &&
          initialStep !== 1 &&
          next.installationTaught &&
          !reviewInstallationOnOpen)
      )
        setStep(3);
      else if (
        currentStep.current === 3 &&
        (!next.installationTaught ||
          (!completed && next.mappingReady === false))
      ) {
        if (next.mappingReady === false) {
          if (next.correction && next.perspectiveValidity?.state !== 'invalid')
            resumeCalibration.current = screenId;
          setStep(1);
        } else {
          setStep(2);
        }
      }
      setSingleFailure(
        singleStatus.phase === 'error' &&
          singleStatus.attemptId !== reportedSingleFailure.current
          ? singleStatus
          : undefined,
      );
    },
    [
      batchClient,
      cameraId,
      initialStep,
      reviewInstallationOnOpen,
      selectScreen,
    ],
  );
  const refresh = useCallback(
    (signal = AbortSignal.timeout(15000)) => refreshScreen(selectedId, signal),
    [selectedId, refreshScreen],
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
    async (
      updates: ReadonlyArray<{
        screenId: string;
        correction: CameraCorrection;
      }>,
    ) => {
      for (const update of updates)
        await markerRequest<Configuration>(
          `/api/devices/${encodeURIComponent(update.screenId)}/calibration/camera/correction`,
          update.correction,
        );
      // Page mapping needs the saved tool setup; a bench that has not saved it
      // yet keeps the perspective and maps during the tool step. The host
      // rebinds an existing mapping to the manual corners without replaying
      // marker detection or camera imaging calibration.
      if (currentBase.current !== base) return;
      setMappingError(undefined);
      await refresh();
    },
    [base, refresh],
  );
  /**
   * Clearing keeps the screen, its page link and its marker slot; only the
   * framing the camera was applying is released, so the same glass can be
   * mapped again without pairing it a second time.
   */
  const clearCorrection = useCallback(async () => {
    await pageClient.clearCameraPerspectives(cameraId);
    // Keep the correction cleared until the operator starts a new pass.
    autoDetectStarted.current = selectedId;
    setError(undefined);
    setMappingError(undefined);
    await refresh();
  }, [cameraId, pageClient, refresh, selectedId]);
  useEffect(() => {
    const abort = new AbortController();
    const target = `/api/devices/${encodeURIComponent(requestedId)}/calibration`;
    const obsolete = () =>
      abort.signal.aborted || requestedScreen.current !== requestedId;
    let opened = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const signal = AbortSignal.any([
        abort.signal,
        AbortSignal.timeout(15000),
      ]);
      let pairingConflict = false;
      try {
        if (!opened) {
          const { screens: available } = await markerRequest<{
            screens: BoundScreen[];
          }>('/api/screens', undefined, signal);
          if (obsolete()) return;
          const selectable = available.filter(
            (screen) => screen.cameraId === cameraId,
          );
          if (!selectable.some((screen) => screen.id === requestedId)) {
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
          }>(`${target}/open`, {}, signal);
          if (obsolete()) return;
          pairingConflict = openedScreen.pairingConflict === true;
          opened = !openedScreen.awaitingPreview;
        }
        await refreshScreen(requestedId, signal);
        if (obsolete()) return;
        if (pairingConflict)
          setError(
            t(
              'The preview phone does not match this screen’s saved binding. Use the bound phone or release the binding first.',
            ),
          );
        setLoadError(undefined);
      } catch (cause) {
        opened = false;
        if (obsolete()) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        if (requestedId !== displayedScreen.current) {
          requestScreen(displayedScreen.current);
          setError(message);
        } else {
          setLoadError(message);
        }
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
  }, [cameraId, refreshScreen, requestedId, requestScreen, selectScreen]);
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
  const asideOutlines = shouldShowScreenOutlines(
    controller.setup.imaging,
    applying,
  )
    ? knownScreens.flatMap((entry) => {
        const fresh =
          config?.deviceId === entry.id ? config.correction : undefined;
        const quad =
          entry.id === activeId
            ? (fresh ?? entry.correction)
            : entry.correction;
        if (
          !quad ||
          shouldHideSelectedScreenOutline({
            awaitingOriginTap,
            markerAdd,
            markerOpen,
            screenId: entry.id,
            selectedId,
            step,
          })
        )
          return [];
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
      })
    : [];
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
    addingScreen.current?.abort();
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
  const waitForImagingCalibration = useCallback(async () => {
    const deadline = Date.now() + 30_000;
    try {
      while (currentBase.current === base) {
        const { imaging } = await client.assistedCalibrationSetup();
        if (imaging?.state === 'ready' || imaging?.state === 'unsupported')
          return;
        if (imaging?.state === 'error')
          throw new Error(
            imaging.message ?? 'Could not calibrate the camera image.',
          );
        if (Date.now() >= deadline)
          throw new Error('Timed out while calibrating the camera image.');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch (cause) {
      if (currentBase.current === base)
        void message.warning(
          calibrationErrorText(
            cause instanceof Error ? cause.message : String(cause),
          ),
        );
    }
  }, [base, client, message]);
  const detected = useCallback(
    async (
      _session: unknown,
      result: MarkerCalibrationDetectionResponse,
      _targets: string[],
      token: string,
    ) => {
      if (currentBase.current !== base) return;
      setRetryId(undefined);
      setError(undefined);
      setMappingError(undefined);
      const { session } = result;
      /*
       * A result the workstation would trust is applied without a review pass:
       * the operator connected the screen to get a perspective, not a dialog.
       * Weak evidence opens the aggregate review only for multiple screens. A
       * single screen has a usable result applied directly; if application
       * fails, the marker dialog stays open with the error.
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
        if (hasMultipleCalibrationTargets(session)) {
          setReview({ ...result, token });
          setReviewOpen(true);
          return;
        }
        const hasUsableResult = session.targets.some(
          (target) => target.state === 'succeeded' && target.result,
        );
        if (!hasUsableResult) {
          const message = t('No screen produced a usable calibration result');
          setMappingError(message);
          setError(message);
          throw new Error(message);
        }
      }
      setApplying(true);
      let mappingApplied = false;
      try {
        const applied = await markerClient.applyMarkerCalibration(
          session.id,
          token,
        );
        if (currentBase.current !== base) return;
        const failures = Object.values(applied.mappingErrors);
        setMappingError(failures.join('\n') || undefined);
        if (failures.length) setError(failures.join('\n'));
        if (failures.length) throw new Error(failures.join('\n'));
        mappingApplied = true;
        await waitForImagingCalibration();
        if (currentBase.current !== base) return;
        void message.success(t('Camera mapping applied automatically'));
        pendingAddedScreen.current = undefined;
        await refresh();
        if (currentBase.current !== base) return;
        setMarkerOpen(false);
        setReview(undefined);
        setReviewOpen(false);
      } catch (cause) {
        if (currentBase.current !== base) return;
        if (!mappingApplied) {
          if (hasMultipleCalibrationTargets(session)) {
            setReview({ ...result, token });
            setReviewOpen(true);
          }
        }
        setMappingError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      } finally {
        if (currentBase.current === base) setApplying(false);
      }
    },
    [base, markerClient, message, refresh, waitForImagingCalibration],
  );
  /**
   * Add Screen creates the target before its marker pass. Cancelling that pass
   * must take the empty target back out, otherwise it keeps the screen picker
   * visible and leaves a screen nobody calibrated. A target that already has a
   * correction or a saved perspective is kept.
   */
  const discardPendingAddedScreen = useCallback(
    async (id: string) => {
      try {
        await pageClient.discardAddedScreen(cameraId, id);
        if (currentBase.current !== base) return;
        await refresh();
      } catch (cause) {
        if (currentBase.current === base)
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [base, cameraId, pageClient, refresh],
  );
  const startAddedScreenCalibration = useCallback(
    async (previouslyClaimed?: ReadonlySet<string>) => {
      if (addingScreen.current) return false;
      const operation = new AbortController();
      addingScreen.current = operation;
      let createdTarget: string | undefined;
      let createdSession: MarkerCalibrationCreateResult | undefined;
      const checkActive = () => {
        if (currentBase.current !== base) operation.abort();
        operation.signal.throwIfAborted();
      };
      try {
        let screenIds: string[] = [];
        let first = false;
        if (previouslyClaimed) {
          const { devices } = await pageClient.listScreenDevices();
          const { screens } = await markerRequest<{ screens: BoundScreen[] }>(
            '/api/screens',
            undefined,
            operation.signal,
          );
          checkActive();
          ({ screenIds, first } = calibrationTargetsAfterPairing(
            screens,
            cameraId,
            devices,
            previouslyClaimed,
          ));
        }
        if (screenIds.length === 0) {
          // A released page needs a new target. Allocating by name can reuse
          // the remaining screen bound to a different phone.
          createdTarget = (
            await markerRequest<{ id: string }>('/api/screens', { cameraId })
          ).id;
          checkActive();
          screenIds = [createdTarget];
        }
        createdSession = await markerClient.createMarkerCalibration(
          cameraId,
          undefined,
          undefined,
          screenIds,
        );
        checkActive();
        setFirstScreenCalibrationForConnection(first);
        setMarkerAdd(true);
        setMarkerSession(createdSession);
        setRetryId(undefined);
        pendingAddedScreen.current = createdTarget;
        setMarkerOpen(true);
        return true;
      } catch (cause) {
        if (createdSession)
          await markerClient
            .cancelMarkerCalibration(createdSession.id, createdSession.token)
            .catch(() => undefined);
        if (createdTarget)
          await pageClient
            .discardAddedScreen(cameraId, createdTarget)
            .catch(() => undefined);
        if (!operation.signal.aborted && currentBase.current === base)
          setError(cause instanceof Error ? cause.message : String(cause));
        return false;
      } finally {
        addingScreen.current = undefined;
      }
    },
    [base, cameraId, markerClient, pageClient],
  );
  const markerClosed = useCallback(
    (reason: 'dismissed' | 'detected') => {
      if (currentBase.current !== base) return;
      setMarkerOpen(false);
      setFirstScreenCalibrationForConnection(false);
      setMarkerAdd(false);
      setDetectionScreensOverride(undefined);
      setRetryId(undefined);
      // A completed detection hands the target to review. Cancelling a retry
      // also leaves that review available to apply the previous result.
      if (reason === 'detected' || (retryId && review)) return;
      const pending = pendingAddedScreen.current;
      pendingAddedScreen.current = undefined;
      if (pending) void discardPendingAddedScreen(pending);
    },
    [base, discardPendingAddedScreen, retryId, review],
  );
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
      awaitingOriginTap ||
      (SCREEN_DRIFT_DETECTION_ENABLED && perspectiveState !== 'valid') ||
      resumeCalibration.current !== selectedId
    )
      return;
    if (config.mappingReady) {
      resumeCalibration.current = undefined;
      setStep(config.installationTaught && !reviewInstallationOnOpen ? 3 : 2);
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
    reviewInstallationOnOpen,
    markerOpen,
    perspectiveEditor,
    batchActive,
    closing,
    config,
    selectedId,
    perspectiveState,
    awaitingOriginTap,
    phoneFullscreen,
    base,
    client,
    refresh,
  ]);
  useEffect(() => {
    if (
      step !== 1 ||
      phonesOpen ||
      addingScreen.current ||
      config?.deviceId !== selectedId
    )
      return;
    if (markerOpen) {
      autoDetectStarted.current = selectedId;
      return;
    }
    if (
      perspectiveEditor ||
      (config.correction && !outlineBlocked && !awaitingOriginTap)
    )
      return;
    // Markers are only reported from a fullscreen page; opening the dialog
    // earlier would detect against a viewport the camera cannot trust.
    if (!phoneConnected || !phoneFullscreen) return;
    if (autoDetectStarted.current === selectedId) return;
    autoDetectStarted.current = selectedId;
    setFirstScreenCalibrationForConnection(false);
    setMarkerAdd(false);
    setMarkerOpen(awaitingOriginTap ? selectedId : true);
  }, [
    step,
    phonesOpen,
    markerOpen,
    perspectiveEditor,
    awaitingOriginTap,
    config?.correction,
    config?.mappingReady,
    outlineBlocked,
    phoneConnected,
    phoneFullscreen,
    selectedId,
  ]);
  const startSingle = useCallback(async () => {
    if (startingSingle.current) return;
    if (!config?.installationTaught) {
      setStep(2);
      return;
    }
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
  }, [base, config?.installationTaught, refresh, selectedId]);
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
      !config.installationTaught ||
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
    config?.installationTaught,
    outlineBlocked,
    lease,
    startSingle,
    base,
  ]);
  const recoveryMessages = {
    'manual-stop':
      'The robot was stopped manually. Confirm recovery before sampling.',
    'emergency-stop':
      config?.armState?.requiresOperatorRecovery === false
        ? 'Release the emergency stop. Recovery is checked automatically.'
        : 'Emergency stop was triggered. Confirm recovery before sampling.',
    'socket-disconnect': controller.session?.awaitingSocketRecovery
      ? 'Connection interrupted. Checking readiness before returning to sampling setup.'
      : 'Waiting for the controller to confirm it is ready.',
    fault: 'Clear the controller fault. Recovery is checked automatically.',
    pause: 'Resume the robot to continue calibration.',
    interruption: 'Waiting for the controller to confirm it is ready.',
  };
  const payloadReadbackPending =
    config?.armState?.state.enabled &&
    !config.armState.recoveryRequired &&
    isPayloadReadbackPending(config.armState.payloadApplication);
  const powerControl = config && !config.ready && !payloadReadbackPending && (
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
    (next < 3 || Boolean(config?.installationTaught));
  const screenOptions = step === 1 ? knownScreens : savedScreens;
  const showScreenPicker = shouldShowScreenPicker({
    step,
    markerOpen,
    batchActive,
    screenCount: screenOptions.length,
    soleScreen,
  });
  const batchAction = savedScreens.length > 1 && (
    <Button
      disabled={
        !config?.ready ||
        !config.installationTaught ||
        outlineBlocked ||
        singleBusy
      }
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
          <nav
            aria-label={t('Calibration')}
            {...(switching ? { inert: '' } : {})}
          >
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
              <Button disabled={switching} onClick={() => setPhonesOpen(true)}>
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
          <div
            className="guided-calibration-flow"
            ref={flow}
            style={
              !config && camera
                ? { minHeight: previousHeight.current.flow }
                : undefined
            }
          >
            <PerspectiveObservationCard
              observation={perspective}
              screenName={activeScreen?.name}
              onRecalibrate={
                batchActive || singleBusy || switching
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
            {showScreenPicker && (
              <Select
                aria-label={t('Calibration Screen')}
                value={
                  screenOptions.some((screen) => screen.id === requestedId)
                    ? requestedId
                    : undefined
                }
                options={screenOptions.map(({ id, name }) => ({
                  value: id,
                  label: name,
                }))}
                placeholder={t('Select a screen for calibration')}
                loading={switching || (!config && !loadError)}
                disabled={
                  closing ||
                  singleBusy ||
                  controller.busy ||
                  loadedConfig?.armState?.state.moving ||
                  loadedConfig?.armState?.state.dragMode
                }
                style={{ minWidth: 180 }}
                onChange={(id) => {
                  requestScreen(id);
                  identifyScreen(cameraId, id);
                }}
              />
            )}
            {step === 3 && camera && (!soleScreen || batchActive) && (
              <div {...(switching ? { inert: '' } : {})}>
                <CalibrationBatchPanel
                  ref={batchPanel}
                  api={batchClient}
                  cameraId={cameraId}
                  screens={states}
                  disabled={
                    !config?.ready ||
                    !config.installationTaught ||
                    outlineBlocked ||
                    controller.busy ||
                    singleBusy
                  }
                  onChanged={refresh}
                />
              </div>
            )}
            {!config ? (
              !loadError && <Spin />
            ) : (
              <div
                className="guided-screen-controls"
                aria-busy={switching}
                {...(switching ? { inert: '' } : {})}
              >
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
                      pairWaitingPages={markerAdd}
                      key={selectedId}
                      existingScreens={
                        markerOpen === selectedId
                          ? existing.filter(
                              (screen) => screen.id === selectedId,
                            )
                          : markerAdd
                            ? []
                            : retryId
                              ? undefined
                              : existing
                      }
                      focusTargetId={markerAdd ? undefined : retryId}
                      resumeSession={
                        markerAdd || retryId ? markerSession : undefined
                      }
                      includeSucceededTargets={Boolean(retryId)}
                      keepSessionOnClose
                      onAdjustManually={(targetId) => {
                        // The operator chose the manual path, so the automatic
                        // pass must not reopen over the editor. The manual
                        // editor owns a just-created target; do not roll it back.
                        if (pendingAddedScreen.current === targetId)
                          pendingAddedScreen.current = undefined;
                        if (targetId !== selectedId) {
                          selectScreen(targetId);
                        }
                        autoDetectStarted.current = targetId;
                        setPerspectiveEditor(true);
                      }}
                      onClose={markerClosed}
                      onDetected={detected}
                      onSessionCreated={setMarkerSession}
                      onTargetRenamed={() => refresh()}
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
                        // keep the automatic pass from opening over the editor
                        // while retaining the existing camera imaging profile.
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
                      key={selectedId}
                      onAddScreen={async () => {
                        if (
                          needsPhoneConnectionBeforeAddScreen(
                            screens,
                            cameraId,
                            phoneReadiness.connection?.devices,
                          )
                        ) {
                          openScreenPairing();
                          return;
                        }
                        await startAddedScreenCalibration();
                      }}
                      onPair={() => setPhonesOpen(true)}
                      onDetect={() => {
                        void (async () => {
                          try {
                            const listed = await pageClient.listScreenDevices();
                            const onlineScreens =
                              selectOnlineCalibrationScreens(
                                allMarkerScreens,
                                cameraId,
                                listed.devices,
                              );
                            if (!onlineScreens.length) {
                              openScreenPairing();
                              return;
                            }
                            setDetectionScreensOverride(onlineScreens);
                            await pageClient.clearCameraPerspectives(
                              cameraId,
                              onlineScreens.map((screen) => screen.id),
                            );
                            await refresh();
                            setError(undefined);
                            setMappingError(undefined);
                            setRetryId(undefined);
                            setFirstScreenCalibrationForConnection(false);
                            setMarkerAdd(false);
                            setMarkerOpen(true);
                          } catch (cause) {
                            setDetectionScreensOverride(undefined);
                            setError(
                              cause instanceof Error
                                ? cause.message
                                : String(cause),
                            );
                          }
                        })();
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
                        if (currentBase.current !== base) return;
                        await waitForImagingCalibration();
                        if (currentBase.current !== base) return;
                        setMappingError(undefined);
                        await refresh();
                      }}
                      onClear={clearCorrection}
                      onContinue={() =>
                        setStep(
                          !config.input
                            ? 0
                            : config.installationTaught &&
                                !reviewInstallationOnOpen
                              ? 3
                              : 2,
                        )
                      }
                      refresh={refresh}
                    />
                  ))}
                {step === 2 && teaching && (
                  <>
                    <Space wrap>
                      {config.installationTaught && (
                        <Button onClick={() => setStep(3)}>
                          {t(
                            reviewInstallationOnOpen
                              ? 'Use Saved Teaching'
                              : 'Next Step',
                          )}
                        </Button>
                      )}
                      {powerControl}
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
                      boundaryPreviewAvailable={Boolean(
                        config.previewPositions?.cameraBoundaryLine,
                      )}
                      onPointRecorded={() => {
                        void refresh().catch((cause) => {
                          if (requestedScreen.current === selectedId)
                            setLoadError(
                              cause instanceof Error
                                ? cause.message
                                : String(cause),
                            );
                        });
                      }}
                      onSaved={() => {
                        setStep(3);
                        void refresh().catch((cause) => {
                          if (requestedScreen.current === selectedId)
                            setLoadError(
                              cause instanceof Error
                                ? cause.message
                                : String(cause),
                            );
                        });
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
                              : payloadReadbackPending
                                ? 'Reconfirming the tool payload…'
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
                    {lease?.phase === 'queued' && (
                      <Alert
                        type="info"
                        showIcon
                        message={t('Waiting for the Controller queue')}
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
                        prepareFromTeaching
                        screenName={selected?.name}
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
                          disabled={
                            !config.ready ||
                            !config.installationTaught ||
                            singleQueued
                          }
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
              </div>
            )}
          </div>
          {camera && (
            <aside className="guided-camera" aria-label={camera.name}>
              <Tabs
                size="small"
                defaultActiveKey="camera"
                tabBarExtraContent={
                  <Typography.Text
                    type="secondary"
                    className="guided-camera-name"
                    title={camera.name}
                  >
                    {camera.name}
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
                            src={rawCameraPreviewUrl(
                              cameraId,
                              'guided-preview',
                            )}
                            data-testid="calibration-live-camera"
                            alt={camera.name}
                          />
                          <ScreenOutlines outlines={asideOutlines} />
                        </div>
                        {step === 1 && (
                          <Typography.Text type="secondary">
                            {t(
                              awaitingOriginTap
                                ? 'Tap the iPhone page once so the camera can locate the screen boundary.'
                                : 'Keep the entire phone visible in the camera preview.',
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
                      step === 2 ? (
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
      <footer
        className="calibration-shell-footer"
        ref={footerShell}
        {...(switching ? { inert: '' } : {})}
        style={
          !config && camera && previousHeight.current.footer
            ? { display: 'block', minHeight: previousHeight.current.footer }
            : undefined
        }
      >
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
          setClaimedBeforePairing(undefined);
        }}
        onContinue={
          claimedBeforePairing
            ? async () => {
                setPhonesOpen(false);
                setClaimedBeforePairing(undefined);
                await startAddedScreenCalibration(claimedBeforePairing);
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
          // Forget also removes the bound screen. Refresh the list before
          // asking a calibration host for the selected screen's configuration.
          const { screens: remaining } = await markerRequest<{
            screens: BoundScreen[];
          }>('/api/screens');
          if (requestedScreen.current !== selectedId) return;
          setScreens(remaining);
          const available = remaining.filter(
            (screen) => screen.cameraId === cameraId,
          );
          if (available.some((screen) => screen.id === selectedId))
            await refresh();
          else requestScreen(available[0]?.id ?? cameraId);
        }}
        onDeletePage={async (pageId, screenId) => {
          const deletesCurrent =
            screenId === selectedId || screenId === requestedId;
          const fallback = knownScreens.find(
            (screen) => screen.id !== screenId,
          );
          setScreens((current) =>
            current.filter((screen) => screen.id !== screenId),
          );
          if (deletesCurrent) requestScreen(fallback?.id ?? cameraId);
          await pageClient.deleteScreenPage(cameraId, pageId);
          setReview(undefined);
          setMarkerSession(undefined);
          setRetryId(undefined);
          if (!deletesCurrent) await refresh();
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
        open={reviewOpen && hasMultipleCalibrationTargets(review?.session)}
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
              if (failures.length) throw new Error(failures.join('\n'));
              await waitForImagingCalibration();
              if (currentBase.current !== base) return;
              pendingAddedScreen.current = undefined;
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
