import { App as AntdApp, ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import { createRoot } from 'react-dom/client';
import { MultiDeviceApp } from './MultiDeviceApp';
import { I18nProvider, useI18n } from './i18n';
import { useRoute } from './routes';
import './style.css';

function App() {
  const { locale } = useI18n();
  return (
    <ConfigProvider
      theme={{ token: { colorPrimary: '#2B83FF' } }}
      locale={locale === 'zh' ? zhCN : enUS}
    >
      <AntdApp component={false}>
        <MultiDeviceApp route={useRoute()} />
      </AntdApp>
    </ConfigProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <App />
  </I18nProvider>,
);
