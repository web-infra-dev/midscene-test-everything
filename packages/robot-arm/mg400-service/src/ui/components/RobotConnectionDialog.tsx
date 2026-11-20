import { Alert, Button, Modal, Space, Spin, Typography } from 'antd';
import { Cable } from 'lucide-react';
import { useViews } from '../extensions';
import { useRobotArm } from '../hooks/useRobotArm';
import { useT } from '../i18n';

/** The same connection form is available before and after opening a camera. */
export function RobotConnectionDialog({
  open,
  onClose,
  title,
}: { open: boolean; onClose(): void; title?: string }) {
  const { ConnectionForm } = useViews();
  const arm = useRobotArm();
  const t = useT();
  const connecting = arm.busy || arm.setup?.phase === 'connecting';
  const error = arm.error || arm.setup?.error || arm.connectionError;
  return (
    <Modal
      open={open}
      onCancel={() => {
        if (!arm.busy) onClose();
      }}
      closable={!arm.busy}
      maskClosable={!arm.busy}
      keyboard={!arm.busy}
      footer={null}
      className="robot-settings-detail"
      width={680}
      title={
        <>
          <Cable size={18} />
          {title ?? t('connectTitle')}
        </>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {error && <Alert type="error" showIcon message={error} />}
        {!arm.setup ? (
          <Spin />
        ) : ConnectionForm ? (
          <ConnectionForm arm={arm} footer={null} onContinue={onClose} />
        ) : (
          <>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              {arm.setup.connection
                ? [
                    arm.setup.connection.adapter.toUpperCase(),
                    arm.setup.connection.options.host,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : t('connectDescription')}
            </Typography.Paragraph>
            <Button
              type="primary"
              loading={connecting}
              onClick={() => void arm.run(arm.api.connect)}
            >
              {t(connecting ? 'connecting' : error ? 'retry' : 'connect')}
            </Button>
          </>
        )}
      </Space>
    </Modal>
  );
}
