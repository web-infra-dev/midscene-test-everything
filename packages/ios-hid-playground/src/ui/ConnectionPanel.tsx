import type { PlaygroundControllerResult } from '@midscene/arm-kit-playground/shell/controller/types.ts';
import MidsceneLogo from '@midscene/arm-kit-playground/shell/icons/midscene-logo.svg?react';
import '@midscene/arm-kit-playground/shell/SessionSetupPanel.less';
import { CameraCalibration } from './CameraCalibration';
import { navigate } from './routes';
import '@midscene/robotics-vision/styles.css';
import '@midscene/robotics-vision/screen-setup.less';
import { Alert, Button, Form, Input, Select, Space, Spin, message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Choice = { id: string; name: string; modelName?: string };
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
  airplay?: { name: string; pin: string };
};
async function request(url: string, body?: unknown) {
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
    signal: AbortSignal.timeout(30000),
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
function Frame({ url }: { url: string }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false;
    let previous = '';
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const blob = await (await request(url)).blob();
        if (stopped) return;
        const next = URL.createObjectURL(blob);
        setSrc(next);
        setError('');
        if (previous) URL.revokeObjectURL(previous);
        previous = next;
      } catch (cause) {
        if (!stopped) setError(String(cause));
      }
      if (!stopped) timer = setTimeout(poll, 200);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (previous) URL.revokeObjectURL(previous);
    };
  }, [url]);
  return (
    <div className="ios-hid-live">
      {src ? <img src={src} alt="手机实时画面" /> : <Spin tip="等待手机画面" />}
      {error && <Alert type="warning" message={error} />}
    </div>
  );
}
function BindingSetup({
  baseUrl,
  previewTarget,
  peers,
}: {
  baseUrl: string;
  previewTarget: HTMLElement | null;
  peers: Choice[];
}) {
  const [state, setState] = useState<Binding>();
  const peer = peers.length === 1 ? peers[0].id : undefined;
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const value: Binding = await (await request(`${baseUrl}/state`)).json();
        await request(`${baseUrl}/select`, { usbDeviceId: value.selectedUSB });
        const next: Binding = await (await request(`${baseUrl}/state`)).json();
        if (!stopped) {
          setState(next);
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
  return (
    <Space direction="vertical" className="ios-hid-fields" size="middle">
      {state?.source === 'usb' && (
        <p>
          USB ·{' '}
          {state.devices.find((d) => d.id === state.selectedUSB)?.name ??
            '已选择手机'}
        </p>
      )}
      {state?.source === 'airplay' && (
        <>
          <p>在 iPhone 控制中心打开「屏幕镜像」，选择以下接收器。</p>
          <strong>{state.airplay?.name ?? '正在启动接收器…'}</strong>
          {state.airplay && <p>配对码：{state.airplay.pin}</p>}
        </>
      )}
      <strong>{state?.selectedPeer ? '确认画面' : '蓝牙连接'}</strong>
      {!state?.selectedPeer && (
        <p>
          在 iPhone「设置 → 蓝牙」中连接「Midscene 」，并在「辅助功能 →
          触控」中启用辅助触控。
        </p>
      )}
      <div className="ios-hid-bluetooth-status">
        {peers.map((peer) => (
          <div key={peer.id} className="ios-hid-bluetooth-device">
            <span className="ios-hid-online-dot" />
            {peer.name}
          </div>
        ))}
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
        onClick={() => {
          setBusy(true);
          setError('');
          void request(`${baseUrl}/confirm`, {
            bluetoothPeerId: peer,
            confirmed: true,
          })
            .catch((cause) => setError(String(cause)))
            .finally(() => setBusy(false));
        }}
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
function SavedSelection({ baseUrl }: { baseUrl: string }) {
  const [items, setItems] = useState<Choice[]>([]);
  const [id, setId] = useState<string>();
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false;
    void request(`${baseUrl}/devices`)
      .then((r) => r.json())
      .then((items) => {
        if (!stopped) setItems(items);
      })
      .catch((cause) => {
        if (!stopped) setError(String(cause));
      });
    return () => {
      stopped = true;
    };
  }, [baseUrl]);
  return (
    <Space direction="vertical" className="ios-hid-fields">
      <p>有多个已保存配置，请选择这台手机的配置。</p>
      <Select
        aria-label="已保存设备"
        value={id}
        onChange={setId}
        options={items.map((item) => ({ value: item.id, label: item.name }))}
      />
      <Button
        disabled={!id}
        onClick={() => {
          void request(`${baseUrl}/select`, { id }).catch((cause) =>
            setError(String(cause)),
          );
        }}
      >
        继续
      </Button>
      {error && <Alert type="warning" message={error} />}
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
  controller: PlaygroundControllerResult;
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
        const peer = value.hosts.length === 1 ? value.hosts[0].id : undefined;
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
  const notifiedError = useRef(connection.error ?? '');
  useEffect(() => {
    const notice = error || connection.error || '';
    if (notice && notice !== notifiedError.current)
      void message.warning(notice);
    notifiedError.current = notice;
  }, [error, connection.error]);
  const baseUrl = connection.setupId
    ? `${apiBase}/ios-hid/setup/${connection.setupId}`
    : undefined;
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
          initialValues={{ source: initialSource }}
          hidden={pending && Boolean(baseUrl)}
          disabled={pending}
          onFinish={async () => {
            setCameraId(state.form.getFieldValue('cameraId'));
            setError('');
            setPreparing(true);
            try {
              await cameraPreview.release.current();
              const { name: _name, ...input } = state.form.getFieldsValue(true);
              if (await actions.createSession(input)) {
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
              {connectedPeers.map((peer) => (
                <div key={peer.id} className="ios-hid-bluetooth-device">
                  <span className="ios-hid-online-dot" />
                  {peer.name}
                </div>
              ))}
              {!connectedPeers.length && (
                <span className="ios-hid-waiting">
                  <span className="ios-hid-waiting-ring" aria-hidden="true" />
                  {!bluetoothOnline
                    ? '正在连接蓝牙服务…'
                    : bluetoothState === 'bluetooth off'
                      ? '请开启 Mac 蓝牙'
                      : /not allowed|failed|unavailable/.test(bluetoothState)
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
          <Button
            className="session-setup-submit"
            loading={pending}
            htmlType="submit"
            type="primary"
            block
            disabled={
              peers.length !== 1 ||
              !bluetoothOnline ||
              (source !== 'airplay' && (loading || !selectedAvailable))
            }
          >
            {source === 'airplay' ? '启动 AirPlay 接收器' : '连接设备'}
          </Button>
        </Form>
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
        {pending && baseUrl && (
          <div className="ios-hid-fields">
            <div ref={setControls} />
            {baseUrl && connection.setupKind === 'selection' && (
              <SavedSelection key={baseUrl} baseUrl={baseUrl} />
            )}
            {baseUrl && connection.setupKind === 'device' && (
              <BindingSetup
                peers={peers}
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
