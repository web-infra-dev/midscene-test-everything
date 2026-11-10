import {
  PerspectiveObservationCard,
  type ScreenOutlineEntry,
  usePerspectiveValidity,
} from '@midscene/arm-calibration-ui';
import {
  Alert,
  Button,
  Empty,
  Segmented,
  Select,
  Spin,
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
import { useCallback, useEffect, useState } from 'react';
import { type CameraView, cameraPreviewUrl } from '../camera-preview';
import { cameraStateLabel, useCameras } from '../cameras';
import { useConnection } from '../connection';
import { useViews } from '../extensions';
import { useDeviceReadiness } from '../hooks/useDeviceReadiness';
import { useRobotArm } from '../hooks/useRobotArm';
import { usePreferences, useT } from '../i18n';
import { CameraPerspectiveActions } from './CameraPerspectiveActions';
import { CameraRail } from './CameraRail';
import { CameraStagePreview } from './CameraStagePreview';
import { DeviceCalibration } from './DeviceCalibration';
import { DeviceTransfer } from './DeviceTransfer';
import { LiveCameraImage } from './LiveCameraImage';
import { RobotConnectionDialog } from './RobotConnectionDialog';
import { RobotReadinessCard } from './RobotReadinessCard';
import { TaskWorkspace } from './TaskWorkspace';
import { WorkspaceLayout } from './WorkspaceLayout';
import { ActionAudit } from './robot-arm/ActionAudit';
import { ControllerMotionSettings } from './robot-arm/ControllerMotionSettings';
import { DeviceSettings } from './robot-arm/DeviceSettings';
import { RobotStatusBar } from './robot-arm/RobotStatusBar';
import './CameraStage.less';

export function DeviceWorkspace({ connected }: { connected: boolean }) {
  const t = useT();
  const { ConnectionForm } = useViews();
  const arm = useRobotArm();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const language = usePreferences((state) => state.language);
  const [configurationRevision, setConfigurationRevision] = useState(0);
  const [wizard, setWizard] = useState<{
    id: string;
    cameraId: string;
    step: 0 | 1;
    session: string;
  }>();
  const [wizardScreen, setWizardScreen] = useState<string>();
  const [transferId, setTransferId] = useState<string>();
  const [preferredView, setCameraView] = useState<CameraView>('raw');
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
  const closeCalibration = useCallback(
    (screenId?: string) => {
      if (screenId) setPreferredScreenId(screenId);
      setWizard(undefined);
      setWizardScreen(undefined);
      setConfigurationRevision((value) => value + 1);
      void refresh();
    },
    [refresh],
  );
  const { host, disconnect, setupSession, check } = useConnection();
  const [pausedCamera, setPausedCamera] = useState<string>();
  const [frame, setFrame] = useState<{
    key: string;
    width: number;
    height: number;
  }>();
  const [preferredScreenId, setPreferredScreenId] = useState<string>();
  useEffect(() => {
    void refresh();
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
  const activeWizard =
    robotReady && wizard?.session === setupSession ? wizard : undefined;
  const openCalibration = (step: 0 | 1 = 0) => {
    if (!deviceId || !selectedId || !setupSession) return;
    setWizardScreen(deviceId);
    setWizard({
      id: deviceId,
      cameraId: selectedId,
      step,
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
    JSON.stringify([setupSession, configurationRevision, previewRevision]),
  );
  const perspective = usePerspectiveValidity(
    `/api/devices/${encodeURIComponent(deviceId ?? '')}/calibration`,
    Boolean(deviceId && running && activeScreen?.correction && !activeWizard),
    JSON.stringify([setupSession, configurationRevision, previewRevision]),
  );
  const perspectiveBlocked = perspective.summary?.state === 'invalid';
  const ready = readiness?.status === 'ready';
  /*
   * The raw view draws every screen the camera holds a perspective for, the way
   * the workstation stage did. The corrected view is already rectified, so an
   * outline there would double up with the transformed image.
   */
  const stageOutlines: ScreenOutlineEntry[] =
    cameraView === 'raw'
      ? (standalone && selected ? [selected] : availableScreens).flatMap(
          (screen) => {
            if (!screen.correction) return [];
            return [
              {
                id: screen.id,
                name: screen.name,
                correction: screen.correction,
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
      {connected && (
        <RobotStatusBar
          key={JSON.stringify([controlScreen, setupSession])}
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
        />
      ) : camera && selected ? (
        <WorkspaceLayout
          sidebar={
            (connected && !robotReady) ||
            (!connected &&
              deviceSession === undefined &&
              status === 'ready') ? (
              <Alert
                type="warning"
                showIcon
                message={
                  language === 'zh'
                    ? '设备会话尚未同步'
                    : 'Device session is out of sync'
                }
                description={
                  deviceSession === undefined && status === 'ready'
                    ? language === 'zh'
                      ? '当前服务没有返回设备会话。请在仓库根目录运行 pnpm build，重启 pnpm dev 后重试。'
                      : 'The server did not return a device session. Run pnpm build at the repository root, restart pnpm dev, then retry.'
                    : language === 'zh'
                      ? '正在核对机械臂和相机的连接。若未恢复，请重试。'
                      : 'Checking the robot and camera connection. Retry if it does not recover.'
                }
                action={
                  <Button
                    loading={status === 'loading'}
                    onClick={() => void Promise.all([check(), refresh(false)])}
                  >
                    {t('refresh')}
                  </Button>
                }
              />
            ) : !connected || !running || !deviceId ? (
              <RobotReadinessCard
                camera={camera}
                connected={connected}
                disabled={connected && (starting || Boolean(pendingId))}
                actionLabel={connected ? t('startCamera') : undefined}
                onOpenSetup={() =>
                  connected ? void start(selected.id) : setConnectionOpen(true)
                }
              />
            ) : perspectiveBlocked ? (
              <RobotReadinessCard
                camera={{ ...selected, hasCorrection: false }}
                onOpenSetup={openCameraCorrection}
              />
            ) : ready ? (
              <TaskWorkspace cameraId={deviceId!} />
            ) : readiness?.status === 'required' ? (
              <RobotReadinessCard
                camera={{
                  ...selected,
                  hasCorrection: activeScreen?.hasCorrection,
                }}
                onOpenSetup={() => openCalibration()}
              />
            ) : readiness?.status === 'error' ? (
              <Alert
                type="error"
                showIcon
                message={
                  language === 'zh'
                    ? '无法检查设备标定'
                    : 'Unable to check calibration'
                }
                description={readiness.error}
                action={
                  <Button
                    onClick={() =>
                      setConfigurationRevision((value) => value + 1)
                    }
                  >
                    {language === 'zh' ? '重试' : 'Retry'}
                  </Button>
                }
              />
            ) : (
              <Spin
                aria-label={
                  language === 'zh' ? '检查设备标定' : 'Checking calibration'
                }
              />
            )
          }
        >
          <section className="camera-stage">
            <header className="camera-stage-header">
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
              <div className="camera-stage-actions">
                {availableScreens.length > 1 && activeScreen && (
                  <Select
                    aria-label={language === 'zh' ? '标定屏幕' : 'Screen'}
                    value={activeScreen.id}
                    onChange={setPreferredScreenId}
                    options={availableScreens.map((s) => ({
                      value: s.id,
                      label: s.name,
                    }))}
                    style={{ width: 160 }}
                  />
                )}

                {activeScreen &&
                  (standalone || (connected && setupSession)) && (
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
                      void refresh();
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
                        setPausedCamera(
                          previewEnabled ? selected.id : undefined,
                        );
                        setPreviewRevision((n) => n + 1);
                      } else if (connected)
                        void (running ? stop(selected.id) : start(selected.id));
                    }}
                  />
                </Tooltip>
              </div>
            </header>
            <PerspectiveObservationCard
              observation={perspective}
              screenName={activeScreen?.name ?? selected.name}
              onRecalibrate={openCameraCorrection}
            />
            <CameraStagePreview
              available={Boolean(previewEnabled && previewError !== previewKey)}
              outlines={stageOutlines}
              frameSize={cameraView === 'corrected' ? previewTarget : undefined}
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
                <LiveCameraImage
                  key={previewKey}
                  className="stream-preview"
                  src={`${cameraPreviewUrl(previewId, cameraView)}&revision=${encodeURIComponent(previewKey)}`}
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
                  onError={() => setPreviewError(previewKey)}
                  alt={
                    cameraView === 'corrected'
                      ? activeScreen?.name
                      : selected.name
                  }
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
            {(error || selected.error || selected.stream?.error) && (
              <Typography.Text type="danger" role="alert">
                {error || selected.error || selected.stream?.error}
              </Typography.Text>
            )}
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
          </section>
        </WorkspaceLayout>
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
                    onClick={() => setTransferId(deviceId)}
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
          onClose={() => setTransferId(undefined)}
        />
      )}
    </>
  );
}
