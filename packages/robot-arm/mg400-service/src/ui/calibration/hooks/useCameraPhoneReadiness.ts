import { useEffect, useState } from 'react';
import type { ScreenCalibClient as RobotArmApi } from '../marker-client';
import { isRequiredPhonePage } from '../utils/phone-readiness';
interface CameraProfile {
  id: string;
  online?: boolean;
  screenBindings?: { id: string; pageKey?: string }[];
}

export type InstallationConnection = Awaited<
  ReturnType<RobotArmApi['installationConnection']>
>;

export interface CameraPhoneReadiness {
  cameraAvailable: boolean;
  cameraOnline: boolean;
  /** Camera these counts belong to, when the caller named one. */
  cameraId?: string;
  connection?: InstallationConnection;
  error?: string;
  ready: boolean;
  readyPhones: InstallationConnection['devices'];
  requiredPhones: number;
  resolved: boolean;
}

export function deriveCameraPhoneReadiness(input: {
  cameras: readonly CameraProfile[];
  cameraId?: string;
  connection?: InstallationConnection;
  error?: string;
  resolved: boolean;
}): CameraPhoneReadiness {
  const cameraOnline = input.cameras.some(
    (camera) => camera.id === input.cameraId && camera.online,
  );
  /*
   * Count pages assigned to this camera, including a saved browser identity
   * whose transient assignment was lost in a service restart. Unknown pages
   * and pages explicitly assigned to another camera never count.
   */
  const cameraId = input.cameraId;
  const selectedCamera = input.cameras.find(
    (camera) => camera.id === input.cameraId,
  );
  const readyPhones = (input.connection?.devices ?? []).filter(
    (device) =>
      isRequiredPhonePage(device, cameraId, selectedCamera?.screenBindings) &&
      device.visible &&
      device.fullscreen,
  );
  const requiredPhones = Math.max(
    1,
    selectedCamera?.screenBindings?.length ?? 0,
  );
  return {
    cameraAvailable: input.cameras.some((camera) => camera.online),
    cameraOnline,
    ...(input.cameraId ? { cameraId: input.cameraId } : {}),
    connection: input.connection,
    error: input.error,
    // A page for another screen is not a fault: the workstation needs at least
    // one page per configured screen, and a multi-screen bench keeps several
    // pages open at once.
    ready:
      input.resolved &&
      cameraOnline &&
      (selectedCamera?.screenBindings?.length
        ? selectedCamera.screenBindings.every((screen) =>
            readyPhones.some((page) =>
              isRequiredPhonePage(page, cameraId, [screen]),
            ),
          )
        : readyPhones.length > 0) &&
      !input.error,
    readyPhones,
    requiredPhones,
    resolved: input.resolved,
  };
}

/**
 * Poll camera and phone readiness at the setup-page level so step completion
 * does not depend on the Camera and Phone step being mounted.
 */
export function useCameraPhoneReadiness(input: {
  active: boolean;
  api: RobotArmApi;
  cameras: readonly CameraProfile[];
  cameraId?: string;
}) {
  const [connection, setConnection] = useState<InstallationConnection>();
  const [error, setError] = useState<string>();
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let current = true;
    if (!input.active) {
      setConnection(undefined);
      setError(undefined);
      setResolved(false);
      return;
    }
    setResolved(false);
    let polling = false;
    const refresh = async () => {
      if (polling) return;
      polling = true;
      try {
        const next = await input.api.installationConnection();
        if (!current) return;
        setConnection(next);
        setError(undefined);
      } catch (cause) {
        if (!current) return;
        setConnection(undefined);
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        polling = false;
        if (current) setResolved(true);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [input.active, input.api]);

  return deriveCameraPhoneReadiness({
    cameras: input.cameras,
    cameraId: input.cameraId,
    connection,
    error,
    resolved,
  });
}
