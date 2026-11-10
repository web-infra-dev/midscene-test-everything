/** Only an explicit calibration error leads to setup; transport errors stay retryable. */
export async function checkDeviceCalibration(
  id: string,
  signal?: AbortSignal,
): Promise<'ready' | 'required'> {
  const response = await fetch(
    `/api/devices/${encodeURIComponent(id)}/configuration`,
    {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    },
  );
  const data = await response.json();
  if (!response.ok) {
    if (requiresCalibration(data.code)) return 'required';
    throw new Error(data.error || 'Unable to check device calibration');
  }
  if (!data.calibration || !data.screen)
    throw new Error('Invalid device configuration');
  return 'ready';
}

export function requiresCalibration(code: string) {
  return [
    'CALIBRATION_REQUIRED',
    'MAPPING_REQUIRED',
    'EXECUTION_CONTEXT_CHANGED',
    'VISION_BINDING_CHANGED',
  ].includes(code);
}
