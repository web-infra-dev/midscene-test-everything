import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { listOpenDevices } from '@midscene/open-device';
import {
  type LaunchPlaygroundOptions,
  playgroundForSessionManager,
} from '@midscene/playground';
import express from 'express';
import {
  RemoteSessionManager,
  openDevicePlatform,
  serviceOptions,
} from './platform.js';

export { openDevicePlatform };

export async function launchOpenDevicePlayground(
  options: LaunchPlaygroundOptions = {},
) {
  const connectionPage = fileURLToPath(new URL('./ui/', import.meta.url));
  const require = createRequire(import.meta.url);
  const upstreamStatic = resolve(
    dirname(require.resolve('@midscene/playground')),
    '../../static',
  );
  const [upstreamPage, connectionHtml] = await Promise.all([
    readFile(join(options.staticPath ?? upstreamStatic, 'index.html'), 'utf8'),
    readFile(join(connectionPage, 'connect.html'), 'utf8'),
  ]);
  const connectionAssets = connectionHtml.match(
    /<link\b[^>]*href="\/open-device\/ui\/[^"]+"[^>]*>|<script\b[^>]*src="\/open-device\/ui\/[^"]+"[^>]*><\/script>/g,
  );
  if (!connectionAssets?.length)
    throw new Error('Missing Open Device Playground connection assets.');
  const page = upstreamPage.replace(
    '</head>',
    `${connectionAssets.join('')}</head>`,
  );
  const platform = await openDevicePlatform.prepare(undefined);
  const launched = await playgroundForSessionManager().launch({
    port: 5800,
    ...options,
    async configureServer(server) {
      server.setPreparedPlatform(platform);
      const app = server.app as express.Express;
      app.get('/', (_req, res) => {
        res.set('Cache-Control', 'no-store').type('html').send(page);
      });
      app.get('/mjpeg', async (_req, res) => {
        const manager = platform.sessionManager;
        const cancellation = new AbortController();
        const abort = () => cancellation.abort();
        res.once('close', abort);
        try {
          const upstream =
            manager instanceof RemoteSessionManager
              ? await manager.openPreview(cancellation.signal)
              : undefined;
          if (!upstream) {
            res.status(409).json({ error: '请先连接设备。' });
            return;
          }
          const type = upstream.headers.get('content-type');
          if (
            !upstream.body ||
            !type?.startsWith('multipart/x-mixed-replace;')
          ) {
            await upstream.body?.cancel();
            res.status(502).json({ error: '设备服务未返回预览流。' });
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
            res.status(502).json({ error: '设备预览连接失败。' });
        } finally {
          res.off('close', abort);
          abort();
        }
      });
      app.get('/open-device/session-status', (_req, res) => {
        const manager = platform.sessionManager;
        res.set('Cache-Control', 'no-store').json({
          ended:
            manager instanceof RemoteSessionManager && manager.sessionEnded,
        });
      });
      app.use(
        '/open-device/ui',
        express.static(connectionPage, { index: false }),
      );
      app.post(
        '/open-device/devices',
        express.json({ limit: '8kb' }),
        (req, res) => {
          res.set('Cache-Control', 'no-store');
          void Promise.resolve()
            .then(() => listOpenDevices(serviceOptions(req.body)))
            .then((devices) => res.json({ devices }))
            .catch((error: Error) =>
              res.status(400).json({ error: error.message }),
            );
        },
      );
      await options.configureServer?.(server);
    },
  });
  return { ...launched, port: launched.server.port ?? launched.port };
}
