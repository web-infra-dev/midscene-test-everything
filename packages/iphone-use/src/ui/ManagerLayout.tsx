import '@midscene/device-manager-ui/shell/PlaygroundApp.less';
import { Logo, NavActions } from '@midscene/device-manager-ui/visualizer';
import { Layout } from 'antd';
import { type ReactNode, useEffect, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

async function verifyModel(config: Record<string, string>) {
  const response = await fetch('/connectivity-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
    signal: AbortSignal.timeout(60_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? '模型连接失败');
  return result;
}

export function ManagerLayout({
  sidebar,
  preview,
}: { sidebar: ReactNode; preview: ReactNode }) {
  const [narrow, setNarrow] = useState(window.innerWidth <= 1024);
  useEffect(() => {
    const resize = () => setNarrow(window.innerWidth <= 1024);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  return (
    <Layout className="app-container playground-container">
      <Layout.Content className="app-content">
        <PanelGroup
          autoSaveId="playground-layout"
          direction={narrow ? 'vertical' : 'horizontal'}
        >
          <Panel
            defaultSize={narrow ? 67 : 32}
            maxSize={narrow ? 85 : 60}
            minSize={narrow ? 67 : 25}
            className="app-panel left-panel"
          >
            <div className="panel-content left-panel-content">
              <div className="playground-panel-header">
                <div className="header-row">
                  <Logo />
                  <NavActions onVerify={verifyModel} />
                </div>
              </div>
              <div className="playground-panel-playground">{sidebar}</div>
            </div>
          </Panel>
          <PanelResizeHandle className="panel-resize-handle" />
          <Panel
            defaultSize={narrow ? 33 : 68}
            minSize={narrow ? 15 : 40}
            className="app-panel right-panel"
          >
            <div className="panel-content right-panel-content">{preview}</div>
          </Panel>
        </PanelGroup>
      </Layout.Content>
    </Layout>
  );
}
