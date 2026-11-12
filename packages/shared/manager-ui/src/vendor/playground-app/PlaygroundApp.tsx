import {
  type DeviceType,
  Logo,
  NavActions,
  type PlaygroundBranding,
  type UniversalPlaygroundConfig,
} from '../visualizer/shell';
import { Layout } from 'antd';
import { useEffect, useState, type ReactNode } from 'react';
import type { PlaygroundControllerResult } from './controller/types';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { DisconnectedPreview } from './DisconnectedPreview';
import { PlaygroundPreview } from './PlaygroundPreview';
import { PlaygroundThemeProvider } from './PlaygroundThemeProvider';
import { usePlaygroundController } from './controller/usePlaygroundController';
import ServerOfflineBackground from './icons/server-offline-background.svg?react';
import ServerOfflineForeground from './icons/server-offline-foreground.svg?react';
import { PlaygroundConversationPanel } from './panels/PlaygroundConversationPanel';
import './PlaygroundApp.less';

const { Content } = Layout;

export interface PlaygroundAppProps {
  sessionReady?: boolean;
  workspaceHeader?: ReactNode;
  renderPreview?: (controller: PlaygroundControllerResult) => ReactNode;
  renderSetup?: (controller: PlaygroundControllerResult) => ReactNode;
  renderPendingPreview?: (controller: PlaygroundControllerResult) => ReactNode;
  serverUrl: string;
  appVersion: string;
  title?: string;
  defaultDeviceType?: DeviceType;
  branding?: Partial<PlaygroundBranding>;
  playgroundConfig?: Partial<UniversalPlaygroundConfig>;
  offlineTitle?: string;
  offlineStatusText?: string;
  pollIntervalMs?: number;
}

export function PlaygroundApp({
  sessionReady,
  workspaceHeader,
  renderPreview,
  renderSetup,
  renderPendingPreview,
  serverUrl,
  appVersion,
  title = 'Playground',
  defaultDeviceType = 'web',
  branding,
  playgroundConfig,
  offlineTitle = 'Midscene Playground',
  offlineStatusText = 'Server offline...',
  pollIntervalMs = 5000,
}: PlaygroundAppProps) {
  const [isNarrowScreen, setIsNarrowScreen] = useState(false);
  const rawController = usePlaygroundController({
    serverUrl,
    defaultDeviceType,
    countdownSeconds: playgroundConfig?.executionUx?.countdownSeconds,
    pollIntervalMs,
  });

  const controller = sessionReady === undefined ? rawController : {
    ...rawController,
    state: {
      ...rawController.state,
      sessionViewState: {
        ...rawController.state.sessionViewState,
        connected: rawController.state.sessionViewState.connected && sessionReady,
      },
    },
  };
  useEffect(() => {
    const handleResize = () => {
      setIsNarrowScreen(window.innerWidth <= 1024);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!controller.state.serverOnline) {
    return (
      <PlaygroundThemeProvider>
        <div className="server-offline-container">
          <div className="server-offline-message">
            <Logo />
            <div className="server-offline-content">
              <div className="server-offline-icon">
                <ServerOfflineBackground className="icon-background" />
                <ServerOfflineForeground className="icon-foreground" />
              </div>
              <h1>{offlineTitle}</h1>
              <p className="connection-status">{offlineStatusText}</p>
            </div>
          </div>
        </div>
      </PlaygroundThemeProvider>
    );
  }

  return (
    <PlaygroundThemeProvider>
      <Layout className="app-container playground-container">
        <Content className="app-content">
          <PanelGroup
            autoSaveId="playground-layout"
            direction={isNarrowScreen ? 'vertical' : 'horizontal'}
          >
            <Panel
              defaultSize={isNarrowScreen ? 67 : 32}
              maxSize={isNarrowScreen ? 85 : 60}
              minSize={isNarrowScreen ? 67 : 25}
              className="app-panel left-panel"
            >
              <div className="panel-content left-panel-content">
                <div className="playground-panel-header">
                  <div className="header-row">
                    <Logo />
                    <NavActions
                      showTooltipWhenEmpty={false}
                      showModelName={false}
                      playgroundSDK={controller.state.playgroundSDK}
                    />
                  </div>
                </div>

                <div className="playground-panel-playground">
                  <PlaygroundConversationPanel
                    header={controller.state.sessionViewState.connected ? workspaceHeader : undefined}
                    notConnectedFallback={renderSetup?.(controller)}
                    controller={controller}
                    appVersion={appVersion}
                    branding={branding}
                    playgroundConfig={playgroundConfig}
                    title={title}
                  />
                </div>
              </div>
            </Panel>

            <PanelResizeHandle className="panel-resize-handle" />

            <Panel
              defaultSize={isNarrowScreen ? 33 : 68}
              minSize={isNarrowScreen ? 15 : 40}
              className="app-panel right-panel"
            >
              <div className="panel-content right-panel-content">
                {renderPreview ? renderPreview(controller) : controller.state.sessionViewState.connected ? (
                  <PlaygroundPreview
                    playgroundSDK={controller.state.playgroundSDK}
                    runtimeInfo={controller.state.runtimeInfo}
                    serverUrl={serverUrl}
                    serverOnline={controller.state.serverOnline}
                    isUserOperating={controller.state.isUserOperating}
                  />
                ) : (
                  renderPendingPreview ? renderPendingPreview(controller) : <DisconnectedPreview />
                )}
              </div>
            </Panel>
          </PanelGroup>
        </Content>
      </Layout>
    </PlaygroundThemeProvider>
  );
}
