import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { CameraFrame, CameraSessionManager } from '@midscene/arm-kit';
import type { CameraStream } from '@midscene/arm-kit/internal/camera/camera-stream';
import type { CalibrationPageLayout } from '@midscene/robotics-shared/assisted-contracts';
import type { PerspectiveTarget } from '@midscene/robotics-shared/camera/vision-types';
import type { CameraCorrection } from '@midscene/robotics-shared/contracts';
import type { DeviceEntry } from './devices.js';

export type CameraPreviewView = 'raw' | 'corrected';

type FrameTransform = (frame: CameraFrame) => Promise<Buffer>;

/**
 * Keep enough detail for small UI text when the preview is shown full screen,
 * while still capping a multi-megapixel target before rectifying every frame.
 */
export const CORRECTED_PREVIEW_OPTIONS = {
  maxSide: 1600,
  maxPixels: 1_440_000,
  sampling: 'bilinear',
} as const;
const CORRECTED_PREVIEW_INTERVAL_MS = correctedPreviewIntervalMs();

/**
 * Corrected previews cost a decode, a homography warp and a re-encode per
 * frame. Two cameras at 30 fps ask for more throughput than the worker pool
 * has, so each transformed preview keeps at most two frames in flight (see
 * `streamFrames`) and drops whatever it cannot show. That is enough to keep a
 * two-camera session stable without an artificial frame-rate cap; set
 * ROBOT_VISION_CORRECTED_PREVIEW_FPS to add one when a machine needs it.
 */
function correctedPreviewIntervalMs() {
  const configured = Number(
    process.env.ROBOT_VISION_CORRECTED_PREVIEW_FPS ?? 0,
  );
  if (!Number.isFinite(configured) || configured <= 0) return 0;
  return Math.max(1, Math.round(1000 / Math.min(configured, 60)));
}
/**
 * Calibration keeps the right-hand preview mounted while the perspective
 * editor opens live and corrected previews. Four streams leave two of the
 * browser's six connections available for arm and camera polling.
 */
const MAX_CLIENT_PREVIEWS = 4;

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
  while (active.size > MAX_CLIENT_PREVIEWS) {
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
  while (previews.size > MAX_CLIENT_PREVIEWS) {
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
 * One MJPEG response over one live stream. Bounded concurrent transforms keep
 * the stream smooth while preserved frame order prevents latency or reordering.
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
  let inFlight = 0;
  let lastWrittenAt = 0;
  let nextFrame = 0;
  let nextWrite = 0;
  const completed = new Map<number, Buffer>();
  // Uncapped previews can overlap two transforms. A capped preview admits one
  // frame at a time so the next frame must wait for the last write interval.
  const maxInFlight = minIntervalMs > 0 ? 1 : 2;
  const flush = () => {
    while (
      !res.destroyed &&
      !res.writableEnded &&
      !blocked &&
      completed.has(nextWrite)
    ) {
      const jpeg = completed.get(nextWrite)!;
      completed.delete(nextWrite);
      nextWrite += 1;
      const header = Buffer.from(
        `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`,
      );
      blocked = !res.write(Buffer.concat([header, jpeg, Buffer.from('\r\n')]));
      blockedSince = blocked ? Date.now() : 0;
      lastWrittenAt = Date.now();
    }
  };
  const writeFrame = async (frame: CameraFrame) => {
    if (res.destroyed || res.writableEnded) return;
    if (blocked) {
      if (Date.now() - blockedSince > 10_000) res.destroy();
      return;
    }
    if (inFlight + completed.size >= maxInFlight) return;
    if (minIntervalMs && Date.now() - lastWrittenAt < minIntervalMs) return;
    const sequence = nextFrame++;
    inFlight += 1;
    try {
      const jpeg = transform ? await transform(frame) : frame.jpeg;
      if (res.destroyed || res.writableEnded) return;
      completed.set(sequence, jpeg);
      flush();
    } catch {
      // Never silently substitute raw frames for an invalid corrected view.
      res.destroy();
    } finally {
      inFlight -= 1;
    }
  };
  const drained = () => {
    blocked = false;
    blockedSince = 0;
    flush();
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
  screenId?: string,
) {
  const { camera } = entry;
  // A camera can hold one perspective per screen. The 3D twin names the screen
  // so two slabs can stream different rectifications of the same raw frames;
  // the camera id names the camera-level perspective.
  const session = screenId
    ? screenId === camera.camera.id
      ? await camera.forCamera()
      : await camera.forScreen(screenId)
    : camera;
  if (corrected && !session.getRectifiedPreviewTarget())
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
      corrected ? (frame) => rectifyPreviewFrame(session, frame) : undefined,
      corrected
        ? viewer?.startsWith('twin-')
          ? 100
          : CORRECTED_PREVIEW_INTERVAL_MS
        : 0,
    );
  } catch (error) {
    untrack();
    throw error;
  }
}

export function rectifyPreviewFrame(
  camera: DeviceEntry['camera'],
  frame: CameraFrame,
) {
  if (typeof camera.rectifiedPreviewFrame === 'function')
    return camera.rectifiedPreviewFrame(frame.jpeg, CORRECTED_PREVIEW_OPTIONS);
  return camera.rectifiedFrame(frame.jpeg, CORRECTED_PREVIEW_OPTIONS);
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
  checkCapture?: () => CalibrationPageLayout | undefined,
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
      checkCapture?.(),
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
