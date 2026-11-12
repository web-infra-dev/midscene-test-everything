import { armUiTheme } from '@midscene/robotics-shared';
import { App as AntApp, Badge, Button, ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import { Languages } from 'lucide-react';
import { useEffect, useState } from 'react';
import logo from './assets/midscene-logo.png';
import {
  VoiceSettings,
  robotVoice,
  useBrowserVoice,
  useCalibrationLanguage,
} from './calibration';
import { ConnectionScreen } from './components/ConnectionScreen';
import { DeviceWorkspace } from './components/DeviceWorkspace';
import { useConnection } from './connection';
import { useSetupStore } from './hooks/useRobotArm';
import { usePreferences, useT } from './i18n';
import './App.less';
import './components/robot-arm/Setup.less';

import { type PlaygroundViews, Views } from './extensions';
export function App(views: PlaygroundViews) {
  useBrowserVoice();
  const t = useT();
  const { language, setLanguage } = usePreferences();
  const { phase, check } = useConnection();
  const connected = phase === 'connected';
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  useEffect(() => {
    if (connected) setWorkspaceOpen(true);
  }, [connected]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!useSetupStore.getState().busy) {
        await check();
        if (disposed) return;
        const store = useSetupStore.getState();
        const connection = useConnection.getState();
        const session = connection.setupSession;
        if (
          !store.setup ||
          store.serviceStatus === 'offline' ||
          (store.setup.phase === 'connecting' &&
            connection.phase !== 'connecting') ||
          (session && session !== store.setup.session)
        )
          await store.refreshConfiguration();
      }
      if (!disposed) timer = setTimeout(() => void poll(), 2500);
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [check]);
  useEffect(() => {
    useCalibrationLanguage.getState().setLanguage(language);
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);
  useEffect(
    () =>
      useConnection.subscribe((next, previous) => {
        if (
          !next.runtime ||
          !previous.runtime ||
          next.setupSession !== previous.setupSession
        )
          return;
        const current = next.runtime.state;
        const old = previous.runtime.state;
        if (current.faults.length && !old.faults.length)
          robotVoice.notify('fault', 3);
        else if (current.enabled !== old.enabled)
          robotVoice.notify(current.enabled ? 'enabled' : 'disabled', 1);
        if (next.runtime.softwarePaused && !previous.runtime.softwarePaused)
          robotVoice.notify('paused', 2);
      }),
    [],
  );
  return (
    <ConfigProvider theme={armUiTheme} locale={language === 'zh' ? zhCN : enUS}>
      <Views.Provider value={views}>
        <AntApp>
          <div className="app-shell">
            <header className="app-header">
              <div className="brand">
                <img src={logo} alt="Midscene" />
                <span className="brand-divider" />
                <span translate="no">Arm Device Manager</span>
              </div>
              <div className="header-actions">
                <VoiceSettings compact />
                <Badge
                  status={
                    connected
                      ? 'success'
                      : phase === 'connecting' || phase === 'checking'
                        ? 'processing'
                        : 'default'
                  }
                  text={
                    connected
                      ? t('connected')
                      : phase === 'connecting'
                        ? t('connecting')
                        : phase === 'checking'
                          ? t('checking')
                          : t('disconnected')
                  }
                />
                <Button
                  icon={<Languages size={16} />}
                  onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
                >
                  {language === 'zh' ? 'English' : '中文'}
                </Button>
              </div>
            </header>
            {workspaceOpen || connected ? (
              <DeviceWorkspace connected={connected} />
            ) : (
              <ConnectionScreen onSkip={() => setWorkspaceOpen(true)} />
            )}
          </div>
        </AntApp>
      </Views.Provider>
    </ConfigProvider>
  );
}
