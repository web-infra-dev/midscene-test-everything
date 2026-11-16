import { parentPort, workerData } from 'node:worker_threads';
import {
  type CameraScreenSettings,
  PerspectiveTransformer,
  rectifyCameraFrame,
} from '@midscene/robotics-vision';

const port = parentPort!;
const settings: CameraScreenSettings = workerData;
const transformer = new PerspectiveTransformer();

port.on('message', async (jpeg: Uint8Array) => {
  try {
    const corrected = await rectifyCameraFrame(
      Buffer.from(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength),
      settings,
      transformer,
    );
    const frame = Uint8Array.from(corrected);
    port.postMessage({ jpeg: frame }, [frame.buffer]);
  } catch (error) {
    port.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
