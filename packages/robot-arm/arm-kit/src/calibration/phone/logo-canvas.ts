import type { CalibrationLogoStatus } from '../../assisted-contracts.js';

/** Serialized into the calibration page, so keep the implementation self-contained. */
export function mountLogoCanvas(
  canvas: HTMLCanvasElement,
  signature: HTMLElement,
  error: HTMLElement,
  onPaint: () => void,
  onTouch?: (event: PointerEvent, stroke: number, canvasAck: string) => void,
) {
  const ink = canvas.getContext('2d');
  let run: CalibrationLogoStatus | undefined;
  let painted: string | undefined;
  let pointer: number | undefined;
  let points: [number, number][] = [];
  const strokes: { points: [number, number][]; valid: boolean }[] = [];
  let strokeExtent = 0;

  const showResult = () => {
    const signed =
      run?.state === 'completed' &&
      pointer === undefined &&
      strokes.length === run.expectedStrokes &&
      strokes.every((stroke) => stroke.valid);
    signature.setAttribute('aria-hidden', String(!signed));
    const warning =
      run?.state === 'failed'
        ? (run.error ?? 'Logo drawing stopped')
        : run?.state === 'completed' && pointer === undefined && !signed
          ? 'Check the drawing'
          : '';
    error.textContent = warning;
    error.hidden = !warning;
  };
  const point = (event: PointerEvent): [number, number] => {
    const bounds = canvas.getBoundingClientRect();
    return [event.clientX - bounds.left, event.clientY - bounds.top];
  };
  const retryAck = (status: CalibrationLogoStatus) =>
    `${status.id}:${status.retryFromStroke}`;
  const applyRetry = () => {
    if (
      !ink ||
      !run ||
      run.state !== 'drawing' ||
      run.retryFromStroke === undefined ||
      !painted ||
      painted === retryAck(run) ||
      pointer !== undefined
    )
      return;
    const confirmed = run.retryFromStroke - 1;
    if (
      !Number.isInteger(confirmed) ||
      confirmed < 0 ||
      confirmed >= run.expectedStrokes ||
      confirmed > strokes.length ||
      strokes.slice(0, confirmed).some((stroke) => !stroke.valid)
    )
      return;
    strokes.length = confirmed;
    ink.save();
    ink.setTransform(1, 0, 0, 1, 0, 0);
    ink.clearRect(0, 0, canvas.width, canvas.height);
    ink.restore();
    for (const stroke of strokes) {
      ink.beginPath();
      ink.moveTo(...stroke.points[0]);
      for (const position of stroke.points.slice(1)) ink.lineTo(...position);
      ink.stroke();
    }
    painted = retryAck(run);
    onPaint();
  };
  canvas.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    if (
      !ink ||
      !painted ||
      run?.state !== 'drawing' ||
      pointer !== undefined ||
      (run.retryFromStroke !== undefined && painted !== retryAck(run))
    )
      return;
    event.preventDefault();
    pointer = event.pointerId;
    canvas.setPointerCapture(pointer);
    points = [point(event)];
    strokeExtent = 0;
    ink.beginPath();
    ink.moveTo(...points[0]);
    onTouch?.(event, strokes.length + 1, painted);
  });
  canvas.addEventListener('pointermove', (event) => {
    event.stopPropagation();
    if (!ink || pointer !== event.pointerId) return;
    const samples = event.getCoalescedEvents?.();
    for (const sample of samples?.length ? samples : [event]) {
      const position = point(sample);
      ink.lineTo(...position);
      points.push(position);
      const start = points[0];
      strokeExtent = Math.max(
        strokeExtent,
        Math.hypot(position[0] - start[0], position[1] - start[1]),
      );
    }
    ink.stroke();
    ink.beginPath();
    ink.moveTo(...point(event));
  });
  const finish = (event: PointerEvent) => {
    event.stopPropagation();
    if (!ink || pointer !== event.pointerId) return;
    pointer = undefined;
    let valid = false;
    if (event.type === 'pointerup') {
      const end = point(event);
      ink.lineTo(...end);
      ink.stroke();
      const start = points[0];
      points.push(end);
      valid =
        strokeExtent >= 4 &&
        Math.hypot(end[0] - start[0], end[1] - start[1]) <= 12;
    }
    strokes.push({ points, valid });
    if (painted) onTouch?.(event, strokes.length, painted);
    points = [];
    applyRetry();
    showResult();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  canvas.addEventListener('lostpointercapture', finish);

  return {
    supported: Boolean(ink),
    get painted() {
      return painted;
    },
    show(next?: CalibrationLogoStatus) {
      const changed = run?.id !== next?.id;
      run = next;
      canvas.hidden = !run;
      if (changed) {
        painted = undefined;
        strokes.length = 0;
        pointer = undefined;
        points = [];
        if (ink && next) {
          const bounds = canvas.getBoundingClientRect();
          if (bounds.width > 0 && bounds.height > 0) {
            const scale = Math.min(devicePixelRatio || 1, 2);
            canvas.width = Math.round(bounds.width * scale);
            canvas.height = Math.round(bounds.height * scale);
            ink.setTransform(scale, 0, 0, scale, 0, 0);
            ink.lineCap = ink.lineJoin = 'round';
            ink.lineWidth = 2.5;
            ink.strokeStyle = '#f8fafc';
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                if (run?.id !== next.id || run.state !== 'drawing') return;
                painted = next.id;
                onPaint();
              }),
            );
          }
        }
      }
      applyRetry();
      showResult();
    },
  };
}
