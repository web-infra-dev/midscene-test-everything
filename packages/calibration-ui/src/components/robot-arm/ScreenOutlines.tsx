import type { CalibrationPreviewPositions } from '@midscene/arm-kit-shared/assisted-contracts';
import type { CameraCorrection } from '@midscene/arm-kit-shared/contracts';
import { useLayoutEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { CalibrationPositionMarkers } from './CalibrationPositionMarkers';

/** One screen the camera already holds a perspective for. */
export interface ScreenOutlineEntry {
  id: string;
  name: string;
  correction: CameraCorrection;
  previewPositions?: CalibrationPreviewPositions;
  /** The screen the checklist is currently working on. */
  active?: boolean;
  validity?: 'valid' | 'invalid' | 'suspected' | 'unverified';
}

const corners = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;

function ScreenOutline({ outline }: { outline: ScreenOutlineEntry }) {
  const { name, correction, active, validity } = outline;
  const { sourceWidth: width, sourceHeight: height, points } = correction;
  const layer = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>();
  const centerX = (points.topLeft.x + points.topRight.x) / 2;
  const centerY = (points.topLeft.y + points.topRight.y) / 2;

  useLayoutEffect(() => {
    const element = layer.current;
    if (!element || !name) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const scale = Math.min(box.width / width, box.height / height);
      const offsetX = (box.width - width * scale) / 2;
      const offsetY = (box.height - height * scale) / 2;
      const clamp = (value: number, size: number, padding: number) => {
        const inset = Math.min(padding, size / 2);
        return Math.max(inset, Math.min(value, size - inset));
      };
      setPosition({
        left: offsetX + clamp(centerX * scale, width * scale, 10),
        top: offsetY + clamp(centerY * scale, height * scale, 4),
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [name, width, height, centerX, centerY]);

  return (
    <div
      className="camera-mapping-outline-layer"
      data-active={active === true}
      data-validity={validity}
      ref={layer}
    >
      <svg
        className="camera-mapping-outlines"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={name || t('Screen boundary')}
      >
        <polygon
          points={corners
            .map((corner) => `${points[corner].x},${points[corner].y}`)
            .join(' ')}
        />
      </svg>
      <CalibrationPositionMarkers
        correction={correction}
        positions={outline.previewPositions}
      />
      {name && (
        <span
          aria-hidden="true"
          className="camera-mapping-outline-label"
          style={position ?? { visibility: 'hidden' }}
        >
          {name}
        </span>
      )}
    </div>
  );
}

export function ScreenOutlines({
  outlines,
}: { outlines: readonly ScreenOutlineEntry[] }) {
  return (
    <>
      {outlines.map((outline) =>
        outline.correction.sourceWidth && outline.correction.sourceHeight ? (
          <ScreenOutline key={outline.id} outline={outline} />
        ) : null,
      )}
    </>
  );
}
