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
 * One live preview per camera. A browser that is refreshed or switched between
 * raw/corrected leaves the previous multipart response open unless it is
 * explicitly destroyed; accumulating those responses exhausts the browser's
 * per-host connection pool and stalls the next page load.
 */
const standalonePreviews = new Map<string, Set<ServerResponse>>();

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
) {
  const { camera } = entry;
  if (corrected && !camera.getRectifiedPreviewTarget())
    throw Object.assign(
      new Error('Save perspective correction before viewing it'),
      { status: 409 },
    );
  await streamFrames(
    res,
    camera.stream,
    corrected ? (frame) => rectifyPreviewFrame(camera, frame) : undefined,
    corrected ? 100 : 0,
  );
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
) {
  const owner = randomUUID();
  const camera = await cameras.acquire(
    id,
    owner,
    view === 'corrected' ? screenId : undefined,
  );
  const previous = standalonePreviews.get(id);
  const active = previous ?? new Set<ServerResponse>();
  active.add(res);
  standalonePreviews.set(id, active);
  // Acquire first, then retire older viewers: the camera keeps its new owner
  // and the old multipart sockets are freed instead of lingering.
  for (const old of previous ?? []) if (old !== res) old.destroy();
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
    active.delete(res);
    if (!active.size && standalonePreviews.get(id) === active)
      standalonePreviews.delete(id);
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
) {
  const owner = randomUUID();
  const camera = await cameras.acquire(id, owner, screenId);
  try {
    await camera.checkCorrection(correction);
    if (target) await camera.setPerspective(correction, target);
    else await camera.setCorrection(correction);
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
