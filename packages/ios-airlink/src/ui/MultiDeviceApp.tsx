import { Button, Form, Modal, Popover, Tooltip, message } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BindingSetup,
  type Connection,
  ConnectionPanel,
} from './ConnectionPanel';
import { ManagerLayout } from './ManagerLayout';
import { LiveScreenshot, Spinner } from './ScreenPreview';
import { useI18n } from './i18n';
import { type Route, navigate } from './routes';
import { subscribeSSE } from './sse';
import './multi-device.css';

type Workspace = {
  id: string;
  apiBase: string;
  connected: boolean;
  source: string;
  sourceId?: string;
  bluetoothPeerId?: string;
  screenError?: string;
  refreshing?: boolean;
  occupied?: boolean;
  state?: Connection & {
    phase: string;
    device?: { id: string; name: string; modelName?: string };
    error?: string;
  };
};

async function workspaceRequest(path = '', method = 'GET', timeoutMs = 15000) {
  const result = await fetch(`/ios-airlink/workspaces${path}`, {
    method,
    headers: { 'X-Midscene-Playground': 'workspace' },
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const value = await result.json();
  if (!result.ok) throw new Error(value.error ?? '设备列表读取失败');
  return value;
}

export function BluetoothStatusIcon({
  warning = false,
  active = false,
}: { warning?: boolean; active?: boolean }) {
  return (
    <span
      className="ios-airlink-status-icon"
      data-state={warning ? 'warning' : active ? 'active' : 'idle'}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m7 7 10 10-5 4V3l5 4L7 17" />
      </svg>
      {warning && <i />}
    </span>
  );
}

function sourceLabel(source: string, t: (zh: string, en: string) => string) {
  return source === 'camera'
    ? t('独立摄像头', 'Camera')
    : source === 'airplay'
      ? 'AirPlay'
      : 'USB';
}

function workspaceName(item: Workspace, list: Workspace[]) {
  const device = item.state?.device;
  const label = device?.modelName
    ? `${device.name} - ${device.modelName}`
    : (device?.name ?? 'iPhone');
  const same = list.filter(
    (other) =>
      other.connected &&
      other.state?.device?.name === device?.name &&
      other.state?.device?.modelName === device?.modelName,
  );
  return same.length > 1 ? `${label} · ${item.id.slice(0, 4)}` : label;
}

export function MultiDeviceApp({ route }: { route: Route }) {
  const { t, te } = useI18n();
  const [workspaces, setWorkspaces] = useState<Workspace[]>();
  const [adding, setAdding] = useState(false);
  const boot = useRef<Promise<unknown>>();
  const isHome = !route.startsWith('workspace');
  const activeId = route.split('/')[1];

  const reload = useCallback(async () => {
    const value = (await workspaceRequest()) as Workspace[];
    setWorkspaces(value);
    return value;
  }, []);

  useEffect(() => {
    return subscribeSSE('/ios-airlink/workspaces/events', {
      onMessage: (data) => {
        try {
          setWorkspaces(JSON.parse(data) as Workspace[]);
        } catch {
          void message.warning('设备状态读取失败，请刷新页面。');
        }
      },
      onError: () =>
        setWorkspaces((current) =>
          current?.map((item) => ({
            ...item,
            state: {
              ...item.state,
              phase: 'failed',
              error: '设备状态连接中断，正在恢复…',
            },
          })),
        ),
    });
  }, []);

  const addDevice = useCallback(async () => {
    const draft = workspaces?.find((item) => !item.connected);
    if (draft) {
      navigate(`connect/${draft.id}`);
      return;
    }
    setAdding(true);
    try {
      const item = (await workspaceRequest('', 'POST')) as Workspace;
      await reload();
      navigate(`connect/${item.id}`);
    } catch (error) {
      void message.error(String(error));
    } finally {
      setAdding(false);
    }
  }, [reload, workspaces]);

  useEffect(() => {
    if (!workspaces) return;
    const current = activeId
      ? workspaces.find((item) => item.id === activeId)
      : undefined;
    if (current) {
      if (isHome && current.connected) {
        navigate(`workspace/${current.id}`, true);
      }
      return;
    }
    const fallback = isHome
      ? workspaces.find((item) => !item.connected)
      : workspaces.find((item) => item.connected);
    if (fallback) {
      navigate(`${isHome ? 'connect' : 'workspace'}/${fallback.id}`, true);
      return;
    }
    // Single flight also covers React strict-mode effect replay and navigation while adding.
    if (!boot.current)
      boot.current = (async () => {
        const item = (await workspaceRequest('', 'POST')) as Workspace;
        await reload();
        navigate(`connect/${item.id}`, true);
      })()
        .catch((error) => {
          void message.error(String(error));
        })
        .finally(() => {
          boot.current = undefined;
        });
  }, [workspaces, activeId, isHome, reload]);

  const remove = (item: Workspace) => {
    Modal.confirm({
      title: t('移除此设备？', 'Remove this device?'),
      content: t(
        '将从当前列表移除此设备并释放连接，已保存的配置仍然保留。',
        'This removes the device from the active list and releases the connection. Saved calibration profiles are kept.',
      ),
      okText: t('移除', 'Remove'),
      okButtonProps: { danger: true },
      cancelText: t('取消', 'Cancel'),
      centered: true,
      onOk: async () => {
        try {
          await workspaceRequest(`/${item.id}`, 'DELETE');
          const next = await reload();
          const remaining = next.find((other) => other.connected);
          if (remaining) navigate(`workspace/${remaining.id}`, true);
          else navigate('workspace', true);
        } catch (error) {
          void message.warning(
            error instanceof Error
              ? te(error.message)
              : t('移除失败，请重试。', 'Failed to remove. Please try again.'),
          );
          throw error;
        }
      },
    });
  };

  if (
    !workspaces ||
    !activeId ||
    !workspaces.some((item) => item.id === activeId)
  )
    return (
      <div className="ios-airlink-loading">
        <Spinner size={26} />
      </div>
    );

  const connectedDevices = workspaces.filter((item) => item.connected);
  const setupItem = isHome
    ? workspaces.find((item) => item.id === activeId && !item.connected)
    : undefined;

  const inlineSetup = connectedDevices.length === 0 && Boolean(setupItem);

  return (
    <ManagerLayout
      adding={adding}
      onAdd={() => void addDevice()}
      showAdd={!inlineSetup}
    >
      {inlineSetup && setupItem ? (
        <AddDeviceModal
          inline
          item={setupItem}
          workspaces={workspaces}
          hasConnected={false}
          reload={reload}
        />
      ) : connectedDevices.length === 0 ? (
        <div className="ios-airlink-empty-grid">
          <div className="ios-airlink-empty-card">
            <div className="ios-airlink-empty-title">
              {t('暂无已接入设备', 'No connected devices')}
            </div>
            <Button
              type="primary"
              className="ios-airlink-primary-btn"
              loading={adding}
              onClick={() => void addDevice()}
            >
              {t('＋ 添加设备', '+ Add Device')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="ios-airlink-card-grid">
            {connectedDevices.map((item) => (
              <DeviceCard
                key={item.id}
                item={item}
                workspaces={workspaces}
                onRemove={() => remove(item)}
                reload={reload}
              />
            ))}
            <button
              type="button"
              className="ios-airlink-add-grid-card"
              onClick={() => void addDevice()}
            >
              <span className="ios-airlink-add-grid-plus">＋</span>
              <span>{t('添加设备', 'Add Device')}</span>
            </button>
          </div>

          {setupItem && (
            <AddDeviceModal
              item={setupItem}
              workspaces={workspaces}
              hasConnected={connectedDevices.length > 0}
              connectedFallbackId={connectedDevices[0]?.id}
              reload={reload}
            />
          )}
        </>
      )}
    </ManagerLayout>
  );
}

function DeviceCard({
  item,
  workspaces,
  onRemove,
  reload,
}: {
  item: Workspace;
  workspaces: Workspace[];
  onRemove: () => void;
  reload: () => Promise<Workspace[]>;
}) {
  const { t, te } = useI18n();
  const [previewTarget, setPreviewTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const [detailOpen, setDetailOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [cancellingRecovery, setCancellingRecovery] = useState(false);
  const busy = refreshing || Boolean(item.refreshing);
  const lastRecoverySetup = useRef<string>();
  if (busy && item.source === 'airplay' && item.state?.setupId)
    lastRecoverySetup.current = `${item.apiBase}/ios-airlink/setup/${item.state.setupId}`;
  if (!busy) lastRecoverySetup.current = undefined;
  const recoverySetup = lastRecoverySetup.current;
  const [recoveryBluetoothConnected, setRecoveryBluetoothConnected] =
    useState<boolean>();
  useEffect(() => {
    setRecoveryBluetoothConnected(undefined);
  }, [recoverySetup]);

  const recoveryMessage =
    item.state?.phase === 'connecting'
      ? t('正在恢复设备控制…', 'Restoring device control…')
      : recoverySetup
        ? recoveryBluetoothConnected === false
          ? t(
              '等待蓝牙重新连接，请在手机「设置 → 蓝牙」中连接这台 Mac。',
              'Waiting for Bluetooth reconnection. Connect to this Mac in Settings → Bluetooth on your iPhone.',
            )
          : recoveryBluetoothConnected === true
            ? t(
                '等待手机恢复屏幕镜像…',
                'Waiting for Screen Mirroring to resume…',
              )
            : t('正在获取蓝牙连接状态…', 'Checking Bluetooth status…')
        : t('正在检查设备连接…', 'Checking device connection…');

  const ready = item.state?.phase === 'ready' && !item.screenError && !busy;
  const error = te(
    item.screenError ??
      item.state?.error ??
      '设备连接已断开，请检查连接后点击刷新。',
  );
  const name = workspaceName(item, workspaces);
  const deviceId = item.state?.device?.id;

  const refresh = async () => {
    if (busy) return;
    setRefreshing(true);
    try {
      await workspaceRequest(
        `/${item.id}/refresh`,
        'POST',
        10 * 60_000 + 15000,
      );
    } catch (err) {
      void message.warning(
        err instanceof Error
          ? te(err.message)
          : t('恢复失败，请重试。', 'Recovery failed. Please try again.'),
      );
    } finally {
      await reload().catch(() => {});
      setRefreshing(false);
    }
  };

  const getScreenshot = useCallback(async () => {
    const response = await fetch(`${item.apiBase}/screenshot`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new Error(t('画面获取失败', 'Failed to fetch frame'));
    return response.json();
  }, [item.apiBase, t]);

  const copyId = () => {
    if (!deviceId) return;
    void navigator.clipboard
      .writeText(deviceId)
      .then(() => message.success(t('已复制设备 ID', 'Copied device ID')))
      .catch(() =>
        message.warning(
          t(
            '复制失败，请手动选择设备 ID。',
            'Copy failed. Please copy the device ID manually.',
          ),
        ),
      );
  };

  const statusPopover = (
    <div className="ios-airlink-popover-details">
      <div className="ios-airlink-kv-row">
        <span className="ios-airlink-kv-label">
          {t('占用状态', 'Occupancy')}
        </span>
        <span className="ios-airlink-kv-value">
          <span
            className={`ios-airlink-occupancy-pill${item.occupied ? ' occupied' : ''}`}
          >
            <i />
            {item.occupied ? t('使用中', 'In Use') : t('空闲可用', 'Available')}
          </span>
        </span>
      </div>
      <div className="ios-airlink-kv-row">
        <span className="ios-airlink-kv-label">{t('画面来源', 'Screen')}</span>
        <span className="ios-airlink-kv-value">
          {sourceLabel(item.source, t)} ·{' '}
          {item.screenError
            ? t('画面中断', 'Interrupted')
            : item.state?.phase === 'ready'
              ? t('正常', 'OK')
              : t('不可用', 'Unavailable')}
        </span>
      </div>
      <div className="ios-airlink-kv-row">
        <span className="ios-airlink-kv-label">
          {t('蓝牙键鼠', 'Bluetooth HID')}
        </span>
        <span className="ios-airlink-kv-value">
          {item.state?.phase === 'ready'
            ? t('已连接', 'Connected')
            : t('已断开', 'Disconnected')}
        </span>
      </div>
      <div className="ios-airlink-kv-row">
        <span className="ios-airlink-kv-label">{t('指针验证', 'Pointer')}</span>
        <span className="ios-airlink-kv-value">
          {ready
            ? t('已通过', 'Verified')
            : t('等待重新验证', 'Needs re-verification')}
        </span>
      </div>
      <div className="ios-airlink-kv-row">
        <span className="ios-airlink-kv-label">
          {t('设备 ID', 'Device ID')}
        </span>
        <span className="ios-airlink-kv-value">
          <code>{deviceId ?? t('等待连接', 'Pending')}</code>
        </span>
      </div>
      {!ready && (
        <div className="ios-airlink-device-notice" style={{ marginTop: 8 }}>
          <span>{busy ? recoveryMessage : error}</span>
        </div>
      )}
    </div>
  );

  const cancelRecovery = () => {
    if (!recoverySetup || cancellingRecovery) return;
    const setupId = recoverySetup.split('/').filter(Boolean).at(-1);
    if (!setupId) return;
    setCancellingRecovery(true);
    void fetch(`${recoverySetup}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Midscene-Setup': setupId,
      },
      body: '{}',
      signal: AbortSignal.timeout(10_000),
    })
      .catch(() => {})
      .finally(() => {
        setCancellingRecovery(false);
      });
  };

  return (
    <article className="ios-airlink-card">
      <div className="ios-airlink-card-stage">
        <div className="ios-airlink-card-badges">
          <Popover
            trigger={['hover', 'click']}
            placement="bottomLeft"
            content={statusPopover}
          >
            <button
              type="button"
              className={`ios-airlink-status-badge${ready ? ' ready' : ''}`}
            >
              <i />
              {ready
                ? t('连接正常', 'Connected')
                : busy
                  ? t('正在恢复', 'Recovering')
                  : t('需要处理', 'Attention')}
            </button>
          </Popover>
          <span className="ios-airlink-source-tag">
            {sourceLabel(item.source, t)}
          </span>
        </div>

        <button
          type="button"
          className="ios-airlink-thumb-bezel ios-airlink-thumb-clickable"
          aria-label={t(`查看 ${name} 详情`, `View ${name} details`)}
          onClick={() => setDetailOpen(true)}
        >
          <div className="ios-airlink-thumb-screen">
            <LiveScreenshot getScreenshot={getScreenshot} paused={!ready} />
          </div>
        </button>

        {!ready && (
          <div className="ios-airlink-device-preview-error">
            <strong>
              {busy
                ? t('正在恢复设备连接…', 'Restoring connection…')
                : item.screenError
                  ? t('画面已中断', 'Screen Interrupted')
                  : t('设备连接已断开', 'Disconnected')}
            </strong>
            {!busy && <p>{error}</p>}
            <Button
              type="primary"
              size="small"
              className="ios-airlink-primary-btn"
              loading={busy}
              onClick={() => void refresh()}
            >
              {t('刷新', 'Refresh')}
            </Button>
          </div>
        )}
      </div>

      <footer className="ios-airlink-card-footer">
        <div className="ios-airlink-card-title" title={name}>
          {name}
        </div>
        <div className="ios-airlink-card-tools">
          <Tooltip title={t('复制设备 ID', 'Copy Device ID')}>
            <Button
              size="small"
              type="text"
              aria-label={t('复制设备 ID', 'Copy Device ID')}
              className="ios-airlink-icon-btn"
              disabled={!deviceId}
              onClick={copyId}
              icon={
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
                  <rect x="9" y="9" width="12" height="12" rx="2.5" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
              }
            />
          </Tooltip>
          <Tooltip title={t('移除设备', 'Remove Device')}>
            <Button
              size="small"
              type="text"
              aria-label={t('移除设备', 'Remove Device')}
              className="ios-airlink-icon-btn danger"
              onClick={onRemove}
              icon={
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
                  <path d="M4 7h16" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
                  <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              }
            />
          </Tooltip>
        </div>
      </footer>

      <Modal
        open={Boolean(recoverySetup)}
        footer={null}
        closable
        onCancel={cancelRecovery}
        width={480}
        centered
        title={t('恢复 AirPlay 连接', 'Restore AirPlay Connection')}
      >
        <div className="ios-airlink-recovery-preview" ref={setPreviewTarget}>
          {recoverySetup && (
            <BindingSetup
              key={recoverySetup}
              recovery
              onBluetoothStatus={setRecoveryBluetoothConnected}
              baseUrl={recoverySetup}
              source="airplay"
              previewTarget={previewTarget}
              peers={
                item.bluetoothPeerId ? [{ id: item.bluetoothPeerId, name }] : []
              }
              selectedPeerId={item.bluetoothPeerId}
              onSelectPeer={() => {}}
              verifying={item.state?.phase === 'connecting'}
            />
          )}
        </div>
      </Modal>

      <Modal
        open={detailOpen}
        footer={null}
        width={760}
        centered
        onCancel={() => setDetailOpen(false)}
        className="ios-airlink-detail-modal"
        styles={{ body: { padding: 0 } }}
      >
        <div className="ios-airlink-detail-studio">
          <div className="ios-airlink-detail-preview">
            <div className="ios-airlink-phone-bezel ios-airlink-detail-bezel">
              <div className="ios-airlink-phone-screen">
                <LiveScreenshot getScreenshot={getScreenshot} paused={!ready} />
              </div>
            </div>
          </div>

          <div className="ios-airlink-detail-info">
            <div className="ios-airlink-detail-head">
              <h3 className="ios-airlink-detail-title" title={name}>
                {name}
              </h3>
              <span
                className={`ios-airlink-status-badge${ready ? ' ready' : ''}`}
              >
                <i />
                {ready
                  ? t('连接正常', 'Connected')
                  : busy
                    ? t('正在恢复', 'Recovering')
                    : t('需要处理', 'Attention')}
              </span>
            </div>

            <div className="ios-airlink-detail-kv-card">
              <div className="ios-airlink-kv-row">
                <span className="ios-airlink-kv-label">
                  {t('占用状态', 'Occupancy')}
                </span>
                <span className="ios-airlink-kv-value">
                  <span
                    className={`ios-airlink-occupancy-pill${item.occupied ? ' occupied' : ''}`}
                  >
                    <i />
                    {item.occupied
                      ? t('使用中', 'In Use')
                      : t('空闲可用', 'Available')}
                  </span>
                </span>
              </div>
              <div className="ios-airlink-kv-row">
                <span className="ios-airlink-kv-label">
                  {t('画面来源', 'Screen')}
                </span>
                <span className="ios-airlink-kv-value">
                  {sourceLabel(item.source, t)} ·{' '}
                  {item.screenError
                    ? t('画面中断', 'Interrupted')
                    : item.state?.phase === 'ready'
                      ? t('正常', 'OK')
                      : t('不可用', 'Unavailable')}
                </span>
              </div>
              <div className="ios-airlink-kv-row">
                <span className="ios-airlink-kv-label">
                  {t('蓝牙键鼠', 'Bluetooth HID')}
                </span>
                <span className="ios-airlink-kv-value">
                  {item.state?.phase === 'ready'
                    ? t('已连接', 'Connected')
                    : t('已断开', 'Disconnected')}
                </span>
              </div>
              <div className="ios-airlink-kv-row">
                <span className="ios-airlink-kv-label">
                  {t('指针验证', 'Pointer')}
                </span>
                <span className="ios-airlink-kv-value">
                  {ready
                    ? t('已通过', 'Verified')
                    : t('等待重新验证', 'Needs re-verification')}
                </span>
              </div>
              <div className="ios-airlink-kv-row">
                <span className="ios-airlink-kv-label">
                  {t('设备 ID', 'Device ID')}
                </span>
                <span className="ios-airlink-kv-value ios-airlink-detail-id">
                  <code>{deviceId ?? t('等待连接', 'Pending')}</code>
                  {deviceId && (
                    <Button size="small" type="text" onClick={copyId}>
                      {t('复制', 'Copy')}
                    </Button>
                  )}
                </span>
              </div>
            </div>

            {!ready && (
              <div className="ios-airlink-device-notice">
                <span>{busy ? recoveryMessage : error}</span>
              </div>
            )}

            <div className="ios-airlink-detail-actions">
              {!ready && (
                <Button
                  type="primary"
                  className="ios-airlink-primary-btn"
                  loading={busy}
                  onClick={() => void refresh()}
                >
                  {t('刷新连接', 'Refresh')}
                </Button>
              )}
              <Button
                danger
                onClick={() => {
                  setDetailOpen(false);
                  onRemove();
                }}
              >
                {t('移除设备', 'Remove Device')}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </article>
  );
}

function AddDeviceModal({
  inline = false,
  item,
  workspaces,
  hasConnected,
  connectedFallbackId,
  reload,
}: {
  inline?: boolean;
  item: Workspace;
  workspaces: Workspace[];
  hasConnected: boolean;
  connectedFallbackId?: string;
  reload: () => Promise<Workspace[]>;
}) {
  const { t, te } = useI18n();
  const [previewTarget, setPreviewTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const [returning, setReturning] = useState(false);
  const [form] = Form.useForm();

  const settingUp =
    item.state?.phase === 'setup-required' ||
    item.state?.phase === 'connecting';

  const returnToAdd = async () => {
    setReturning(true);
    try {
      const response = await fetch(`${item.apiBase}/ios-airlink/cancel`, {
        method: 'POST',
        headers: { 'X-Midscene-Playground': 'setup' },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok)
        throw new Error(
          (await response.json()).error ??
            t('取消失败，请重试。', 'Failed to cancel. Please try again.'),
        );
      await reload();
    } catch (error) {
      void message.warning(
        error instanceof Error
          ? te(error.message)
          : t('取消失败，请重试。', 'Failed to cancel. Please try again.'),
      );
    } finally {
      setReturning(false);
    }
  };

  const createSession = async (input?: Record<string, unknown>) => {
    const response = await fetch(`${item.apiBase}/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Midscene-Playground': 'setup',
      },
      body: JSON.stringify(input ?? {}),
      signal: AbortSignal.timeout(11 * 60_000),
    });
    if (!response.ok)
      throw new Error(
        (await response.json()).error ?? t('连接失败', 'Connection failed'),
      );
    return true;
  };

  const handleClose = () => {
    if (settingUp) {
      void returnToAdd();
      return;
    }
    if (hasConnected && connectedFallbackId) {
      navigate(`workspace/${connectedFallbackId}`);
    }
  };

  const cameraWizardActive = Boolean(
    item.state?.setupKind === 'camera' && item.state?.setupId,
  );

  const studio = (
    <div
      className={`ios-airlink-setup-studio${cameraWizardActive ? ' ios-airlink-setup-studio--camera' : ''}`}
    >
      <div className="ios-airlink-setup-panel">
        <ConnectionPanel
          connection={item.state}
          initialSource={item.source}
          controller={{
            state: { form, sessionMutating: settingUp },
            actions: { createSession },
          }}
          previewTarget={previewTarget}
          apiBase={item.apiBase}
          onCancel={() => void returnToAdd()}
          cancelling={returning}
          reservedPeers={workspaces
            .filter((other) => other.id !== item.id && other.connected)
            .map((other) => other.bluetoothPeerId)
            .filter((id): id is string => Boolean(id))}
          reservedSources={workspaces
            .filter(
              (other) =>
                other.id !== item.id && other.connected && other.sourceId,
            )
            .map((other) => `${other.source}:${other.sourceId}`)}
          onConnected={() => {
            void reload();
            navigate(`workspace/${item.id}`);
          }}
        />
      </div>
      <div className="ios-airlink-setup-preview">
        <div className="ios-airlink-preview" ref={setPreviewTarget} />
      </div>
    </div>
  );

  if (inline) {
    return (
      <div
        className={`ios-airlink-inline-setup${cameraWizardActive ? ' ios-airlink-inline-setup--camera' : ''}`}
      >
        {studio}
      </div>
    );
  }

  return (
    <Modal
      open
      footer={null}
      width={cameraWizardActive ? 980 : 860}
      centered
      closable={hasConnected || settingUp}
      maskClosable={hasConnected && !settingUp}
      onCancel={handleClose}
      className="ios-airlink-add-modal"
      styles={{ body: { padding: 0 } }}
    >
      {studio}
    </Modal>
  );
}
