import { Alert } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n';

export function Spinner({
  size = 22,
  label,
}: {
  size?: number;
  label?: string;
}) {
  return (
    <span className="ios-airlink-spinner-wrap">
      <span
        className="ios-airlink-spinner"
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
      {label && <span>{label}</span>}
    </span>
  );
}

/** Shared preview loop; pausing keeps the last frame for an interruption mask. */
export function Frame({
  url,
  active = true,
  showError = true,
}: {
  url: string;
  active?: boolean;
  showError?: boolean;
}) {
  const { t, te } = useI18n();
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  const current = useRef('');
  useEffect(() => {
    setSrc('');
    setError('');
    return () => {
      if (current.current) URL.revokeObjectURL(current.current);
      current.current = '';
    };
  }, [url]);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const lifetime = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.any([
            lifetime.signal,
            AbortSignal.timeout(15000),
          ]),
        });
        if (!response.ok)
          throw new Error(
            (await response.json()).error ??
              t('画面获取失败', 'Failed to fetch screen frame'),
          );
        if (response.status !== 204) {
          const blob = await response.blob();
          if (stopped) return;
          const next = URL.createObjectURL(blob);
          setSrc(next);
          setError('');
          if (current.current) URL.revokeObjectURL(current.current);
          current.current = next;
        }
      } catch (cause) {
        if (!stopped) setError(te(String(cause)));
      }
      if (!stopped) timer = setTimeout(poll, 200);
    };
    void poll();
    return () => {
      stopped = true;
      lifetime.abort();
      clearTimeout(timer);
    };
  }, [url, active, t, te]);
  return (
    <div className="ios-airlink-live">
      {src ? (
        <img src={src} alt={t('手机实时画面', 'Live phone screen')} />
      ) : (
        active && <Spinner label={t('等待手机画面', 'Waiting for screen')} />
      )}
      {showError && error && <Alert type="warning" message={error} />}
    </div>
  );
}

/** Polling screenshot preview for connected device cards and detail modal. */
export function LiveScreenshot({
  getScreenshot,
  paused = false,
}: {
  getScreenshot: () => Promise<{
    screenshot: string;
    timestamp: number;
  } | null>;
  paused?: boolean;
}) {
  const { t } = useI18n();
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (paused) return;
    let stopped = false;
    const load = async () => {
      try {
        const res = await getScreenshot();
        if (stopped) return;
        if (res?.screenshot) {
          setScreenshot(res.screenshot.trim());
          setError(null);
        }
      } catch (cause) {
        if (!stopped) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [getScreenshot, paused]);

  if (screenshot) {
    return <img src={screenshot} alt={t('设备画面', 'Device screen')} />;
  }
  return (
    <div className="ios-airlink-pending-waiting">
      {error ? <span>{error}</span> : <Spinner />}
    </div>
  );
}
