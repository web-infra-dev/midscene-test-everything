import { CorrectedPreview } from '@midscene/arm-calibration-ui';
import type { PerspectiveRotation } from '@midscene/arm-kit-shared/camera/vision-types';
import type { CameraCorrection } from '@midscene/arm-kit-shared/contracts';
import {
  Alert,
  Button,
  Card,
  Modal,
  QRCode,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { Check, RefreshCw, ScanLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../i18n';
import './MultiDeviceCalibration.less';

interface SessionTarget {
  key: string;
  screenId?: string;
  name: string;
  base: boolean;
  claimed: boolean;
  state: string;
  pageKey?: string;
}

interface SessionLinks {
  name: string;
  url: string;
}

interface CalibrationSession {
  token: string;
  bindToken: string;
  links: SessionLinks[];
  targets: SessionTarget[];
}

interface Detection {
  correction: CameraCorrection;
  jpeg: string;
  markerIds: number[];
  validFrames: number;
  frameCount: number;
  jitterPx: number;
  errorPx: number;
  screenWidthPx: number;
  screenHeightPx: number;
  rotation: PerspectiveRotation;
}

interface Result {
  key: string;
  screenId?: string;
  name: string;
  base: boolean;
  ok: boolean;
  detection?: Detection;
  error?: string;
}

const sessionEndpoint = '/api/cameras/calibration-sessions';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error?.message ?? value.error ?? 'Request failed');
  return value;
}

function stateLabel(state: string, zh: boolean) {
  const labels: Record<string, [string, string]> = {
    unclaimed: ['等待扫码', 'Waiting for scan'],
    waiting: ['等待手机', 'Waiting for phone'],
    preparing: ['准备中', 'Preparing'],
    fullscreen: ['等待全屏', 'Waiting for fullscreen'],
    bounds: ['调整屏幕范围', 'Checking screen bounds'],
    ready: ['就绪', 'Ready'],
    home_screen: ['需要主屏幕图标', 'Open from Home Screen'],
    'home-screen': ['需要主屏幕图标', 'Open from Home Screen'],
  };
  const label = labels[state] ?? [state, state];
  return zh ? label[0] : label[1];
}

export function MultiDeviceCalibrationDialog({
  open,
  cameraId,
  cameraName,
  onClose,
  onApplied,
}: {
  open: boolean;
  cameraId: string;
  cameraName: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const zh = useLanguage() === 'zh';
  const [session, setSession] = useState<CalibrationSession>();
  const [link, setLink] = useState<string>();
  const [error, setError] = useState<string>();
  const [results, setResults] = useState<Result[]>();
  const [detecting, setDetecting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string>();
  const generation = useRef(0);
  const sessionToken = useRef<string>();

  useEffect(() => {
    if (!open) return;
    const current = ++generation.current;
    setSession(undefined);
    setResults(undefined);
    setError(undefined);
    setApplyError(undefined);
    const abort = new AbortController();
    void request<CalibrationSession>(sessionEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: cameraId }),
      signal: abort.signal,
    })
      .then((next) => {
        if (generation.current !== current) return;
        sessionToken.current = next.token;
        setSession(next);
        setLink(next.links[0]?.url);
      })
      .catch((cause) => {
        if (generation.current === current)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      generation.current += 1;
      abort.abort();
      const token = sessionToken.current;
      sessionToken.current = undefined;
      if (token)
        void fetch(`${sessionEndpoint}?token=${encodeURIComponent(token)}`, {
          method: 'DELETE',
          keepalive: true,
        }).catch(() => undefined);
    };
  }, [open, cameraId]);

  useEffect(() => {
    if (!open || !session || results) return;
    const current = generation.current;
    const timer = setInterval(() => {
      void request<CalibrationSession>(
        `${sessionEndpoint}?token=${encodeURIComponent(session.token)}`,
      )
        .then((next) => {
          if (generation.current === current) setSession(next);
        })
        .catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, [open, session?.token, results]);

  if (!open) return null;

  const claimed = session?.targets.filter((target) => target.claimed) ?? [];
  const ready = claimed.length > 0 && claimed.every((t) => t.state === 'ready');
  const successful = results?.filter((result) => result.ok) ?? [];

  const detect = async () => {
    if (!session || detecting) return;
    setDetecting(true);
    setError(undefined);
    try {
      const next = await request<{ screens: Result[] }>(
        `${sessionEndpoint}/detect?token=${encodeURIComponent(session.token)}`,
        { method: 'POST', signal: AbortSignal.timeout(120000) },
      );
      setResults(next.screens);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDetecting(false);
    }
  };

  const apply = async () => {
    if (!session || applying) return;
    setApplying(true);
    setApplyError(undefined);
    try {
      const next = await request<{
        applied: Result[];
        failed: Result[];
      }>(
        `${sessionEndpoint}/apply?token=${encodeURIComponent(session.token)}`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(120000),
        },
      );
      if (next.failed.length) {
        setApplyError(
          next.failed.map((item) => `${item.name}: ${item.error}`).join('\n'),
        );
        return;
      }
      onApplied();
      onClose();
    } catch (cause) {
      setApplyError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal
      centered
      closable={!applying}
      footer={
        <Space wrap>
          <Button disabled={applying} onClick={onClose}>
            {zh ? '关闭' : 'Close'}
          </Button>
          {results ? (
            <>
              <Button
                disabled={applying}
                icon={<RefreshCw size={15} />}
                onClick={() => {
                  setResults(undefined);
                  setApplyError(undefined);
                }}
              >
                {zh ? '重新标定' : 'Recalibrate'}
              </Button>
              <Button
                disabled={!successful.length}
                icon={<Check size={16} />}
                loading={applying}
                onClick={() => void apply()}
                type="primary"
              >
                {zh
                  ? `应用全部结果（${successful.length}）`
                  : `Apply all results (${successful.length})`}
              </Button>
            </>
          ) : (
            <Button
              disabled={!ready || detecting}
              icon={<ScanLine size={16} />}
              loading={detecting}
              onClick={() => void detect()}
              type="primary"
            >
              {zh ? '开始标定' : 'Start calibration'}
            </Button>
          )}
        </Space>
      }
      onCancel={onClose}
      open
      title={`${zh ? '多设备屏幕标定' : 'Multi-device screen calibration'} · ${cameraName}`}
      width="min(980px, 94vw)"
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {error && <Alert showIcon type="error" message={error} />}
        {applyError && (
          <Alert
            showIcon
            type="error"
            message={zh ? '部分结果未保存' : 'Some results were not saved'}
            description={applyError}
          />
        )}
        {!session ? (
          <div
            style={{ display: 'grid', placeItems: 'center', minHeight: 220 }}
          >
            {error ? null : <Spin />}
          </div>
        ) : (
          <>
            <Typography.Paragraph style={{ margin: 0 }}>
              {zh
                ? '用每台手机依次扫描同一个码。第一台进入屏幕 1，后续手机自动成为屏幕 2、3、4…；手机进入全屏并显示标记后，点击“开始标定”。'
                : 'Scan the same code with each phone in turn. The first phone becomes Screen 1, later phones become Screens 2, 3, 4… When they are fullscreen and showing markers, select Start calibration.'}
            </Typography.Paragraph>
            <div className="multi-device-bind">
              <div className="multi-device-qr">
                {link ? <QRCode value={link} size={168} /> : <Spin />}
              </div>
              <Space direction="vertical" size="small">
                <Typography.Text strong>
                  {zh ? '服务机固定二维码' : 'Host calibration code'}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {zh
                    ? '所有手机扫这一张码，不需要逐台切换二维码。'
                    : 'Every phone scans this one code; no per-screen QR rotation.'}
                </Typography.Text>
                {session.links.length > 1 && (
                  <Select
                    aria-label={zh ? '手机网络地址' : 'Phone network address'}
                    onChange={(value) => {
                      setLink(value);
                    }}
                    options={session.links.map((item) => ({
                      label: item.name,
                      value: item.url,
                    }))}
                    style={{ minWidth: 260 }}
                    value={link}
                  />
                )}
                {!session.links.length && (
                  <Alert
                    showIcon
                    type="error"
                    message={
                      zh
                        ? '没有找到手机可访问的局域网地址。'
                        : 'No LAN address is available for the phone.'
                    }
                  />
                )}
                <a href={link} rel="noreferrer" target="_blank">
                  {zh ? '打开标定页' : 'Open calibration page'}
                </a>
              </Space>
            </div>
            <div className="multi-device-targets">
              {session.targets.map((target, index) => (
                <div className="multi-device-target" key={target.key}>
                  <span>
                    <strong>
                      {index + 1}. {target.name}
                    </strong>{' '}
                    {target.base && (
                      <Tag color="blue">{zh ? '基础' : 'Base'}</Tag>
                    )}
                  </span>
                  <Tag
                    color={
                      target.state === 'ready'
                        ? 'green'
                        : target.claimed
                          ? 'gold'
                          : undefined
                    }
                  >
                    {target.claimed
                      ? stateLabel(target.state, zh)
                      : zh
                        ? '等待扫码'
                        : 'Waiting for scan'}
                  </Tag>
                </div>
              ))}
            </div>
            {claimed.length === 0 && (
              <Alert
                showIcon
                type="info"
                message={
                  zh
                    ? '还没有手机接入。扫描上方二维码后，屏幕列表会自动出现。'
                    : 'No phone has joined yet. Scan the code above and screens will appear here automatically.'
                }
              />
            )}
            {claimed.length > 0 && !ready && (
              <Alert
                showIcon
                type="info"
                message={
                  zh
                    ? '等待所有已连接手机进入全屏并显示标记。'
                    : 'Waiting for every connected phone to enter fullscreen and show its markers.'
                }
              />
            )}
            {results && (
              <div className="multi-device-results">
                {results.map((result) => (
                  <Card
                    key={result.key}
                    size="small"
                    title={result.name}
                    extra={
                      <Tag color={result.ok ? 'green' : 'red'}>
                        {result.ok
                          ? zh
                            ? '成功'
                            : 'Succeeded'
                          : zh
                            ? '失败'
                            : 'Failed'}
                      </Tag>
                    }
                  >
                    {result.ok && result.detection ? (
                      <Space direction="vertical" size="small">
                        <CorrectedPreview
                          correction={result.detection.correction}
                          size={{
                            width: result.detection.screenWidthPx,
                            height: result.detection.screenHeightPx,
                          }}
                          src={`data:image/jpeg;base64,${result.detection.jpeg}`}
                        />
                        <Typography.Text type="secondary">
                          {result.detection.markerIds.length}/6{' '}
                          {zh ? '标记' : 'markers'} ·{' '}
                          {result.detection.errorPx.toFixed(2)} px
                        </Typography.Text>
                      </Space>
                    ) : (
                      <Alert showIcon type="error" message={result.error} />
                    )}
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </Space>
    </Modal>
  );
}
