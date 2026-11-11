import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { CameraFrame, CameraSessionManager } from '@midscene/arm-kit';
import type { PerspectiveTarget } from '@midscene/arm-kit-shared/camera/vision-types';
import type { CameraCorrection } from '@midscene/arm-kit-shared/contracts';
import type { CameraStream } from '@midscene/arm-kit/internal/camera/camera-stream';
import type { DeviceEntry } from './devices.js';

export type CameraPreviewView = 'raw' | 'corrected';

type FrameTransform = (frame: CameraFrame) => Promise<Buffer>;

/**
 * A phone-screen preview lives in a panel of a few hundred CSS pixels. Cap the
 * rectified stream so a multi-megapixel target does not block the Node event
 * loop (and every other request) several times per second.
 */
const CORRECTED_PREVIEW_MAX_SIDE = 900;
const CORRECTED_PREVIEW_MAX_PIXELS = 450_000;
/** Every camera frame is cheap enough at this size with nearest sampling. */
const CORRECTED_PREVIEW_INTERVAL_MS = 0;

/**
 * Live previews for one (camera, browser tab), keyed by UI slot. A refresh or a
 * raw/corrected swap leaves the previous multipart response open unless it is
 * explicitly destroyed. Keep at most two slots: the browser only has six
 * connections, and the arm/camera polls must keep some of them.
 */
const clientPreviews = new Map<string, Map<string, ServerResponse>>();

/**
 * A retired MJPEG response must not leave a reusable keep-alive socket behind:
 * the next API request on that socket would hang until its timeout.
 */
function retirePreview(res: ServerResponse) {
  if (res.destroyed || res.writableEnded) return;
  try {
    res.end();
  } catch {
    // The socket is already gone.
  }
  res.destroy();
}

function trackClientPreview(
  cameraId: string | undefined,
  client: string | undefined,
  viewer: string | undefined,
  res: ServerResponse,
): () => void {
  if (!cameraId || !client) return () => {};
  const groupKey = `${cameraId}\u0000${client}`;
  const viewerKey = viewer || 'preview';
  let active = clientPreviews.get(groupKey);
  const previous = active?.get(viewerKey);
  active ??= new Map<string, ServerResponse>();
  active.set(viewerKey, res);
  clientPreviews.set(groupKey, active);
  if (previous && previous !== res) retirePreview(previous);
  // A hidden or unmounted preview can leave its response behind; the oldest
  // slot is the least likely to still be visible.
  while (active.size > 2) {
    const oldest = active.entries().next().value as
      | [string, ServerResponse]
      | undefined;
    if (!oldest || oldest[1] === res) break;
    active.delete(oldest[0]);
    retirePreview(oldest[1]);
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (active.get(viewerKey) === res) active.delete(viewerKey);
    if (!active.size && clientPreviews.get(groupKey) === active)
      clientPreviews.delete(groupKey);
  };
  res.once('close', release);
  return release;
}

/**
 * Previews also live in per-device calibration hosts. Cap them across every
 * route for one tab: the browser only has six connections, and six preview
 * responses leave nothing for the arm poll.
 */
const globalClientPreviews = new Map<string, Map<string, ServerResponse>>();

export function registerClientPreview(
  client: string | undefined,
  key: string,
  res: ServerResponse,
): () => void {
  if (!client) return () => {};
  let previews = globalClientPreviews.get(client);
  const previous = previews?.get(key);
  previews ??= new Map<string, ServerResponse>();
  previews.set(key, res);
  globalClientPreviews.set(client, previews);
  if (previous && previous !== res) retirePreview(previous);
  while (previews.size > 2) {
    const oldest = previews.entries().next().value as
      | [string, ServerResponse]
      | undefined;
    if (!oldest || oldest[1] === res) break;
    previews.delete(oldest[0]);
    retirePreview(oldest[1]);
  }
  const release = () => {
    if (previews!.get(key) === res) previews!.delete(key);
    if (!previews!.size && globalClientPreviews.get(client) === previews)
      globalClientPreviews.delete(client);
  };
  res.once('close', release);
  return release;
}

/**
 * One MJPEG response over one live stream. Frames are dropped, never queued, so
 * a slow perspective transform cannot build latency or outlive its viewer.
 */
async function streamFrames(
  res: ServerResponse,
  stream: CameraStream,
  transform?: FrameTransform,
  minIntervalMs = 0,
) {
  if (res.destroyed) return;
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Connection: 'close',
  });
  // Keep dead viewers from pinning a response forever.
  res.socket?.setKeepAlive(true, 5_000);
  res.socket?.setTimeout(30_000, () => res.destroy());
  let blocked = false;
  let blockedSince = 0;
  let processing = false;
  let lastWrittenAt = 0;
  const writeFrame = async (frame: CameraFrame) => {
    if (res.destroyed || res.writableEnded) return;
    if (blocked) {
      if (Date.now() - blockedSince > 10_000) res.destroy();
      return;
    }
    if (processing) return;
    if (minIntervalMs && Date.now() - lastWrittenAt < minIntervalMs) return;
    processing = true;
    try {
      const jpeg = transform ? await transform(frame) : frame.jpeg;
      if (res.destroyed || res.writableEnded) return;
      const header = Buffer.from(
        `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`,
      );
      blocked = !res.write(Buffer.concat([header, jpeg, Buffer.from('\r\n')]));
      blockedSince = blocked ? Date.now() : 0;
      lastWrittenAt = Date.now();
    } catch {
      // Never silently substitute raw frames for an invalid corrected view.
      res.destroy();
    } finally {
      processing = false;
    }
  };
  const drained = () => {
    blocked = false;
    blockedSince = 0;
  };
  const ended = () => res.end();
  res.on('drain', drained);
  stream.on('frame', writeFrame);
  stream.once('stopped', ended);
  stream.once('failed', ended);
  res.once('close', () => {
    res.off('drain', drained);
    stream.off('frame', writeFrame);
    stream.off('stopped', ended);
    stream.off('failed', ended);
  });
}

/** Preview the applied perspective directly from the shared camera stream. */
export async function streamCameraPreview(
  res: ServerResponse,
  entry: Pick<DeviceEntry, 'camera'>,
  corrected = false,
  client?: string,
  viewer?: string,
) {
  const { camera } = entry;
  if (corrected && !camera.getRectifiedPreviewTarget())
    throw Object.assign(
      new Error('Save perspective correction before viewing it'),
      { status: 409 },
    );
  if (res.destroyed) return;
  registerClientPreview(
    client,
    `camera:${camera.camera?.id ?? ''}:${viewer || 'preview'}`,
    res,
  );
  const untrack = trackClientPreview(camera.camera?.id, client, viewer, res);
  try {
    await streamFrames(
      res,
      camera.stream,
      corrected ? (frame) => rectifyPreviewFrame(camera, frame) : undefined,
      corrected ? CORRECTED_PREVIEW_INTERVAL_MS : 0,
    );
  } catch (error) {
    untrack();
    throw error;
  }
}

function rectifyPreviewFrame(
  camera: DeviceEntry['camera'],
  frame: CameraFrame,
) {
  return camera.rectifiedFrame(frame.jpeg, {
    maxSide: CORRECTED_PREVIEW_MAX_SIDE,
    maxPixels: CORRECTED_PREVIEW_MAX_PIXELS,
    sampling: 'nearest',
  });
}

function closedResponse(res: ServerResponse) {
  return new Promise<void>((resolve) => {
    if (res.destroyed || res.writableEnded) resolve();
    else res.once('close', resolve);
  });
}

/** A camera-only preview owns the stream for the lifetime of this HTTP response. */
export async function streamStandalonePreview(
  res: ServerResponse,
  cameras: CameraSessionManager,
  id: string,
  view: CameraPreviewView = 'raw',
  screenId?: string,
  client?: string,
  viewer?: string,
) {
  const owner = randomUUID();
  const camera = await cameras.acquire(
    id,
    owner,
    view === 'corrected' ? screenId : undefined,
  );
  try {
    if (res.destroyed) return;
    const closed = closedResponse(res);
    if (view === 'corrected') {
      const correction = camera.getCorrection();
      const target = camera.getPerspectiveTarget();
      if (!correction || !target)
        throw Object.assign(
          new Error('Save perspective correction before viewing it'),
          { status: 409 },
        );
    }
    const untrack = trackClientPreview(id, client, viewer, res);
    registerClientPreview(
      client,
      `standalone:${id}:${viewer || 'preview'}`,
      res,
    );
    try {
      if (view === 'corrected') {
        await streamFrames(
          res,
          camera.stream,
          (frame) => rectifyPreviewFrame(camera, frame),
          CORRECTED_PREVIEW_INTERVAL_MS,
        );
      } else {
        await streamFrames(res, camera.stream);
      }
      await closed;
    } finally {
      untrack();
    }
  } finally {
    await cameras.release(id, owner);
  }
}

/** Persist a camera-only perspective correction against one live camera frame. */
export async function saveStandaloneCorrection(
  cameras: CameraSessionManager,
  id: string,
  correction: CameraCorrection,
  target?: PerspectiveTarget,
  screenId?: string,
  checkCapture?: () => void,
  allowMismatch = false,
) {
  const owner = randomUUID();
  const camera = await cameras.acquire(id, owner, screenId);
  try {
    // Camera-only editing is an explicit operator action. Let it persist even
    // when the edited outline no longer aligns with this live frame; the result
    // is returned so the UI can warn and robot movement still revalidates it.
    const validity = await camera.checkCorrection(
      correction,
      undefined,
      allowMismatch,
    );
    checkCapture?.();
    if (target) await camera.setPerspective(correction, target);
    else await camera.setCorrection(correction);
    return validity;
  } finally {
    await cameras.release(id, owner);
  }
}

/** Delete the camera-only correction and its saved output target. */
export async function clearStandaloneCorrection(
  cameras: CameraSessionManager,
  id: string,
  screenId?: string,
) {
  await cameras.clearPerspective(id, screenId);
}
