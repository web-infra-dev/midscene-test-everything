import { globalThemeConfig } from '../visualizer/shell';
import { App as AntdApp, ConfigProvider } from 'antd';
import type { PropsWithChildren } from 'react';

export function PlaygroundThemeProvider({ children }: PropsWithChildren) {
  return (
    <ConfigProvider theme={globalThemeConfig()}>
      <AntdApp component={false}>{children}</AntdApp>
    </ConfigProvider>
  );
}
