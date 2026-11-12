import type { CalibrationPreviewPositions } from '@midscene/robotics-shared/assisted-contracts';
import type { CameraCorrection } from '@midscene/robotics-shared/contracts';
import { useLayoutEffect, useRef, useState } from 'react';
import { t, useLanguage } from '../../i18n';

const markers = [
  {
    kind: 'reference',
    label: 'Calibration Reference Position',
    color: '#58d9ff',
  },
  { kind: 'safe', label: 'Safe Parking Position', color: '#ffcc66' },
  { kind: 'cameraBoundary', label: 'Camera-side Boundary', color: '#eab0ff' },
] as const;

export function CalibrationPositionMarkers({
  correction,
  positions,
}: {
  correction: CameraCorrection;
  positions?: CalibrationPreviewPositions;
}) {
  useLanguage();
  const { sourceWidth: width, sourceHeight: height } = correction;
  const layer = useRef<SVGSVGElement>(null);
  const [pixelSize, setPixelSize] = useState<number>();
  const located = markers.flatMap((marker) => {
    const point = positions?.[marker.kind];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
      return [];
    const outside =
      point.x < 0 || point.x >= width || point.y < 0 || point.y >= height;
    return [{ ...marker, point, outside }];
  });
  const visible = Boolean(width && height && located.length);
  useLayoutEffect(() => {
    const element = layer.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const scale = Math.min(box.width / width, box.height / height);
      if (scale > 0) setPixelSize(1 / scale);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible, width, height]);
  if (!visible) return null;
  const unit = pixelSize ?? Math.min(width, height) / 300;
  return (
    <svg
      ref={layer}
      className="calibration-position-markers"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={t('Calibration positions')}
    >
      {located.map(({ kind, label, color, point: p, outside }) => {
        const safe = kind === 'safe';
        const atEdge = outside && kind === 'cameraBoundary';
        const point = atEdge
          ? {
              x: Math.min(width - 10 * unit, Math.max(10 * unit, p.x)),
              y: Math.min(height - 10 * unit, Math.max(10 * unit, p.y)),
            }
          : p;
        const labelOnly = outside && !atEdge;
        const right = labelOnly || point.x > width / 2;
        const labelX = labelOnly
          ? width - 6 * unit
          : point.x + (right ? -8 : 8) * unit;
        const labelY = labelOnly
          ? safe
            ? height - 7 * unit
            : 15 * unit
          : Math.min(
              height - 4 * unit,
              Math.max(13 * unit, point.y + (safe ? 12 : -6) * unit),
            );
        return (
          <g key={kind} data-position={kind}>
            {!labelOnly && (
              <g
                transform={`translate(${point.x} ${point.y}) scale(${unit})`}
                fill={color}
                stroke="#152333"
                strokeWidth="1.5"
              >
                {kind === 'cameraBoundary' ? (
                  <path d="M0 -6L6 5H-6Z" />
                ) : safe ? (
                  <path d="M0 -6L6 0 0 6 -6 0Z" />
                ) : (
                  <circle r="5" />
                )}
                <circle r="1.5" fill="#152333" stroke="none" />
              </g>
            )}
            <text
              x={labelX}
              y={labelY}
              textAnchor={right ? 'end' : 'start'}
              fill={color}
              stroke="#152333"
              strokeWidth={3 * unit}
              strokeLinejoin="round"
              paintOrder="stroke"
              fontSize={12 * unit}
              fontWeight="600"
            >
              {outside ? t('{0} · outside frame', [t(label)]) : t(label)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
