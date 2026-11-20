import type { CalibrationPreviewPositions } from '@midscene/robotics-shared/assisted-contracts';
import type { CameraCorrection } from '@midscene/robotics-shared/contracts';
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

export interface ScreenOutlineLabelPlacement {
  left: number;
  top: number;
  angle: number;
}

const corners = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;

/**
 * Place the screen name on the screen's own top edge, as defined by the
 * perspective correction: topLeft→topRight, centered on its midpoint and
 * turned parallel to it. The phone may lie sideways in the camera, so this
 * edge can appear on any side of the raw preview; the corrected screen is the
 * reference, not whichever edge happens to look highest on the page.
 */
export function screenOutlineLabelPlacement(
  correction: CameraCorrection,
  box: { width: number; height: number },
): ScreenOutlineLabelPlacement | undefined {
  const { sourceWidth: width, sourceHeight: height, points } = correction;
  if (!width || !height || !box.width || !box.height) return undefined;
  const scale = Math.min(box.width / width, box.height / height);
  const offsetX = (box.width - width * scale) / 2;
  const offsetY = (box.height - height * scale) / 2;
  const { topLeft, topRight } = points;
  const angle =
    (Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x) * 180) /
    Math.PI;
  return {
    left: offsetX + ((topLeft.x + topRight.x) / 2) * scale,
    top: offsetY + ((topLeft.y + topRight.y) / 2) * scale,
    // The edge is undirected; keep the text from reading upside down.
    angle: angle > 90 ? angle - 180 : angle < -90 ? angle + 180 : angle,
  };
}

function ScreenOutline({
  outline,
  screenCorners,
}: {
  outline: ScreenOutlineEntry;
  screenCorners?: readonly { x: number; y: number }[];
}) {
  const { name, correction, active, validity } = outline;
  const { sourceWidth: width, sourceHeight: height, points } = correction;
  const layer = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<ScreenOutlineLabelPlacement>();

  useLayoutEffect(() => {
    const element = layer.current;
    if (!element || !name) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const next = screenOutlineLabelPlacement(correction, box);
      if (next) setPlacement(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [name, correction]);

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
        screenCorners={screenCorners}
      />
      {name && (
        <span
          aria-hidden="true"
          className="camera-mapping-outline-label"
          style={
            placement
              ? {
                  left: placement.left,
                  top: placement.top,
                  transform: `translate(-50%, -50%) rotate(${placement.angle}deg)`,
                }
              : { visibility: 'hidden' }
          }
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
          <ScreenOutline
            key={outline.id}
            outline={outline}
            screenCorners={
              outline.previewPositions?.cameraBoundaryLine
                ? outlines.flatMap(({ correction, validity }) =>
                    validity !== 'invalid' &&
                    correction.sourceWidth === outline.correction.sourceWidth &&
                    correction.sourceHeight === outline.correction.sourceHeight
                      ? Object.values(correction.points)
                      : [],
                  )
                : undefined
            }
          />
        ) : null,
      )}
    </>
  );
}
