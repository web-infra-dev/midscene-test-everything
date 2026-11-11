import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listIOSHIDDevices } from '@midscene/ios-hid';
import {
  type LaunchPlaygroundOptions,
  playgroundForSessionManager,
} from '@midscene/playground';
import express from 'express';
import {
  RemoteSessionManager,
  iosHIDPlatform,
  serviceOptions,
} from './platform.js';

export { iosHIDPlatform };

export async function launchIOSHIDPlayground(
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
    /<link\b[^>]*href="\/ios-hid\/ui\/[^"]+"[^>]*>|<script\b[^>]*src="\/ios-hid\/ui\/[^"]+"[^>]*><\/script>/g,
  );
  if (!connectionAssets?.length)
    throw new Error('Missing iOS HID Playground connection assets.');
  const page = upstreamPage.replace(
    '</head>',
    `${connectionAssets.join('')}</head>`,
  );
  const platform = await iosHIDPlatform.prepare(undefined);
  const launched = await playgroundForSessionManager().launch({
    port: 5800,
    ...options,
    async configureServer(server) {
      server.setPreparedPlatform(platform);
      const app = server.app as express.Express;
      app.get('/', (_req, res) => {
        res.set('Cache-Control', 'no-store').type('html').send(page);
      });
      app.get('/ios-hid/session-status', (_req, res) => {
        const manager = platform.sessionManager;
        res.set('Cache-Control', 'no-store').json({
          ended:
            manager instanceof RemoteSessionManager && manager.sessionEnded,
        });
      });
      app.use('/ios-hid/ui', express.static(connectionPage, { index: false }));
      app.post(
        '/ios-hid/devices',
        express.json({ limit: '8kb' }),
        (req, res) => {
          res.set('Cache-Control', 'no-store');
          void Promise.resolve()
            .then(() => listIOSHIDDevices(serviceOptions(req.body)))
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
