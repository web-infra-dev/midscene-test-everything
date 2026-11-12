import { App, Button, Input, Space, Typography } from 'antd';
import { Copy } from 'lucide-react';
import { useState } from 'react';

export function OpenDeviceSettings({ language }: { language: 'zh' | 'en' }) {
  const zh = language === 'zh';
  const { message } = App.useApp();
  const [credentials, setCredentials] = useState<{
    url: string;
    token: string;
  }>();
  const [loading, setLoading] = useState(false);

  async function showCredentials() {
    setLoading(true);
    try {
      const response = await fetch('/api/arm/open-device', {
        headers: { 'X-Midscene-Manager': '1' },
        cache: 'no-store',
      });
      if (response.status === 404) {
        void message.error(
          zh
            ? '当前后端没有提供连接信息，请重启机械臂服务后重试。'
            : 'Connection details are unavailable. Restart the arm service and try again.',
        );
        return;
      }
      if (response.status === 403) {
        void message.error(
          zh
            ? '请在服务所在电脑通过 localhost 打开管理台。'
            : 'Open the manager through localhost on the service computer.',
        );
        return;
      }
      if (!response.ok) throw new Error('Credentials unavailable');
      setCredentials(await response.json());
    } catch {
      void message.error(
        zh
          ? '暂时无法读取连接信息，请重试。'
          : 'Could not read connection details. Try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="robot-settings-group" aria-label="Open Device">
      <Typography.Text type="secondary">Open Device</Typography.Text>
      {credentials ? (
        [
          { label: zh ? '服务地址' : 'Service URL', value: credentials.url },
          { label: 'Token', value: credentials.token },
        ].map(({ label, value }) => (
          <div key={label} className="open-device-field">
            <Typography.Text>{label}</Typography.Text>
            <Space.Compact block>
              <Input readOnly value={value} aria-label={label} />
              <Button
                icon={<Copy size={16} />}
                aria-label={zh ? `复制 ${label}` : `Copy ${label}`}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(value);
                    void message.success(zh ? '已复制' : 'Copied');
                  } catch {
                    void message.error(
                      zh
                        ? '复制失败，请选中文字后手动复制。'
                        : 'Could not copy. Select the text to copy it manually.',
                    );
                  }
                }}
              />
            </Space.Compact>
          </div>
        ))
      ) : (
        <Button loading={loading} onClick={() => void showCredentials()}>
          {zh ? '查看连接信息' : 'Show connection details'}
        </Button>
      )}
    </section>
  );
}
