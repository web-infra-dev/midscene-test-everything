import { DownOutlined, ReloadOutlined } from '@ant-design/icons';
import type { UniversalDeviceProfile } from '@midscene/universal-device';
import { AutoComplete, Button, Form, Input, Select } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './connect.css';
import { mountPreviewFeedback } from './preview-feedback';

const defaultHost = 'http://localhost:5801';
const storageKey = 'midscene.open-device.connections';
const t = (_zh: string, en: string) => en;
const deviceStatus = {
  available: 'Available',
  busy: 'In Use',
  offline: 'Offline',
};

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

type ServiceConnection = { host: string; token: string };

function readConnections(): ServiceConnection[] {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    if (Array.isArray(saved))
      return saved.filter(
        (item) =>
          typeof item?.host === 'string' && typeof item.token === 'string',
      );
  } catch {
    // The form also works when browser storage is unavailable.
  }
  return [];
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error ??
        t('请求失败，请重试。', 'Request failed. Please try again.'),
    );
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
  return error instanceof Error
    ? error.message
    : t('请求失败，请重试。', 'Request failed. Please try again.');
}

type ConnectionValues = { host: string; token: string; deviceId?: string };

function ConnectionForm({ initialNotice }: { initialNotice?: string }) {
  const [services, setServices] = useState(readConnections);
  const saved = services[0] ?? { host: defaultHost, token: '' };
  const [form] = Form.useForm<ConnectionValues>();
  const deviceId = Form.useWatch('deviceId', form);
  const previousOrigin = useRef<string | undefined>(saved.host);
  const [devices, setDevices] = useState<UniversalDeviceProfile[]>([]);
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
      const result = await post<{ devices: UniversalDeviceProfile[] }>(
        '/open-device/devices',
        connection,
        query.signal,
      );
      if (query.signal.aborted) return;
      const next = [
        connection,
        ...services.filter((item) => item.host !== origin),
      ].slice(0, 10);
      setServices(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Keep the validated credential in memory for this page.
      }
      setDevices(result.devices);
      if (!result.devices.some((device) => device.status === 'available'))
        setNotice(
          t(
            '没有可用设备，请到设备管理台检查连接。',
            'No available devices. Check the connection in the device manager.',
          ),
        );
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
      const connectionId = Array.from(
        crypto.getRandomValues(new Uint8Array(16)),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('');
      const route = `/devices/${encodeURIComponent(deviceId)}/${connectionId}`;
      await post(`${route}/session`, {
        host: host.trim(),
        token: token.trim(),
        deviceId,
      });
      location.assign(route);
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
              services.find((item) => item.host === origin)?.token ?? '',
            );
          previousOrigin.current = origin;
        }
        if ('host' in changed || 'token' in changed) resetDevices();
      }}
    >
      <Form.Item
        name="host"
        label={t('设备服务地址', 'Device Service URL')}
        rules={[
          {
            validator: (_, value: string | undefined) =>
              value && serviceOrigin(value)
                ? Promise.resolve()
                : Promise.reject(
                    new Error(
                      t(
                        '请输入设备服务地址，例如 http://localhost:5801。',
                        'Enter the device service URL, e.g. http://localhost:5801.',
                      ),
                    ),
                  ),
          },
        ]}
      >
        <AutoComplete
          placeholder={defaultHost}
          options={services.map(({ host }) => ({ value: host }))}
          filterOption={false}
          suffixIcon={services.length ? <DownOutlined /> : null}
          onSelect={(host) => {
            const connection = services.find((item) => item.host === host);
            if (!connection) return;
            form.setFieldValue('token', connection.token);
            void refreshDevices();
          }}
        />
      </Form.Item>
      <Form.Item
        name="token"
        label={t('访问凭证', 'Access Token')}
        rules={[
          {
            required: true,
            whitespace: true,
            message: t(
              '请输入设备服务访问凭证。',
              'Enter the device service access token.',
            ),
          },
        ]}
      >
        <Input type="password" autoComplete="off" />
      </Form.Item>
      <Form.Item
        name="deviceId"
        label={
          <span className="hid-device-label">
            {t('设备', 'Device')}
            <Button
              type="text"
              size="small"
              htmlType="button"
              icon={<ReloadOutlined />}
              aria-label={t('刷新设备列表', 'Refresh device list')}
              title={t('刷新设备列表', 'Refresh device list')}
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
          placeholder={t('请选择设备', 'Select a device')}
          notFoundContent={
            querying
              ? t('正在查找设备…', 'Finding devices…')
              : t('请点击刷新查询设备', 'Click refresh to query devices')
          }
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
        {connecting ? t('正在连接…', 'Connecting…') : t('连接', 'Connect')}
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
        '/open-device/session-status',
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
        {notice ??
          (ended
            ? t(
                '设备控制会话已结束，请重新连接。',
                'Device control session ended. Please reconnect.',
              )
            : undefined)}
      </output>
      <Button href="/" target="_blank" rel="noopener">
        {t('连接另一台设备', 'Connect another device')}
      </Button>
      <Button
        loading={disconnecting}
        onClick={async () => {
          setDisconnecting(true);
          setNotice(undefined);
          try {
            await request('/session', { method: 'DELETE' });
            location.assign('/');
          } catch (error) {
            setNotice(errorMessage(error));
            setDisconnecting(false);
          }
        }}
      >
        {ended
          ? t('返回连接页面', 'Back to Connect')
          : t('断开设备', 'Disconnect')}
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
    if (connected) {
      const header = document.querySelector(
        '.playground-panel-header .header-row',
      );
      // Keep session controls reachable while the upstream layout is remounting.
      const target = header ?? document.body;
      container.classList.toggle('hid-toolbar-fallback', !header);
      if (container.parentElement !== target) target.append(container);
      return;
    }
    const target = document.querySelector('.session-setup-card');
    if (target && container.parentElement !== target) target.append(container);
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
