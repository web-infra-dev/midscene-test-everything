import { useEffect } from 'react';
import type { TwinScreenSnapshot } from '../../server/twin-types.js';
import { previewClientId } from '../camera-preview';
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

/**
 * Feeds every screen's corrected MJPEG into its canvas.
 *
 * The <img> elements must stay in the document: Chromium decodes the first
 * frame of a detached multipart image and then stops advancing it, which looks
 * exactly like a frozen 3D texture. They live in a 8 px, nearly transparent
 * holder so MJPEG keeps rendering without becoming visible UI. `complete` is
 * never used as a gate because an open multipart stream is never complete; the
 * natural width only proves that at least one frame has arrived.
 */
export function useScreenTextures(
  screens: readonly TwinScreenSnapshot[],
  canvases: Record<string, HTMLCanvasElement>,
  stageRef: { current: TwinStage | null },
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled || !screens.length) return;
    const client = previewClientId();
    const holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText =
      'position:fixed;left:0;top:0;width:8px;height:8px;overflow:hidden;' +
      'opacity:0.01;pointer-events:none;z-index:2147483647';
    document.body.appendChild(holder);

    let cancelled = false;
    const retries = new Set<number>();
    const images = screens.map((screen) => {
      const image = new Image();
      image.alt = '';
      image.decoding = 'async';
      holder.appendChild(image);
      const source = `${screen.previewUrl}${client ? `&client=${encodeURIComponent(client)}` : ''}`;
      const attach = () => {
        // A stopped camera ends the multipart response; opening it again is the
        // only way to resume, and the retry marker keeps the URL uncached.
        image.src = `${source}&retry=${Date.now()}`;
      };
      image.onerror = () => {
        if (cancelled) return;
        const timer = window.setTimeout(() => {
          retries.delete(timer);
          if (!cancelled) attach();
        }, 1500);
        retries.add(timer);
      };
      attach();
      return { screen, image };
    });

    const timer = window.setInterval(() => {
      const stage = stageRef.current;
      for (const { screen, image } of images) {
        if (!image.naturalWidth) continue;
        const canvas = canvases[screen.id];
        const context = canvas?.getContext('2d');
        if (!canvas || !context) continue;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        stage?.markScreenTexture(screen.id);
      }
    }, DRAW_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      for (const retry of retries) window.clearTimeout(retry);
      for (const { image } of images) image.src = '';
      holder.remove();
    };
  }, [screens, canvases, stageRef, enabled]);
}
