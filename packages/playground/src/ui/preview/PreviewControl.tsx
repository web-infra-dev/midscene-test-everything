import { Alert } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import { LiveCameraImage } from '../components/LiveCameraImage';
import type { usePreviewControl } from '../hooks/usePreviewControl';
import { useLanguage } from '../i18n';
import { PreviewActionOverlay } from './PreviewActionOverlay';
import {
  PREVIEW_LONG_PRESS_MS,
  PreviewGesture,
  type PreviewGestureDraft,
} from './gesture';
import {
  type PreviewPoint,
  type PreviewScreenGeometry,
  createRectifiedProjection,
  createScreenProjections,
} from './projection';
import './PreviewControl.less';

export interface PreviewControlProps {
  cameraId: string;
  view: 'raw' | 'corrected';
  screens: readonly PreviewScreenGeometry[];
  activeScreenId?: string;
  src: string;
  alt: string;
  className?: string;
  onLoad?: React.ReactEventHandler<HTMLImageElement>;
  onError?: React.ReactEventHandler<HTMLImageElement>;
  available: boolean;
  longPressEnabled?: boolean;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  control: ReturnType<typeof usePreviewControl>;
}

export function PreviewControl({
  cameraId,
  view,
  screens,
  activeScreenId,
  src,
  alt,
  className,
  onLoad,
  onError,
  available,
  longPressEnabled = false,
  enabled,
  onEnabledChange,
  control,
}: PreviewControlProps) {
  const zh = useLanguage() === 'zh';
  const [natural, setNatural] = useState<{ width: number; height: number }>();
  const [draft, setDraft] = useState<PreviewGestureDraft>();
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const { execute, busy, feedback, error, clearError } = control;
  const projections = useMemo(() => {
    if (!natural) return [];
    if (view === 'corrected') {
      const screen = screens.find((item) => item.id === activeScreenId);
      return screen
        ? [
            {
              ...createRectifiedProjection(
                screen,
                natural.width,
                natural.height,
              ),
              screen,
            },
          ]
        : [];
    }
    return createScreenProjections(screens, natural.width, natural.height);
  }, [activeScreenId, natural, screens, view]);
  const projectionsKey = useMemo(
    () =>
      JSON.stringify(
        projections.map((projection) => [
          projection.screen.id,
          projection.screen.calibrationId,
          projection.width,
          projection.height,
        ]),
      ),
    [projections],
  );
  const gesture = useMemo(
    () =>
      new PreviewGesture({
        projections,
        activeId: activeScreenId,
        longPressEnabled,
      }),
    [activeScreenId, longPressEnabled, projections],
  );
  const enabledRef = useRef(enabled && available);
  enabledRef.current = enabled && available;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    if (enabled && available) return;
    gesture.cancel();
    setDraft(undefined);
    clearTimeout(longPressTimer.current);
  }, [enabled, available, gesture]);
  useEffect(() => {
    onEnabledChange(false);
  }, [cameraId, view, projectionsKey, onEnabledChange]);
  useEffect(() => {
    if (available || busy) return;
    onEnabledChange(false);
    setDraft(undefined);
    gesture.cancel();
  }, [available, busy, gesture, onEnabledChange]);
  useEffect(() => {
    // A changed correction or target must not inherit an in-flight gesture.
    gesture.cancel();
    setDraft(undefined);
  }, [gesture]);
  useEffect(() => {
    const cancel = () => {
      gesture.cancel();
      setDraft(undefined);
      clearTimeout(longPressTimer.current);
    };
    window.addEventListener('blur', cancel);
    const hidden = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', hidden);
      cancel();
    };
  }, [gesture]);
  const point = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!natural) return undefined;
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(
      rect.width / natural.width,
      rect.height / natural.height,
    );
    if (!(scale > 0)) return undefined;
    return {
      x:
        (event.clientX - rect.left - (rect.width - natural.width * scale) / 2) /
        scale,
      y:
        (event.clientY -
          rect.top -
          (rect.height - natural.height * scale) / 2) /
        scale,
    } satisfies PreviewPoint;
  };
  const clearHold = () => {
    clearTimeout(longPressTimer.current);
    longPressTimer.current = undefined;
  };
  const finish = (event: React.PointerEvent<HTMLImageElement>) => {
    const at =
      enabledRef.current && !busyRef.current ? point(event) : undefined;
    clearHold();
    if (at) {
      const result = gesture.end(event.pointerId, at, performance.now());
      setDraft(undefined);
      if (result) void execute(result.target, result.action);
    } else {
      gesture.cancel();
      setDraft(undefined);
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const down = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!enabledRef.current || busyRef.current) return;
    if (!event.isPrimary || event.button !== 0) return;
    const at = point(event);
    if (!at) return;
    const start = gesture.start(event.pointerId, at, performance.now());
    if (start.kind === 'ambiguous') {
      const chosen = start.preferred ?? start.hits[0];
      if (!chosen) return;
      gesture.choose(event.pointerId, at, performance.now(), chosen);
    }
    const target = gesture.screen;
    if (!target) return;
    setDraft(gesture.draft);
    event.currentTarget.setPointerCapture(event.pointerId);
    clearHold();
    longPressTimer.current = setTimeout(() => {
      if (!gesture.active) return;
      setDraft(gesture.tick(performance.now()));
    }, PREVIEW_LONG_PRESS_MS);
    if (event.cancelable) event.preventDefault();
  };
  const move = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!enabledRef.current || busyRef.current || !gesture.active) return;
    const at = point(event);
    if (!at) return;
    const next = gesture.move(event.pointerId, at, performance.now());
    setDraft(next);
    if (
      gesture.screen &&
      !event.currentTarget.hasPointerCapture?.(event.pointerId)
    )
      event.currentTarget.setPointerCapture(event.pointerId);
    if (next?.type === 'swipe') clearHold();
    if (event.cancelable) event.preventDefault();
  };
  const cancel = (event: React.PointerEvent<HTMLImageElement>) => {
    gesture.cancel();
    clearHold();
    setDraft(undefined);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const interaction = enabled && available && !busy;
  return (
    <>
      <LiveCameraImage
        alt={alt}
        className={className}
        draggable={false}
        onError={(event) => {
          setNatural(undefined);
          onError?.(event);
        }}
        onLoad={(event) => {
          const { naturalWidth: width, naturalHeight: height } =
            event.currentTarget;
          if (width && height) setNatural({ width, height });
          onLoad?.(event);
        }}
        onPointerCancel={cancel}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={finish}
        onLostPointerCapture={(event) => {
          if (gesture.active) cancel(event);
        }}
        src={src}
        style={
          interaction
            ? {
                cursor: 'crosshair',
                touchAction: 'none',
                userSelect: 'none',
              }
            : undefined
        }
      />
      {natural && (draft || feedback) ? (
        <PreviewActionOverlay
          draft={draft}
          feedback={draft ? undefined : feedback}
          projection={
            (draft ? undefined : feedback?.target) ??
            gesture.screen ??
            projections.find((item) => item.screen.id === activeScreenId) ??
            projections[0] ??
            projectionForNatural(natural)
          }
        />
      ) : null}
      {error ? (
        <Alert
          role="alert"
          className="preview-control-error"
          type="error"
          showIcon
          closable
          onClose={clearError}
          message={
            error.code === 'TRANSFER_REQUIRED' ||
            error.code === 'TRANSFER_STALE'
              ? zh
                ? '需要先验证设备切换路径，再点击目标屏幕。'
                : 'Validate the device transfer route before touching this screen.'
              : error.code === 'POSITION_UNKNOWN'
                ? zh
                  ? '机械臂位置未知，请先完成恢复或重新标定。'
                  : 'The arm position is unknown. Recover or recalibrate first.'
                : error.message
          }
        />
      ) : null}
    </>
  );
}

function projectionForNatural(natural: { width: number; height: number }) {
  return {
    width: natural.width,
    height: natural.height,
    contains: () => false,
    toScreen: (point: PreviewPoint) => point,
    toImage: (point: PreviewPoint) => point,
    clipSegment: () => undefined,
  };
}
