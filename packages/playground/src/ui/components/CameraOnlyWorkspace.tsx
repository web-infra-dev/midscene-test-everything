import {
  Alert,
  App,
  Button,
  Empty,
  Segmented,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { Eraser, RefreshCw, ScanLine } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type CameraView, cameraPreviewUrl } from '../camera-preview';
import {
  BASE_SCREEN_ID,
  type CameraScreenEntry,
  cameraScreenName,
  fetchCameraScreens,
  removeCameraScreen,
} from '../camera-screens';
import { type CameraEntry, cameraStateLabel, useCameras } from '../cameras';
import { useLanguage, useT } from '../i18n';
import { CameraRail } from './CameraRail';
import { CameraScreensPanel } from './CameraScreensPanel';
import { CameraStagePreview } from './CameraStagePreview';
import { MultiDeviceCalibrationDialog } from './MultiDeviceCalibrationDialog';
import { RobotConnectionDialog } from './RobotConnectionDialog';
import { RobotReadinessCard } from './RobotReadinessCard';
import { WorkspaceLayout } from './WorkspaceLayout';
import './CameraStage.less';

/** Detach a multipart image so the browser cancels its long-lived request. */
function releasePreviewImage(image: HTMLImageElement | null) {
  if (!image) return;
  image.removeAttribute('src');
  image.src = 'data:,';
}

export function CameraOnlyWorkspace() {
  const t = useT();
  const zh = useLanguage() === 'zh';
  const { message, modal } = App.useApp();
  const {
    cameras,
    selectedId,
    status,
    select,
    refresh,
    error,
    markCorrectionCleared,
  } = useCameras();
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [screens, setScreens] = useState<CameraScreenEntry[]>([]);
  const [selectedScreenId, setSelectedScreenId] =
    useState<string>(BASE_SCREEN_ID);
  const [screensError, setScreensError] = useState<string>();
  const [screensRevision, setScreensRevision] = useState(0);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [correctionCleared, setCorrectionCleared] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [previewSuspended, setPreviewSuspended] = useState(false);
  const [leaseReady, setLeaseReady] = useState(false);
  const [leaseError, setLeaseError] = useState<string>();
  const [view, setView] = useState<CameraView>('raw');
  const [revision, setRevision] = useState(0);
  const [failedUrl, setFailedUrl] = useState<string>();
  const [frame, setFrame] = useState<{
    url: string;
    width: number;
    height: number;
  }>();
  const previewImage = useRef<HTMLImageElement | null>(null);
  const setPreviewImage = useCallback((node: HTMLImageElement | null) => {
    if (previewImage.current && previewImage.current !== node)
      releasePreviewImage(previewImage.current);
    previewImage.current = node;
  }, []);
  useEffect(() => () => releasePreviewImage(previewImage.current), []);
  useEffect(() => {
    const abort = () => releasePreviewImage(previewImage.current);
    window.addEventListener('pagehide', abort);
    return () => {
      window.removeEventListener('pagehide', abort);
      abort();
    };
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!selectedId) {
      setScreens([]);
      setSelectedScreenId(BASE_SCREEN_ID);
      return;
    }
    const abort = new AbortController();
    setScreensError(undefined);
    void fetchCameraScreens(selectedId, abort.signal)
      .then((next) => {
        if (abort.signal.aborted) return;
        setScreens(next);
        setSelectedScreenId((current) =>
          next.some((screen) => screen.id === current)
            ? current
            : (next.find((screen) => screen.base)?.id ?? BASE_SCREEN_ID),
        );
      })
      .catch((cause) => {
        if (!abort.signal.aborted)
          setScreensError(
            cause instanceof Error ? cause.message : String(cause),
          );
      });
    return () => abort.abort();
  }, [selectedId, screensRevision]);
  // Keep one camera lease for the whole workspace. Preview responses then
  // come and go without stopping the camera, so clearing a correction or
  // switching raw/corrected never restarts the device.
  useEffect(() => {
    if (!selectedId) {
      setLeaseReady(false);
      return;
    }
    let cancelled = false;
    let lease: string | undefined;
    setLeaseReady(false);
    setLeaseError(undefined);
    void fetch('/api/cameras/lease', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selectedId }),
      // Camera startup itself is allowed 15s before it is declared failed.
      signal: AbortSignal.timeout(20000),
    })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok)
          throw new Error(value.error ?? 'Could not start the camera');
        if (typeof value.lease !== 'string')
          throw new Error('Invalid camera lease');
        if (cancelled) {
          void fetch(
            `/api/cameras/lease?lease=${encodeURIComponent(value.lease)}`,
            { method: 'DELETE', keepalive: true },
          );
          return;
        }
        lease = value.lease;
        setLeaseReady(true);
      })
      .catch((cause) => {
        if (cancelled) return;
        setLeaseError(cause instanceof Error ? cause.message : String(cause));
        // Let the preview request surface any real camera error.
        setLeaseReady(true);
      });
    return () => {
      cancelled = true;
      setLeaseReady(false);
      if (lease)
        void fetch(`/api/cameras/lease?lease=${encodeURIComponent(lease)}`, {
          method: 'DELETE',
          keepalive: true,
        });
    };
  }, [selectedId]);
  const selected = cameras.find((camera) => camera.id === selectedId);
  const selectedScreen =
    screens.find((screen) => screen.id === selectedScreenId) ??
    screens.find((screen) => screen.base) ??
    (selected
      ? {
          id: BASE_SCREEN_ID,
          name: 'Screen 1',
          base: true,
          hasCorrection: Boolean(selected.hasCorrection),
          ...(selected.perspectiveTarget
            ? { perspectiveTarget: selected.perspectiveTarget }
            : {}),
        }
      : undefined);
  const activeScreenId = selectedScreen?.base ? undefined : selectedScreen?.id;
  const hasCorrection =
    !correctionCleared && Boolean(selectedScreen?.hasCorrection);
  const effectiveView: CameraView =
    view === 'corrected' && hasCorrection ? 'corrected' : 'raw';
  const target = hasCorrection ? selectedScreen?.perspectiveTarget : undefined;
  const outlines = screens.flatMap((screen) =>
    screen.hasCorrection && screen.correction
      ? [
          {
            id: screen.id,
            name: cameraScreenName(screen, zh),
            correction: screen.correction,
            active: screen.id === selectedScreen?.id,
          },
        ]
      : [],
  );
  const url =
    previewSuspended || !leaseReady || !selected
      ? undefined
      : `${cameraPreviewUrl(selected.id, effectiveView, activeScreenId)}&revision=${revision}`;
  // Before robot connection, the preview opens its stream on demand. Use the
  // displayed frame as evidence when no stream metadata is available yet.
  const displayed = frame?.url === url ? frame : undefined;
  const camera: CameraEntry | undefined = selected && {
    ...selected,
    stream: {
      ...selected.stream,
      state:
        failedUrl === url
          ? 'failed'
          : displayed
            ? 'running'
            : (selected.stream?.state ?? 'starting'),
      width: displayed?.width ?? selected.stream?.width ?? 0,
      height: displayed?.height ?? selected.stream?.height ?? 0,
      hasFrame: Boolean(displayed || selected.stream?.hasFrame),
    },
  };
  const previewFailed = Boolean(url && failedUrl === url);
  const changeCamera = (id: string) => {
    select(id);
    setCorrectionCleared(false);
    setClearing(false);
    setView('raw');
    setScreens([]);
    setSelectedScreenId(BASE_SCREEN_ID);
    setFailedUrl(undefined);
  };
  const changeScreen = (id: string) => {
    if (id === selectedScreenId) return;
    setSelectedScreenId(id);
    setCorrectionCleared(false);
    setFailedUrl(undefined);
    setRevision((value) => value + 1);
  };
  const deleteScreen = async (screen: CameraScreenEntry) => {
    if (!selected || screen.base) return;
    setScreensError(undefined);
    try {
      await removeCameraScreen(selected.id, screen.id);
      setScreens((current) =>
        current.filter((entry) => entry.id !== screen.id),
      );
      if (selectedScreenId === screen.id) {
        setSelectedScreenId(BASE_SCREEN_ID);
        setCorrectionCleared(false);
        setView('raw');
        setFailedUrl(undefined);
        setRevision((value) => value + 1);
      }
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      setScreensError(text);
      message.error(text);
    }
  };
  const clearCorrection = async () => {
    if (!selected || clearing) return;
    const id = selected.id;
    setClearing(true);
    // Unmount the preview entirely while clearing. Switching straight to the
    // raw view would start another camera lease, and the delete would then
    // queue behind that camera opening.
    setPreviewSuspended(true);
    setView('raw');
    setRevision((value) => value + 1);
    try {
      const response = await fetch(
        `/api/cameras/correction?id=${encodeURIComponent(id)}&all=true`,
        { method: 'DELETE', signal: AbortSignal.timeout(15000) },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.error?.message ?? result.error ?? 'Failed');
      setCorrectionCleared(true);
      setSelectedScreenId(BASE_SCREEN_ID);
      setScreens(
        Array.isArray(result.screens) && result.screens.length
          ? result.screens
          : [
              {
                id: BASE_SCREEN_ID,
                name: 'Screen 1',
                base: true,
                hasCorrection: false,
              },
            ],
      );
      markCorrectionCleared(id);
      message.success(t('correctionCleared'));
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setClearing(false);
      setPreviewSuspended(false);
    }
  };
  const confirmClearCorrection = () => {
    modal.confirm({
      title: t('clearCorrectionTitle'),
      content: t('clearCorrectionBody'),
      okText: t('clearCorrection'),
      okButtonProps: { danger: true },
      cancelText: zh ? '取消' : 'Cancel',
      onOk: clearCorrection,
    });
  };
  return (
    <>
      <WorkspaceLayout
        sidebar={
          <>
            {selected && (
              <CameraScreensPanel
                onRemove={(screen) => void deleteScreen(screen)}
                onSelect={changeScreen}
                screens={screens}
                selectedId={selectedScreen?.id ?? BASE_SCREEN_ID}
              />
            )}
            <RobotReadinessCard
              camera={camera}
              connected={false}
              onOpenSetup={() => setConnectionOpen(true)}
            />
          </>
        }
      >
        <section className="camera-stage">
          <header className="camera-stage-header">
            <div className="camera-stage-title">
              <Typography.Title level={4} style={{ margin: 0 }}>
                {camera?.name ?? t('cameras')}
              </Typography.Title>
              {camera && (
                <div className="camera-stage-meta">
                  <Tag
                    color={
                      camera.stream?.state === 'running' ? 'green' : undefined
                    }
                  >
                    {t(cameraStateLabel(camera))}
                  </Tag>
                  {Boolean(camera.stream?.width && camera.stream?.height) && (
                    <Typography.Text type="secondary">
                      {camera.stream!.width} × {camera.stream!.height}
                    </Typography.Text>
                  )}
                </div>
              )}
            </div>
            <div className="camera-stage-actions">
              {selected && (
                <Button
                  icon={<ScanLine size={16} />}
                  onClick={() => setCalibrationOpen(true)}
                >
                  {t('detectScreenMarkers')}
                </Button>
              )}
              {hasCorrection && (
                <>
                  <Segmented
                    className="rv-segmented"
                    aria-label={t('cameraView')}
                    value={effectiveView}
                    onChange={(value) => setView(value as CameraView)}
                    options={[
                      { value: 'raw', label: t('rawView') },
                      { value: 'corrected', label: t('correctedView') },
                    ]}
                  />
                  <Button
                    danger
                    icon={<Eraser size={16} />}
                    loading={clearing}
                    onClick={confirmClearCorrection}
                  >
                    {t('clearCorrection')}
                  </Button>
                </>
              )}
              <Tooltip title={t('refresh')}>
                <Button
                  type="text"
                  aria-label={t('refresh')}
                  icon={<RefreshCw size={16} />}
                  loading={status === 'loading'}
                  onClick={() => {
                    setRevision((value) => value + 1);
                    setScreensRevision((value) => value + 1);
                    void refresh();
                  }}
                />
              </Tooltip>
            </div>
          </header>
          {error && <Alert type="error" showIcon message={error} />}
          {leaseError && <Alert type="error" showIcon message={leaseError} />}
          {screensError && (
            <Alert type="error" showIcon message={screensError} />
          )}
          <CameraStagePreview
            available={Boolean(url && !previewFailed)}
            outlines={effectiveView === 'raw' ? outlines : undefined}
            frameSize={
              effectiveView === 'corrected' && target ? target : undefined
            }
          >
            {url && camera ? (
              previewFailed ? (
                <Empty
                  description={t(
                    effectiveView === 'corrected'
                      ? 'correctedPreviewFailed'
                      : 'rawPreviewFailed',
                  )}
                />
              ) : (
                <img
                  ref={setPreviewImage}
                  key={url}
                  src={url}
                  className="stream-preview"
                  alt={camera.name}
                  onError={() => setFailedUrl(url)}
                  onLoad={(event) => {
                    const { naturalWidth: width, naturalHeight: height } =
                      event.currentTarget;
                    if (width && height)
                      setFrame((previous) =>
                        previous?.url === url &&
                        previous.width === width &&
                        previous.height === height
                          ? previous
                          : { url, width, height },
                      );
                  }}
                />
              )
            ) : !leaseReady ? (
              <Spin aria-label={t('cameraStarting')} />
            ) : clearing ? (
              <Spin aria-label={t('clearCorrection')} />
            ) : status === 'loading' ? (
              <Spin aria-label={t('loadingCameras')} />
            ) : (
              <Empty description={t('noCameras')} />
            )}
          </CameraStagePreview>
          {cameras.length > 0 && (
            <CameraRail
              entries={cameras.map((entry) =>
                camera && entry.id === camera.id ? camera : entry,
              )}
              selectedId={selectedId}
              onSelect={changeCamera}
            />
          )}
        </section>
      </WorkspaceLayout>
      <MultiDeviceCalibrationDialog
        cameraId={selected?.id ?? ''}
        cameraName={selected?.name ?? ''}
        onApplied={() => {
          setSelectedScreenId(BASE_SCREEN_ID);
          setCorrectionCleared(false);
          setView('raw');
          setFailedUrl(undefined);
          setRevision((value) => value + 1);
          setScreensRevision((value) => value + 1);
        }}
        onClose={() => setCalibrationOpen(false)}
        open={calibrationOpen && Boolean(selected)}
      />
      <RobotConnectionDialog
        open={connectionOpen}
        onClose={() => setConnectionOpen(false)}
      />
    </>
  );
}
