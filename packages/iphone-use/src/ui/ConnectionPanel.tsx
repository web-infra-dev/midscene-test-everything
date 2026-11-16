import {
  Button,
  Checkbox,
  Form,
  type FormInstance,
  Input,
  Segmented,
  Select,
  Space,
  message,
} from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AirPlaySetupInfo } from '../hardware/types.js';
import { AirPlayPreview } from './AirPlayPreview';
import { CameraCalibration } from './CameraCalibration';
import { Frame, Spinner } from './ScreenPreview';
import {
  bluetoothLabel,
  resolveBluetoothSelection,
} from './bluetooth-selection';
import { useI18n } from './i18n';
import { navigate } from './routes';
import { subscribeSSE } from './sse';

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
            `${apiBase}/iphone-use/camera-preview/${encodeURIComponent(cameraId)}`,
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
              `${apiBase}/iphone-use/camera-preview/${preview.id}/close`,
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
          setUrl(`${apiBase}/iphone-use/camera-preview/${preview.id}/frame`);
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
      className="iphone-use-refresh"
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
          className={spinning ? 'iphone-use-refresh-spinning' : undefined}
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
  const { t } = useI18n();
  return (
    <fieldset
      aria-label={t('选择蓝牙手机', 'Select Bluetooth phone')}
      className="iphone-use-bluetooth-status"
    >
      {peers.map((peer) => {
        const occupied = reserved.includes(peer.id);
        return (
          <button
            key={peer.id}
            type="button"
            className="iphone-use-bluetooth-device"
            aria-pressed={selected === peer.id}
            disabled={disabled || occupied}
            onClick={() => onSelect(peer.id)}
          >
            <span className="iphone-use-online-dot" />
            <span>{bluetoothLabel(peer, peers)}</span>
            {occupied ? (
              <small>{t('使用中', 'In Use')}</small>
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
  const { t, te } = useI18n();
  const [state, setState] = useState<Binding>();
  const [airplay, setAirplay] = useState<AirPlaySetupInfo>();
  const [eventsOnline, setEventsOnline] = useState(false);
  const peer = peers.find((item) => item.id === selectedPeerId)?.id;
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (error) void message.warning(te(error));
  }, [error, te]);
  useEffect(() => {
    if (!recovery || verifying) return;
    return subscribeSSE(
      baseUrl.replace(/\/setup\/[^/]+\/?$/, '/bluetooth/events'),
      {
        onMessage: (data) => {
          const status = JSON.parse(data) as {
            hosts: { id: string; reports: number[] }[];
          };
          onBluetoothStatus?.(
            status.hosts.some(
              (host) =>
                host.id === selectedPeerId &&
                [1, 2, 3].every((report) => host.reports.includes(report)),
            ),
          );
        },
        onError: () => onBluetoothStatus?.(undefined),
      },
      'iphone-use:bluetooth',
    );
  }, [baseUrl, recovery, verifying, selectedPeerId, onBluetoothStatus]);
  const selectReceiver = useCallback(
    async (isStopped?: () => boolean) => {
      setError('');
      if (source === 'airplay') {
        const result = (await (
          await request(`${baseUrl}/select`, {}, 240_000)
        ).json()) as {
          airplay?: AirPlaySetupInfo;
          selectedPeer?: string;
        };
        if (isStopped?.()) return;
        if (result.selectedPeer) {
          setState(
            (current) =>
              ({
                ...(current ?? {
                  source: 'airplay',
                  computerName: '',
                  devices: [],
                  bluetooth: { hosts: [] },
                }),
                selectedPeer: result.selectedPeer,
                airplay: result.airplay ?? current?.airplay,
              }) as Binding,
          );
        }
        if (result.airplay) {
          setAirplay((current) =>
            current?.state === 'streaming' ? current : result.airplay,
          );
        }
        setPreview(true);
        return;
      }
      const value: Binding = await (await request(`${baseUrl}/state`)).json();
      await request(
        `${baseUrl}/select`,
        { usbDeviceId: value.selectedUSB },
        240_000,
      );
      const next: Binding = await (await request(`${baseUrl}/state`)).json();
      if (!isStopped?.()) {
        setState(next);
        setAirplay((current) => current ?? next.airplay);
        setPreview(true);
      }
    },
    [baseUrl, source],
  );
  useEffect(() => {
    let stopped = false;
    void selectReceiver(() => stopped).catch((cause) => {
      if (!stopped) setError(String(cause));
    });
    return () => {
      stopped = true;
    };
  }, [selectReceiver]);
  useEffect(() => {
    if (source !== 'airplay' || verifying) return;
    return subscribeSSE(`${baseUrl}/events`, {
      onMessage: (data) => {
        const value = JSON.parse(data) as { airplay?: AirPlaySetupInfo };
        if (value.airplay) setAirplay(value.airplay);
        setEventsOnline(true);
      },
      onError: () => setEventsOnline(false),
    });
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
          <div className="iphone-use-submit-row">
            {info?.state === 'failed' || (!info && Boolean(error)) ? (
              <Button
                type="primary"
                block
                className="session-setup-submit"
                disabled={checking}
                onClick={() => {
                  void selectReceiver().catch((cause) =>
                    setError(String(cause)),
                  );
                }}
              >
                {t('重试接收器', 'Retry Receiver')}
              </Button>
            ) : (
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
                {t('验证并连接', 'Verify & Connect')}
              </Button>
            )}
            {onStop && (
              <Button
                className="iphone-use-cancel-btn"
                disabled={false}
                onClick={onStop}
              >
                {t('取消连接', 'Cancel')}
              </Button>
            )}
          </div>
        )}
        {previewTarget &&
          createPortal(
            <AirPlayPreview
              info={info}
              frameUrl={`${baseUrl}/frame`}
              verifying={checking}
              setupError={error}
            />,
            previewTarget,
          )}
      </>
    );
  }
  return (
    <Space direction="vertical" className="iphone-use-fields" size="middle">
      {state?.source === 'usb' && (
        <p>
          USB ·{' '}
          {state.devices.find((d) => d.id === state.selectedUSB)?.name ??
            t('已选择手机', 'Phone selected')}
        </p>
      )}
      <strong>
        {state?.selectedPeer
          ? t('确认画面', 'Confirm Screen')
          : t('蓝牙连接', 'Bluetooth Connection')}
      </strong>
      {!state?.selectedPeer && (
        <p>
          {t(
            `在 iPhone「设置 → 蓝牙」中连接「${state?.computerName ?? 'Mac'}」，并在「辅助功能 → 触控」中启用辅助触控。`,
            `Connect to "${state?.computerName ?? 'Mac'}" in Settings → Bluetooth on your iPhone, and enable AssistiveTouch in Accessibility → Touch.`,
          )}
        </p>
      )}
      <div className="iphone-use-bluetooth-status">
        <BluetoothPeers
          peers={peers}
          selected={peer}
          disabled={busy}
          onSelect={onSelectPeer}
        />
        {!peers.length && (
          <span className="iphone-use-waiting">
            <span className="iphone-use-waiting-ring" aria-hidden="true" />
            {t('等待手机连接…', 'Waiting for iPhone…')}
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
        {t('确认并验证指针', 'Confirm & Verify Pointer')}
      </Button>
      {preview &&
        previewTarget &&
        createPortal(<Frame url={`${baseUrl}/frame`} />, previewTarget)}
    </Space>
  );
}
function PendingScreenPreview({
  apiBase,
  source,
  phase,
}: {
  apiBase: string;
  source: string;
  phase?: string;
}) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`${apiBase}/preview-screenshot`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(4000),
        });
        if (!stopped && res.ok) {
          const data = (await res.json()) as { screenshot?: string };
          if (data.screenshot) setSrc(data.screenshot);
        }
      } catch {
        // Screen source may still be opening; keep polling.
      } finally {
        if (!stopped) timer = setTimeout(() => void poll(), 350);
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [apiBase]);

  const { t } = useI18n();
  const sourceText =
    source === 'camera'
      ? t('摄像头', 'Camera')
      : source === 'airplay'
        ? 'AirPlay'
        : 'USB';
  const calibrating = phase === 'connecting' || Boolean(src);
  return (
    <div className="iphone-use-pending-preview">
      <div className="iphone-use-phone-bezel iphone-use-pending-bezel">
        <div className="iphone-use-phone-screen">
          {src ? (
            <img
              src={src}
              alt={t('设备画面预览', 'Device screen preview')}
              className="iphone-use-pending-img"
            />
          ) : (
            <div className="iphone-use-pending-waiting">
              <Spinner />
              <span>
                {calibrating
                  ? t('正在校准指针…', 'Calibrating pointer…')
                  : t('正在连接设备…', 'Connecting device…')}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="iphone-use-pending-progress">
        <div className="iphone-use-progress-step done">
          <i />
          <span>{t('蓝牙已连接', 'Bluetooth Ready')}</span>
        </div>
        <div
          className={`iphone-use-progress-step ${calibrating ? 'done' : 'active'}`}
        >
          <i />
          <span>{t(`${sourceText} 画面就绪`, `${sourceText} Ready`)}</span>
        </div>
        <div
          className={`iphone-use-progress-step ${calibrating ? 'active' : ''}`}
        >
          <i />
          <span>{t('指针校准', 'Pointer Calibrated')}</span>
        </div>
      </div>
    </div>
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
  onCancel,
  cancelling = false,
}: {
  controller: {
    state: {
      form: FormInstance;
      sessionMutating: boolean;
    };
    actions: {
      createSession: (
        input?: Record<string, unknown>,
        options?: { silent?: boolean },
      ) => Promise<boolean>;
    };
  };
  previewTarget: HTMLElement | null;
  apiBase?: string;
  connection?: Connection;
  reservedPeers?: string[];
  reservedSources?: string[];
  initialSource?: string;
  onConnected?: () => void;
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  const { t, te } = useI18n();
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
    void scopedRequest(`/iphone-use/discover/${source}`)
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
    return subscribeSSE(
      `${apiBase}/iphone-use/bluetooth/events`,
      {
        onMessage: (data) => {
          try {
            const value = JSON.parse(data);
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
        },
        onError: () => {
          setBluetoothOnline(false);
          setPeers([]);
          setConnectedPeers([]);
          state.form.setFieldsValue({
            bluetoothPeerId: undefined,
          });
        },
      },
      'iphone-use:bluetooth',
    );
  }, [state.form, apiBase, reservedPeerKey]);
  // The initial SSE snapshot restores state; it is not a new failure event.
  const cancelled = useRef(false);
  const notifiedError = useRef(connection.error ?? '');
  useEffect(() => {
    const notice = error || connection.error || '';
    if (!cancelled.current && notice && notice !== notifiedError.current)
      void message.warning(te(notice));
    notifiedError.current = notice;
  }, [error, connection.error]);
  const baseUrl = connection.setupId
    ? `${apiBase}/iphone-use/setup/${connection.setupId}`
    : undefined;
  const airplaySetupUrl =
    source === 'airplay' &&
    pending &&
    baseUrl &&
    connection.setupKind === 'device'
      ? baseUrl
      : undefined;
  const stopAirplay = () => {
    cancelled.current = true;
    void scopedRequest('/iphone-use/cancel', {}).catch((cause) => {
      cancelled.current = false;
      setError(String(cause));
    });
  };

  const cameraWizardActive = Boolean(
    pending && connection.setupKind === 'camera' && baseUrl,
  );
  const hideAddForm = Boolean(pending && baseUrl && !airplaySetupUrl);

  return (
    <div
      className={`iphone-use-setup-form-wrap${cameraWizardActive ? ' iphone-use-setup-form-wrap--camera' : ''}`}
    >
      <div
        className={`iphone-use-setup-card${pending && baseUrl && !cameraWizardActive ? ' iphone-use-pending' : ''}${cameraWizardActive ? ' iphone-use-setup-card--camera' : ''}`}
      >
        {!cameraWizardActive && (
          <h2 className="iphone-use-setup-heading">
            {t('添加设备', 'Add Device')}
          </h2>
        )}
        <Form
          form={state.form}
          layout="vertical"
          className="iphone-use-setup-form"
          initialValues={{ source: initialSource, reuseConfiguration: true }}
          style={hideAddForm ? { display: 'none' } : undefined}
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
          <div className="iphone-use-step-card">
            <div className="iphone-use-step-card-head">
              <span className="iphone-use-step-title">
                <i
                  className={`iphone-use-step-index${selectedPeerId ? ' done' : ''}`}
                >
                  1
                </i>
                {t('蓝牙连接', 'Bluetooth')}
              </span>
              <span
                className="iphone-use-step-card-meta"
                title={t(
                  `设置 → 蓝牙 · ${bluetoothName}`,
                  `Settings → Bluetooth · ${bluetoothName}`,
                )}
              >
                {t(
                  `设置 → 蓝牙 · ${bluetoothName}`,
                  `Settings · ${bluetoothName}`,
                )}
              </span>
            </div>
            <div className="iphone-use-bluetooth-status" aria-live="polite">
              <BluetoothPeers
                peers={connectedPeers}
                selected={selectedPeerId}
                reserved={reservedPeers}
                disabled={pending || !bluetoothOnline}
                onSelect={selectPeer}
              />
              {!connectedPeers.length && (
                <span className="iphone-use-waiting">
                  <span
                    className="iphone-use-waiting-ring"
                    aria-hidden="true"
                  />
                  {!bluetoothOnline
                    ? t('正在连接蓝牙服务…', 'Connecting Bluetooth service…')
                    : bluetoothState.toLowerCase() === 'bluetooth off'
                      ? t('请开启 Mac 蓝牙', 'Turn on Mac Bluetooth')
                      : /not allowed|failed|unavailable/i.test(bluetoothState)
                        ? t(
                            '蓝牙服务不可用，请检查系统蓝牙权限',
                            'Bluetooth unavailable. Check system Bluetooth permissions.',
                          )
                        : t('等待手机连接…', 'Waiting for iPhone…')}
                </span>
              )}
            </div>
          </div>

          <Form.Item name="bluetoothPeerId" hidden>
            <Input />
          </Form.Item>

          <div className="iphone-use-step-card">
            <div className="iphone-use-step-card-head">
              <span className="iphone-use-step-title">
                <i className="iphone-use-step-index">2</i>
                {t('开启辅助触控', 'Enable AssistiveTouch')}
              </span>
              <span
                className="iphone-use-step-card-meta"
                title={t(
                  '手机设置 → 辅助功能 → 触控 → 辅助触控',
                  'Settings → Accessibility → Touch → AssistiveTouch',
                )}
              >
                {t('辅助功能 → 触控', 'Accessibility → Touch')}
              </span>
            </div>
          </div>

          <div className="iphone-use-step-card iphone-use-step-card-source">
            <div className="iphone-use-step-card-head">
              <span className="iphone-use-step-title">
                <i className="iphone-use-step-index">3</i>
                {t('画面来源', 'Screen Source')}
              </span>
            </div>
            <Form.Item name="source" hidden>
              <Input />
            </Form.Item>
            <Segmented
              block
              disabled={pending}
              value={source}
              onChange={(val) => state.form.setFieldValue('source', val)}
              options={[
                { value: 'usb', label: 'USB' },
                { value: 'airplay', label: 'AirPlay' },
                { value: 'camera', label: t('独立摄像头', 'Camera') },
              ]}
            />
            {source !== 'airplay' && (
              <Form.Item
                name={source === 'usb' ? 'deviceId' : 'cameraId'}
                className="iphone-use-device-field"
                label={
                  <span className="iphone-use-device-label">
                    <span>
                      {source === 'usb'
                        ? t(
                            `USB 手机 · ${devices.length} 台设备`,
                            `USB Phone · ${devices.length}`,
                          )
                        : t(
                            `摄像头 · ${devices.length} 台设备`,
                            `Camera · ${devices.length}`,
                          )}
                    </span>
                    <RefreshDevices
                      loading={loading}
                      onClick={() => setRefresh((v) => v + 1)}
                    />
                  </span>
                }
                rules={[
                  {
                    required: true,
                    message: t('请先选择设备', 'Please select a device'),
                  },
                ]}
              >
                <Select
                  disabled={loading && !devices.length}
                  placeholder={
                    loading
                      ? t('正在查找设备…', 'Finding devices…')
                      : !devices.length
                        ? t('未发现设备', 'No devices found')
                        : !availableDevices.length
                          ? t('设备均在使用中', 'All devices in use')
                          : t('请选择设备', 'Select a device')
                  }
                  options={devices.map((d) => ({
                    value: d.id,
                    label: `${choiceLabel(d)}${reservedSources.includes(`${source}:${d.id}`) ? t('（使用中）', ' (In Use)') : ''}`,
                    disabled: reservedSources.includes(`${source}:${d.id}`),
                  }))}
                />
              </Form.Item>
            )}
            <Form.Item
              name="reuseConfiguration"
              valuePropName="checked"
              className="iphone-use-reuse-item"
            >
              <Checkbox className="iphone-use-reuse-configuration">
                {t('使用已保存的校准配置', 'Reuse saved calibration')}
              </Checkbox>
            </Form.Item>
          </div>
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
            <div className="iphone-use-submit-row">
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
                {source === 'airplay' && !pending
                  ? t('启动 AirPlay 接收器', 'Start AirPlay Receiver')
                  : t('连接设备', 'Connect Device')}
              </Button>
              {pending && onCancel && (
                <Button
                  className="iphone-use-cancel-btn"
                  disabled={false}
                  loading={cancelling}
                  onClick={onCancel}
                >
                  {t('取消连接', 'Cancel')}
                </Button>
              )}
            </div>
          )}
        </Form>
        {cameraWizardActive && baseUrl && (
          <CameraCalibration
            key={baseUrl}
            baseUrl={baseUrl}
            cameraId={cameraId}
            verifying={connection.phase === 'connecting'}
            cancelling={cancelling}
            onCancel={() => {
              if (onCancel) {
                onCancel();
              } else {
                void scopedRequest('/iphone-use/cancel', {}).catch((cause) =>
                  setError(String(cause)),
                );
              }
            }}
          />
        )}
        {pending &&
          !airplaySetupUrl &&
          !(baseUrl && connection.setupKind === 'device') &&
          !(baseUrl && connection.setupKind === 'camera') &&
          previewTarget &&
          createPortal(
            <PendingScreenPreview
              apiBase={apiBase}
              source={source}
              phase={connection.phase}
            />,
            previewTarget,
          )}
        {!pending &&
          !airplaySetupUrl &&
          !(source === 'camera' && selectedAvailable && selectedCameraId) &&
          previewTarget &&
          createPortal(
            <div className="iphone-use-preview-empty">
              <div className="iphone-use-preview-empty-icon" aria-hidden="true">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m7 7 10 10-5 5V2l5 5L7 17" />
                </svg>
              </div>
              <p>
                {source === 'usb'
                  ? t(
                      '连接数据线并解锁，首次请信任 Mac',
                      'Connect USB cable and unlock; trust this Mac if prompted',
                    )
                  : source === 'airplay'
                    ? t(
                        '控制中心 → 屏幕镜像',
                        'Control Center → Screen Mirroring',
                      )
                    : t(
                        '摄像头画面预览（连接后扫码校正）',
                        'Camera preview (scan QR to calibrate after connecting)',
                      )}
              </p>
            </div>,
            previewTarget,
          )}
        {!pending &&
          source === 'camera' &&
          selectedAvailable &&
          selectedCameraId &&
          previewTarget &&
          createPortal(
            cameraPreview.url ? (
              <div className="iphone-use-camera-monitor">
                <Frame key={cameraPreview.url} url={cameraPreview.url} />
              </div>
            ) : (
              <div className="iphone-use-camera-loading">
                {cameraPreview.error ? (
                  <span>{te(cameraPreview.error)}</span>
                ) : (
                  <>
                    <Spinner />
                    <span>{t('正在打开摄像头…', 'Opening camera…')}</span>
                  </>
                )}
              </div>
            ),
            previewTarget,
          )}
        {pending &&
          baseUrl &&
          connection.setupKind === 'device' &&
          !airplaySetupUrl && (
            <div className="iphone-use-fields">
              <div ref={setControls} />
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
            </div>
          )}
      </div>
    </div>
  );
}
