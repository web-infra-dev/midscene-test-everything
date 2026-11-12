import { IconArrowLeft } from '@arco-design/web-react/icon';
import { armUiTheme } from '@midscene/robotics-shared';
import type {
  CalibrationPageLayout,
  CalibrationPhoneStatus,
  CameraMappingAccuracy,
} from '@midscene/robotics-shared/assisted-contracts';
import type { CameraCorrection } from '@midscene/robotics-shared/contracts';
import {
  Alert,
  Button,
  ConfigProvider,
  Select,
  Space,
  Spin,
  Steps,
} from 'antd';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CameraDevice } from '../camera/types.js';
import type { CameraScreenSettings } from '../screen.js';
import { CameraCornerEditor } from './CameraCornerEditor.js';
import { CameraCorrectionStep } from './CameraCorrectionStep.js';
import { CorrectedPreview } from './CorrectedPreview.js';
import { PhonePairStep } from './PhonePairStep.js';
import { ScreenMappingView } from './ScreenMappingView.js';
import { zh } from './locales/zh.js';

const t = (message: string, values: readonly unknown[] = []) =>
  (zh[message] ?? message).replace(/\{(\d+)\}/g, (match, index) =>
    Number(index) < values.length ? String(values[Number(index)]) : match,
  );
interface State {
  selectedCameraId?: string;
  cameras: CameraDevice[];
  initialValue?: CameraScreenSettings;
  phone: CalibrationPhoneStatus;
  layout?: CalibrationPageLayout;
  phoneConnected: boolean;
}
export interface CameraSetupProps {
  selectedCameraId?: string;
  fullPage?: boolean;
  onCancel?: () => void;
  baseUrl: string;
  onComplete?: (settings: CameraScreenSettings) => void;
  controlsTarget?: HTMLElement;
  continueLabel?: string;
  savingLabel?: string;
  onConfirm?: (settings: CameraScreenSettings) => Promise<void>;
}
/** The same phone pairing view, screen editor and preview used by arm setup. */
export function CameraSetup({
  fullPage,
  onCancel,
  selectedCameraId,
  baseUrl,
  onComplete,
  controlsTarget,
  continueLabel,
  savingLabel,
  onConfirm,
}: CameraSetupProps) {
  const selectId = useId();
  const [state, setState] = useState<State>();
  const [cameraId, setCameraId] = useState('');
  const [hasResult, setHasResult] = useState(false);
  const [correction, setCorrection] = useState<CameraCorrection>();
  const [size, setSize] = useState({ width: 720, height: 1280 });
  const [src, setSrc] = useState('');
  const [busy, setBusy] = useState(false);
  const [detectingAction, setDetectingAction] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [accuracy, setAccuracy] = useState<CameraMappingAccuracy>();
  const [stage, setStage] = useState<'phone' | 'screen' | 'saved'>(() => {
    try {
      return sessionStorage.getItem(`camera-step:${baseUrl}`) === 'screen'
        ? 'screen'
        : 'phone';
    } catch {
      return 'phone';
    }
  });
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    try {
      sessionStorage.setItem(`camera-step:${baseUrl}`, stage);
    } catch {}
  }, [baseUrl, stage]);
  const detecting = useRef(false);
  const attempted = useRef('');
  const setupId = baseUrl.split('/').filter(Boolean).at(-1)!;

  async function request(path: string, value?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: value === undefined ? 'GET' : 'POST',
      headers:
        value === undefined
          ? undefined
          : { 'Content-Type': 'application/json', 'X-Midscene-Setup': setupId },
      body: value === undefined ? undefined : JSON.stringify(value),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw Error((await response.json()).error ?? 'Camera request failed');
    return response;
  }
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next: State = await (await request('/state')).json();
        if (!Array.isArray(next.cameras))
          throw new Error('摄像头设置已结束，请返回选择设备。');
        if (!stopped) {
          setState(next);
          if (!selectedCameraId && next.selectedCameraId)
            setCameraId(next.selectedCameraId);
          if (next.layout?.screen)
            setSize({
              width: Math.min(
                4096,
                Math.max(180, Math.round(next.layout.screen.width)),
              ),
              height: Math.min(
                4096,
                Math.max(180, Math.round(next.layout.screen.height)),
              ),
            });
        }
      } catch (cause) {
        if (!stopped) setError(String(cause));
      }
      if (!stopped) timer = setTimeout(poll, 1000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [baseUrl]);
  useEffect(() => {
    if (!cameraId || stage === 'saved') return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let previous = '';
    const poll = async () => {
      try {
        const blob = await (await request('/frame')).blob();
        if (stopped) return;
        const next = URL.createObjectURL(blob);
        const image = await createImageBitmap(blob);
        if (stopped) {
          image.close();
          URL.revokeObjectURL(next);
          return;
        }
        const { width, height } = image;
        setCorrection(
          (current) =>
            current ?? {
              sourceWidth: width,
              sourceHeight: height,
              rotation: 0,
              points: {
                topLeft: { x: width * 0.1, y: height * 0.1 },
                topRight: { x: width * 0.9, y: height * 0.1 },
                bottomRight: { x: width * 0.9, y: height * 0.9 },
                bottomLeft: { x: width * 0.1, y: height * 0.9 },
              },
            },
        );
        image.close();
        setSrc(next);
        if (previous) URL.revokeObjectURL(previous);
        previous = next;
      } catch (cause) {
        if (!stopped) setError(String(cause));
      }
      if (!stopped) timer = setTimeout(poll, 150);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (previous) URL.revokeObjectURL(previous);
    };
  }, [cameraId, stage === 'saved']);
  const settings = correction && { cameraId, correction, ...size };
  // Just as in the arm editor, a draft or page-layout change invalidates its check.
  const checkKey = JSON.stringify([
    settings,
    state?.layout,
    state?.phoneConnected,
  ]);
  useEffect(() => {
    setAccuracy(undefined);
    if (
      !settings ||
      !state?.phoneConnected ||
      stage !== 'screen' ||
      busy ||
      onConfirm
    )
      return;
    let stopped = false;
    const timer = setTimeout(() => {
      void request('/check', settings)
        .then((r) => r.json())
        .then((result) => {
          if (!stopped) {
            setAccuracy(result.accuracy);
            setError('');
          }
        })
        .catch((cause) => {
          if (!stopped) setError(String(cause));
        });
    }, 400);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [checkKey, stage, busy, onConfirm]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  async function detect() {
    if (detecting.current) return;
    detecting.current = true;
    setDetectingAction(true);
    await run(async () => {
      const result = await (await request('/markers', {})).json();
      setCorrection(result.correction);
      setHasResult(true);
      setSize({ width: result.width, height: result.height });
    });
    detecting.current = false;
    setDetectingAction(false);
  }
  useEffect(() => {
    if (
      stage !== 'screen' ||
      hasResult ||
      !cameraId ||
      !state?.phoneConnected ||
      busy
    )
      return;
    const key = JSON.stringify([cameraId, state.layout]);
    if (attempted.current === key) return;
    attempted.current = key;
    void detect();
  }, [stage, cameraId, state?.layout, state?.phoneConnected, busy]);
  useEffect(() => {
    if (!selectedCameraId) return;
    let stopped = false;
    void request('/select', { cameraId: selectedCameraId })
      .then(() => {
        if (!stopped) setCameraId(selectedCameraId);
      })
      .catch((cause) => {
        if (!stopped) setError(String(cause));
      });
    return () => {
      stopped = true;
    };
  }, [baseUrl, selectedCameraId]);
  const detectionActions = (
    <Button
      size="small"
      loading={busy && detecting.current}
      disabled={!cameraId || !state?.phoneConnected || busy}
      onClick={() => void detect()}
    >
      {t('Detect screen markers')}
    </Button>
  );
  const liveEditor = src ? (
    <CameraCornerEditor
      src={src}
      value={correction!}
      onChange={(value) => {
        setCorrection(value);
        setHasResult(true);
        if (onConfirm) setError('');
      }}
      disabled={busy}
      translate={t}
    />
  ) : (
    <Spin />
  );
  const correctedResult =
    src && correction && hasResult ? (
      <CorrectedPreview
        src={src}
        correction={correction}
        size={size}
        translate={t}
      />
    ) : (
      <div className="vision-result-empty">校正后将在这里显示手机画面</div>
    );
  const canConfirm =
    settings &&
    (onConfirm ? hasResult : Boolean(accuracy && state?.phoneConnected));
  const confirmLabel =
    (saving && savingLabel) || continueLabel || t('Save and Continue');
  async function confirmSettings() {
    if (!settings) return;
    if (onConfirm) await onConfirm(settings);
    else await request('/confirm', settings);
    setStage('saved');
    onComplete?.(settings);
  }

  const controls = (
    <div className="vision-screen-controls">
      {!selectedCameraId && !fullPage && (
        <label htmlFor={selectId}>
          {t('Camera')}
          <Select
            id={selectId}
            aria-label={t('Camera')}
            value={cameraId || undefined}
            placeholder={t('Select a camera')}
            disabled={busy || stage === 'saved'}
            options={state?.cameras.map((camera) => ({
              value: camera.id,
              label: camera.name,
            }))}
            onChange={(id) =>
              void run(async () => {
                setCameraId('');
                setSrc('');
                setCorrection(undefined);
                setAccuracy(undefined);
                attempted.current = '';
                await request('/select', { cameraId: id });
                const initial = state?.initialValue;
                if (initial?.cameraId === id) {
                  setCorrection(initial.correction);
                  setSize({ width: initial.width, height: initial.height });
                }
                setCameraId(id);
              })
            }
          />
        </label>
      )}
      {selectedCameraId && !fullPage && (
        <p>
          {state?.cameras.find(
            (camera) => camera.id === (selectedCameraId ?? cameraId),
          )?.name ?? '正在读取摄像头…'}
        </p>
      )}
      {!fullPage && stage === 'phone' && state && (
        <PhonePairStep
          controller={{ setup: state, phone: state.phone, busy }}
          footer={footer}
          t={t}
          onContinue={() => setStage('screen')}
        />
      )}
      {stage === 'screen' && !fullPage && (
        <Button
          type="primary"
          disabled={!canConfirm}
          loading={busy}
          onClick={() => void run(confirmSettings)}
        >
          {confirmLabel}
        </Button>
      )}
      {stage === 'saved' && <output>{t('Saved')}</output>}
      {error && stage !== 'screen' && !fullPage && (
        <Alert type="warning" message={error} showIcon />
      )}
      <div ref={setFooter}>
        <Space />
      </div>
    </div>
  );
  const preview = (
    <ScreenMappingView
      t={t}
      size={size}
      actions={
        <Button
          size="small"
          loading={busy && detecting.current}
          disabled={!cameraId || !state?.phoneConnected || busy}
          onClick={() => void detect()}
        >
          {t('Detect screen markers')}
        </Button>
      }
      live={
        src ? (
          correction ? (
            <CameraCornerEditor
              src={src}
              value={correction}
              onChange={setCorrection}
              disabled={busy}
              translate={t}
            />
          ) : (
            <img src={src} alt={t('Live Preview')} />
          )
        ) : (
          <Spin />
        )
      }
      corrected={
        src && correction ? (
          <CorrectedPreview
            src={src}
            correction={correction}
            size={size}
            translate={t}
          />
        ) : null
      }
    />
  );
  if (fullPage)
    return (
      <ConfigProvider theme={armUiTheme}>
        <div className="vision-camera-workspace">
          <header className="vision-workspace-header">
            <Button
              type="text"
              icon={<IconArrowLeft fontSize={18} />}
              className="vision-workspace-back"
              aria-label="返回设备选择"
              onClick={onCancel}
              disabled={busy}
            >
              <strong className="vision-workspace-title">
                透视校正（
                {state?.cameras.find(
                  (camera) => camera.id === (selectedCameraId ?? cameraId),
                )?.name ?? '正在读取摄像头…'}
                ）
              </strong>
            </Button>
          </header>
          <Steps
            size="small"
            current={stage === 'phone' ? 0 : 1}
            onChange={(step) => {
              if (
                !busy &&
                stage !== 'saved' &&
                (step === 0 || (state?.phoneConnected && state.layout))
              )
                setStage(step === 0 ? 'phone' : 'screen');
            }}
            items={[
              {
                title: '扫码连接',
                status: state?.phoneConnected
                  ? 'finish'
                  : stage === 'phone'
                    ? 'process'
                    : 'wait',
              },
              {
                title: '相机校正',
                disabled: !state?.phoneConnected || !state.layout,
              },
            ]}
          />
          <div className={`vision-step-body vision-step-${stage}`}>
            {stage === 'phone' && state && (
              <PhonePairStep
                controller={{ setup: state, phone: state.phone, busy }}
                footer={footer}
                t={t}
                onContinue={() => setStage('screen')}
              />
            )}
            {stage !== 'phone' && (
              <CameraCorrectionStep
                t={t}
                size={size}
                live={liveEditor}
                corrected={correctedResult}
                actions={detectionActions}
                error={error}
                verified={Boolean(accuracy)}
                detecting={detectingAction}
                saving={saving}
                disabled={!canConfirm || busy || stage === 'saved'}
                continueLabel={confirmLabel}
                onContinue={() => {
                  setSaving(true);
                  void run(confirmSettings).finally(() => setSaving(false));
                }}
              />
            )}
          </div>
          {controls}
        </div>
      </ConfigProvider>
    );
  return (
    <ConfigProvider theme={armUiTheme}>
      <div className="vision-screen-setup">
        {controlsTarget ? createPortal(controls, controlsTarget) : controls}
        {preview}
      </div>
    </ConfigProvider>
  );
}
