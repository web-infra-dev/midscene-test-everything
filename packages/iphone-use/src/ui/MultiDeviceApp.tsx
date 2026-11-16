import { ScreenshotViewer } from '@midscene/device-manager-ui/visualizer';
import { Button, Form, Modal, Popover, Spin, Tooltip, message } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BindingSetup,
  type Connection,
  ConnectionPanel,
} from './ConnectionPanel';
import { ManagerLayout } from './ManagerLayout';
import { type Route, navigate } from './routes';
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
  const result = await fetch(`/iphone-use/workspaces${path}`, {
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
      className="iphone-use-status-icon"
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

function sourceLabel(source: string) {
  return source === 'camera'
    ? '独立摄像头'
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
    const events = new EventSource('/iphone-use/workspaces/events');
    events.onmessage = (event) => {
      try {
        setWorkspaces(JSON.parse(event.data) as Workspace[]);
      } catch {
        void message.warning('设备状态读取失败，请刷新页面。');
      }
    };
    events.onerror = () =>
      setWorkspaces((current) =>
        current?.map((item) => ({
          ...item,
          state: {
            ...item.state,
            phase: 'failed',
            error: '设备状态连接中断，正在恢复…',
          },
        })),
      );
    return () => events.close();
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
    if (activeId && workspaces.some((item) => item.id === activeId)) return;
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
      title: '移除此设备？',
      content: '将从当前列表移除此设备并释放连接，已保存的配置仍然保留。',
      okText: '移除',
      okButtonProps: { danger: true },
      cancelText: '取消',
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
            error instanceof Error ? error.message : '移除失败，请重试。',
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
      <div className="iphone-use-loading">
        <Spin />
      </div>
    );

  const connectedDevices = workspaces.filter((item) => item.connected);
  const setupItem = isHome
    ? workspaces.find((item) => item.id === activeId)
    : undefined;

  return (
    <ManagerLayout adding={adding} onAdd={() => void addDevice()}>
      {connectedDevices.length === 0 ? (
        <div className="iphone-use-empty-grid">
          <div className="iphone-use-empty-card">
            <div className="iphone-use-empty-title">暂无已接入设备</div>
            <Button
              type="primary"
              className="iphone-use-primary-btn"
              loading={adding}
              onClick={() => void addDevice()}
            >
              ＋ 添加设备
            </Button>
          </div>
        </div>
      ) : (
        <div className="iphone-use-card-grid">
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
            className="iphone-use-add-grid-card"
            onClick={() => void addDevice()}
          >
            <span className="iphone-use-add-grid-plus">＋</span>
            <span>添加设备</span>
          </button>
        </div>
      )}

      {setupItem && (
        <AddDeviceModal
          item={setupItem}
          workspaces={workspaces}
          hasConnected={connectedDevices.length > 0}
          connectedFallbackId={connectedDevices[0]?.id}
          reload={reload}
        />
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
  const [previewTarget, setPreviewTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const [detailOpen, setDetailOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const busy = refreshing || Boolean(item.refreshing);
  const lastRecoverySetup = useRef<string>();
  if (busy && item.source === 'airplay' && item.state?.setupId)
    lastRecoverySetup.current = `${item.apiBase}/iphone-use/setup/${item.state.setupId}`;
  if (!busy) lastRecoverySetup.current = undefined;
  const recoverySetup = lastRecoverySetup.current;
  const [recoveryBluetoothConnected, setRecoveryBluetoothConnected] =
    useState<boolean>();
  useEffect(() => {
    setRecoveryBluetoothConnected(undefined);
  }, [recoverySetup]);

  const recoveryMessage =
    item.state?.phase === 'connecting'
      ? '正在恢复设备控制…'
      : recoverySetup
        ? recoveryBluetoothConnected === false
          ? '等待蓝牙重新连接，请在手机「设置 → 蓝牙」中连接这台 Mac。'
          : recoveryBluetoothConnected === true
            ? '等待手机恢复屏幕镜像…'
            : '正在获取蓝牙连接状态…'
        : '正在检查设备连接…';

  const ready = item.state?.phase === 'ready' && !item.screenError && !busy;
  const error =
    item.screenError ??
    item.state?.error ??
    '设备连接已断开，请检查连接后点击刷新。';
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
        err instanceof Error ? err.message : '恢复失败，请重试。',
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
    if (!response.ok) throw new Error('画面获取失败');
    return response.json();
  }, [item.apiBase]);

  const copyId = () => {
    if (!deviceId) return;
    void navigator.clipboard
      .writeText(deviceId)
      .then(() => message.success('已复制设备 ID'))
      .catch(() => message.warning('复制失败，请手动选择设备 ID。'));
  };

  const statusPopover = (
    <div className="iphone-use-popover-details">
      <div className="iphone-use-kv-row">
        <span className="iphone-use-kv-label">占用状态</span>
        <span className="iphone-use-kv-value">
          <span
            className={`iphone-use-occupancy-pill${item.occupied ? ' occupied' : ''}`}
          >
            <i />
            {item.occupied ? '使用中' : '空闲可用'}
          </span>
        </span>
      </div>
      <div className="iphone-use-kv-row">
        <span className="iphone-use-kv-label">画面来源</span>
        <span className="iphone-use-kv-value">
          {sourceLabel(item.source)} ·{' '}
          {item.screenError
            ? '画面中断'
            : item.state?.phase === 'ready'
              ? '正常'
              : '不可用'}
        </span>
      </div>
      <div className="iphone-use-kv-row">
        <span className="iphone-use-kv-label">蓝牙键鼠</span>
        <span className="iphone-use-kv-value">
          {item.state?.phase === 'ready' ? '已连接' : '已断开'}
        </span>
      </div>
      <div className="iphone-use-kv-row">
        <span className="iphone-use-kv-label">指针验证</span>
        <span className="iphone-use-kv-value">
          {ready ? '已通过' : '等待重新验证'}
        </span>
      </div>
      <div className="iphone-use-kv-row">
        <span className="iphone-use-kv-label">设备 ID</span>
        <span className="iphone-use-kv-value">
          <code>{deviceId ?? '等待连接'}</code>
        </span>
      </div>
      {!ready && (
        <div className="iphone-use-device-notice" style={{ marginTop: 8 }}>
          <span>{busy ? recoveryMessage : error}</span>
        </div>
      )}
    </div>
  );

  return (
    <article className="iphone-use-card">
      <div className="iphone-use-card-stage">
        <div className="iphone-use-card-badges">
          <Popover
            trigger={['hover', 'click']}
            placement="bottomLeft"
            content={statusPopover}
          >
            <button
              type="button"
              className={`iphone-use-status-badge${ready ? ' ready' : ''}`}
            >
              <i />
              {ready ? '连接正常' : busy ? '正在恢复' : '需要处理'}
            </button>
          </Popover>
          <span className="iphone-use-source-tag">
            {sourceLabel(item.source)}
          </span>
        </div>

        <button
          type="button"
          className="iphone-use-thumb-bezel iphone-use-thumb-clickable"
          aria-label={`查看 ${name} 详情`}
          onClick={() => setDetailOpen(true)}
        >
          <div className="iphone-use-thumb-screen">
            <ScreenshotViewer
              mode="screen-only"
              serverOnline
              isUserOperating={!ready}
              getScreenshot={getScreenshot}
            />
          </div>
        </button>

        {!ready && (
          <div className="iphone-use-device-preview-error">
            <strong>
              {busy
                ? '正在恢复设备连接…'
                : item.screenError
                  ? '画面已中断'
                  : '设备连接已断开'}
            </strong>
            {!busy && <p>{error}</p>}
            <Button
              type="primary"
              size="small"
              className="iphone-use-primary-btn"
              loading={busy}
              onClick={() => void refresh()}
            >
              刷新
            </Button>
          </div>
        )}
      </div>

      <footer className="iphone-use-card-footer">
        <div className="iphone-use-card-title" title={name}>
          {name}
        </div>
        <div className="iphone-use-card-tools">
          <Tooltip title="复制设备 ID">
            <Button
              size="small"
              type="text"
              aria-label="复制设备 ID"
              className="iphone-use-icon-btn"
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
          <Tooltip title="移除设备">
            <Button
              size="small"
              type="text"
              aria-label="移除设备"
              className="iphone-use-icon-btn danger"
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
        closable={false}
        width={480}
        centered
        title="恢复 AirPlay 连接"
      >
        <div className="iphone-use-recovery-preview" ref={setPreviewTarget}>
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
        className="iphone-use-detail-modal"
        styles={{ body: { padding: 0 } }}
      >
        <div className="iphone-use-detail-studio">
          <div className="iphone-use-detail-preview">
            <div className="iphone-use-phone-bezel iphone-use-detail-bezel">
              <div className="iphone-use-phone-screen">
                <ScreenshotViewer
                  mode="screen-only"
                  serverOnline
                  isUserOperating={!ready}
                  getScreenshot={getScreenshot}
                />
              </div>
            </div>
          </div>

          <div className="iphone-use-detail-info">
            <div className="iphone-use-detail-head">
              <h3 className="iphone-use-detail-title" title={name}>
                {name}
              </h3>
              <span
                className={`iphone-use-status-badge${ready ? ' ready' : ''}`}
              >
                <i />
                {ready ? '连接正常' : busy ? '正在恢复' : '需要处理'}
              </span>
            </div>

            <div className="iphone-use-detail-kv-card">
              <div className="iphone-use-kv-row">
                <span className="iphone-use-kv-label">占用状态</span>
                <span className="iphone-use-kv-value">
                  <span
                    className={`iphone-use-occupancy-pill${item.occupied ? ' occupied' : ''}`}
                  >
                    <i />
                    {item.occupied ? '使用中' : '空闲可用'}
                  </span>
                </span>
              </div>
              <div className="iphone-use-kv-row">
                <span className="iphone-use-kv-label">画面来源</span>
                <span className="iphone-use-kv-value">
                  {sourceLabel(item.source)} ·{' '}
                  {item.screenError
                    ? '画面中断'
                    : item.state?.phase === 'ready'
                      ? '正常'
                      : '不可用'}
                </span>
              </div>
              <div className="iphone-use-kv-row">
                <span className="iphone-use-kv-label">蓝牙键鼠</span>
                <span className="iphone-use-kv-value">
                  {item.state?.phase === 'ready' ? '已连接' : '已断开'}
                </span>
              </div>
              <div className="iphone-use-kv-row">
                <span className="iphone-use-kv-label">指针验证</span>
                <span className="iphone-use-kv-value">
                  {ready ? '已通过' : '等待重新验证'}
                </span>
              </div>
              <div className="iphone-use-kv-row">
                <span className="iphone-use-kv-label">设备 ID</span>
                <span className="iphone-use-kv-value iphone-use-detail-id">
                  <code>{deviceId ?? '等待连接'}</code>
                  {deviceId && (
                    <Button size="small" type="text" onClick={copyId}>
                      复制
                    </Button>
                  )}
                </span>
              </div>
            </div>

            {!ready && (
              <div className="iphone-use-device-notice">
                <span>{busy ? recoveryMessage : error}</span>
              </div>
            )}

            <div className="iphone-use-detail-actions">
              {!ready && (
                <Button
                  type="primary"
                  className="iphone-use-primary-btn"
                  loading={busy}
                  onClick={() => void refresh()}
                >
                  刷新连接
                </Button>
              )}
              <Button
                danger
                onClick={() => {
                  setDetailOpen(false);
                  onRemove();
                }}
              >
                移除设备
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </article>
  );
}

function AddDeviceModal({
  item,
  workspaces,
  hasConnected,
  connectedFallbackId,
  reload,
}: {
  item: Workspace;
  workspaces: Workspace[];
  hasConnected: boolean;
  connectedFallbackId?: string;
  reload: () => Promise<Workspace[]>;
}) {
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
      const response = await fetch(`${item.apiBase}/iphone-use/cancel`, {
        method: 'POST',
        headers: { 'X-Midscene-Playground': 'setup' },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok)
        throw new Error((await response.json()).error ?? '取消失败，请重试。');
      await reload();
    } catch (error) {
      void message.warning(
        error instanceof Error ? error.message : '取消失败，请重试。',
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
      throw new Error((await response.json()).error ?? '连接失败');
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

  return (
    <Modal
      open
      footer={null}
      width={cameraWizardActive ? 980 : 860}
      centered
      closable={hasConnected || settingUp}
      maskClosable={hasConnected && !settingUp}
      onCancel={handleClose}
      className="iphone-use-add-modal"
      styles={{ body: { padding: 0 } }}
    >
      <div
        className={`iphone-use-setup-studio${cameraWizardActive ? ' iphone-use-setup-studio--camera' : ''}`}
      >
        <div className="iphone-use-setup-panel">
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
        <div className="iphone-use-setup-preview">
          <div className="iphone-use-preview" ref={setPreviewTarget} />
        </div>
      </div>
    </Modal>
  );
}
