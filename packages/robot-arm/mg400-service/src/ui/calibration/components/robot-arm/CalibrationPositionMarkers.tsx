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
  {
    kind: 'cameraBoundaryEnd',
    label: 'Camera-side Boundary B',
    color: '#eab0ff',
  },
] as const;

function boundaryOverlay(
  line: NonNullable<CalibrationPreviewPositions['cameraBoundaryLine']>,
  width: number,
  height: number,
) {
  const { start, end, allowed } = line;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const side = (p: { x: number; y: number }) =>
    dx * (p.y - start.y) - dy * (p.x - start.x);
  const sign = Math.sign(side(allowed));
  if (!sign) return;
  const frame = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const crossings: typeof frame = [];
  const forbidden = frame.flatMap((p, index) => {
    const q = frame[(index + 1) % frame.length];
    const a = sign * side(p);
    const b = sign * side(q);
    const polygon = a <= 0 ? [p] : [];
    if (a <= 0 !== b <= 0) {
      const fraction = a / (a - b);
      const hit = {
        x: p.x + (q.x - p.x) * fraction,
        y: p.y + (q.y - p.y) * fraction,
      };
      crossings.push(hit);
      polygon.push(hit);
    }
    return polygon;
  });
  return {
    crossings,
    forbidden,
    isForbidden: (p: { x: number; y: number }) => sign * side(p) < 0,
  };
}

export function CalibrationPositionMarkers({
  correction,
  positions,
  screenCorners,
}: {
  correction: CameraCorrection;
  positions?: CalibrationPreviewPositions;
  screenCorners?: readonly { x: number; y: number }[];
}) {
  useLanguage();
  const { sourceWidth: width, sourceHeight: height } = correction;
  const layer = useRef<SVGSVGElement>(null);
  const [pixelSize, setPixelSize] = useState<number>();
  const boundary = positions?.cameraBoundaryLine;
  const overlay = boundary && boundaryOverlay(boundary, width, height);
  const located = markers.flatMap((marker) => {
    const point = positions?.[marker.kind];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
      return [];
    const outside =
      point.x < 0 || point.x >= width || point.y < 0 || point.y >= height;
    const label =
      marker.kind === 'cameraBoundary' && positions?.cameraBoundaryEnd
        ? 'Camera-side Boundary A'
        : marker.label;
    return [{ ...marker, label, point, outside }];
  });
  const visible = Boolean(width && height && (located.length || overlay));
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
      {overlay && (
        <g aria-label={t('Forbidden side')}>
          <polygon
            points={overlay.forbidden.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="#ff4d4f"
            fillOpacity="0.16"
          />
          {overlay.crossings.length === 2 && (
            <line
              x1={overlay.crossings[0].x}
              y1={overlay.crossings[0].y}
              x2={overlay.crossings[1].x}
              y2={overlay.crossings[1].y}
              stroke="#eab0ff"
              strokeWidth={2 * unit}
              strokeDasharray={`${6 * unit} ${4 * unit}`}
            />
          )}
          {(screenCorners ?? Object.values(correction.points)).map((point) =>
            overlay.isForbidden(point) ? (
              <circle
                key={`${point.x},${point.y}`}
                cx={point.x}
                cy={point.y}
                r={4 * unit}
                fill="#ff4d4f"
                stroke="#fff"
                strokeWidth={unit}
              />
            ) : null,
          )}
        </g>
      )}
      {located.map(({ kind, label, color, point: p, outside }) => {
        const safe = kind === 'safe';
        const boundaryPoint =
          kind === 'cameraBoundary' || kind === 'cameraBoundaryEnd';
        const atEdge = outside && boundaryPoint;
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
                {boundaryPoint ? (
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
