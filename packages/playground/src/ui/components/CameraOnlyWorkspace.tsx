import type { PerspectiveTarget } from '@midscene/arm-kit-shared/camera/vision-types';
import type { CameraCorrection } from '@midscene/arm-kit-shared/contracts';
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
import { Eraser, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type CameraView, cameraPreviewUrl } from '../camera-preview';
import { type CameraEntry, cameraStateLabel, useCameras } from '../cameras';
import { useLanguage, useT } from '../i18n';
import { CameraRail } from './CameraRail';
import { CameraStagePreview } from './CameraStagePreview';
import { PerspectiveCorrectionDialog } from './PerspectiveCorrectionDialog';
import { RobotConnectionDialog } from './RobotConnectionDialog';
import { RobotReadinessCard } from './RobotReadinessCard';
import {
  type CameraMarkerDetection,
  ScreenMarkerPreview,
} from './ScreenMarkerPreview';
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
    markCorrection,
    markCorrectionCleared,
  } = useCameras();
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [detection, setDetection] = useState<CameraMarkerDetection>();
  const [saved, setSaved] = useState<{
    correction: CameraCorrection;
    target: PerspectiveTarget;
  }>();
  const [correctionCleared, setCorrectionCleared] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [previewSuspended, setPreviewSuspended] = useState(false);
  const [leaseReady, setLeaseReady] = useState(false);
  const [leaseError, setLeaseError] = useState<string>();
  const [view, setView] = useState<CameraView>('raw');
  const [editorOpen, setEditorOpen] = useState(false);
  const [markerOpenRequest, setMarkerOpenRequest] = useState(0);
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
  const hasCorrection =
    !correctionCleared && Boolean(saved ?? selected?.hasCorrection);
  const effectiveView: CameraView =
    view === 'corrected' && hasCorrection ? 'corrected' : 'raw';
  const target = hasCorrection
    ? (saved?.target ?? selected?.perspectiveTarget)
    : undefined;
  const url =
    previewSuspended || !leaseReady || !selected
      ? undefined
      : `${cameraPreviewUrl(selected.id, effectiveView)}&revision=${revision}`;
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
  const dismissDetection = () => {
    setDetection(undefined);
    setEditorOpen(false);
  };
  const changeCamera = (id: string) => {
    select(id);
    dismissDetection();
    setSaved(undefined);
    setCorrectionCleared(false);
    setClearing(false);
    setView('raw');
  };
  const saveCorrection = async (
    correction: CameraCorrection,
    target: PerspectiveTarget,
  ) => {
    if (!selected || !detection) return;
    const response = await fetch('/api/cameras/correction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: selected.id,
        correction,
        perspectiveTarget: target,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? result.error);
    // Keep the accepted result in the stage: switch to the corrected stream and
    // frame it with the saved output size instead of leaving the raw camera shot.
    setSaved({ correction, target });
    markCorrection(selected.id, target);
    setCorrectionCleared(false);
    setDetection(undefined);
    setEditorOpen(false);
    setView('corrected');
    setRevision((value) => value + 1);
    message.success(t('correctionSaved'));
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
        `/api/cameras/correction?id=${encodeURIComponent(id)}`,
        { method: 'DELETE', signal: AbortSignal.timeout(10000) },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.error?.message ?? result.error ?? 'Failed');
      setSaved(undefined);
      setDetection(undefined);
      setEditorOpen(false);
      setCorrectionCleared(true);
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
          <RobotReadinessCard
            camera={camera}
            connected={false}
            onOpenSetup={() => setConnectionOpen(true)}
          />
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
                <ScreenMarkerPreview
                  key={selected.id}
                  id={selected.id}
                  name={selected.name}
                  openRequest={markerOpenRequest}
                  onOpenChange={(open) => {
                    if (open) setView('raw');
                  }}
                  onDetected={(next) => {
                    // Keep the raw stream (and close the rectified one) while
                    // the operator edits corners; the corrected view returns on
                    // Apply.
                    setView('raw');
                    setDetection(next);
                    setEditorOpen(true);
                  }}
                />
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
                    dismissDetection();
                    void refresh();
                  }}
                />
              </Tooltip>
            </div>
          </header>
          {error && <Alert type="error" showIcon message={error} />}
          {leaseError && <Alert type="error" showIcon message={leaseError} />}
          <CameraStagePreview
            available={Boolean(url && !previewFailed)}
            outline={
              effectiveView === 'raw'
                ? (detection?.correction ??
                  (hasCorrection ? saved?.correction : undefined))
                : undefined
            }
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
      <PerspectiveCorrectionDialog
        cameraName={selected?.name ?? ''}
        detection={detection}
        onApply={saveCorrection}
        onClose={() => setEditorOpen(false)}
        onDetectAgain={() => {
          setEditorOpen(false);
          setDetection(undefined);
          setMarkerOpenRequest((value) => value + 1);
        }}
        open={editorOpen && Boolean(detection)}
      />
      <RobotConnectionDialog
        open={connectionOpen}
        onClose={() => setConnectionOpen(false)}
      />
    </>
  );
}
