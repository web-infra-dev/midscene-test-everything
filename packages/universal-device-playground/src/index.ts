import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
  type LaunchPlaygroundOptions,
  PlaygroundServer,
  playgroundForSessionManager,
} from '@midscene/playground';
import { listUniversalDevices } from '@midscene/universal-device';
import express from 'express';
import {
  PlaygroundDeviceSessions,
  deviceBootstrap,
  deviceRoute,
  deviceScope,
} from './device-sessions.js';
import {
  type RemoteSessionManager,
  prepareUniversalDevicePlatform,
  serviceOptions,
  universalDevicePlatform,
} from './platform.js';

export { universalDevicePlatform };

export async function launchUniversalDevicePlayground(
  options: LaunchPlaygroundOptions = {},
) {
  const connectionPage = fileURLToPath(new URL('./ui/', import.meta.url));
  const require = createRequire(import.meta.url);
  const staticPath =
    options.staticPath ??
    resolve(dirname(require.resolve('@midscene/playground')), '../../static');
  const [upstreamPage, connectionHtml] = await Promise.all([
    readFile(join(staticPath, 'index.html'), 'utf8'),
    readFile(join(connectionPage, 'connect.html'), 'utf8'),
  ]);
  const connectionAssets = connectionHtml.match(
    /<link\b[^>]*href="\/open-device\/ui\/[^"]+"[^>]*>|<script\b[^>]*src="\/open-device\/ui\/[^"]+"[^>]*><\/script>/g,
  );
  if (!connectionAssets?.length)
    throw new Error('Missing Universal Device Playground connection assets.');
  const page = upstreamPage
    .replace(/<head\b[^>]*>/i, (head) => head + deviceBootstrap)
    .replace('</head>', `${connectionAssets.join('')}</head>`);
  const sessions = new PlaygroundDeviceSessions((scope) =>
    createDeviceServer(staticPath, scope),
  );

  try {
    const launched = await playgroundForSessionManager().launch({
      port: 5800,
      ...options,
      async configureServer(server) {
        const platform = prepareUniversalDevicePlatform();
        server.setPreparedPlatform(platform);
        const app = server.app as express.Express;
        app.get(
          ['/', '/index.html', '/playground/:contextId', deviceRoute],
          (req, res) => {
            if (req.params.connectionId && !deviceScope(req.params))
              return res.sendStatus(404);
            res.set('Cache-Control', 'no-store').type('html').send(page);
          },
        );
        app.use(
          '/open-device/ui',
          express.static(connectionPage, { index: false }),
        );
        app.use(express.static(staticPath, { index: false, redirect: false }));
        app.post(
          '/open-device/devices',
          express.json({ limit: '8kb' }),
          (req, res) => {
            res.set('Cache-Control', 'no-store');
            void Promise.resolve()
              .then(() => listUniversalDevices(serviceOptions(req.body)))
              .then((devices) => res.json({ devices }))
              .catch((error: Error) =>
                res.status(400).json({ error: error.message }),
              );
          },
        );
        app.post(`${deviceRoute}/leave`, (req, res) => {
          const scope = deviceScope(req.params);
          if (scope) sessions.leave(scope);
          res.sendStatus(204);
        });
        app.post(
          `${deviceRoute}/session`,
          express.json({ limit: '8kb' }),
          (req, res, next) => {
            if (req.body?.deviceId !== req.params.deviceId)
              return res
                .status(400)
                .json({ error: 'Select the device for this page.' });
            next();
          },
        );
        await options.configureServer?.(server);
        app.use(deviceRoute, (req, res, next) => {
          const scope = deviceScope(req.params);
          if (!scope) return res.sendStatus(404);
          sessions.handle(scope, req, res, next);
        });
        mountDevicePreview(app, platform.sessionManager);
      },
    });
    return {
      ...launched,
      port: launched.server.port ?? launched.port,
      async close() {
        await Promise.all([sessions.close(), launched.close()]);
      },
    };
  } catch (error) {
    await sessions.close();
    throw error;
  }
}

async function createDeviceServer(staticPath: string, scope: string) {
  const server = new PlaygroundServer(
    undefined,
    staticPath,
    scope.split('/').at(-1),
  );
  const platform = prepareUniversalDevicePlatform(scope);
  server.setPreparedPlatform(platform);
  const app = server.app as express.Express;
  mountDevicePreview(app, platform.sessionManager);
  app.post(['/execute', '/cancel/:requestId'], (_req, res, next) => {
    // Upstream's report links can open with no referrer in a separate tab.
    const json = res.json.bind(res);
    res.json = (body) => {
      const report = body?.report;
      if (
        report?.url?.startsWith('/reports/') &&
        report.replayUrl?.startsWith('/reports/')
      ) {
        body = {
          ...body,
          report: {
            ...report,
            url: scope + report.url,
            replayUrl: scope + report.replayUrl,
          },
        };
      }
      return json(body);
    };
    next();
  });
  // Upstream initializes its Express routes in launch(). Mount the resulting
  // app behind the public listener and release the temporary socket.
  await server.launch(0);
  const listener = server.server;
  await new Promise<void>((resolve, reject) => {
    if (!listener) return resolve();
    listener.close((error) => (error ? reject(error) : resolve()));
  });
  server.server = undefined;
  return server;
}

function mountDevicePreview(
  app: express.Express,
  manager: RemoteSessionManager,
) {
  app.get('/mjpeg', async (_req, res) => {
    const cancellation = new AbortController();
    const abort = () => cancellation.abort();
    res.once('close', abort);
    try {
      const upstream = await manager.openPreview(cancellation.signal);
      if (!upstream) {
        res.status(409).json({ error: 'Connect a device first.' });
        return;
      }
      const type = upstream.headers.get('content-type');
      if (!upstream.body || !type?.startsWith('multipart/x-mixed-replace;')) {
        await upstream.body?.cancel();
        res
          .status(502)
          .json({ error: 'Device service did not return a preview stream.' });
        return;
      }
      res.set({
        'Content-Type': type,
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      const body = upstream.body as Parameters<typeof Readable.fromWeb>[0];
      await pipeline(Readable.fromWeb(body), res, {
        signal: cancellation.signal,
      });
    } catch {
      if (!res.destroyed && !res.headersSent)
        res.status(502).json({ error: 'Failed to connect device preview.' });
    } finally {
      res.off('close', abort);
      abort();
    }
  });
  app.get('/open-device/session-status', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({
      ended: manager.sessionEnded,
    });
  });
}
