import type {
  ScreenCalibClient,
  ScreenDeviceSummary,
  TargetDisplaySession,
} from '../marker-client';

type MarkerPageClient = Pick<
  ScreenCalibClient,
  'assignScreenDevice' | 'listScreenDevices' | 'listTargetDisplays'
>;

interface MarkerPageBinding {
  deviceId: string;
  targetDisplayId: string;
}

interface PrepareMarkerPagesOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

const DEFAULT_PREPARE_TIMEOUT_MS = 8000;
const DEFAULT_POLL_INTERVAL_MS = 250;
const ACTIVE_DISPLAY_STATES = new Set(['pending', 'ready']);

function activeDisplayFor(
  displays: readonly TargetDisplaySession[],
  targetId: string,
) {
  return displays
    .filter(
      (display) =>
        display.visionTargetId === targetId &&
        ACTIVE_DISPLAY_STATES.has(display.state),
    )
    .slice(-1)[0];
}

function updatedDevice(
  devices: readonly ScreenDeviceSummary[],
  device: ScreenDeviceSummary,
) {
  return devices.map((candidate) =>
    candidate.id === device.id ? { ...candidate, ...device } : candidate,
  );
}

/**
 * Reuse the same phone page and mapping session while returning the page to
 * marker mode. A newly created target display may have a different id from the
 * display used by the completed mapping, so related historical displays are
 * considered before assigning the page to the active display.
 */
async function assignMarkerPages(
  client: MarkerPageClient,
  targetIds: readonly string[],
  requireBinding: boolean,
  cameraId?: string,
): Promise<MarkerPageBinding[]> {
  const requestedTargetIds = [...new Set(targetIds)].filter(Boolean);
  if (!requestedTargetIds.length) return [];
  const [displays, listed] = await Promise.all([
    client.listTargetDisplays(),
    client.listScreenDevices(),
  ]);
  let devices = listed.devices;
  const claimedDevices = new Set<string>();
  const bindings: MarkerPageBinding[] = [];

  for (const targetId of requestedTargetIds) {
    const related = displays.filter(
      (display) => display.visionTargetId === targetId,
    );
    const active = activeDisplayFor(displays, targetId);
    if (!active) {
      if (!requireBinding) continue;
      throw new Error(
        'The bound screen page is missing. Reopen screen calibration to reconnect it.',
      );
    }
    const relatedIds = new Set(related.map((display) => display.id));
    const candidates = devices.filter(
      (device) =>
        device.targetDisplayId && relatedIds.has(device.targetDisplayId),
    );
    const exact = candidates.filter(
      (device) => device.targetDisplayId === active.id,
    );
    if (exact.length > 1 || (!exact.length && candidates.length > 1))
      throw new Error(
        'More than one screen page is associated with this calibration screen. Reconnect the intended phone page and try again.',
      );
    const candidate = exact[0] ?? candidates[0];
    if (!candidate || claimedDevices.has(candidate.id)) {
      if (!requireBinding) continue;
      throw new Error(
        'The bound screen page is missing. Reopen screen calibration to reconnect it.',
      );
    }
    claimedDevices.add(candidate.id);
    bindings.push({
      deviceId: candidate.id,
      targetDisplayId: active.id,
    });
    if (candidate.mode === 'markers' && candidate.targetDisplayId === active.id)
      continue;
    // Assignment preserves the existing page credential and mapping session,
    // and the service refuses this transition while mapping is running.
    const assigned = await client.assignScreenDevice(candidate.id, {
      role: 'markers',
      targetDisplayId: active.id,
      ...(cameraId ? { cameraId } : {}),
    });
    if (assigned.device) devices = updatedDevice(devices, assigned.device);
  }
  return bindings;
}

/** Best-effort restoration for phones associated with these targets. */
export async function restoreMarkerPages(
  client: MarkerPageClient,
  targetIds: readonly string[],
  cameraId?: string,
) {
  await assignMarkerPages(client, targetIds, false, cameraId);
}

/**
 * Switch bound phones to marker mode and wait until the page has painted the
 * markers. Vision must not capture while the phones still show page mapping.
 */
export async function prepareMarkerPagesForDetection(
  client: MarkerPageClient,
  targetIds: readonly string[],
  options: PrepareMarkerPagesOptions & { cameraId?: string } = {},
) {
  const bindings = await assignMarkerPages(
    client,
    targetIds,
    true,
    options.cameraId,
  );
  if (!bindings.length) return;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PREPARE_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + timeoutMs;

  for (;;) {
    const { devices } = await client.listScreenDevices();
    const ready = bindings.every((binding) => {
      const device = devices.find(
        (candidate) =>
          candidate.targetDisplayId === binding.targetDisplayId &&
          candidate.id === binding.deviceId,
      );
      return (
        device?.mode === 'markers' &&
        device.markersReady === true &&
        device.visible === true &&
        device.fullscreen === true
      );
    });
    if (ready) return;
    const remaining = deadline - now();
    if (remaining <= 0)
      throw new Error(
        'The bound phone page did not return to the marker view. Keep the page open and try again.',
      );
    await sleep(Math.min(pollIntervalMs, remaining));
  }
}
