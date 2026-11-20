import { armUiTheme } from '@midscene/robotics-shared';
import { theme } from 'antd';
import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
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
const themeStorageKey = 'arm-playground-theme';
export const armThemeModes = ['system', 'light', 'dark'] as const;

export function useArmThemePreference() {
  const [mode, setMode] = useState<(typeof armThemeModes)[number]>(() => {
    try {
      const saved = localStorage.getItem(themeStorageKey);
      return armThemeModes.find((mode) => mode === saved) ?? 'system';
    } catch {
      return 'system';
    }
  });
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-theme');
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);

    try {
      localStorage.setItem(themeStorageKey, mode);
    } catch {
      /* The selected theme still works without storage. */
    }
    return () => {
      if (previous === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', previous);
    };
  }, [mode]);
  return [mode, setMode] as const;
}

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
