import type { CalibrationImagingStatus } from '@midscene/robotics-shared/assisted-contracts';

interface ImagingCompletionOptions {
  screenId: string;
  load: () => Promise<{ imaging?: CalibrationImagingStatus }>;
  activate: () => Promise<CalibrationImagingStatus>;
  shouldContinue?: () => boolean;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export function shouldSwitchScreenImaging({
  step,
  hasCorrection,
  batchActive,
  singleBusy,
  controllerBusy,
  markerOpen,
  perspectiveEditor,
}: {
  step: number;
  hasCorrection: boolean;
  batchActive: boolean;
  singleBusy: boolean;
  controllerBusy: boolean;
  markerOpen: boolean;
  perspectiveEditor: boolean;
}) {
  return (
    step >= 2 &&
    hasCorrection &&
    !batchActive &&
    !singleBusy &&
    !controllerBusy &&
    !markerOpen &&
    !perspectiveEditor
  );
}

export function screenImagingSwitchError(
  imaging: CalibrationImagingStatus | undefined,
  screenId: string,
) {
  if (!imaging) return 'Camera imaging switch failed';
  if (imaging.state === 'unsupported') return undefined;
  if (imaging.state === 'error' || imaging.state === 'unconfigured')
    return (
      imaging.message ??
      `Camera imaging was not applied to the selected screen ${screenId}`
    );
  if (
    imaging.state === 'ready' &&
    (imaging.active === false ||
      (imaging.screenId !== undefined && imaging.screenId !== screenId))
  )
    return `Camera imaging was not applied to the selected screen ${screenId}`;
  return undefined;
}

/**
 * Wait for the background camera calibration, then activate the screen the
 * operator still has selected when that calibration finishes.
 */
export async function finishCameraImagingForScreen({
  screenId,
  load,
  activate,
  shouldContinue = () => true,
  timeoutMs = 120_000,
  pollMs = 100,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: ImagingCompletionOptions): Promise<void> {
  const deadline = now() + timeoutMs;
  while (shouldContinue()) {
    const { imaging } = await load();
    if (imaging?.state === 'ready') {
      const applied = await activate();
      const switchError = screenImagingSwitchError(applied, screenId);
      if (switchError) throw new Error(switchError);
      return;
    }
    if (imaging?.state === 'unsupported') return;
    if (imaging?.state === 'error')
      throw new Error(
        imaging.message ?? 'Could not calibrate the camera image.',
      );
    if (now() >= deadline)
      throw new Error('Timed out while calibrating the camera image.');
    await sleep(pollMs);
  }
}
