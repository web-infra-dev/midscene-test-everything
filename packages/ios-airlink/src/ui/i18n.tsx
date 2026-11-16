import {
  type PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

export type Locale = 'zh' | 'en';

const LOCALE_STORAGE_KEY = 'midscene.locale';

export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    // Ignore storage failures.
  }
  return typeof navigator !== 'undefined' &&
    navigator.language.toLowerCase().startsWith('zh')
    ? 'zh'
    : 'en';
}

const BACKEND_ERROR_EN: Record<string, string> = {
  '画面已中断，请检查连接后点击刷新。':
    'Screen stream interrupted. Check the connection and click Refresh.',
  '设备正在使用，请先在 Playground 断开连接。':
    'Device is in use. Disconnect from Playground first.',
  '设备工作区不存在。': 'Device workspace does not exist.',
  '设备工作区不存在，请返回首页。':
    'Device workspace not found. Return to the home page.',
  '蓝牙连接已断开，请在手机连接后点击刷新。':
    'Bluetooth disconnected. Reconnect on your phone and click Refresh.',
  '设备连接已失效，请检查连接后点击刷新。':
    'Device connection lost. Check the connection and click Refresh.',
  '设备尚未就绪。': 'Device is not ready yet.',
  '设备尚未连接。': 'Device is not connected yet.',
  '设备尚未连接，请先添加设备。':
    'Device is not connected yet. Add the device first.',
  '设备已移除。': 'Device has been removed.',
  '恢复失败，请检查连接后刷新。':
    'Recovery failed. Check the connection and try refreshing.',
  '恢复失败，请重试。': 'Recovery failed. Please try again.',
  '设备尚未就绪，请检查连接后刷新。':
    'Device is not ready yet. Check the connection and refresh.',
  '请选择 USB 手机': 'Please select a USB phone.',
  请选择摄像头: 'Please select a camera.',
  请选择蓝牙手机: 'Please select a Bluetooth phone.',
  '连接失败，请重试。': 'Connection failed. Please try again.',
  '取消失败，请重试。': 'Failed to cancel. Please try again.',
  设备列表读取失败: 'Failed to load device list.',
  画面获取失败: 'Failed to fetch screen frame.',
  '未找到 UxPlay，请安装后重新启动接收器。':
    'UxPlay not found. Install UxPlay and restart the receiver.',
  'AirPlay 连接已中断，或手机仍在发送但视频解码停滞，请重新投屏。':
    'AirPlay disconnected or video decoding stalled. Restart Screen Mirroring.',
  'AirPlay 画面不可用，请重新投屏。':
    'AirPlay screen unavailable. Restart Screen Mirroring.',
  '摄像头设置已结束，请返回选择设备。':
    'Camera setup has ended. Return to device selection.',
  '摄像头请求失败，请重试。': 'Camera request failed. Please try again.',
  '设备正在使用，请先断开现有连接。':
    'Device is in use. Disconnect the active session first.',
  '设备未就绪，请先在设备管理台连接手机。':
    'Device is not ready. Connect the phone in the device manager first.',
  '请先在手机「控制中心 → 屏幕镜像」开始屏幕镜像。':
    'Start Screen Mirroring from Control Center on your iPhone first.',
  '无法启动或读取摄像头预览。': 'Unable to start or read camera preview.',
};

export function translateBackendMessage(raw: string, locale: Locale): string {
  if (locale === 'zh' || !raw) return raw;
  const cleaned = raw.replace(/^Error:\s*/, '').trim();
  if (BACKEND_ERROR_EN[cleaned]) return BACKEND_ERROR_EN[cleaned];
  if (cleaned.includes('Independent check error')) {
    return 'Screen corner check failed. Align all four corners to the screen edges or re-detect markers before confirming.';
  }
  if (cleaned.includes('Cannot reliably locate the mouse pointer')) {
    return 'Could not reliably detect pointer movement. Make sure AssistiveTouch is enabled and the pointer is clearly visible.';
  }
  return raw;
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  t: (zh: string, en: string) => string;
  te: (raw: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'zh',
  setLocale: () => {},
  toggleLocale: () => {},
  t: (zh) => zh,
  te: (raw) => raw,
});

export function I18nProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'zh' ? 'en' : 'zh');
  }, [locale, setLocale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      toggleLocale,
      t: (zh, en) => (locale === 'zh' ? zh : en),
      te: (raw) => translateBackendMessage(raw, locale),
    }),
    [locale, setLocale, toggleLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
