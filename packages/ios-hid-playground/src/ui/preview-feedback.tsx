import {
  type PreviewAction,
  PreviewActionOverlay,
  type PreviewFeedbackStatus,
} from '@midscene/preview-controls';
import '@midscene/preview-controls/styles.css';
import { createRoot } from 'react-dom/client';

type Point = { x: number; y: number };
type Feedback = { action: PreviewAction; status?: PreviewFeedbackStatus };
const interactionSelector = '[data-midscene-device-interaction-layer="true"]';

function actionFromRequest(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method !== 'POST' || typeof init.body !== 'string') return;
  try {
    const url = new URL(
      input instanceof Request ? input.url : input,
      location.href,
    );
    if (url.origin !== location.origin || url.pathname !== '/interact') return;
    const { actionType, x, y, endX, endY } = JSON.parse(init.body);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (actionType === 'Tap') return { type: 'tap', point: { x, y } } as const;
    if (
      (actionType === 'Swipe' || actionType === 'DragAndDrop') &&
      Number.isFinite(endX) &&
      Number.isFinite(endY)
    )
      return {
        type: 'swipe',
        from: { x, y },
        to: { x: endX, y: endY },
      } as const;
  } catch {
    // Let Playground handle malformed requests.
  }
}

export function mountPreviewFeedback(playground: HTMLElement) {
  const host = document.createElement('div');
  host.className = 'hid-preview-feedback';
  const root = createRoot(host);
  let layer: HTMLElement | null = null;
  let feedback: Feedback | undefined;
  let timer: number | undefined;
  let gesture:
    | { id: number; start: Point; clientX: number; clientY: number }
    | undefined;

  function image() {
    return layer?.parentElement?.querySelector<HTMLImageElement>(
      '.screenshot-content img.screenshot-image',
    );
  }

  function render(next?: Feedback) {
    feedback = next;
    const frame = image();
    root.render(
      next && frame?.naturalWidth && frame.naturalHeight ? (
        <PreviewActionOverlay
          width={frame.naturalWidth}
          height={frame.naturalHeight}
          action={next.action}
          status={next.status}
          language={
            document.documentElement.lang.startsWith('en') ? 'en' : 'zh'
          }
        />
      ) : null,
    );
  }

  function clearAfter(ms: number) {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => render(), ms);
  }

  function point(event: PointerEvent, clamp: boolean) {
    const frame = image();
    const rect = frame?.closest('.screenshot-content')?.getBoundingClientRect();
    if (
      !frame?.naturalWidth ||
      !frame.naturalHeight ||
      !rect?.width ||
      !rect.height
    )
      return;
    const scale = Math.min(
      rect.width / frame.naturalWidth,
      rect.height / frame.naturalHeight,
    );
    const x =
      (event.clientX -
        rect.left -
        (rect.width - frame.naturalWidth * scale) / 2) /
      scale;
    const y =
      (event.clientY -
        rect.top -
        (rect.height - frame.naturalHeight * scale) / 2) /
      scale;
    if (
      !clamp &&
      (x < 0 || y < 0 || x >= frame.naturalWidth || y >= frame.naturalHeight)
    )
      return;
    return {
      x: Math.max(0, Math.min(frame.naturalWidth - 1, Math.round(x))),
      y: Math.max(0, Math.min(frame.naturalHeight - 1, Math.round(y))),
    };
  }

  playground.addEventListener(
    'pointerdown',
    (event) => {
      if (
        !layer ||
        !layer.contains(event.target as Node) ||
        event.button !== 0 ||
        gesture ||
        feedback?.status === 'executing'
      )
        return;
      const start = point(event, false);
      if (!start) return;
      window.clearTimeout(timer);
      gesture = {
        id: event.pointerId,
        start,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      render({ action: { type: 'tap', point: start } });
    },
    true,
  );
  playground.addEventListener(
    'pointermove',
    (event) => {
      if (gesture?.id !== event.pointerId) return;
      if (
        Math.hypot(
          event.clientX - gesture.clientX,
          event.clientY - gesture.clientY,
        ) <= 8
      ) {
        if (feedback?.action.type === 'swipe')
          render({ action: { type: 'tap', point: gesture.start } });
        return;
      }
      const end = point(event, true);
      if (end)
        render({ action: { type: 'swipe', from: gesture.start, to: end } });
    },
    true,
  );
  playground.addEventListener(
    'pointerup',
    (event) => {
      if (gesture?.id !== event.pointerId) return;
      gesture = undefined;
      clearAfter(250);
    },
    true,
  );
  playground.addEventListener(
    'pointercancel',
    (event) => {
      if (gesture?.id !== event.pointerId) return;
      gesture = undefined;
      render();
    },
    true,
  );

  const mount = () => {
    const next = playground.querySelector<HTMLElement>(interactionSelector);
    if (next === layer) return;
    layer = next;
    gesture = undefined;
    window.clearTimeout(timer);
    render();
    if (layer) layer.append(host);
    else host.remove();
  };
  new MutationObserver(mount).observe(playground, {
    childList: true,
    subtree: true,
  });
  mount();

  // The prebuilt Playground has no interaction callback. Observe its own
  // request and response so the feedback uses the coordinates it actually sends.
  const fetchFromPlayground = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const action = layer && actionFromRequest(input, init);
    if (!action) return fetchFromPlayground(input, init);
    window.clearTimeout(timer);
    const pending: Feedback = { action, status: 'executing' };
    render(pending);
    const finish = (ok: boolean) => {
      if (feedback !== pending) return;
      render({ action, status: ok ? 'completed' : 'failed' });
      clearAfter(ok ? 1800 : 5000);
    };
    try {
      const response = await fetchFromPlayground(input, init);
      finish(response.ok);
      return response;
    } catch (error) {
      finish(false);
      throw error;
    }
  };
}
