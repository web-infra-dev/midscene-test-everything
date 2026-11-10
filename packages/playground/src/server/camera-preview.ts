import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { CameraSessionManager } from '@midscene/arm-kit';
import type { PerspectiveTarget } from '@midscene/arm-kit-shared/camera/vision-types';
import type { CameraCorrection } from '@midscene/arm-kit-shared/contracts';
import type { DeviceEntry } from './devices.js';

/** Share the camera stream; corrected frames use the same accepted mapping as task screenshots. */
export async function streamCameraPreview(
  res: ServerResponse,
  entry: Pick<DeviceEntry, 'camera'> & Partial<Pick<DeviceEntry, 'device'>>,
  corrected = false,
) {
  const stream = entry.camera.stream;
  const device = corrected ? entry.device : undefined;
  if (corrected && !device)
    throw new Error('Connect the arm for corrected previews');
  if (device) await device.configuration();
  if (res.destroyed) return;
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  let blocked = false;
  let processing = false;
  let lastCorrectedAt = 0;
  const writeFrame = async (frame: { jpeg: Buffer }) => {
    if (blocked || processing || res.destroyed || res.writableEnded) return;
    // Drop intermediate frames instead of queuing expensive perspective transforms.
    if (corrected && Date.now() - lastCorrectedAt < 100) return;
    processing = true;
    try {
      const jpeg = device
        ? Buffer.from(await device.screenshotBase64(), 'base64')
        : frame.jpeg;
      if (res.destroyed || res.writableEnded) return;
      const header = Buffer.from(
        `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`,
      );
      blocked = !res.write(Buffer.concat([header, jpeg, Buffer.from('\r\n')]));
      lastCorrectedAt = Date.now();
    } catch {
      // Never silently substitute raw frames for an invalid corrected view.
      res.destroy();
    } finally {
      processing = false;
    }
  };
  const drained = () => {
    blocked = false;
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

/** A camera-only preview owns the stream for the lifetime of this HTTP response. */
export async function streamStandalonePreview(
  res: ServerResponse,
  cameras: CameraSessionManager,
  id: string,
) {
  const owner = randomUUID();
  const camera = await cameras.acquire(id, owner);
  try {
    if (res.destroyed) return;
    const closed = new Promise<void>((resolve) => res.once('close', resolve));
    await streamCameraPreview(res, { camera });
    await closed;
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
) {
  const owner = randomUUID();
  const camera = await cameras.acquire(id, owner);
  try {
    await camera.checkCorrection(correction);
    if (target) await camera.setPerspective(correction, target);
    else await camera.setCorrection(correction);
  } finally {
    await cameras.release(id, owner);
  }
}
