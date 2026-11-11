import type { ScreenAction } from '@midscene/arm-kit-shared/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PreviewScreenProjection } from '../preview/projection';

export type PreviewActionStatus =
  | 'preparing'
  | 'executing'
  | 'completed'
  | 'failed';

export interface PreviewActionFeedback {
  id: string;
  status: PreviewActionStatus;
  action: ScreenAction;
  targetName: string;
  target: PreviewScreenProjection;
  message?: string;
}

export interface PreviewControlError {
  message: string;
  code?: string;
}

export interface UsePreviewControlOptions {
  contextKey?: string;
  activeCalibrationId?: string;
  /** Confirm a gesture that physically switches to another calibrated screen. */
  confirmCrossScreen?: (
    target: PreviewScreenProjection,
    action: ScreenAction,
  ) => Promise<boolean>;
  onActionError?: (
    error: PreviewControlError,
    target: PreviewScreenProjection,
  ) => void;
  onCompleted?: () => void;
}

const actionLabel = (action: ScreenAction) => {
  switch (action.type) {
    case 'longPress':
      return 'long press';
    case 'swipe':
    case 'dragAndDrop':
      return 'swipe';
    default:
      return 'tap';
  }
};

export function usePreviewControl({
  contextKey,
  activeCalibrationId,
  confirmCrossScreen,
  onActionError,
  onCompleted,
}: UsePreviewControlOptions = {}) {
  const [feedback, setFeedback] = useState<PreviewActionFeedback>();
  const [error, setError] = useState<PreviewControlError>();
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  const executing = useRef(false);
  const context = useRef(contextKey);
  context.current = contextKey;
  useEffect(() => {
    setFeedback(undefined);
    setError(undefined);
    if (timer.current) clearTimeout(timer.current);
  }, [contextKey]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  const scheduleClear = useCallback((status: PreviewActionStatus) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => {
        if (mounted.current) setFeedback(undefined);
      },
      status === 'failed' ? 5000 : 1800,
    );
  }, []);
  const execute = useCallback(
    async (target: PreviewScreenProjection, action: ScreenAction) => {
      if (busy || executing.current) return;
      executing.current = true;
      setBusy(true);
      setError(undefined);
      if (timer.current) clearTimeout(timer.current);
      const id = crypto.randomUUID();
      const targetName = target.screen.name ?? target.screen.id;
      const publish = (status: PreviewActionStatus, message?: string) =>
        mounted.current &&
        context.current === contextKey &&
        setFeedback({
          id,
          status,
          action,
          targetName,
          target,
          message,
        });
      publish('preparing');
      try {
        if (
          confirmCrossScreen &&
          activeCalibrationId &&
          target.screen.calibrationId &&
          activeCalibrationId !== target.screen.calibrationId
        ) {
          const confirmed = await confirmCrossScreen(target, action);
          if (
            !confirmed ||
            !mounted.current ||
            context.current !== contextKey
          ) {
            if (mounted.current && context.current === contextKey)
              setFeedback(undefined);
            return;
          }
        }
        publish('executing');
        const response = await fetch(
          `/api/devices/${encodeURIComponent(target.screen.id)}/actions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action }),
          },
        );
        const value = await response.json().catch(() => ({}));
        if (!response.ok)
          throw Object.assign(
            new Error(
              value?.error?.message ??
                value?.error ??
                `HTTP ${response.status}`,
            ),
            { code: value?.code },
          );
        if (!mounted.current || context.current !== contextKey) return;
        publish('completed');
        scheduleClear('completed');
        onCompleted?.();
      } catch (cause) {
        if (!mounted.current || context.current !== contextKey) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        const code =
          cause && typeof cause === 'object' && 'code' in cause
            ? String(cause.code)
            : undefined;
        setError({ message, code });
        onActionError?.({ message, code }, target);
        publish('failed', `${actionLabel(action)} failed`);
        scheduleClear('failed');
      } finally {
        executing.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [
      activeCalibrationId,
      contextKey,
      busy,
      confirmCrossScreen,
      onActionError,
      onCompleted,
      scheduleClear,
    ],
  );
  return {
    execute,
    busy,
    feedback,
    error,
    clearError: () => setError(undefined),
  };
}
