import { Alert, Spin } from 'antd';
import { useEffect, useState } from 'react';
import { CalibrationWorkspace } from '../CalibrationWorkspace';
import { t, useCalibrationLanguage } from '../i18n';

export function StandaloneCalibration() {
  const language = useCalibrationLanguage((state) => state.language);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [expired, setExpired] = useState(false);
  const [completed, setCompleted] = useState(false);
  useEffect(() => {
    if (completed) return;
    let disposed = false;
    let pending = false;
    let lastConnected = Date.now();
    let graceMs = 90_000;
    let controller: AbortController | undefined;
    const renew = async () => {
      if (pending || disposed) return;
      pending = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 5000);
      try {
        const response = await fetch('/_calibration/page?review', {
          method: 'POST',
          signal: controller.signal,
        });
        if (disposed) return;
        if (response.status === 410) {
          setExpired(true);
          setOffline(true);
          disposed = true;
          return;
        }
        if (!response.ok) throw new Error('Page connection failed');
        const configuredGrace = Number(
          response.headers.get('X-Calibration-Page-Timeout'),
        );
        if (Number.isFinite(configuredGrace) && configuredGrace > 0)
          graceMs = configuredGrace;
        lastConnected = Date.now();
        setReady(true);
        setOffline(false);
      } catch {
        if (!disposed) {
          setOffline(true);
          if (Date.now() - lastConnected >= graceMs) {
            setExpired(true);
            disposed = true;
          }
        }
      } finally {
        clearTimeout(timeout);
        pending = false;
      }
    };
    void renew();
    const timer = setInterval(() => void renew(), 5000);
    const visible = () => {
      if (!document.hidden) void renew();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true;
      clearInterval(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', visible);
    };
  }, [completed]);
  if (completed)
    return (
      <main className="calibration-page">
        <Alert
          type="success"
          showIcon
          message={t(
            'Calibration finished. You can close this tab.',
            [],
            language,
          )}
        />
      </main>
    );
  return (
    <div className="standalone-calibration">
      {offline && (
        <Alert
          type="error"
          showIcon
          message={t(
            expired
              ? 'Calibration page expired. Start calibration again from your script.'
              : 'Connection to calibration was lost. Reconnecting…',
            [],
            language,
          )}
        />
      )}
      {ready && !expired ? (
        <CalibrationWorkspace
          onComplete={async () => {
            const response = await fetch('/_calibration/finish', {
              method: 'POST',
              signal: AbortSignal.timeout(10000),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            setCompleted(true);
            window.close();
          }}
        />
      ) : (
        !offline && (
          <div className="calibration-page">
            <Spin />
          </div>
        )
      )}
    </div>
  );
}
