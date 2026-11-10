import type { CameraCorrection } from '@midscene/arm-kit-shared/contracts';
import { Button } from 'antd';
import { Maximize, Minimize } from 'lucide-react';
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useLanguage } from '../i18n';
import { CameraScreenOutline } from './CameraScreenOutline';

export interface CameraStageOutline {
  id: string;
  name: string;
  correction: CameraCorrection;
  active?: boolean;
}

/**
 * The preview image uses object-fit: contain, while an SVG also preserves its
 * aspect ratio. HTML labels must use the resulting image rectangle, not the
 * full preview element, or letterboxing moves them away from their outline.
 */
export function fitPreviewContent(
  containerWidth: number,
  containerHeight: number,
  sourceWidth: number,
  sourceHeight: number,
) {
  if (
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    sourceWidth <= 0 ||
    sourceHeight <= 0
  )
    return undefined;
  const scale = Math.min(
    containerWidth / sourceWidth,
    containerHeight / sourceHeight,
  );
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    left: (containerWidth - width) / 2,
    top: (containerHeight - height) / 2,
    width,
    height,
  };
}

/** Keep the current stream attached while the operator inspects it full screen. */
export function CameraStagePreview({
  children,
  available = true,
  outlines,
  frameSize,
}: {
  children: ReactNode;
  available?: boolean;
  outlines?: readonly CameraStageOutline[];
  /** Crop frame dimensions (a rectified screen) instead of the camera frame. */
  frameSize?: { width: number; height: number };
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [native, setNative] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [contentBox, setContentBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>();
  const sourceWidth = outlines?.[0]?.correction.sourceWidth;
  const sourceHeight = outlines?.[0]?.correction.sourceHeight;
  useEffect(() => {
    const element = frame.current;
    if (!element || !sourceWidth || !sourceHeight) {
      setContentBox(undefined);
      return;
    }
    const measure = () => {
      const next = fitPreviewContent(
        element.clientWidth,
        element.clientHeight,
        sourceWidth,
        sourceHeight,
      );
      setContentBox((previous) =>
        previous &&
        next &&
        previous.left === next.left &&
        previous.top === next.top &&
        previous.width === next.width &&
        previous.height === next.height
          ? previous
          : next,
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [sourceWidth, sourceHeight, expanded, native]);
  useEffect(() => {
    const changed = () =>
      setNative(
        Boolean(frame.current && document.fullscreenElement === frame.current),
      );
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  useEffect(() => {
    if (!expanded) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [expanded]);
  const zh = useLanguage() === 'zh';
  const full = native || expanded;
  const label = full
    ? zh
      ? '退出全屏'
      : 'Exit full screen'
    : zh
      ? '全屏预览'
      : 'Full-screen preview';
  const toggle = async () => {
    if (native) await document.exitFullscreen();
    else if (expanded) setExpanded(false);
    else if (frame.current?.requestFullscreen) {
      try {
        await frame.current.requestFullscreen();
      } catch {
        setExpanded(true);
      }
    } else setExpanded(true);
  };
  const ratio = frameSize ? frameSize.width / frameSize.height : undefined;
  const fittedStyle = ratio
    ? ({
        '--rv-preview-aspect': String(ratio),
      } as CSSProperties)
    : undefined;
  return (
    <div
      ref={frame}
      className={`camera-stage-preview${expanded ? ' is-expanded' : ''}${ratio ? ' is-framed' : ''}`}
      style={fittedStyle}
    >
      {children}
      {outlines && available && outlines.length > 0 && (
        <div
          className="camera-stage-outlines"
          style={
            contentBox
              ? {
                  left: contentBox.left,
                  top: contentBox.top,
                  width: contentBox.width,
                  height: contentBox.height,
                  right: 'auto',
                  bottom: 'auto',
                }
              : undefined
          }
        >
          {outlines.map((item) => (
            <CameraScreenOutline
              active={item.active}
              imageHeight={item.correction.sourceHeight}
              imageWidth={item.correction.sourceWidth}
              key={item.id}
              label={item.name}
              points={item.correction.points}
              screenId={item.id}
            />
          ))}
        </div>
      )}
      {(available || full) && (
        <Button
          className="camera-fullscreen"
          size="small"
          aria-label={label}
          title={label}
          icon={full ? <Minimize size={16} /> : <Maximize size={16} />}
          onClick={() => void toggle()}
        />
      )}
    </div>
  );
}
