import { Alert, Button, Modal, Space, Table, Typography } from 'antd';
import { History, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useLanguage } from '../../i18n';
import type {
  RobotActionAuditRecord,
  RobotActionAuditStatus,
} from '../../robot-arm-api';
export function ActionAudit() {
  const language = useLanguage();
  const zh = language === 'zh';
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [data, setData] = useState<{
    status?: RobotActionAuditStatus;
    records: RobotActionAuditRecord[];
  }>({ records: [] });
  const refresh = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch('/api/audit/actions');
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? `HTTP ${response.status}`);
      setData(result);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        icon={<History size={18} />}
        onClick={() => {
          setOpen(true);
          void refresh();
        }}
      >
        {zh ? '动作记录' : 'Action history'}
      </Button>
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        className="robot-settings-detail"
        width={900}
        title={
          <>
            <History size={18} />
            {zh ? '动作记录' : 'Action history'}
          </>
        }
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <div className="settings-history-toolbar">
            <Typography.Text type="secondary">
              {zh
                ? '当前安装配置最近 100 条记录，包含操作结果与失败原因。'
                : 'Latest 100 records for this installation, including outcomes and errors.'}
            </Typography.Text>
            <Button
              icon={<RefreshCw size={14} />}
              loading={busy}
              onClick={() => void refresh()}
            >
              {zh ? '刷新' : 'Refresh'}
            </Button>
          </div>
          {error && <Alert type="error" message={error} />}
          {data.status && (
            <Typography.Text code>{data.status.filePath}</Typography.Text>
          )}
          {Boolean(data.status?.failures) && (
            <Alert
              type="warning"
              message={
                data.status?.lastError ??
                (zh
                  ? '部分动作记录写入失败'
                  : 'Some audit records could not be saved')
              }
            />
          )}
          <Table
            locale={{
              emptyText: zh ? '暂无动作记录' : 'No actions recorded yet',
            }}
            size="middle"
            rowKey={(row) => `${row.at}:${row.seq}`}
            dataSource={data.records}
            loading={busy}
            scroll={{ x: 650 }}
            columns={[
              { title: zh ? '时间' : 'Time', dataIndex: 'at' },
              { title: zh ? '操作' : 'Operation', dataIndex: 'kind' },
              { title: zh ? '结果' : 'Outcome', dataIndex: 'outcome' },
              {
                title: zh ? '详情' : 'Details',
                render: (_, row) => row.error || JSON.stringify(row.detail),
              },
            ]}
          />
        </Space>
      </Modal>
    </>
  );
}
