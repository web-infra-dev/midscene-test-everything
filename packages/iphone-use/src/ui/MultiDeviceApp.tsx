import { DisconnectedPreview } from '@midscene/device-manager-ui/shell/DisconnectedPreview.tsx';
import { ScreenshotViewer } from '@midscene/device-manager-ui/visualizer';
import {
  Button,
  Form,
  Modal,
  Popover,
  Select,
  Spin,
  Tooltip,
  message,
} from 'antd';
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
      cancelText: '取消',
      onOk: async () => {
        await workspaceRequest(`/${item.id}`, 'DELETE');
        await reload();
        navigate('workspace', true);
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
  return (
    <>
      {workspaces.map((item) => (
        <DeviceWorkspace
          key={item.id}
          item={item}
          workspaces={workspaces}
          isHome={isHome}
          active={item.id === activeId}
          adding={adding}
          onAdd={addDevice}
          onRemove={remove}
          reload={reload}
        />
      ))}
    </>
  );
}
function DeviceWorkspace({
  item,
  workspaces,
  isHome,
  active,
  adding,
  onAdd,
  onRemove,
  reload,
}: {
  item: Workspace;
  workspaces: Workspace[];
  isHome: boolean;
  active: boolean;
  adding: boolean;
  onAdd: () => Promise<void>;
  onRemove: (item: Workspace) => void;
  reload: () => Promise<Workspace[]>;
}) {
  const [previewTarget, setPreviewTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const [returning, setReturning] = useState(false);
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
        throw new Error((await response.json()).error ?? '返回失败，请重试。');
      await reload();
    } catch (error) {
      void message.warning(
        error instanceof Error ? error.message : '返回失败，请重试。',
      );
    } finally {
      setReturning(false);
    }
  };
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
  const tabs = workspaces.filter((other) => other.connected);
  const name = workspaceName(item, workspaces);
  const refresh = async () => {
    if (busy) return;
    setRefreshing(true);
    try {
      await workspaceRequest(
        `/${item.id}/refresh`,
        'POST',
        10 * 60_000 + 15000,
      );
    } catch (error) {
      void message.warning(
        error instanceof Error ? error.message : '恢复失败，请重试。',
      );
    } finally {
      await reload().catch(() => {});
      setRefreshing(false);
    }
  };
  const details = (
    <div className="iphone-use-device-details">
      <strong>{name}</strong>
      <dl>
        <dt>画面来源</dt>
        <dd>
          {sourceLabel(item.source)} ·{' '}
          {item.screenError
            ? '画面中断'
            : item.state?.phase === 'ready'
              ? '正常'
              : '不可用'}
        </dd>
        <dt>蓝牙键鼠</dt>
        <dd>{item.state?.phase === 'ready' ? '已连接' : '已断开'}</dd>
        <dt>指针验证</dt>
        <dd>{ready ? '已通过' : '等待重新验证'}</dd>
      </dl>
      <Button size="small" type="text" danger onClick={() => onRemove(item)}>
        移除设备
      </Button>
    </div>
  );
  const recoveryControls = (
    <>
      {!ready && item.connected && (
        <div className="iphone-use-device-notice">
          <span>{busy ? recoveryMessage : error}</span>
        </div>
      )}
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
    </>
  );
  const [form] = Form.useForm();
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
  const getScreenshot = useCallback(async () => {
    const response = await fetch(`${item.apiBase}/screenshot`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('画面获取失败');
    return response.json();
  }, [item.apiBase]);
  const setup =
    active && isHome ? (
      <div className="iphone-use-connect-page">
        {(tabs.length > 0 || settingUp) && (
          <nav className="iphone-use-connect-nav" aria-label="页面导航">
            <Button
              className="iphone-use-back-workspace"
              type="text"
              size="small"
              loading={returning}
              onClick={() => {
                if (settingUp) void returnToAdd();
                else
                  navigate(
                    `workspace/${tabs.some((other) => other.id === item.id) ? item.id : tabs[0].id}`,
                  );
              }}
            >
              {settingUp ? '← 返回添加设备' : '← 返回工作台'}
            </Button>
          </nav>
        )}
        <ConnectionPanel
          connection={item.state}
          initialSource={item.source}
          controller={{
            state: { form, sessionMutating: settingUp },
            actions: { createSession },
          }}
          previewTarget={previewTarget}
          apiBase={item.apiBase}
          reservedPeers={workspaces
            .filter(
              (other) =>
                // Occupancy follows workspace membership, including outages.
                other.id !== item.id && other.connected,
            )
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
    ) : null;
  if (!active) return null;
  return (
    <ManagerLayout
      sidebar={
        <div className="iphone-use-manager-panel">
          {recoveryControls}
          {isHome ? (
            setup
          ) : (
            <section className="iphone-use-manager-summary">
              <div className="iphone-use-manager-summary-heading">
                <h2>设备信息</h2>
                <span
                  className={`iphone-use-manager-status${ready ? ' ready' : ''}`}
                >
                  {ready ? '连接正常' : busy ? '正在恢复' : '需要处理'}
                </span>
              </div>
              <dl>
                <dt>设备名称</dt>
                <dd>{name}</dd>
                <dt>画面来源</dt>
                <dd>{sourceLabel(item.source)}</dd>
                <dt>蓝牙键鼠</dt>
                <dd>{item.state?.phase === 'ready' ? '已连接' : '未连接'}</dd>
                <dt>设备 ID</dt>
                <dd className="iphone-use-manager-device-id">
                  <code>{item.state?.device?.id ?? '等待连接'}</code>
                  <Button
                    size="small"
                    type="text"
                    disabled={!item.state?.device?.id}
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(item.state!.device!.id)
                        .then(() => message.success('已复制设备 ID'))
                        .catch(() =>
                          message.warning('复制失败，请手动选择设备 ID。'),
                        );
                    }}
                  >
                    复制
                  </Button>
                </dd>
              </dl>
            </section>
          )}
        </div>
      }
      preview={
        isHome || !item.connected ? (
          <div className="iphone-use-preview" ref={setPreviewTarget}>
            <DisconnectedPreview />
          </div>
        ) : recoverySetup ? (
          <div className="iphone-use-preview" ref={setPreviewTarget} />
        ) : (
          <div className="iphone-use-device-preview">
            <div className="iphone-use-device-preview-header">
              <div className="iphone-use-preview-device">
                {tabs.length > 1 ? (
                  <Select
                    aria-label="切换设备"
                    size="small"
                    variant="borderless"
                    value={item.id}
                    onChange={(id) => navigate(`workspace/${id}`)}
                    options={tabs.map((other) => ({
                      value: other.id,
                      label: (
                        <span className="iphone-use-device-option">
                          <span
                            className={`iphone-use-device-dot${other.state?.phase !== 'ready' || other.screenError ? ' warning' : ''}`}
                          />
                          {workspaceName(other, workspaces)}
                        </span>
                      ),
                    }))}
                  />
                ) : (
                  <span>{name}</span>
                )}
                <small>／ {sourceLabel(item.source)}</small>
              </div>
              <div className="iphone-use-preview-actions">
                <Button
                  type="text"
                  size="small"
                  loading={adding}
                  onClick={() => void onAdd()}
                >
                  ＋ 添加设备
                </Button>
                <Popover
                  trigger={['hover', 'click']}
                  placement="bottomRight"
                  content={details}
                >
                  <Tooltip title={ready ? '设备已就绪' : '设备连接异常'}>
                    <Button
                      type="text"
                      size="small"
                      aria-label={
                        ready ? '设备连接状态：已就绪' : '设备连接状态：异常'
                      }
                      icon={
                        <BluetoothStatusIcon active={ready} warning={!ready} />
                      }
                    />
                  </Tooltip>
                </Popover>
              </div>
            </div>
            <div className="iphone-use-device-video">
              <ScreenshotViewer
                mode="screen-only"
                serverOnline
                isUserOperating={!ready}
                getScreenshot={getScreenshot}
              />
              {!ready && item.connected && (
                <div className="iphone-use-device-preview-error">
                  <strong>
                    {busy
                      ? '正在恢复设备连接…'
                      : item.screenError
                        ? '画面已中断'
                        : '设备连接已断开'}
                  </strong>
                  {!busy && <p>{error}</p>}
                  <Button loading={busy} onClick={() => void refresh()}>
                    刷新
                  </Button>
                </div>
              )}
            </div>
          </div>
        )
      }
    />
  );
}
