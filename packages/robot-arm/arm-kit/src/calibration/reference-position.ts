import type { InstallationTeaching, ProfileData } from '../contracts.js';

export function savedCalibrationReference(
  loadProfiles: () => ProfileData,
  deviceId: string | undefined,
  cameraId: string | undefined,
  calibrationId: string | undefined,
  teaching?: InstallationTeaching,
) {
  if (
    deviceId !== undefined &&
    teaching?.referenceDeviceId === deviceId &&
    !teaching.invalidatedReason
  )
    return { pose: teaching.referencePose, source: 'teaching' as const };

  const profiles = loadProfiles();
  const start = calibrationId
    ? profiles.sessions?.find(
        (session) =>
          session.status === 'completed' &&
          session.candidate?.id === calibrationId,
      )?.auto?.startPose
    : undefined;
  if (start) return { pose: start, source: 'sampling-start' as const };

  // Older teachings lack a reference screen ID. Use one only for its sole owner.
  if (
    !deviceId ||
    !teaching ||
    teaching.invalidatedReason ||
    teaching.referenceDeviceId
  )
    return undefined;
  const otherTarget = profiles.screenTargets?.some(
    (target) =>
      !target.archived &&
      target.cameraId === cameraId &&
      target.id !== deviceId,
  );
  const otherDevice = [
    ...(profiles.calibrationSetups ?? []),
    ...(profiles.devices ?? []),
  ].some((item) => item.cameraId === cameraId && item.deviceId !== deviceId);
  if (!otherTarget && !otherDevice)
    return { pose: teaching.referencePose, source: 'teaching' as const };
}
