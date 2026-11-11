import type { PlaygroundControllerResult } from '@midscene/arm-kit-playground/shell/controller/types.ts';
import MidsceneLogo from '@midscene/arm-kit-playground/shell/icons/midscene-logo.svg?react';
import '@midscene/arm-kit-playground/shell/SessionSetupPanel.less';
import type { AirPlaySetupInfo } from '../hardware/types.js';
import { AirPlayPreview, airplayStatusText } from './AirPlayPreview';
import { CameraCalibration } from './CameraCalibration';
import { Frame } from './ScreenPreview';
import {
  bluetoothLabel,
  resolveBluetoothSelection,
} from './bluetooth-selection';
import { navigate } from './routes';
import '@midscene/robotics-vision/styles.css';
import '@midscene/robotics-vision/screen-setup.less';
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  Select,
  Space,
  Spin,
  message,
} from 'antd';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Choice = {
  id: string;
  name: string;
  modelName?: string;
  address?: string;
};
const choiceLabel = (choice: Choice) =>
  choice.modelName ? `${choice.name} - ${choice.modelName}` : choice.name;
export type Connection = {
  phase?: string;
  setupId?: string;
  setupKind?: string;
  error?: string;
};
type Binding = {
  source: string;
  selectedPeer?: string;
  computerName: string;
  selectedUSB?: string;
  devices: Choice[];
  bluetooth: { hosts: Choice[] };
  airplay?: AirPlaySetupInfo;
};
async function request(url: string, body?: unknown, timeoutMs = 30000) {
  const id = /\/setup\/([^/]+)/.exec(url)?.[1];
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined
        ? undefined
        : {
            'Content-Type': 'application/json',
            'X-Midscene-Setup': id ?? '',
            'X-Midscene-Playground': 'setup',
          },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok)
    throw new Error((await response.json()).error ?? '请求失败，请重试');
  return response;
}
function useCameraPreview(
  cameraId: string | undefined,
  enabled: boolean,
  apiBase: string,
) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const release = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    setUrl('');
    setError('');
    if (!enabled || !cameraId) return;
    let stopped = false;
    let closing: Promise<void> | undefined;
    const opening = queue.current
      .catch(() => {})
      .then(async () => {
        if (stopped) return undefined;
        return (await (
          await request(
            `${apiBase}/ios-hid/camera-preview/${encodeURIComponent(cameraId)}`,
            {},
            210_000,
          )
        ).json()) as { id: string };
      });
    queue.current = opening;
    const stop = () => {
      stopped = true;
      closing ??= opening
        .catch(() => undefined)
        .then(async (preview) => {
          if (preview)
            await request(
              `${apiBase}/ios-hid/camera-preview/${preview.id}/close`,
              {},
            );
        });
      queue.current = closing;
      return closing;
    };
    release.current = stop;
    void opening
      .then((preview) => {
        if (!stopped && preview)
          setUrl(`${apiBase}/ios-hid/camera-preview/${preview.id}/frame`);
      })
      .catch((cause) => {
        if (!stopped) setError(String(cause));
      });
    window.addEventListener('pagehide', stop);
    return () => {
      window.removeEventListener('pagehide', stop);
      void stop().catch(() => {});
    };
  }, [cameraId, enabled, apiBase]);
  return { url, error, release };
}

function RefreshDevices({
  loading,
  onClick,
}: { loading: boolean; onClick: () => void }) {
  const [feedback, setFeedback] = useState(false);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(feedbackTimer.current), []);
  const spinning = loading || feedback;
  return (
    <Button
      type="text"
      size="small"
      className="ios-hid-refresh"
      aria-label="刷新设备列表"
      title="刷新设备列表"
      disabled={loading}
      aria-busy={loading}
      data-refreshing={spinning}
      onClick={(event) => {
        event.preventDefault();
        // Discovery can finish before the next paint. Keep one visible rotation
        // without delaying the request, its results or the connection controls.
        clearTimeout(feedbackTimer.current);
        setFeedback(true);
        feedbackTimer.current = setTimeout(() => setFeedback(false), 800);
        onClick();
      }}
      icon={
        <svg
          className={spinning ? 'ios-hid-refresh-spinning' : undefined}
          aria-hidden="true"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 11a9 9 0 1 1 2.4 6.1M3 4v7h7" />
        </svg>
      }
    />
  );
}
function BluetoothPeers({
  peers,
  selected,
  reserved = [],
  disabled = false,
  onSelect,
}: {
  peers: Choice[];
  selected?: string;
  reserved?: string[];
  disabled?: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <fieldset aria-label="选择蓝牙手机" className="ios-hid-bluetooth-status">
      {peers.map((peer) => {
        const occupied = reserved.includes(peer.id);
        return (
          <button
            key={peer.id}
            type="button"
            className="ios-hid-bluetooth-device"
            aria-pressed={selected === peer.id}
            disabled={disabled || occupied}
            onClick={() => onSelect(peer.id)}
          >
            <span className="ios-hid-online-dot" />
            <span>{bluetoothLabel(peer, peers)}</span>
            {occupied ? (
              <small>使用中</small>
            ) : selected === peer.id ? (
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m5 12 4 4L19 6" />
              </svg>
            ) : null}
          </button>
        );
      })}
    </fieldset>
  );
}
export function BindingSetup({
  baseUrl,
  previewTarget,
  peers,
  selectedPeerId,
  onSelectPeer,
  source,
  verifying = false,
  recovery = false,
  onBluetoothStatus,
  onStop,
}: {
  baseUrl: string;
  previewTarget: HTMLElement | null;
  peers: Choice[];
  selectedPeerId?: string;
  onSelectPeer: (id: string) => void;
  source: string;
  verifying?: boolean;
  recovery?: boolean;
  onBluetoothStatus?: (connected: boolean | undefined) => void;
  onStop?: () => void;
}) {
  const [state, setState] = useState<Binding>();
  const [airplay, setAirplay] = useState<AirPlaySetupInfo>();
  const [eventsOnline, setEventsOnline] = useState(false);
  const peer = peers.find((item) => item.id === selectedPeerId)?.id;
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!recovery || verifying) return;
    const events = new EventSource(
      baseUrl.replace(/\/setup\/[^/]+\/?$/, '/bluetooth/events'),
    );
    events.onmessage = (event) => {
      const status = JSON.parse(event.data) as {
        hosts: { id: string; reports: number[] }[];
      };
      onBluetoothStatus?.(
        status.hosts.some(
          (host) =>
            host.id === selectedPeerId &&
            [1, 2, 3].every((report) => host.reports.includes(report)),
        ),
      );
    };
    events.onerror = () => onBluetoothStatus?.(undefined);
    return () => events.close();
  }, [baseUrl, recovery, verifying, selectedPeerId, onBluetoothStatus]);
  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const value: Binding = await (await request(`${baseUrl}/state`)).json();
        await request(`${baseUrl}/select`, { usbDeviceId: value.selectedUSB });
        const next: Binding = await (await request(`${baseUrl}/state`)).json();
        if (!stopped) {
          setState(next);
          setAirplay((current) => current ?? next.airplay);
          setPreview(true);
        }
      } catch (cause) {
        if (!stopped) setError(String(cause));
      }
    })();
    return () => {
      stopped = true;
    };
  }, [baseUrl]);
  useEffect(() => {
    if (source !== 'airplay' || verifying) return;
    const events = new EventSource(`${baseUrl}/events`);
    events.onmessage = (event) => {
      const value = JSON.parse(event.data) as { airplay?: AirPlaySetupInfo };
      if (value.airplay) setAirplay(value.airplay);
      setEventsOnline(true);
    };
    events.onerror = () => setEventsOnline(false);
    return () => events.close();
  }, [baseUrl, source, verifying]);
  useEffect(() => {
    if (
      !selectedPeerId &&
      state?.selectedPeer &&
      peers.some((peer) => peer.id === state.selectedPeer)
    )
      onSelectPeer(state.selectedPeer);
  }, [selectedPeerId, state?.selectedPeer, peers, onSelectPeer]);
  const confirm = () => {
    setBusy(true);
    setError('');
    void request(`${baseUrl}/confirm`, {
      bluetoothPeerId: peer,
      confirmed: true,
    }).catch((cause) => {
      setError(String(cause));
      setBusy(false);
    });
  };
  if (source === 'airplay') {
    const checking = verifying || busy;
    const info =
      !eventsOnline && airplay?.state === 'streaming' && !checking
        ? { ...airplay, state: 'interrupted' as const }
        : airplay;
    return (
      <>
        {!recovery && (
          <div className="ios-hid-airplay-controls">
            <span className="ios-hid-airplay-status">
              {(!info || info.state === 'waiting' || checking) && (
                <span className="ios-hid-waiting-ring" aria-hidden="true" />
              )}
              {airplayStatusText(info, checking)}
            </span>
            <p className="ios-hid-hint">
              {info?.state === 'streaming'
                ? '确认右侧画面是要操作的手机。'
                : '按右侧提示在手机上开始屏幕镜像。'}
            </p>
            <Button
              type="primary"
              block
              className="session-setup-submit"
              loading={checking}
              disabled={
                !peer ||
                !preview ||
                !eventsOnline ||
                info?.state !== 'streaming' ||
                checking
              }
              onClick={confirm}
            >
              验证并连接
            </Button>
            {info?.state === 'failed' && (
              <Button
                block
                disabled={checking}
                onClick={() => {
                  setError('');
                  void request(`${baseUrl}/select`, {}).catch((cause) =>
                    setError(String(cause)),
                  );
                }}
              >
                重试接收器
              </Button>
            )}
            {onStop && (
              <Button
                type="text"
                block
                size="small"
                disabled={checking}
                onClick={onStop}
              >
                停止接收器
              </Button>
            )}
            {error && <Alert type="warning" message={error} />}
          </div>
        )}
        {previewTarget &&
          createPortal(
            <AirPlayPreview
              info={info}
              frameUrl={`${baseUrl}/frame`}
              verifying={checking}
            />,
            previewTarget,
          )}
      </>
    );
  }
  return (
    <Space direction="vertical" className="ios-hid-fields" size="middle">
      {state?.source === 'usb' && (
        <p>
          USB ·{' '}
          {state.devices.find((d) => d.id === state.selectedUSB)?.name ??
            '已选择手机'}
        </p>
      )}
      <strong>{state?.selectedPeer ? '确认画面' : '蓝牙连接'}</strong>
      {!state?.selectedPeer && (
        <p>
          在 iPhone「设置 → 蓝牙」中连接「{state?.computerName ?? 'Mac'}
          」，并在「辅助功能 → 触控」中启用辅助触控。
        </p>
      )}
      <div className="ios-hid-bluetooth-status">
        <BluetoothPeers
          peers={peers}
          selected={peer}
          disabled={busy}
          onSelect={onSelectPeer}
        />
        {!peers.length && (
          <span className="ios-hid-waiting">
            <span className="ios-hid-waiting-ring" aria-hidden="true" />
            等待手机连接…
          </span>
        )}
      </div>
      <Button
        type="primary"
        block
        loading={busy}
        disabled={!peer || !preview}
        onClick={confirm}
      >
        确认并验证指针
      </Button>
      {error && <Alert type="warning" message={error} />}
      {preview &&
        previewTarget &&
        createPortal(<Frame url={`${baseUrl}/frame`} />, previewTarget)}
    </Space>
  );
}
export function ConnectionPanel({
  controller,
  previewTarget,
  apiBase = '',
  connection = {},
  reservedPeers = [],
  reservedSources = [],
  initialSource = 'usb',
  onConnected,
}: {
  controller: {
    state: Pick<
      PlaygroundControllerResult['state'],
      'form' | 'sessionMutating'
    >;
    actions: Pick<PlaygroundControllerResult['actions'], 'createSession'>;
  };
  previewTarget: HTMLElement | null;
  apiBase?: string;
  connection?: Connection;
  reservedPeers?: string[];
  reservedSources?: string[];
  initialSource?: string;
  onConnected?: () => void;
}) {
  const { state, actions } = controller;
  const reservedPeerKey = JSON.stringify(reservedPeers);
  const reservedSourceKey = JSON.stringify(reservedSources);
  const scopedRequest = (url: string, body?: unknown) =>
    request(`${apiBase}${url}`, body);
  const source = String(Form.useWatch('source', state.form) ?? initialSource);
  const [discovery, setDiscovery] = useState<{
    source: string;
    devices: Choice[];
  }>();
  const devices = discovery?.source === source ? discovery.devices : [];
  const availableDevices = devices.filter(
    (device) => !reservedSources.includes(`${source}:${device.id}`),
  );
  const selectedPeerId = Form.useWatch('bluetoothPeerId', state.form) as
    | string
    | undefined;
  const preferredPeer = useRef<string>(
    state.form.getFieldValue('bluetoothPeerId'),
  );
  const selectPeer = (id: string) => {
    preferredPeer.current = id;
    state.form.setFieldValue('bluetoothPeerId', id);
  };
  const [peers, setPeers] = useState<Choice[]>([]);
  const [connectedPeers, setConnectedPeers] = useState<Choice[]>([]);
  const [bluetoothName, setBluetoothName] = useState('Midscene');
  const [bluetoothState, setBluetoothState] = useState('starting');
  const [bluetoothOnline, setBluetoothOnline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');
  const [controls, setControls] = useState<HTMLDivElement | null>(null);
  const [cameraId, setCameraId] = useState<string>();
  const [preparing, setPreparing] = useState(false);
  const pending =
    state.sessionMutating ||
    preparing ||
    connection.phase === 'setup-required' ||
    connection.phase === 'connecting';
  const cameraValue = Form.useWatch('cameraId', state.form);
  const usbValue = Form.useWatch('deviceId', state.form);
  const selectedSourceId = source === 'usb' ? usbValue : cameraValue;
  const selectedAvailable = availableDevices.some(
    (device) => device.id === selectedSourceId,
  );
  const selectedCameraId =
    typeof cameraValue === 'string' ? cameraValue : undefined;
  const cameraPreview = useCameraPreview(
    selectedCameraId,
    source === 'camera' && !pending && selectedAvailable,
    apiBase,
  );
  useEffect(() => {
    if (pending || source === 'airplay') return;
    let stopped = false;
    setLoading(true);
    setError('');
    const field = source === 'usb' ? 'deviceId' : 'cameraId';
    void scopedRequest(`/ios-hid/discover/${source}`)
      .then((r) => r.json())
      .then((all: Choice[]) => {
        const items = all.filter(
          (item) => !reservedSources.includes(`${source}:${item.id}`),
        );
        if (stopped) return;
        setDiscovery({ source, devices: all });
        const previous = state.form.getFieldValue(field);
        state.form.setFieldValue(
          field,
          items.some((d) => d.id === previous)
            ? previous
            : items.length === 1
              ? items[0].id
              : undefined,
        );
      })
      .catch((cause) => {
        if (!stopped) setError(String(cause));
      })
      .finally(() => {
        if (!stopped) setLoading(false);
      });
    return () => {
      stopped = true;
    };
  }, [source, refresh, pending, apiBase, reservedSourceKey]);
  useEffect(() => {
    const events = new EventSource(`${apiBase}/ios-hid/bluetooth/events`);
    events.onmessage = (event) => {
      try {
        const value = JSON.parse(event.data);
        setConnectedPeers(value.hosts);
        value.hosts = value.hosts.filter(
          (peer: Choice) => !reservedPeers.includes(peer.id),
        );
        setPeers(value.hosts);
        setBluetoothName(value.serviceName ?? 'Midscene');
        setBluetoothState(value.state);
        setBluetoothOnline(true);
        const peer = resolveBluetoothSelection(
          preferredPeer.current,
          value.hosts,
          reservedPeers,
        );
        if (peer) preferredPeer.current = peer;
        if (state.form.getFieldValue('bluetoothPeerId') !== peer)
          state.form.setFieldsValue({
            bluetoothPeerId: peer,
          });
      } catch {
        setBluetoothOnline(false);
      }
    };
    events.onerror = () => {
      setBluetoothOnline(false);
      setPeers([]);
      setConnectedPeers([]);
      state.form.setFieldsValue({
        bluetoothPeerId: undefined,
      });
    };
    return () => events.close();
  }, [state.form, apiBase, reservedPeerKey]);
  // The initial SSE snapshot restores state; it is not a new failure event.
  const cancelled = useRef(false);
  const notifiedError = useRef(connection.error ?? '');
  useEffect(() => {
    const notice = error || connection.error || '';
    if (!cancelled.current && notice && notice !== notifiedError.current)
      void message.warning(notice);
    notifiedError.current = notice;
  }, [error, connection.error]);
  const baseUrl = connection.setupId
    ? `${apiBase}/ios-hid/setup/${connection.setupId}`
    : undefined;
  const lastAirplaySetup = useRef<string>();
  if (source === 'airplay' && baseUrl && connection.setupKind === 'device')
    lastAirplaySetup.current = baseUrl;
  if (!pending) lastAirplaySetup.current = undefined;
  const airplaySetupUrl =
    source === 'airplay' && pending ? lastAirplaySetup.current : undefined;
  const stopAirplay = () => {
    cancelled.current = true;
    void scopedRequest('/ios-hid/cancel', {}).catch((cause) => {
      cancelled.current = false;
      setError(String(cause));
    });
  };
  if (pending && connection.setupKind === 'camera' && baseUrl) {
    return createPortal(
      <div className="ios-hid-camera-page">
        <CameraCalibration
          key={baseUrl}
          baseUrl={baseUrl}
          cameraId={cameraId}
          onCancel={() => {
            void scopedRequest('/ios-hid/cancel', {}).catch((cause) =>
              setError(String(cause)),
            );
          }}
        />
      </div>,
      document.body,
    );
  }

  return (
    <div className="session-setup-panel">
      <div
        className={`session-setup-card ios-hid-compact${pending && baseUrl ? ' ios-hid-pending' : ''}`}
      >
        <MidsceneLogo className="session-setup-logo" />
        <h1 className="session-setup-title">连接 iPhone 或 iPad</h1>
        <Form
          form={state.form}
          layout="vertical"
          className="session-setup-form"
          initialValues={{ source: initialSource, reuseConfiguration: true }}
          hidden={pending && Boolean(baseUrl) && !airplaySetupUrl}
          disabled={pending}
          onFinish={async () => {
            setCameraId(state.form.getFieldValue('cameraId'));
            setError('');
            cancelled.current = false;
            setPreparing(true);
            try {
              await cameraPreview.release.current();
              const { name: _name, ...input } = state.form.getFieldsValue(true);
              if (
                await actions.createSession(input, {
                  silent: source === 'airplay',
                })
              ) {
                if (onConnected) onConnected();
                else navigate('workspace');
              }
            } catch (cause) {
              setError(String(cause));
            } finally {
              setPreparing(false);
            }
          }}
        >
          <Form.Item
            label={
              <span className="ios-hid-inline-label">
                <span>1. 蓝牙连接</span>
                <small>（手机设置 → 蓝牙 · {bluetoothName}）</small>
              </span>
            }
            className="ios-hid-connection-step"
          >
            <div className="ios-hid-bluetooth-status" aria-live="polite">
              <BluetoothPeers
                peers={connectedPeers}
                selected={selectedPeerId}
                reserved={reservedPeers}
                disabled={pending || !bluetoothOnline}
                onSelect={selectPeer}
              />
              {!connectedPeers.length && (
                <span className="ios-hid-waiting">
                  <span className="ios-hid-waiting-ring" aria-hidden="true" />
                  {!bluetoothOnline
                    ? '正在连接蓝牙服务…'
                    : bluetoothState.toLowerCase() === 'bluetooth off'
                      ? '请开启 Mac 蓝牙'
                      : /not allowed|failed|unavailable/i.test(bluetoothState)
                        ? '蓝牙服务不可用，请检查系统蓝牙权限'
                        : '等待手机连接…'}
                </span>
              )}
            </div>
          </Form.Item>
          <Form.Item name="bluetoothPeerId" hidden>
            <Input />
          </Form.Item>
          <Form.Item
            label={
              <span className="ios-hid-inline-label">
                <span>2. 开启辅助触控</span>
                <small title="手机设置 → 辅助功能 → 触控 → 辅助触控">
                  （辅助功能 → 触控）
                </small>
              </span>
            }
            className="ios-hid-connection-step ios-hid-instruction-only"
          />
          <Form.Item
            name="source"
            label={
              <span className="ios-hid-inline-label">
                <span>3. 选择画面来源</span>
                <small>
                  （
                  {source === 'usb'
                    ? '连接并解锁，首次请信任 Mac'
                    : source === 'camera'
                      ? '连接后扫码校正'
                      : '控制中心 → 屏幕镜像'}
                  ）
                </small>
              </span>
            }
          >
            <Select
              options={[
                { value: 'usb', label: 'USB' },
                { value: 'airplay', label: 'AirPlay' },
                { value: 'camera', label: '独立摄像头' },
              ]}
            />
          </Form.Item>
          {source !== 'airplay' && (
            <Form.Item
              name={source === 'usb' ? 'deviceId' : 'cameraId'}
              className="ios-hid-device-field"
              label={
                <span className="ios-hid-device-label">
                  <span>
                    {source === 'usb'
                      ? `USB 手机 · ${devices.length} 台设备`
                      : `摄像头 · ${devices.length} 台设备`}
                  </span>
                  <RefreshDevices
                    loading={loading}
                    onClick={() => setRefresh((v) => v + 1)}
                  />
                </span>
              }
              rules={[{ required: true, message: '请先选择设备' }]}
            >
              <Select
                disabled={loading && !devices.length}
                placeholder={
                  loading
                    ? '正在查找设备…'
                    : !devices.length
                      ? '未发现设备'
                      : !availableDevices.length
                        ? '设备均在使用中'
                        : '请选择设备'
                }
                options={devices.map((d) => ({
                  value: d.id,
                  label: `${choiceLabel(d)}${reservedSources.includes(`${source}:${d.id}`) ? '（使用中）' : ''}`,
                  disabled: reservedSources.includes(`${source}:${d.id}`),
                }))}
              />
            </Form.Item>
          )}
          <Form.Item name="reuseConfiguration" valuePropName="checked">
            <Checkbox className="ios-hid-reuse-configuration">
              使用已保存的校准配置（取消勾选可重新设置）
            </Checkbox>
          </Form.Item>
          {airplaySetupUrl ? (
            <BindingSetup
              source="airplay"
              baseUrl={airplaySetupUrl}
              key={airplaySetupUrl}
              previewTarget={previewTarget}
              peers={peers}
              selectedPeerId={selectedPeerId}
              onSelectPeer={selectPeer}
              onStop={stopAirplay}
              verifying={
                connection.phase === 'connecting' && !connection.setupId
              }
            />
          ) : (
            <Button
              className="session-setup-submit"
              loading={pending}
              htmlType="submit"
              type="primary"
              block
              disabled={
                !peers.some((peer) => peer.id === selectedPeerId) ||
                !bluetoothOnline ||
                (source !== 'airplay' && (loading || !selectedAvailable))
              }
            >
              {source === 'airplay'
                ? '启动 AirPlay 接收器'
                : source === 'camera' && connection.phase === 'connecting'
                  ? '正在验证指针…'
                  : '连接设备'}
            </Button>
          )}
        </Form>
        {source === 'camera' && connection.phase === 'connecting' && (
          <output>请保持手机和摄像头静止，屏幕保持明亮。</output>
        )}
        {!pending && source === 'camera' && connection.error && (
          <Alert type="warning" message={connection.error} />
        )}
        {!pending &&
          source === 'camera' &&
          selectedAvailable &&
          selectedCameraId &&
          previewTarget &&
          createPortal(
            cameraPreview.url ? (
              <Frame key={cameraPreview.url} url={cameraPreview.url} />
            ) : (
              <div className="ios-hid-live">
                {cameraPreview.error ? (
                  <Alert type="warning" message={cameraPreview.error} />
                ) : (
                  <Spin tip="正在打开摄像头" />
                )}
              </div>
            ),
            previewTarget,
          )}
        {pending && baseUrl && !airplaySetupUrl && (
          <div className="ios-hid-fields">
            <div ref={setControls} />
            {baseUrl &&
              connection.setupKind === 'device' &&
              !airplaySetupUrl && (
                <BindingSetup
                  source={source}
                  onStop={stopAirplay}
                  peers={peers}
                  selectedPeerId={selectedPeerId}
                  onSelectPeer={selectPeer}
                  key={baseUrl}
                  baseUrl={baseUrl}
                  previewTarget={previewTarget}
                />
              )}
          </div>
        )}
      </div>
    </div>
  );
}
