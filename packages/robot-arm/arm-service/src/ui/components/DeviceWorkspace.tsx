import {
  Alert,
  Button,
  Empty,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { Drawer, Tooltip } from 'antd';
import {
  ArrowRightLeft,
  Cable,
  Play,
  RefreshCw,
  ScanLine,
  Settings2,
  StopCircle,
  Unplug,
  VideoOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PerspectiveObservationCard,
  type ScreenOutlineEntry,
  identifyScreen,
  usePerspectiveValidity,
} from '../calibration';
import { type CameraView, cameraPreviewUrl } from '../camera-preview';
import { cameraStateLabel, useCameras } from '../cameras';
import { useConnection } from '../connection';
import { useViews } from '../extensions';
import { useDeviceReadiness } from '../hooks/useDeviceReadiness';
import { usePreviewControl } from '../hooks/usePreviewControl';
import { useRobotArm } from '../hooks/useRobotArm';
import { usePreferences, useT } from '../i18n';
import { PreviewControl } from '../preview/PreviewControl';
import type { PreviewScreenGeometry } from '../preview/projection';
import { CameraPerspectiveActions } from './CameraPerspectiveActions';
import { CameraRail } from './CameraRail';
import { CameraStagePreview } from './CameraStagePreview';
import { DeviceCalibration } from './DeviceCalibration';
import { DeviceTransfer } from './DeviceTransfer';
import { RobotConnectionDialog } from './RobotConnectionDialog';
import { TwinPanel, type TwinViewPreset } from './TwinPanel';
import { ActionAudit } from './robot-arm/ActionAudit';
import { ControllerMotionSettings } from './robot-arm/ControllerMotionSettings';
import { DeviceSettings } from './robot-arm/DeviceSettings';
import { OpenDeviceSettings } from './robot-arm/OpenDeviceSettings';
import { RobotStatusBar } from './robot-arm/RobotStatusBar';
import './CameraStage.less';

export function DeviceWorkspace({ connected }: { connected: boolean }) {
  const t = useT();
  const { ConnectionForm } = useViews();
  const arm = useRobotArm();
  const [enabledControlContext, setEnabledControlContext] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const language = usePreferences((state) => state.language);
  const [configurationRevision, setConfigurationRevision] = useState(0);
  const [wizard, setWizard] = useState<{
    id: string;
    cameraId: string;
    step: 0 | 1;
    reviewInstallationOnOpen: boolean;
    session: string;
  }>();
  const [wizardScreen, setWizardScreen] = useState<string>();
  const [transferId, setTransferId] = useState<string>();
  const [preferredView, setCameraView] = useState<CameraView>('raw');
  const [twinView, setTwinView] = useState<TwinViewPreset>('default');
  const [previewError, setPreviewError] = useState<string>();
  const [previewRevision, setPreviewRevision] = useState(0);
  const {
    cameras,
    deviceSession,
    selectedId,
    select,
    status,
    refresh,
    start,
    stop,
    pendingId,
    error,
  } = useCameras();
  const { host, disconnect, setupSession, check, control } = useConnection();
  const closeCalibration = useCallback(
    (screenId?: string) => {
      if (screenId) setPreferredScreenId(screenId);
      setWizard(undefined);
      setWizardScreen(undefined);
      setConfigurationRevision((value) => value + 1);
      // Closing the wizard must not probe the camera devices: the stream is
      // already running and enumeration can disturb the capture process.
      void refresh(false);
      void check();
    },
    [check, refresh],
  );
  const [pausedCamera, setPausedCamera] = useState<string>();
  const [frame, setFrame] = useState<{
    key: string;
    width: number;
    height: number;
  }>();
  const [preferredScreenId, setPreferredScreenId] = useState<string>();
  useEffect(() => {
    void refresh(false);
    const onFocus = () => void refresh(false);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh, connected, setupSession]);
  useEffect(() => {
    if (connected) setConnectionOpen(false);
    else setPreferredScreenId(undefined);
  }, [connected]);
  useEffect(() => {
    setSettingsOpen(false);
    setTransferId(undefined);
    setWizardScreen(undefined);
    setWizard(undefined);
    setPausedCamera(undefined);
    setPreferredScreenId(undefined);
  }, [setupSession]);
  useEffect(() => {
    if (
      status === 'loading' ||
      !cameras.some((camera) => camera.stream?.state === 'starting')
    )
      return;
    const timer = setTimeout(() => void refresh(false), 500);
    return () => clearTimeout(timer);
  }, [cameras, status, refresh]);
  const selected = cameras.find((camera) => camera.id === selectedId);
  const streamState = selected?.stream?.state;
  const robotReady =
    connected && Boolean(setupSession && setupSession === deviceSession);
  useEffect(() => {
    if (
      !connected ||
      !setupSession ||
      deviceSession === undefined ||
      robotReady ||
      status !== 'ready'
    )
      return;
    const timer = setTimeout(() => void refresh(false), 1000);
    return () => clearTimeout(timer);
  }, [connected, setupSession, deviceSession, robotReady, status, refresh]);
  const availableScreens = robotReady ? (selected?.screens ?? []) : [];
  const transferTargets = cameras.flatMap((camera) =>
    camera.stream?.state === 'running' ? (camera.screens ?? []) : [],
  );
  const activeScreen =
    availableScreens.find((s) => s.id === preferredScreenId) ??
    availableScreens.find((s) => s.id === selected?.previewScreenId) ??
    availableScreens.find((s) => s.id === selectedId) ??
    availableScreens[0] ??
    (!connected ? selected : undefined);
  const deviceId =
    robotReady && streamState === 'running'
      ? (activeScreen?.id ?? selectedId ?? undefined)
      : undefined;
  const controlScreens = useMemo<PreviewScreenGeometry[]>(
    () =>
      availableScreens.flatMap((screen) => {
        const control = screen.control;
        if (
          !screen.correction ||
          !control?.ready ||
          !control.pixelWidth ||
          !control.pixelHeight
        )
          return [];
        return [
          {
            id: screen.id,
            name: screen.name,
            correction: screen.correction,
            target: screen.perspectiveTarget,
            pixelWidth: control.pixelWidth,
            pixelHeight: control.pixelHeight,
            calibrationId: control.calibrationId,
            active: screen.id === activeScreen?.id,
            ready: true,
          },
        ];
      }),
    [activeScreen?.id, availableScreens],
  );
  // A missed status poll during motion must not unmount the current attempt.
  const activeWizard = wizard?.session === setupSession ? wizard : undefined;
  const openCalibration = (
    step: 0 | 1 = 0,
    reviewInstallationOnOpen = false,
  ) => {
    if (!deviceId || !selectedId || !setupSession) return;
    setWizardScreen(deviceId);
    setWizard({
      id: deviceId,
      cameraId: selectedId,
      step,
      reviewInstallationOnOpen,
      session: setupSession,
    });
  };
  const openCameraCorrection = () => openCalibration(1);
  const controlScreen = activeWizard ? wizardScreen : deviceId;
  const standalone = !connected && deviceSession === null;
  useEffect(() => {
    if (!standalone || !selectedId || pausedCamera === selectedId) return;
    const abort = new AbortController();
    // The preview itself reports startup errors. This extra owner only
    // bridges the instant between detaching one MJPEG image and loading another.
    void fetch(`/api/cameras/lease?id=${encodeURIComponent(selectedId)}`, {
      signal: abort.signal,
    })
      .then((response) => response.arrayBuffer())
      .catch(() => {});
    return () => abort.abort();
  }, [standalone, selectedId, pausedCamera]);
  const previewTarget = activeScreen?.perspectiveTarget;
  const cameraView = previewTarget ? preferredView : 'raw';
  const previewId = cameraView === 'corrected' ? activeScreen?.id : selectedId;
  const previewKey = JSON.stringify([
    previewId,
    cameraView,
    previewRevision,
    standalone,
    connected,
    setupSession,
  ]);
  const running = standalone
    ? Boolean(
        selected &&
          pausedCamera !== selected.id &&
          frame?.key === previewKey &&
          previewError !== previewKey,
      )
    : streamState === 'running';
  const previewEnabled = standalone ? selected?.id !== pausedCamera : running;
  const starting = !standalone && streamState === 'starting';
  const cameraActionLabel = t(
    starting ? 'cameraStarting' : previewEnabled ? 'stopCamera' : 'startCamera',
  );
  const camera =
    selected && standalone
      ? {
          ...selected,
          stream: {
            state: !previewEnabled
              ? 'stopped'
              : previewError === previewKey
                ? 'failed'
                : running
                  ? 'running'
                  : 'starting',
            width: running ? (frame?.width ?? 0) : 0,
            height: running ? (frame?.height ?? 0) : 0,
            hasFrame: running,
          },
        }
      : selected;
  const readiness = useDeviceReadiness(
    running ? deviceId : undefined,
    JSON.stringify([
      setupSession,
      selectedId,
      configurationRevision,
      previewRevision,
    ]),
  );
  const perspective = usePerspectiveValidity(
    `/api/devices/${encodeURIComponent(deviceId ?? '')}/calibration`,
    Boolean(deviceId && running && activeScreen?.correction && !activeWizard),
    JSON.stringify([setupSession, configurationRevision, previewRevision]),
  );
  const perspectiveBlocked = perspective.summary?.state === 'invalid';
  const switchingScreen = Boolean(readiness && readiness.id !== deviceId);
  const ready = !switchingScreen && readiness?.status === 'ready';
  const runtimeState = arm.state;
  const robotState = runtimeState?.state;
  const activeViewBlocked = cameraView === 'corrected' && perspectiveBlocked;
  const robotControlReady = Boolean(
    connected &&
      robotReady &&
      running &&
      previewError !== previewKey &&
      !activeViewBlocked &&
      !control?.remoteBusy &&
      !control?.positionUnknown &&
      arm.capabilities?.screenActions.includes('tap') &&
      arm.capabilities?.screenActions.includes('swipe') &&
      robotState?.connected &&
      robotState.enabled &&
      !robotState.moving &&
      !robotState.dragMode &&
      !runtimeState?.recoveryRequired &&
      !runtimeState?.softwarePaused &&
      !robotState.faults.length &&
      runtimeState?.operation?.status !== 'running',
  );
  const visibleControlScreens =
    cameraView === 'corrected'
      ? controlScreens.filter((screen) => screen.id === activeScreen?.id)
      : controlScreens;
  const controlAvailable =
    !activeWizard && robotControlReady && visibleControlScreens.length > 0;
  const controlContext = JSON.stringify([
    previewKey,
    visibleControlScreens.map((screen) => [
      screen.id,
      screen.calibrationId,
      screen.correction,
      screen.target,
      screen.pixelWidth,
      screen.pixelHeight,
    ]),
  ]);
  const controlEnabled = enabledControlContext === controlContext;
  const controlUnavailableReason = !connected
    ? language === 'zh'
      ? '连接机械臂后才能控制屏幕'
      : 'Connect the robot before controlling a screen'
    : !robotReady
      ? language === 'zh'
        ? '正在核对机械臂与相机，暂不可控制'
        : 'Checking the robot and camera connection'
      : !running
        ? language === 'zh'
          ? '启动相机后才能控制屏幕'
          : 'Start the camera before controlling a screen'
        : activeViewBlocked
          ? language === 'zh'
            ? '屏幕轮廓已失效，请重新标定相机映射'
            : 'The screen outline is stale. Recalibrate the camera mapping'
          : !visibleControlScreens.length
            ? language === 'zh'
              ? '当前画面没有已完成标定和映射的屏幕'
              : 'No screen with accepted calibration and mapping is in view'
            : !ready
              ? language === 'zh'
                ? '屏幕标定尚未就绪'
                : 'Screen calibration is not ready'
              : control?.positionUnknown
                ? language === 'zh'
                  ? '机械臂位置未知，请先恢复或重新标定'
                  : 'The arm position is unknown. Recover or recalibrate first'
                : !robotState?.enabled
                  ? language === 'zh'
                    ? '请先使能机械臂并确认工具负载'
                    : 'Enable the robot and confirm its tool payload first'
                  : control?.remoteBusy
                    ? language === 'zh'
                      ? '机械臂正在由 Open Device 控制'
                      : 'An Open Device session is controlling the arm'
                    : robotState?.moving || robotState?.dragMode
                      ? language === 'zh'
                        ? '机械臂正在运动，暂不可控制'
                        : 'The arm is moving; control is paused'
                      : runtimeState?.recoveryRequired ||
                          runtimeState?.softwarePaused ||
                          robotState?.faults.length
                        ? language === 'zh'
                          ? '请先处理机械臂报警或恢复状态'
                          : 'Clear the robot fault or recovery state first'
                        : undefined;
  const refreshAfterControl = useCallback(async () => {
    setConfigurationRevision((value) => value + 1);
    // A status poll already in flight may still describe the completed motion.
    await Promise.all([refresh(false), check(true)]);
  }, [check, refresh]);
  const previewControl = usePreviewControl({
    contextKey: controlContext,
    onCompleted: refreshAfterControl,
  });
  useEffect(() => {
    if (
      !controlEnabled ||
      activeWizard ||
      (!controlAvailable && !previewControl.busy)
    )
      setEnabledControlContext(undefined);
  }, [controlEnabled, controlAvailable, previewControl.busy, activeWizard]);
  /*
   * The raw view draws every screen the camera holds a perspective for, the way
   * the workstation stage did. The corrected view is already rectified, so an
   * outline there would double up with the transformed image.
   */
  const stageOutlines: ScreenOutlineEntry[] =
    cameraView === 'raw'
      ? (standalone && selected ? [selected] : availableScreens).flatMap(
          (screen) => {
            // A saved perspective is not an applied one: only paint what the
            // camera is actually rectifying right now.
            if (!screen.correction || screen.hasCorrection === false) return [];
            return [
              {
                id: screen.id,
                name: screen.name,
                correction: screen.correction,
                previewPositions:
                  screen.id === activeScreen?.id && !perspectiveBlocked
                    ? screen.previewPositions
                    : undefined,
                active: screen.id === activeScreen?.id,
                validity:
                  screen.id === deviceId
                    ? perspective.summary?.state
                    : undefined,
              },
            ];
          },
        )
      : [];
  return (
    <>
      {connected && arm.adapter?.connectionIdentity.startsWith('mock://') && (
        <Alert
          banner
          showIcon
          type="warning"
          message={
            language === 'zh'
              ? '模拟机械臂：不会连接或移动真实控制器，标定结果不能当作实测结果。'
              : 'Simulated arm: no controller is connected and no motion is sent. Calibration here is not physical evidence.'
          }
        />
      )}
      {(connected || (camera && selected)) && !activeWizard && (
        <div className="arm-manager-notices">
          {connected && (
            <Alert
              closable
              showIcon
              type={ready && !perspectiveBlocked ? 'success' : 'info'}
              message={
                <>
                  {ready &&
                    !perspectiveBlocked &&
                    (language === 'zh'
                      ? '设备已就绪，可在 Open Device Playground 中连接。'
                      : 'Device ready to connect from Open Device Playground. ')}
                  {language === 'zh'
                    ? '在「机械臂配置 → Open Device」查看服务地址和 Token。'
                    : 'Find the service URL and token under Robot settings → Open Device.'}
                </>
              }
            />
          )}
          {camera &&
            selected &&
            !switchingScreen &&
            ((connected && !robotReady) ||
            (!connected &&
              deviceSession === undefined &&
              status === 'ready') ? (
              <Alert
                showIcon
                type="warning"
                message={
                  language === 'zh'
                    ? '设备会话尚未同步'
                    : 'Device session is out of sync'
                }
                action={
                  <Button
                    size="small"
                    loading={status === 'loading'}
                    onClick={() => void Promise.all([check(), refresh(false)])}
                  >
                    {t('refresh')}
                  </Button>
                }
              />
            ) : !connected || !running || !deviceId ? (
              <Alert
                showIcon
                type="info"
                message={
                  connected
                    ? language === 'zh'
                      ? '启动相机后即可继续标定。'
                      : 'Start the camera to continue calibration.'
                    : language === 'zh'
                      ? '可先预览相机，连接机械臂后继续标定。'
                      : 'You can preview the camera before connecting the arm for calibration.'
                }
                action={
                  <Button
                    size="small"
                    disabled={connected && (starting || Boolean(pendingId))}
                    onClick={() =>
                      connected
                        ? void start(selected.id)
                        : setConnectionOpen(true)
                    }
                  >
                    {connected ? t('startCamera') : t('connect')}
                  </Button>
                }
              />
            ) : perspectiveBlocked || readiness?.status === 'required' ? (
              <Alert
                showIcon
                type="warning"
                message={
                  perspectiveBlocked
                    ? language === 'zh'
                      ? '屏幕映射已失效，请重新校正。'
                      : 'The screen mapping needs correction.'
                    : language === 'zh'
                      ? '请完成屏幕标定。'
                      : 'Complete screen calibration.'
                }
                action={
                  <Button
                    size="small"
                    onClick={
                      perspectiveBlocked
                        ? openCameraCorrection
                        : () => openCalibration(0, true)
                    }
                  >
                    {language === 'zh' ? '进入标定' : 'Open calibration'}
                  </Button>
                }
              />
            ) : readiness?.status === 'error' ? (
              <Alert
                showIcon
                type="error"
                message={
                  language === 'zh'
                    ? '无法检查设备标定'
                    : 'Unable to check calibration'
                }
                description={readiness.error}
                action={
                  <Button
                    size="small"
                    onClick={() =>
                      setConfigurationRevision((value) => value + 1)
                    }
                  >
                    {language === 'zh' ? '重试' : 'Retry'}
                  </Button>
                }
              />
            ) : null)}
        </div>
      )}
      {connected && (
        <RobotStatusBar
          control={
            <Tooltip
              title={
                activeWizard
                  ? language === 'zh'
                    ? '点击标定向导右上角的「关闭」，返回相机画面后开启控制。'
                    : 'Close the calibration wizard to enable control in the camera preview.'
                  : controlAvailable
                    ? language === 'zh'
                      ? '点击屏幕为点击，按住 500ms 为长按，拖动为滑动。释放后执行。'
                      : 'Click to tap, hold for at least 500 ms to long press, or drag to swipe. Gestures execute on release.'
                    : controlUnavailableReason
              }
            >
              <Space>
                <span>{language === 'zh' ? '控制' : 'Control'}</span>
                <Switch
                  aria-label={language === 'zh' ? '控制屏幕' : 'Control screen'}
                  checked={controlEnabled}
                  disabled={!controlAvailable || previewControl.busy}
                  onChange={(enabled) =>
                    setEnabledControlContext(
                      enabled ? controlContext : undefined,
                    )
                  }
                />
              </Space>
            </Tooltip>
          }
          key={setupSession}
          cameraId={controlScreen}
          onConfigure={() => {
            if (!activeWizard) openCalibration();
          }}
          preparing={!ready}
          settings={
            <Button
              type="text"
              disabled={Boolean(activeWizard)}
              icon={<Settings2 size={16} />}
              onClick={() => setSettingsOpen(true)}
            >
              {language === 'zh' ? '机械臂配置' : 'Robot settings'}
            </Button>
          }
        />
      )}
      {activeWizard ? (
        <DeviceCalibration
          id={activeWizard.id}
          cameraId={activeWizard.cameraId}
          onScreenChange={setWizardScreen}
          onClose={closeCalibration}
          initialStep={activeWizard.step}
          reviewInstallationOnOpen={activeWizard.reviewInstallationOnOpen}
        />
      ) : camera && selected ? (
        <main className="app-workspace streams-section">
          <header className="camera-stage-header workspace-toolbar">
            <div className="workspace-toolbar-left">
              <div className="camera-stage-title">
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {selected.name}
                </Typography.Title>
                <div className="camera-stage-meta">
                  <Tag
                    color={
                      camera.stream?.state === 'running' ? 'green' : undefined
                    }
                  >
                    {t(cameraStateLabel(camera))}
                  </Tag>
                  <Typography.Text type="secondary">
                    {camera.stream?.width
                      ? `${camera.stream.width} × ${camera.stream.height}`
                      : t('noStream')}
                  </Typography.Text>
                </div>
              </div>
              {availableScreens.length > 1 && activeScreen && (
                <Select
                  aria-label={language === 'zh' ? '标定屏幕' : 'Screen'}
                  value={activeScreen.id}
                  loading={switchingScreen}
                  onChange={(id) => {
                    setPreferredScreenId(id);
                    identifyScreen(selected.id, id);
                  }}
                  options={availableScreens.map((s) => ({
                    value: s.id,
                    label: s.name,
                  }))}
                  style={{ width: 180 }}
                />
              )}
            </div>
            <div className="camera-stage-actions">
              {activeScreen && (standalone || (connected && setupSession)) && (
                <CameraPerspectiveActions
                  key={JSON.stringify([
                    selected.id,
                    activeScreen.id,
                    standalone,
                    setupSession,
                  ])}
                  cameraId={selected.id}
                  screen={activeScreen}
                  robot={
                    connected && setupSession
                      ? {
                          session: setupSession,
                          detect: openCameraCorrection,
                        }
                      : undefined
                  }
                  disabled={!previewEnabled}
                  onChanged={async (view) => {
                    setCameraView(view);
                    setPreviewRevision((n) => n + 1);
                    await refresh(false);
                  }}
                />
              )}
              {previewTarget && (
                <Segmented
                  className="rv-segmented"
                  aria-label={language === 'zh' ? '画面类型' : 'Camera view'}
                  value={cameraView}
                  onChange={(value) => setCameraView(value as CameraView)}
                  options={[
                    {
                      value: 'raw',
                      label: language === 'zh' ? '原始画面' : 'Original',
                    },
                    {
                      value: 'corrected',
                      label: language === 'zh' ? '校正画面' : 'Corrected',
                    },
                  ]}
                />
              )}
              <Tooltip title={t('refresh')}>
                <Button
                  type="text"
                  aria-label={t('refresh')}
                  icon={<RefreshCw size={16} />}
                  loading={status === 'loading'}
                  onClick={() => {
                    setPreviewRevision((value) => value + 1);
                    // Reload the preview, not the device list: probing while
                    // this camera is capturing can disturb the stream.
                    void refresh(false);
                  }}
                />
              </Tooltip>
              <Tooltip title={cameraActionLabel}>
                <Button
                  type="text"
                  aria-label={cameraActionLabel}
                  icon={
                    previewEnabled ? (
                      <StopCircle size={16} />
                    ) : (
                      <Play size={16} />
                    )
                  }
                  loading={starting || pendingId === selected.id}
                  onClick={() => {
                    setPreviewError(undefined);
                    if (standalone) {
                      setPausedCamera(previewEnabled ? selected.id : undefined);
                      setPreviewRevision((n) => n + 1);
                    } else if (connected)
                      void (running ? stop(selected.id) : start(selected.id));
                  }}
                />
              </Tooltip>
              <span className="workspace-toolbar-divider" aria-hidden="true" />
              <Segmented
                className="rv-segmented"
                aria-label={language === 'zh' ? '3D 视角' : '3D view'}
                value={twinView}
                onChange={(value) => setTwinView(value as TwinViewPreset)}
                options={[
                  {
                    value: 'default',
                    label: language === 'zh' ? '默认视角' : 'Default',
                  },
                  {
                    value: 'camera',
                    label: language === 'zh' ? '相机视角' : 'Camera',
                  },
                  {
                    value: 'screen',
                    label: language === 'zh' ? '聚焦屏幕' : 'Screen',
                  },
                ]}
              />
            </div>
          </header>
          <div className="workspace-views">
            <section className="camera-stage">
              <PerspectiveObservationCard
                observation={perspective}
                screenName={activeScreen?.name ?? selected.name}
                onRecalibrate={openCameraCorrection}
              />
              <div className="camera-frame">
                <CameraStagePreview
                  available={Boolean(
                    previewEnabled && previewError !== previewKey,
                  )}
                  outlines={stageOutlines}
                  frameSize={
                    cameraView === 'corrected' ? previewTarget : undefined
                  }
                >
                  {previewEnabled && previewError === previewKey ? (
                    <Empty
                      description={
                        language === 'zh'
                          ? '画面加载失败，请刷新重试'
                          : 'Preview unavailable. Refresh to retry.'
                      }
                    />
                  ) : previewEnabled && previewId ? (
                    <PreviewControl
                      key={previewKey}
                      activeScreenId={activeScreen?.id}
                      alt={
                        cameraView === 'corrected'
                          ? (activeScreen?.name ?? selected.name)
                          : selected.name
                      }
                      available={controlAvailable}
                      longPressEnabled={Boolean(
                        arm.capabilities?.screenActions.includes('longPress'),
                      )}
                      className="stream-preview"
                      control={previewControl}
                      enabled={controlEnabled}
                      onError={() => setPreviewError(previewKey)}
                      onLoad={(event) => {
                        const { naturalWidth: width, naturalHeight: height } =
                          event.currentTarget;
                        if (width && height)
                          setFrame((previous) =>
                            previous?.key === previewKey &&
                            previous.width === width &&
                            previous.height === height
                              ? previous
                              : { key: previewKey, width, height },
                          );
                      }}
                      screens={controlScreens}
                      src={`${cameraPreviewUrl(previewId, cameraView)}&revision=${encodeURIComponent(previewKey)}`}
                      view={cameraView}
                    />
                  ) : starting ? (
                    <Spin aria-label={t('cameraStarting')} />
                  ) : (
                    <>
                      <VideoOff size={40} strokeWidth={1.25} />
                      <span>{t('noStream')}</span>
                    </>
                  )}
                </CameraStagePreview>
                <CameraRail
                  entries={
                    standalone
                      ? cameras.map((entry) =>
                          entry.id === camera.id ? camera : entry,
                        )
                      : cameras
                  }
                  selectedId={selectedId}
                  onSelect={select}
                />
              </div>
              {(error || selected.error || selected.stream?.error) && (
                <Typography.Text type="danger" role="alert">
                  {error || selected.error || selected.stream?.error}
                </Typography.Text>
              )}
            </section>
            <TwinPanel connected={connected} viewPreset={twinView} />
          </div>
        </main>
      ) : (
        <section className="camera-empty">
          <Empty
            description={
              status === 'loading' ? t('loadingCameras') : t('noCameras')
            }
          />
          <Button
            icon={<RefreshCw size={16} />}
            loading={status === 'loading'}
            onClick={() => void refresh()}
          >
            {t('refresh')}
          </Button>
          {!connected && (
            <Button
              icon={<Cable size={16} />}
              onClick={() => setConnectionOpen(true)}
            >
              {t('connect')}
            </Button>
          )}
          {error && <Typography.Text type="danger">{error}</Typography.Text>}
        </section>
      )}
      {connected && (
        <Drawer
          rootClassName="robot-drawer robot-settings-drawer"
          title={language === 'zh' ? '机械臂配置' : 'Robot settings'}
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          width={440}
          footer={
            <Button
              danger
              block
              icon={<Unplug size={16} />}
              onClick={disconnect}
            >
              {t('disconnect')}
            </Button>
          }
        >
          <div className="robot-panel">
            <div className="robot-panel-heading">
              <Cable size={19} />
              <div className="robot-panel-identity">
                <Typography.Text strong>{arm.adapter?.name}</Typography.Text>
                <Typography.Text type="secondary">{host}</Typography.Text>
              </div>
              <Tag color="green">{t('connected')}</Tag>
            </div>
            {(selected || ConnectionForm) && (
              <section className="robot-settings-group">
                <Typography.Text type="secondary">
                  {language === 'zh'
                    ? '连接与标定'
                    : 'Connection & calibration'}
                </Typography.Text>
                {running && deviceId && (
                  <Button
                    icon={<ScanLine size={19} />}
                    onClick={() => {
                      setSettingsOpen(false);
                      openCalibration();
                    }}
                  >
                    {language === 'zh' ? '屏幕标定' : 'Screen Calibration'}
                  </Button>
                )}
                {running && deviceId && transferTargets.length > 1 && (
                  <Button
                    icon={<ArrowRightLeft size={18} />}
                    onClick={() => {
                      setTransferId(deviceId);
                    }}
                  >
                    {t('transferTitle')}
                  </Button>
                )}
                {ConnectionForm && (
                  <Button
                    icon={<Cable size={18} />}
                    onClick={() => setConnectionOpen(true)}
                  >
                    {language === 'zh' ? '连接配置' : 'Connection settings'}
                  </Button>
                )}
              </section>
            )}
            {settingsOpen && <OpenDeviceSettings language={language} />}
            <section className="robot-settings-group">
              <Typography.Text type="secondary">
                {language === 'zh' ? '运动与记录' : 'Motion & history'}
              </Typography.Text>
              <ControllerMotionSettings arm={arm} />
              <ActionAudit />
              {running && deviceId && (
                <DeviceSettings
                  key={`${deviceId}:${configurationRevision}`}
                  id={deviceId!}
                  onRecorded={() => void refresh(false)}
                />
              )}
            </section>
          </div>
        </Drawer>
      )}
      <RobotConnectionDialog
        open={connectionOpen}
        onClose={() => setConnectionOpen(false)}
        title={language === 'zh' ? '连接配置' : 'Connection settings'}
      />
      {connected && transferId && (
        <DeviceTransfer
          key={transferId}
          id={transferId}
          cameras={transferTargets}
          onClose={() => {
            setTransferId(undefined);
          }}
        />
      )}
    </>
  );
}
