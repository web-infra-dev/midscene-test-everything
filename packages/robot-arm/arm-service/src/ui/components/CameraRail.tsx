import { Tag } from 'antd';
import { Video, VideoOff } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { cameraPreviewUrl } from '../camera-preview';
import { type CameraEntry, cameraStateLabel } from '../cameras';
import { useT } from '../i18n';
import { LiveCameraImage } from './LiveCameraImage';

function StageThumbnail({ image }: { image: HTMLImageElement }) {
  const thumbnail = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = thumbnail.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const draw = () => {
      const { naturalWidth, naturalHeight } = image;
      if (!image.isConnected || !naturalWidth || !naturalHeight) return;
      const scale = Math.min(1, 240 / Math.max(naturalWidth, naturalHeight));
      const width = Math.max(1, Math.round(naturalWidth * scale));
      const height = Math.max(1, Math.round(naturalHeight * scale));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      context.drawImage(image, 0, 0, width, height);
    };
    draw();
    const timer = window.setInterval(draw, 250);
    return () => window.clearInterval(timer);
  }, [image]);
  return <canvas aria-hidden ref={thumbnail} />;
}

export function CameraRail({
  id,
  entries,
  expanded = true,
  selectedId,
  selectedImage,
  onSelect,
}: {
  id?: string;
  entries: CameraEntry[];
  expanded?: boolean;
  selectedId: string | null;
  selectedImage?: HTMLImageElement;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  if (!expanded) return <div id={id} hidden />;

  return (
    <div id={id} aria-label={t('cameras')} className="camera-rail">
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
            {camera.stream?.state === 'running' ? (
              camera.id === selectedId ? (
                // Reuse the stage image without opening another MJPEG viewer.
                selectedImage ? (
                  <StageThumbnail image={selectedImage} />
                ) : (
                  <Video size={18} />
                )
              ) : (
                <LiveCameraImage
                  src={cameraPreviewUrl(camera.id, 'raw', 'rail')}
                  alt={camera.name}
                />
              )
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
