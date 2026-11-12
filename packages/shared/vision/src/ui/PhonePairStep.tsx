import { Card, Spin, Tag, Typography } from '@arco-design/web-react';
import { IconCheckCircleFill, IconCopy } from '@arco-design/web-react/icon';
import '@arco-design/web-react/es/Card/style/css.js';
import '@arco-design/web-react/es/Spin/style/css.js';
import '@arco-design/web-react/es/Tag/style/css.js';
import '@arco-design/web-react/es/Typography/style/css.js';
import type {
  CalibrationPageLayout,
  CalibrationPhoneStatus,
} from '@midscene/robotics-shared/assisted-contracts';
import { Button, QRCode } from 'antd';
import { useState } from 'react';
import { createPortal } from 'react-dom';

import { SetupNotice } from './SetupNotice.js';

export function PhonePairStep({
  controller,
  t,
  footer,
  onContinue,
}: {
  controller: {
    setup: { layout?: CalibrationPageLayout; phoneConnected: boolean };
    phone: CalibrationPhoneStatus;
    busy: boolean;
    connectionError?: string;
  };
  t: (message: string) => string;
  footer: HTMLElement | null;
  onContinue(): void;
}) {
  const [link, setLink] = useState<string>();
  const { setup, phone, busy, connectionError } = controller;
  const url =
    phone.links.find((item) => item.url === link)?.url ?? phone.links[0]?.url;
  const screen = setup.layout?.screen;
  const connected = phone.state === 'connected';
  const title = {
    connected: 'Phone connected',
    waiting: 'Scan with your phone to connect',
    paused: 'Phone paused',
    reconnecting: 'Phone disconnected',
  }[phone.state];

  return (
    <section className="robot-phone-pair">
      <Card
        className="robot-phone-card"
        data-connected={connected}
        data-phone-state={phone.state}
      >
        <div className="robot-phone-scan">
          <Typography.Title heading={4} aria-live="polite">
            {t(title)}
          </Typography.Title>
          <div className="robot-phone-code">
            {connected ? (
              <IconCheckCircleFill className="robot-phone-success" />
            ) : url ? (
              <QRCode
                value={url}
                type="svg"
                size={174}
                bordered={false}
                color="#162331"
                bgColor="#fff"
              />
            ) : (
              <Spin aria-label={t('Waiting for phone')} />
            )}
          </div>
          {phone.state === 'waiting' && (
            <small className="robot-phone-info">
              {t(
                'Already paired? Keep the phone page open. It reconnects after a service restart; no need to scan again.',
              )}
            </small>
          )}
          {connected && (
            <div className="robot-phone-info">
              <div className="robot-phone-tags">
                <Tag>{phone.model || t('Unknown phone model')}</Tag>
                {screen && (
                  <span>
                    {t('Screen')} ≈{' '}
                    {Math.round(screen.width * screen.devicePixelRatio)} ×{' '}
                    {Math.round(screen.height * screen.devicePixelRatio)} px
                  </span>
                )}
              </div>
              {screen && (
                <small>
                  {t('Logical screen size')} {screen.width} × {screen.height}{' '}
                  CSS px · {screen.devicePixelRatio}×
                </small>
              )}
            </div>
          )}
          {(phone.state === 'paused' || phone.state === 'reconnecting') && (
            <small className="robot-phone-info">
              {t(
                phone.state === 'paused'
                  ? 'Bring the phone page to the foreground at normal zoom.'
                  : 'Refresh the existing phone page to reconnect.',
              )}
            </small>
          )}
        </div>
        <SetupNotice
          notice={
            connectionError
              ? { tone: 'warning', title: connectionError }
              : undefined
          }
        />
        {url && (
          <div className="robot-phone-address">
            <code>{url}</code>
            <Typography.Text
              key={url}
              copyable={{
                text: url,
                icon: <IconCopy />,
                tooltips: [t('Copy URL'), t('URL copied')],
              }}
            />
            {phone.links.length > 1 && (
              <details>
                <summary>{t('Computer network address')}</summary>
                <select
                  aria-label={t('Computer network address')}
                  value={url}
                  onChange={(event) => setLink(event.target.value)}
                >
                  {phone.links.map((item) => (
                    <option key={item.url} value={item.url}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </details>
            )}
          </div>
        )}
      </Card>
      {footer &&
        createPortal(
          <Button
            type="primary"
            loading={busy}
            disabled={
              !setup.layout || !connected || !setup.phoneConnected || busy
            }
            onClick={() => {
              if (setup.layout && connected && setup.phoneConnected && !busy)
                onContinue();
            }}
          >
            {t('Continue')}
          </Button>,
          footer,
        )}
    </section>
  );
}
