import { Alert, Spin } from 'antd';
import { useEffect, useRef, useState } from 'react';

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
          throw new Error((await response.json()).error ?? '画面获取失败');
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
        if (!stopped) setError(String(cause));
      }
      if (!stopped) timer = setTimeout(poll, 200);
    };
    void poll();
    return () => {
      stopped = true;
      lifetime.abort();
      clearTimeout(timer);
    };
  }, [url, active]);
  return (
    <div className="ios-hid-live">
      {src ? (
        <img src={src} alt="手机实时画面" />
      ) : (
        active && <Spin tip="等待手机画面" />
      )}
      {showError && error && <Alert type="warning" message={error} />}
    </div>
  );
}
