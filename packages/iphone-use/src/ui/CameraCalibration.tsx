import type { CameraScreenSettings } from '@midscene/robotics-vision';
import { CameraCornerEditor } from '@midscene/robotics-vision/ui/CameraCornerEditor';
import { CorrectedPreview } from '@midscene/robotics-vision/ui/CorrectedPreview';
import { Button, QRCode, message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Spinner } from './ScreenPreview';
import { useI18n } from './i18n';

type CameraCorrection = CameraScreenSettings['correction'];

interface CameraSetupState {
  selectedCameraId?: string;
  cameras: { id: string; name: string }[];
  phone: {
    state: 'waiting' | 'connected' | 'paused' | 'reconnecting';
    model?: string;
    links: { url: string; label: string }[];
  };
  layout?: {
    screen: { width: number; height: number; devicePixelRatio: number };
  };
  phoneConnected: boolean;
}

function formatCalibrationError(raw: string) {
  if (raw.includes('Independent check error')) {
    return '屏幕四角校验未通过。请让四个角点贴合屏幕边缘，或重新识别屏幕标记后再确认。';
  }
  if (raw.includes('Cannot reliably locate the mouse pointer')) {
    return '未能确认指针方向。请确认手机已开启辅助触控，画面中能清楚看到指针移动。检查对焦和反光后再次确认。';
  }
  return raw;
}

export function CameraCalibration({
  baseUrl,
  cameraId: initialCameraId,
  verifying = false,
  cancelling = false,
  onCancel,
}: {
  baseUrl: string;
  cameraId?: string;
  verifying?: boolean;
  cancelling?: boolean;
  onCancel: () => void;
}) {
  const { t, te } = useI18n();
  const setupId = baseUrl.split('/').filter(Boolean).at(-1)!;
  const [state, setState] = useState<CameraSetupState>();
  const [cameraId, setCameraId] = useState(initialCameraId ?? '');
  const [selectedLink, setSelectedLink] = useState<string>();
  const [src, setSrc] = useState('');
  const [correction, setCorrection] = useState<CameraCorrection>();
  const [hasResult, setHasResult] = useState(false);
  const [size, setSize] = useState({ width: 720, height: 1280 });
  const [busy, setBusy] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [stage, setStage] = useState<'phone' | 'screen' | 'saved'>(() => {
    try {
      return sessionStorage.getItem(`camera-step:${baseUrl}`) === 'screen'
        ? 'screen'
        : 'phone';
    } catch {
      return 'phone';
    }
  });
  const detectingRef = useRef(false);
  const attemptedRef = useRef('');

  useEffect(() => {
    try {
      sessionStorage.setItem(`camera-step:${baseUrl}`, stage);
    } catch {
      // Ignore storage failures.
    }
  }, [baseUrl, stage]);

  useEffect(() => {
    if (error) void message.warning(te(error));
  }, [error, te]);

  async function request(path: string, body?: unknown, timeoutMs = 30_000) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers:
        body === undefined
          ? undefined
          : {
              'Content-Type': 'application/json',
              'X-Midscene-Setup': setupId,
            },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(
        (await response.json()).error ?? '摄像头请求失败，请重试。',
      );
    }
    return response;
  }

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next: CameraSetupState = await (await request('/state')).json();
        if (!Array.isArray(next.cameras)) {
          throw new Error('摄像头设置已结束，请返回选择设备。');
        }
        if (!stopped) {
          setState(next);
          if (!initialCameraId && next.selectedCameraId) {
            setCameraId(next.selectedCameraId);
          }
          if (next.layout?.screen) {
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
        }
      } catch (cause) {
        if (!stopped)
          setError(cause instanceof Error ? cause.message : String(cause));
      }
      if (!stopped) timer = setTimeout(() => void poll(), 1000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [baseUrl, initialCameraId]);

  useEffect(() => {
    if (!initialCameraId) return;
    let stopped = false;
    void request('/select', { cameraId: initialCameraId })
      .then(() => {
        if (!stopped) setCameraId(initialCameraId);
      })
      .catch((cause) => {
        if (!stopped)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      stopped = true;
    };
  }, [baseUrl, initialCameraId]);

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
        if (!stopped)
          setError(cause instanceof Error ? cause.message : String(cause));
      }
      if (!stopped) timer = setTimeout(() => void poll(), 150);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (previous) URL.revokeObjectURL(previous);
    };
  }, [cameraId, stage === 'saved']);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (cause) {
      setError(
        formatCalibrationError(
          cause instanceof Error ? cause.message : String(cause),
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const detect = async () => {
    if (detectingRef.current) return;
    detectingRef.current = true;
    setDetecting(true);
    await run(async () => {
      const result = await (await request('/markers', {})).json();
      setCorrection(result.correction);
      setHasResult(true);
      setSize({ width: result.width, height: result.height });
    });
    detectingRef.current = false;
    setDetecting(false);
  };

  useEffect(() => {
    if (
      stage !== 'screen' ||
      hasResult ||
      !cameraId ||
      !state?.phoneConnected ||
      busy
    ) {
      return;
    }
    const key = JSON.stringify([cameraId, state.layout]);
    if (attemptedRef.current === key) return;
    attemptedRef.current = key;
    void detect();
  }, [stage, hasResult, cameraId, state?.layout, state?.phoneConnected, busy]);

  const confirm = async () => {
    if (!correction || !cameraId) return;
    const settings: CameraScreenSettings = {
      cameraId,
      correction,
      ...size,
    };
    setSaving(true);
    await run(async () => {
      await request('/confirm', settings, 10 * 60_000);
      setStage('saved');
    });
    setSaving(false);
  };

  const phone = state?.phone;
  const links = phone?.links ?? [];
  const qrUrl =
    links.find((item) => item.url === selectedLink)?.url ?? links[0]?.url;
  const connected = phone?.state === 'connected';
  const cameraName =
    state?.cameras.find((camera) => camera.id === (initialCameraId ?? cameraId))
      ?.name ?? t('摄像头', 'Camera');

  const copyUrl = (url: string) => {
    void navigator.clipboard
      .writeText(url)
      .then(() =>
        message.success(t('已复制手机连接地址', 'Copied connection URL')),
      )
      .catch(() =>
        message.warning(
          t('复制失败，请手动复制。', 'Copy failed. Please copy manually.'),
        ),
      );
  };
  const lockStep = busy || saving || verifying;

  return (
    <div className="iphone-use-camera-wizard">
      <div className="iphone-use-wizard-header">
        <Button
          type="text"
          size="small"
          className="iphone-use-back-workspace"
          loading={cancelling}
          onClick={onCancel}
        >
          {t('← 返回添加设备', '← Back to Add Device')}
        </Button>
        <div
          className="iphone-use-wizard-steps"
          aria-label={t('校准步骤', 'Calibration Steps')}
        >
          <button
            type="button"
            className={`iphone-use-wizard-step${stage === 'phone' ? ' active' : ' done'}`}
            disabled={stage === 'phone' || lockStep}
            onClick={() => setStage('phone')}
          >
            <i>{stage === 'phone' ? '1' : '✓'}</i>
            <span>{t('扫码连接', 'Scan to Connect')}</span>
          </button>
          <span className="iphone-use-wizard-divider" aria-hidden="true" />
          <div
            className={`iphone-use-wizard-step${stage === 'screen' ? ' active' : stage === 'saved' ? ' done' : ''}`}
          >
            <i>{stage === 'saved' ? '✓' : '2'}</i>
            <span>{t('相机校正', 'Camera Calibration')}</span>
          </div>
        </div>
        <span className="iphone-use-wizard-spacer" aria-hidden="true" />
      </div>

      {stage === 'phone' ? (
        <div className="iphone-use-wizard-pair">
          <div className="iphone-use-phone-bezel iphone-use-pending-bezel">
            <div className="iphone-use-phone-screen">
              <div className="iphone-use-airplay-screen-guide">
                {connected ? (
                  <>
                    <span className="iphone-use-camera-check">✓</span>
                    <strong>{t('手机已连接', 'Phone Connected')}</strong>
                    <p className="iphone-use-camera-sub">
                      {t(
                        '点击右侧「下一步：相机校正」',
                        'Click "Next: Camera Calibration" on the right',
                      )}
                    </p>
                  </>
                ) : qrUrl ? (
                  <>
                    <strong>{t('扫码连接手机', 'Scan to Connect')}</strong>
                    <div className="iphone-use-qr-card">
                      <QRCode
                        value={qrUrl}
                        type="svg"
                        size={148}
                        bordered={false}
                        color="#18181b"
                        bgColor="#ffffff"
                      />
                    </div>
                    <p className="iphone-use-camera-sub">
                      {t(
                        '添加到桌面后打开并保持常亮',
                        'Add to Home Screen, open, and keep screen on',
                      )}
                    </p>
                  </>
                ) : (
                  <div className="iphone-use-pending-waiting">
                    <Spinner />
                    <span>{t('正在准备二维码…', 'Preparing QR code…')}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="iphone-use-wizard-pair-card">
            <div className="iphone-use-step-card-head">
              <span className="iphone-use-step-title">
                <i
                  className={`iphone-use-step-index${connected ? ' done' : ''}`}
                >
                  1
                </i>
                {t('手机扫码配对', 'Pair Phone via QR')}
              </span>
              <span className="iphone-use-step-card-meta">{cameraName}</span>
            </div>
            <div className="iphone-use-camera-pair-info">
              {connected ? (
                <div className="iphone-use-camera-connected-row">
                  <span className="iphone-use-online-dot" />
                  <span>
                    {phone?.model || 'iPhone'}
                    {state?.layout?.screen
                      ? ` · ${Math.round(state.layout.screen.width * state.layout.screen.devicePixelRatio)}×${Math.round(state.layout.screen.height * state.layout.screen.devicePixelRatio)}`
                      : ''}
                  </span>
                </div>
              ) : (
                <span className="iphone-use-waiting">
                  <span
                    className="iphone-use-waiting-ring"
                    aria-hidden="true"
                  />
                  {t(
                    '等待手机从桌面打开校准页并保持常亮',
                    'Waiting for calibration page to open from Home Screen',
                  )}
                </span>
              )}
              <div
                className="iphone-use-pwa-steps"
                aria-label={t('桌面打开指引', 'Home Screen Guide')}
              >
                <span className="iphone-use-pwa-chip">
                  {t('1. 扫码打开', '1. Scan QR')}
                </span>
                <span className="iphone-use-pwa-arrow" aria-hidden="true">
                  →
                </span>
                <span className="iphone-use-pwa-chip">
                  {t('2. 共享 · 添加到桌面', '2. Share → Add to Home Screen')}
                </span>
                <span className="iphone-use-pwa-arrow" aria-hidden="true">
                  →
                </span>
                <span className="iphone-use-pwa-chip">
                  {t('3. 从桌面打开', '3. Open from Home')}
                </span>
              </div>
              {links.length > 0 && (
                <div className="iphone-use-camera-link-list">
                  {links.map((item) => {
                    const active = item.url === qrUrl;
                    return (
                      <div
                        key={item.url}
                        className={`iphone-use-camera-link-item${active ? ' active' : ''}`}
                      >
                        <button
                          type="button"
                          className="iphone-use-camera-link-select"
                          aria-pressed={active}
                          onClick={() => setSelectedLink(item.url)}
                        >
                          <i className="iphone-use-camera-link-dot" />
                          <code>{item.url}</code>
                        </button>
                        <button
                          type="button"
                          className="iphone-use-camera-link-copy"
                          aria-label={t(`复制 ${item.url}`, `Copy ${item.url}`)}
                          title={t('复制链接', 'Copy URL')}
                          onClick={() => copyUrl(item.url)}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <rect
                              x="9"
                              y="9"
                              width="13"
                              height="13"
                              rx="2"
                              ry="2"
                            />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="iphone-use-submit-row">
              <Button
                type="primary"
                block
                className="session-setup-submit"
                disabled={!state?.phoneConnected || !state?.layout || busy}
                onClick={() => setStage('screen')}
              >
                {t('下一步：相机校正', 'Next: Camera Calibration')}
              </Button>
              <Button
                className="iphone-use-cancel-btn"
                loading={cancelling}
                onClick={onCancel}
              >
                {t('取消连接', 'Cancel')}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="iphone-use-wizard-calibrate-wrap">
          <div className="iphone-use-wizard-calibrate">
            <div className="iphone-use-wizard-editor-card">
              <div className="iphone-use-step-card-head">
                <span className="iphone-use-step-title">
                  <i
                    className={`iphone-use-step-index${hasResult ? ' done' : ''}`}
                  >
                    2
                  </i>
                  {t(
                    '拖动四角对齐手机屏幕边缘',
                    'Drag corners to match the phone screen edges',
                  )}
                </span>
                <Button
                  size="small"
                  loading={detecting}
                  disabled={!cameraId || !state?.phoneConnected || lockStep}
                  onClick={() => void detect()}
                >
                  {t('自动识别', 'Auto Detect')}
                </Button>
              </div>
              <div className="iphone-use-camera-corner-stage">
                {src && correction ? (
                  <CameraCornerEditor
                    src={src}
                    value={correction}
                    onChange={(value) => {
                      setCorrection(value);
                      setHasResult(true);
                      setError('');
                    }}
                    disabled={lockStep}
                  />
                ) : (
                  <Spinner />
                )}
              </div>
            </div>

            <div className="iphone-use-wizard-preview-col">
              <div className="iphone-use-phone-bezel iphone-use-camera-result-bezel">
                <div className="iphone-use-phone-screen">
                  {src && correction && hasResult ? (
                    <CorrectedPreview
                      src={src}
                      correction={correction}
                      size={size}
                    />
                  ) : (
                    <div className="iphone-use-pending-waiting">
                      <span>{t('校正后预览', 'Rectified Preview')}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="iphone-use-wizard-footer">
            <Button disabled={lockStep} onClick={() => setStage('phone')}>
              {t('← 重新扫码', '← Rescan QR')}
            </Button>
            <div className="iphone-use-wizard-footer-actions">
              <Button
                className="iphone-use-cancel-btn"
                loading={cancelling}
                onClick={onCancel}
              >
                {t('取消连接', 'Cancel')}
              </Button>
              <Button
                type="primary"
                className="session-setup-submit"
                loading={saving || verifying}
                disabled={
                  !correction || !hasResult || lockStep || stage === 'saved'
                }
                onClick={() => void confirm()}
              >
                {saving || verifying
                  ? t('正在验证指针…', 'Verifying Pointer…')
                  : t('确认并验证指针', 'Confirm & Verify Pointer')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
