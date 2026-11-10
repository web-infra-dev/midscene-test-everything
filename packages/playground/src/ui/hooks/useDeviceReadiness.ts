import { useEffect, useState } from 'react';
import { checkDeviceCalibration } from '../device-readiness';

type Result = { id: string; revision: string } & (
  | { status: 'ready' | 'required' }
  | { status: 'error'; error: string }
);

export function useDeviceReadiness(id: string | undefined, revision: string) {
  const [result, setResult] = useState<Result>();
  useEffect(() => {
    if (!id) return;
    const abort = new AbortController();
    void checkDeviceCalibration(id, abort.signal)
      .then((status) => {
        if (!abort.signal.aborted) setResult({ id, revision, status });
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setResult({ id, revision, status: 'error', error: String(error) });
      });
    return () => abort.abort();
  }, [id, revision]);
  return result && result.id === id && result.revision === revision
    ? result
    : undefined;
}
