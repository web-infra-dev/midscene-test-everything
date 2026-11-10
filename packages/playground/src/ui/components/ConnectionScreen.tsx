import { SetupIllustration } from '@midscene/arm-calibration-ui';
import { Alert, Button, Spin, Typography } from 'antd';
import { Cable } from 'lucide-react';
import { useViews } from '../extensions';
import { useRobotArm } from '../hooks/useRobotArm';
import { useLanguage, useT } from '../i18n';

export function ConnectionScreen({ onSkip }: { onSkip(): void }) {
  const { ConnectionForm, connectionDiagram } = useViews();
  const label = useT();
  const arm = useRobotArm();
  const language = useLanguage();
  const connecting = arm.busy || arm.setup?.phase === 'connecting';
  const showDiagram =
    (connectionDiagram ?? arm.setup?.connectionDiagram) === 'ethernet';
  return (
    <main className="connection-screen">
      <section
        className={`connection-card connection-setup${showDiagram ? ' with-diagram' : ''}`}
      >
        <div className="connection-main">
          <div className="connection-icon">
            <Cable size={26} />
          </div>
          <Typography.Title level={2}>{label('connectTitle')}</Typography.Title>
          {!ConnectionForm && arm.setup && (
            <Typography.Paragraph type="secondary" className="connection-intro">
              {arm.setup.connection
                ? [
                    arm.setup.connection.adapter.toUpperCase(),
                    arm.setup.connection.options.host,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : label('connectDescription')}
            </Typography.Paragraph>
          )}
          {(arm.error || arm.setup?.error) && (
            <Alert
              type="error"
              showIcon
              message={arm.error || arm.setup?.error}
            />
          )}
          {arm.setup ? (
            ConnectionForm ? (
              <ConnectionForm
                arm={arm}
                footer={null}
                onContinue={() => void arm.refresh()}
              />
            ) : (
              <Button
                type="primary"
                loading={connecting}
                onClick={() => void arm.run(arm.api.connect)}
              >
                {label(
                  connecting
                    ? 'connecting'
                    : arm.setup?.error
                      ? 'retry'
                      : 'connect',
                )}
              </Button>
            )
          ) : (
            <div className="connection-loading">
              <Spin />
            </div>
          )}
          <Button type="link" onClick={onSkip}>
            {label('skipToCamera')}
          </Button>
        </div>
        {showDiagram && (
          <div className="connection-diagram">
            <SetupIllustration step="connection" language={language} />
          </div>
        )}
      </section>
    </main>
  );
}
