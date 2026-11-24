import { parentPort } from 'node:worker_threads';
import sharp from 'sharp';
import { isRobotArmError } from '../contracts.js';
import { PerspectiveTransformer } from './perspective-transformer.js';
import {
  type RectifiedPreviewJob,
  transformRectifiedPreview,
} from './rectified-preview-transform.js';

const port = parentPort!;
const transformer = new PerspectiveTransformer();
// The pool supplies parallelism; avoid nested per-worker image thread pools.
sharp.concurrency(1);

port.on(
  'message',
  async ({
    id,
    jpeg,
    ...request
  }: RectifiedPreviewJob & {
    id: number;
  }) => {
    try {
      const corrected = await transformRectifiedPreview(
        Buffer.from(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength),
        request,
        transformer,
      );
      const output = Uint8Array.from(corrected);
      port.postMessage({ id, jpeg: output }, [output.buffer]);
    } catch (error) {
      port.postMessage({
        id,
        error: isRobotArmError(error)
          ? {
              message: error.message,
              code: error.code,
              status: error.status,
              details: error.details,
            }
          : {
              message: error instanceof Error ? error.message : String(error),
            },
      });
    }
  },
);
