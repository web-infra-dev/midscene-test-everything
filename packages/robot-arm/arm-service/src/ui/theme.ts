import { armUiTheme } from '@midscene/robotics-shared';
import { theme } from 'antd';
import { useSyncExternalStore } from 'react';
import './theme.less';

const darkTheme = {
  ...armUiTheme,
  algorithm: theme.darkAlgorithm,
  token: {
    ...armUiTheme.token,
    colorBgBase: '#10171e',
    colorBgContainer: '#18222b',
    colorBgElevated: '#202c37',
    colorTextBase: '#edf3f7',
  },
  components: {
    Layout: {
      ...armUiTheme.components.Layout,
      headerBg: '#18222b',
      bodyBg: '#10171e',
    },
    Button: {
      ...armUiTheme.components.Button,
      defaultBg: '#25323f',
      defaultHoverBg: '#304153',
      defaultActiveBg: '#35495d',
      defaultHoverColor: '#edf3f7',
      defaultActiveColor: '#edf3f7',
    },
  },
};

const schemeQuery = '(prefers-color-scheme: dark)';
function isDark() {
  const explicit = document.body
    .closest('[data-theme]')
    ?.getAttribute('data-theme');
  if (explicit === 'light' || explicit === 'dark') return explicit === 'dark';
  return window.matchMedia(schemeQuery).matches;
}

function subscribe(notify: () => void) {
  const scheme = window.matchMedia(schemeQuery);
  scheme.addEventListener('change', notify);
  const observer = new MutationObserver(notify);
  for (const node of [document.documentElement, document.body]) {
    observer.observe(node, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }
  return () => {
    scheme.removeEventListener('change', notify);
    observer.disconnect();
  };
}

export function useArmTheme() {
  return useSyncExternalStore(subscribe, isDark, () => false)
    ? darkTheme
    : armUiTheme;
}
