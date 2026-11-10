import { createServer } from 'node:http';
import { type CameraSetupOptions, createCameraSetup } from './session.js';

/** Used by standalone consumers; hosts mount CameraSetupSession directly. */
export async function openCameraSetup(
  options: CameraSetupOptions & { openBrowser(url: string): Promise<void> },
) {
  const setup = createCameraSetup(options);
  const prefix = `/setup/${setup.id}`;
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (!path.startsWith(`${prefix}/`)) {
      res.writeHead(404).end();
      return;
    }
    void setup
      .handle(req, res, path.slice(prefix.length))
      .catch((error: Error) => {
        if (!res.headersSent)
          res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing setup address');
  const timer = setTimeout(() => void setup.close(), 10 * 60_000);
  try {
    await options.openBrowser(`http://127.0.0.1:${address.port}${prefix}/`);
    return await setup.result;
  } finally {
    clearTimeout(timer);
    await setup.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
