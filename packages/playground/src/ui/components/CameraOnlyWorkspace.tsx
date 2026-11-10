import type { PerspectiveTarget } from '@midscene/arm-kit-shared/camera/vision-types';
import type { CameraCorrection } from '@midscene/arm-kit-shared/contracts';
import {
  Alert,
  App,
  Button,
  Empty,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cameraPreviewUrl } from '../camera-preview';
import { type CameraEntry, cameraStateLabel, useCameras } from '../cameras';
import { useT } from '../i18n';
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

export function CameraOnlyWorkspace() {
  const t = useT();
  const { message } = App.useApp();
  const { cameras, selectedId, status, select, refresh, error } = useCameras();
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [detection, setDetection] = useState<CameraMarkerDetection>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [markerOpenRequest, setMarkerOpenRequest] = useState(0);
  const [revision, setRevision] = useState(0);
  const [failedUrl, setFailedUrl] = useState<string>();
  const [frame, setFrame] = useState<{
    url: string;
    width: number;
    height: number;
  }>();
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const selected = cameras.find((camera) => camera.id === selectedId);
  const url =
    selected && `${cameraPreviewUrl(selected.id)}&revision=${revision}`;
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
  const clearCorrection = () => {
    setDetection(undefined);
    setEditorOpen(false);
  };
  const changeCamera = (id: string) => {
    select(id);
    clearCorrection();
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
    clearCorrection();
    message.success(t('correctionSaved'));
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
                  onDetected={(next) => {
                    setDetection(next);
                    setEditorOpen(true);
                  }}
                />
              )}
              <Tooltip title={t('refresh')}>
                <Button
                  type="text"
                  aria-label={t('refresh')}
                  icon={<RefreshCw size={16} />}
                  loading={status === 'loading'}
                  onClick={() => {
                    setRevision((value) => value + 1);
                    clearCorrection();
                    void refresh();
                  }}
                />
              </Tooltip>
            </div>
          </header>
          {error && <Alert type="error" showIcon message={error} />}
          <CameraStagePreview
            available={Boolean(url && !previewFailed)}
            outline={selected ? detection?.correction : undefined}
          >
            {url && camera ? (
              previewFailed ? (
                <Empty description={t('rawPreviewFailed')} />
              ) : (
                <img
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
              selectedPreviewUrl={url}
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
