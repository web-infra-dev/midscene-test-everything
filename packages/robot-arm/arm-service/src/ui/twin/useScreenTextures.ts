import { useEffect } from 'react';
import type { TwinScreenSnapshot } from '../../server/twin-types.js';
import type { TwinStage } from './engine';

const MAX_TEXTURE_SIDE = 480;
const DRAW_INTERVAL_MS = 100;

/** One canvas per screen, sized to the corrected stream's aspect. */
export function createScreenCanvases(
  screens: readonly TwinScreenSnapshot[],
): Record<string, HTMLCanvasElement> {
  const canvases: Record<string, HTMLCanvasElement> = {};
  for (const screen of screens) {
    const canvas = document.createElement('canvas');
    const scale = Math.min(
      1,
      MAX_TEXTURE_SIDE / Math.max(screen.pixelWidth, screen.pixelHeight),
    );
    canvas.width = Math.max(2, Math.round(screen.pixelWidth * scale));
    canvas.height = Math.max(2, Math.round(screen.pixelHeight * scale));
    canvases[screen.id] = canvas;
  }
  return canvases;
}

export function useScreenTextures(
  screens: readonly TwinScreenSnapshot[],
  canvases: Record<string, HTMLCanvasElement>,
  stage: TwinStage | undefined,
) {
  useEffect(() => {
    if (!stage) return;
    const controller = new AbortController();
    const timers = new Set<number>();
    for (const screen of screens) {
      const canvas = canvases[screen.id];
      const context = canvas?.getContext('2d');
      if (!context) continue;
      // Request the next corrected JPEG only after this one has been drawn.
      // A slow camera cannot queue stale frames or stall another screen.
      const update = async () => {
        const started = performance.now();
        let delay: number;
        try {
          const response = await fetch(screen.frameUrl, {
            cache: 'no-store',
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(8000),
            ]),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const frame = await createImageBitmap(await response.blob());
          try {
            if (controller.signal.aborted) return;
            context.drawImage(frame, 0, 0, canvas.width, canvas.height);
            stage.markScreenTexture(screen.id);
          } finally {
            frame.close();
          }
          delay = Math.max(0, DRAW_INTERVAL_MS - (performance.now() - started));
        } catch {
          delay = 1500;
        }
        if (controller.signal.aborted) return;
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          void update();
        }, delay);
        timers.add(timer);
      };
      void update();
    }
    return () => {
      controller.abort();
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [screens, canvases, stage]);
}
