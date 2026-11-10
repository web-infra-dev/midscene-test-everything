import type { ScreenQuad } from '@midscene/arm-kit-shared/camera/vision-types';
import { useLanguage } from '../i18n';

/**
 * Ported verbatim from the private robot-vision screen outline: the label sits
 * on the inside of the top edge instead of floating above the quadrilateral.
 */
export function CameraScreenOutline({
  points,
  imageWidth,
  imageHeight,
  screenId,
  label,
  active = true,
}: {
  points: ScreenQuad;
  imageWidth: number;
  imageHeight: number;
  screenId?: string;
  label?: string;
  active?: boolean;
}) {
  const zh = useLanguage() === 'zh';
  const ordered = [
    points.topLeft,
    points.topRight,
    points.bottomRight,
    points.bottomLeft,
  ];
  const polygon = ordered.map((point) => `${point.x},${point.y}`).join(' ');
  // The label belongs to the phone's own top edge, not the visually highest
  // edge in the camera image. A portrait screen seen sideways therefore keeps
  // its label on the narrow top edge (topLeft -> topRight).
  const labelX =
    ((points.topLeft.x + points.topRight.x) / 2 / imageWidth) * 100;
  const labelY =
    ((points.topLeft.y + points.topRight.y) / 2 / imageHeight) * 100;
  const labelPosition = {
    left: `${Math.min(90, Math.max(10, labelX)).toFixed(2)}%`,
    top: `${Math.min(92, Math.max(3, labelY)).toFixed(2)}%`,
  };

  return (
    <>
      <svg
        aria-label={label ?? (zh ? '屏幕边界' : 'Screen boundary')}
        className={`screen-outline${active ? ' screen-outline--active' : ''}`}
        data-screen-id={screenId}
        role="img"
        viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      >
        <polygon points={polygon} />
      </svg>
      {label ? (
        <span
          aria-hidden="true"
          className={`screen-outline-label${active ? ' screen-outline-label--active' : ''}`}
          style={labelPosition}
        >
          {label}
        </span>
      ) : null}
    </>
  );
}
