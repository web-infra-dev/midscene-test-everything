import { useCallback, useEffect, useRef, useState } from 'react';
import { requiresCalibration } from '../device-readiness';
import type { CalibrationProfile, ScreenProfile } from '../robot-arm-api';
import { useRobotArm } from './useRobotArm';

const motionKeys = [
  'revision',
  'actionSpeed',
  'actionAcceleration',
  'pressDepthMm',
  'safeHeightMm',
  'contactMs',
  'swipeEndpointHoldMs',
  'longPressMs',
  'dragHoldMs',
  'successorStartLeadMs',
  'releaseSpeedFactor',
  'releaseAccelerationFactor',
];
export function useDeviceControls(id: string) {
  const arm = useRobotArm();
  const [data, setData] = useState<{
    screen: ScreenProfile;
    calibration: CalibrationProfile;
  }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const request = useCallback(
    async (route: string, body?: unknown) => {
      const response = await fetch(
        `/api/devices/${encodeURIComponent(id)}/${route}`,
        {
          method: body === undefined ? 'GET' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
      );
      const value = await response.json();
      if (
        route === 'configuration' &&
        !response.ok &&
        requiresCalibration(value.code)
      )
        return undefined;
      if (!response.ok)
        throw new Error(
          value.error?.message ?? value.error ?? `HTTP ${response.status}`,
        );
      return value;
    },
    [id],
  );
  const refresh = useCallback(async () => {
    setData(await request('configuration'));
    setError(undefined);
  }, [request]);
  useEffect(() => {
    let active = true;
    void request('configuration')
      .then((value) => {
        if (active) setData(value);
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [request]);
  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (pending.current) throw new Error('Wait for the current operation');
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await fn();
      await refresh();
      return result;
    } catch (cause) {
      setError(String(cause));
      throw cause;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return {
    ...arm,
    busy: arm.busy || busy,
    error,
    data,
    refresh,
    run,
    profiles: {
      screens: data ? [data.screen] : [],
      workstation: { screenProfileId: data?.screen.id },
    },
    api: {
      putScreen: (_id: string, candidate: ScreenProfile) =>
        request(
          'motion-settings',
          Object.fromEntries(
            motionKeys.map((key) => [
              key,
              candidate[key as keyof ScreenProfile],
            ]),
          ),
        ),
      safePosition: (mode: 'return' | 'record') =>
        request('safe-position', {
          mode,
          confirmed: true,
          calibrationId: data?.calibration.id,
          revision: data?.calibration.revision,
        }),
    },
  };
}
export type DeviceControls = ReturnType<typeof useDeviceControls>;
