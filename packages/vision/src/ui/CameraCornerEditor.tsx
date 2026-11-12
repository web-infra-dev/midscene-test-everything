import type { CameraCorrection } from '@midscene/robotics-shared/contracts';
import { useRef } from 'react';
import { label as defaultLabel } from './labels.js';

const corners = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;
const labels = ['TL', 'TR', 'BR', 'BL'];

/** Screen rings and outline migrated from robot-vision's CalibrationPreview. */
export function CameraCornerEditor({
  value,
  src,
  disabled,
  onChange,
  onDragging,
  translate = defaultLabel,
}: {
  translate?: typeof defaultLabel;
  onDragging?(active: boolean): void;
  value: CameraCorrection;
  src: string;
  disabled: boolean;
  onChange?: (value: CameraCorrection) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ corner: (typeof corners)[number]; id: number }>();
  const pointAt = (x: number, y: number) => {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    return {
      x: Math.max(
        0,
        Math.min(
          value.sourceWidth - 1,
          ((x - rect.left) / rect.width) * value.sourceWidth,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          value.sourceHeight - 1,
          ((y - rect.top) / rect.height) * value.sourceHeight,
        ),
      ),
    };
  };
  const move = (corner: (typeof corners)[number], x: number, y: number) => {
    const point = pointAt(x, y);
    if (point && !disabled)
      onChange?.({ ...value, points: { ...value.points, [corner]: point } });
  };
  return (
    <figure className="camera-corner-editor">
      <div
        ref={frame}
        className="camera-corner-frame"
        style={{
          aspectRatio: `${value.sourceWidth} / ${value.sourceHeight}`,
          width: `min(100%, ${(100 * value.sourceWidth) / value.sourceHeight}cqh)`,
        }}
      >
        <img src={src} alt={translate('Reference View')} draggable={false} />
        <svg
          role="img"
          aria-label={translate('Screen outline')}
          viewBox={`0 0 ${value.sourceWidth} ${value.sourceHeight}`}
        >
          <title>{translate('Screen outline')}</title>
          <polygon
            points={corners
              .map(
                (corner) =>
                  `${value.points[corner].x},${value.points[corner].y}`,
              )
              .join(' ')}
          />
        </svg>
        {corners.map((corner, index) => (
          <button
            key={corner}
            type="button"
            disabled={disabled}
            aria-label={translate('Corner {0}', [translate(labels[index])])}
            style={{
              left: `${(value.points[corner].x / value.sourceWidth) * 100}%`,
              top: `${(value.points[corner].y / value.sourceHeight) * 100}%`,
            }}
            onPointerDown={(event) => {
              if (event.button !== 0 || drag.current) return;
              event.preventDefault();
              onDragging?.(true);
              drag.current = { corner, id: event.pointerId };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (drag.current?.id === event.pointerId)
                move(corner, event.clientX, event.clientY);
            }}
            onPointerUp={(event) => {
              if (drag.current?.id !== event.pointerId) return;
              move(corner, event.clientX, event.clientY);
              onDragging?.(false);
              drag.current = undefined;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              onDragging?.(false);
              drag.current = undefined;
            }}
            onLostPointerCapture={() => {
              onDragging?.(false);
              drag.current = undefined;
            }}
            onKeyDown={(event) => {
              const delta = (
                {
                  ArrowLeft: [-1, 0],
                  ArrowRight: [1, 0],
                  ArrowUp: [0, -1],
                  ArrowDown: [0, 1],
                } as Record<string, number[]>
              )[event.key];
              if (!delta || disabled) return;
              event.preventDefault();
              const step = event.shiftKey ? 10 : 1;
              onChange?.({
                ...value,
                points: {
                  ...value.points,
                  [corner]: {
                    x: Math.max(
                      0,
                      Math.min(
                        value.sourceWidth - 1,
                        value.points[corner].x + delta[0] * step,
                      ),
                    ),
                    y: Math.max(
                      0,
                      Math.min(
                        value.sourceHeight - 1,
                        value.points[corner].y + delta[1] * step,
                      ),
                    ),
                  },
                },
              });
            }}
          >
            <span className="camera-corner-ring" />
            <span className="camera-corner-label">
              {translate(labels[index])}
            </span>
          </button>
        ))}
      </div>
    </figure>
  );
}
