import { Tag } from 'antd';
import { Video, VideoOff } from 'lucide-react';
import { cameraPreviewUrl } from '../camera-preview';
import { type CameraEntry, cameraStateLabel } from '../cameras';
import { useT } from '../i18n';
import { LiveCameraImage } from './LiveCameraImage';

export function CameraRail({
  entries,
  selectedId,
  onSelect,
}: {
  entries: CameraEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  return (
    <div aria-label={t('cameras')} className="camera-rail">
      {entries.map((camera) => (
        <button
          aria-current={camera.id === selectedId}
          aria-label={camera.name}
          className={`camera-rail-item${camera.id === selectedId ? ' is-active' : ''}`}
          key={camera.id}
          onClick={() => onSelect(camera.id)}
          type="button"
        >
          <span className="camera-rail-thumb">
            {camera.id === selectedId ? (
              camera.stream?.state === 'running' ? (
                <Video size={18} />
              ) : (
                <VideoOff size={18} />
              )
            ) : camera.stream?.state === 'running' ? (
              // The stage already owns the selected camera's preview stream.
              <LiveCameraImage
                src={cameraPreviewUrl(camera.id, 'raw', 'rail')}
                alt={camera.name}
              />
            ) : (
              <VideoOff size={18} />
            )}
          </span>
          <span className="camera-rail-meta">
            <span className="camera-rail-name" title={camera.name}>
              {camera.name}
            </span>
            <Tag
              color={camera.stream?.state === 'running' ? 'green' : undefined}
            >
              {t(cameraStateLabel(camera))}
            </Tag>
          </span>
        </button>
      ))}
    </div>
  );
}
