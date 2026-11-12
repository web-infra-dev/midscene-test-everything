import { ReloadOutlined } from '@ant-design/icons';
import type { IOSHIDServiceProfile } from '@midscene/ios-hid';
import { Button, Form, Input, Select } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './connect.css';
import { mountPreviewFeedback } from './preview-feedback';

const defaultHost = 'http://localhost:5801';
const storageKey = 'midscene.ios-hid.connection';
const deviceStatus = { available: '可用', busy: '使用中', offline: '离线' };

function serviceOrigin(host: string) {
  let url: URL;
  try {
    url = new URL(host.trim());
  } catch {
    return;
  }
  if (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    !url.username &&
    !url.password &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash
  ) {
    return url.origin;
  }
}

function readConnection(): { host: string; token: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (typeof saved?.host === 'string' && typeof saved.token === 'string')
      return saved;
  } catch {
    // The form also works when browser storage is unavailable.
  }
  return { host: defaultHost, token: '' };
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? '请求失败，请重试。');
  return data;
}

function post<T>(path: string, input: object, signal?: AbortSignal) {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请重试。';
}

type ConnectionValues = { host: string; token: string; deviceId?: string };

function ConnectionForm({ initialNotice }: { initialNotice?: string }) {
  const [saved, setSaved] = useState(readConnection);
  const [form] = Form.useForm<ConnectionValues>();
  const deviceId = Form.useWatch('deviceId', form);
  const previousOrigin = useRef<string | undefined>(saved.host);
  const [devices, setDevices] = useState<IOSHIDServiceProfile[]>([]);
  const [notice, setNotice] = useState(initialNotice);
  const [querying, setQuerying] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const activeQuery = useRef<AbortController>();

  function resetDevices() {
    activeQuery.current?.abort();
    setDevices([]);
    form.setFieldValue('deviceId', undefined);
    setNotice(undefined);
  }

  async function refreshDevices() {
    let values: ConnectionValues;
    try {
      values = await form.validateFields(['host', 'token']);
    } catch {
      return;
    }
    const origin = serviceOrigin(values.host);
    if (!origin) return;
    resetDevices();
    const query = new AbortController();
    activeQuery.current = query;
    setQuerying(true);
    const connection = { host: origin, token: values.token.trim() };
    try {
      const result = await post<{ devices: IOSHIDServiceProfile[] }>(
        '/ios-hid/devices',
        connection,
        query.signal,
      );
      if (query.signal.aborted) return;
      setSaved(connection);
      try {
        localStorage.setItem(storageKey, JSON.stringify(connection));
      } catch {
        // Keep the validated credential in memory for this page.
      }
      setDevices(result.devices);
      if (!result.devices.some((device) => device.status === 'available'))
        setNotice('没有可用手机，请到设备管理台检查连接。');
    } catch (error) {
      if (!query.signal.aborted) setNotice(errorMessage(error));
    } finally {
      if (activeQuery.current === query) {
        activeQuery.current = undefined;
        setQuerying(false);
      }
    }
  }

  async function connect({ host, token, deviceId }: ConnectionValues) {
    if (!deviceId || connecting || querying) return;
    setConnecting(true);
    setNotice(undefined);
    try {
      await post('/session', {
        host: host.trim(),
        token: token.trim(),
        deviceId,
      });
      location.reload();
    } catch (error) {
      setNotice(errorMessage(error));
      setConnecting(false);
    }
  }

  return (
    <Form
      form={form}
      className="session-setup-form"
      layout="vertical"
      requiredMark={false}
      initialValues={saved}
      disabled={connecting}
      onFinish={connect}
      onValuesChange={(changed: Partial<ConnectionValues>) => {
        if ('host' in changed) {
          const origin = serviceOrigin(changed.host ?? '');
          if (origin !== previousOrigin.current)
            form.setFieldValue(
              'token',
              origin === saved.host ? saved.token : '',
            );
          previousOrigin.current = origin;
        }
        if ('host' in changed || 'token' in changed) resetDevices();
      }}
    >
      <Form.Item
        name="host"
        label="设备服务地址"
        rules={[
          {
            validator: (_, value: string | undefined) =>
              value && serviceOrigin(value)
                ? Promise.resolve()
                : Promise.reject(
                    new Error(
                      '请输入设备服务地址，例如 http://localhost:5801。',
                    ),
                  ),
          },
        ]}
      >
        <Input placeholder={defaultHost} />
      </Form.Item>
      <Form.Item
        name="token"
        label="访问凭证"
        rules={[
          {
            required: true,
            whitespace: true,
            message: '请输入设备服务访问凭证。',
          },
        ]}
      >
        <Input type="password" autoComplete="off" />
      </Form.Item>
      <Form.Item
        name="deviceId"
        label={
          <span className="hid-device-label">
            手机
            <Button
              type="text"
              size="small"
              htmlType="button"
              icon={<ReloadOutlined />}
              aria-label="刷新设备列表"
              title="刷新设备列表"
              loading={querying}
              onClick={(event) => {
                event.preventDefault();
                void refreshDevices();
              }}
            />
          </span>
        }
      >
        <Select
          placeholder="请选择设备"
          notFoundContent={querying ? '正在查找设备…' : '请点击刷新查询设备'}
          options={devices.map((device) => ({
            label: `${device.name} · ${deviceStatus[device.status]}`,
            value: device.id,
            disabled: device.status !== 'available',
          }))}
        />
      </Form.Item>
      <button
        className="session-setup-submit"
        type="submit"
        disabled={!deviceId || querying || connecting}
      >
        {connecting ? '正在连接…' : '连接'}
      </button>
      <output>{notice}</output>
    </Form>
  );
}

function Disconnect() {
  const [disconnecting, setDisconnecting] = useState(false);
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    if (ended) return;
    const controller = new AbortController();
    const check = async () => {
      const status = await request<{ ended: boolean }>(
        '/ios-hid/session-status',
        {
          signal: controller.signal,
        },
      ).catch(() => undefined);
      if (status?.ended && !controller.signal.aborted) setEnded(true);
    };
    void check();
    const timer = setInterval(() => void check(), 2000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [ended]);
  const [notice, setNotice] = useState<string>();
  return (
    <>
      <output>
        {notice ?? (ended ? '设备控制会话已结束，请重新连接。' : undefined)}
      </output>
      <Button
        loading={disconnecting}
        onClick={async () => {
          setDisconnecting(true);
          setNotice(undefined);
          try {
            await request('/session', { method: 'DELETE' });
            location.reload();
          } catch (error) {
            setNotice(errorMessage(error));
            setDisconnecting(false);
          }
        }}
      >
        {ended ? '返回连接页面' : '断开设备'}
      </Button>
    </>
  );
}

// Mount the device controls in the existing upstream Playground layout.
function mountControls(connected: boolean, notice?: string) {
  const container = document.createElement('div');
  container.id = connected ? 'hid-device-toolbar' : 'hid-form';
  createRoot(container).render(
    connected ? <Disconnect /> : <ConnectionForm initialNotice={notice} />,
  );
  const mount = () => {
    const target = document.querySelector(
      connected ? '.right-panel-content' : '.session-setup-card',
    );
    if (!target || container.parentElement === target) return;
    if (connected) target.prepend(container);
    else target.append(container);
  };
  const root = document.getElementById('root');
  if (!root) return;
  if (connected) mountPreviewFeedback(root);
  new MutationObserver(mount).observe(root, { childList: true, subtree: true });
  mount();
}

void request<{ connected: boolean }>('/session').then(
  (session) => mountControls(Boolean(session.connected)),
  (error) => mountControls(false, errorMessage(error)),
);
