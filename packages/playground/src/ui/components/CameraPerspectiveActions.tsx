import type { PerspectiveTarget } from '@midscene/arm-kit-shared/camera/vision-types';
import type { CameraCorrection } from '@midscene/arm-kit-shared/contracts';
import { App, Button } from 'antd';
import { Eraser, ScanLine, SlidersHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CameraView } from '../camera-preview';
import type { CameraScreen } from '../cameras';
import { useLanguage, useT } from '../i18n';
import {
  PerspectiveCorrectionDialog,
  type PerspectiveDraft,
} from './PerspectiveCorrectionDialog';
import { ScreenMarkerPreview } from './ScreenMarkerPreview';

export function CameraPerspectiveActions({
  cameraId,
  screen,
  robot,
  disabled,
  onChanged,
}: {
  cameraId: string;
  screen: CameraScreen;
  robot?: { session: string; detect(): void };
  disabled: boolean;
  onChanged(view: CameraView): Promise<void>;
}) {
  const t = useT();
  const zh = useLanguage() === 'zh';
  const { message, modal } = App.useApp();
  const [draft, setDraft] = useState<PerspectiveDraft>();
  const [request, setRequest] = useState(0);
  const [loading, setLoading] = useState(false);
  const scope = useRef(new AbortController());
  const objectUrl = useRef<string>();
  useEffect(() => {
    const current = new AbortController();
    scope.current = current;
    return () => {
      current.abort();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);
  const identity = {
    id: cameraId,
    ...(robot && { session: robot.session, screen: screen.id }),
  };
  const signal = () =>
    AbortSignal.any([scope.current.signal, AbortSignal.timeout(30000)]);
  const detect = () => {
    setDraft(undefined);
    if (robot) robot.detect();
    else setRequest((n) => n + 1);
  };
  const edit = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/cameras/frame?id=${encodeURIComponent(cameraId)}`,
        { signal: signal() },
      );
      if (!response.ok) throw new Error((await response.json()).error);
      const blob = await response.blob();
      const frame = await createImageBitmap(blob);
      const { width, height } = frame;
      frame.close();
      if (scope.current.signal.aborted) return;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = URL.createObjectURL(blob);
      const saved = screen.correction;
      const correction =
        saved?.sourceWidth === width && saved.sourceHeight === height
          ? saved
          : {
              sourceWidth: width,
              sourceHeight: height,
              rotation: 0 as const,
              points: {
                topLeft: { x: width * 0.1, y: height * 0.1 },
                topRight: { x: width * 0.9, y: height * 0.1 },
                bottomLeft: { x: width * 0.1, y: height * 0.9 },
                bottomRight: { x: width * 0.9, y: height * 0.9 },
              },
            };
      setDraft({
        source: objectUrl.current,
        correction,
        screenWidthPx: screen.perspectiveTarget?.width ?? width,
        screenHeightPx: screen.perspectiveTarget?.height ?? height,
        rotation: screen.perspectiveTarget?.rotation ?? correction.rotation,
      });
    } catch (error) {
      if (!scope.current.signal.aborted) message.error(String(error));
    } finally {
      setLoading(false);
    }
  };
  const save = async (
    correction: CameraCorrection,
    target: PerspectiveTarget,
  ) => {
    const response = await fetch('/api/cameras/correction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...identity,
        ...(draft && 'evidence' in draft && { evidence: draft.evidence }),
        correction,
        perspectiveTarget: target,
      }),
      signal: signal(),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    if (scope.current.signal.aborted) return;
    await onChanged('corrected');
    setDraft(undefined);
    if (result.validity?.state === 'invalid')
      message.warning(t('correctionSavedWithWarning'));
    else message.success(t('correctionSaved'));
    if (result.mappingError) message.warning(result.mappingError);
  };
  return (
    <>
      {robot ? (
        <Button
          disabled={disabled}
          icon={<ScanLine size={16} />}
          onClick={detect}
        >
          {zh ? '识别屏幕标记' : 'Detect screen markers'}
        </Button>
      ) : (
        <ScreenMarkerPreview
          disabled={disabled}
          id={cameraId}
          name={screen.name}
          openRequest={request}
          onDetected={setDraft}
        />
      )}
      <Button
        disabled={disabled}
        loading={loading}
        icon={<SlidersHorizontal size={16} />}
        onClick={() => void edit()}
      >
        {zh ? '编辑透视' : 'Edit perspective'}
      </Button>
      {screen.hasCorrection && (
        <Button
          disabled={disabled}
          danger
          icon={<Eraser size={16} />}
          onClick={() =>
            modal.confirm({
              title: t('clearCorrectionTitle'),
              content: robot
                ? zh
                  ? '停止应用此屏幕的校正，并清除页面映射。已保存的透视将保留。'
                  : 'Clear the applied correction and page mapping for this screen. Its saved perspective is kept.'
                : t('clearCorrectionBody'),
              okText: t('clearCorrection'),
              okButtonProps: { danger: true },
              cancelText: zh ? '取消' : 'Cancel',
              onOk: async () => {
                if (scope.current.signal.aborted) return;
                const response = await fetch(
                  `/api/cameras/correction?${new URLSearchParams(identity)}`,
                  { method: 'DELETE', signal: signal() },
                );
                if (!response.ok) {
                  const error = new Error((await response.json()).error);
                  message.error(error.message);
                  throw error;
                }
                if (!scope.current.signal.aborted) await onChanged('raw');
              },
            })
          }
        >
          {t('clearCorrection')}
        </Button>
      )}
      <PerspectiveCorrectionDialog
        cameraName={screen.name}
        detection={draft}
        open={Boolean(draft)}
        onApply={save}
        onClose={() => setDraft(undefined)}
        onDetectAgain={detect}
      />
    </>
  );
}
