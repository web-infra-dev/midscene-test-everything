import MidsceneLogo from '@midscene/device-manager-ui/shell/icons/midscene-logo.svg?react';
import { Button } from 'antd';
import type { ReactNode } from 'react';

export function ManagerLayout({
  adding,
  onAdd,
  children,
}: {
  adding: boolean;
  onAdd: () => void;
  children: ReactNode;
}) {
  return (
    <div className="iphone-use-shell">
      <header className="iphone-use-topbar">
        <div className="iphone-use-topbar-brand">
          <MidsceneLogo className="iphone-use-topbar-logo" />
          <span className="iphone-use-topbar-title">Midscene iPhone Use</span>
        </div>
        <div className="iphone-use-topbar-actions">
          <Button
            size="small"
            className="iphone-use-outline-btn"
            href="/api/docs/"
            target="_blank"
            rel="noreferrer"
          >
            API 文档 ↗
          </Button>
          <Button
            type="primary"
            size="small"
            className="iphone-use-primary-btn"
            loading={adding}
            onClick={onAdd}
          >
            ＋ 添加设备
          </Button>
        </div>
      </header>

      <main className="iphone-use-grid-main">{children}</main>
    </div>
  );
}
