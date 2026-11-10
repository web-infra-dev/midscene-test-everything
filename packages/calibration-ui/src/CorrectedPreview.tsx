import type { CameraCorrection } from '@midscene/arm-kit-shared/contracts';
import { useEffect, useRef } from 'react';
import { t } from './i18n';
import { type PreviewPixels, rectifyPreview } from './rectify-preview';

/** The preview only needs enough pixels to fit the dialog panel. */
const MAX_PREVIEW_SIDE = 720;

export function CorrectedPreview({
  correction,
  size,
  src,
}: {
  correction: CameraCorrection;
  size: { width: number; height: number };
  src: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const decoded = useRef<PreviewPixels & { src: string }>();

  useEffect(() => {
    let cancelled = false;
    const paint = (source: PreviewPixels) => {
      const element = canvas.current;
      if (cancelled || !element) return;
      const scale = Math.min(
        1,
        MAX_PREVIEW_SIDE / Math.max(size.width, size.height),
      );
      const width = Math.max(1, Math.round(size.width * scale));
      const height = Math.max(1, Math.round(size.height * scale));
      try {
        const output = rectifyPreview(
          source,
          correction,
          width,
          height,
          correction.rotation ?? 0,
        );
        element.width = width;
        element.height = height;
        const context = element.getContext('2d');
        if (!context) return;
        const image = context.createImageData(width, height);
        image.data.set(output.data);
        context.putImageData(image, 0, 0);
      } catch {
        element.width = 0;
        element.height = 0;
      }
    };
    const cached = decoded.current;
    if (cached?.src === src) {
      paint(cached);
      return () => {
        cancelled = true;
      };
    }
    if (typeof Image === 'undefined') return;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const source = document.createElement('canvas');
      source.width = image.naturalWidth;
      source.height = image.naturalHeight;
      const context = source.getContext('2d', { willReadFrequently: true });
      if (!context || !source.width || !source.height) return;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(
        0,
        0,
        source.width,
        source.height,
      ).data;
      const value = {
        src,
        width: source.width,
        height: source.height,
        data: pixels,
      };
      decoded.current = value;
      paint(value);
    };
    image.src = src;
    return () => {
      cancelled = true;
      image.onload = null;
    };
  }, [correction, size, src]);

  return (
    <div className="range-output">
      <canvas
        ref={canvas}
        className="corrected-preview-canvas"
        role="img"
        aria-label={t('Corrected View')}
      />
    </div>
  );
}
