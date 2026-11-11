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
import { iosHIDPlatform, serviceOptions } from './platform.js';

export { iosHIDPlatform };

export async function launchIOSHIDPlayground(
  options: LaunchPlaygroundOptions = {},
) {
  const connectionPage = fileURLToPath(new URL('../public/', import.meta.url));
  const require = createRequire(import.meta.url);
  const upstreamStatic = resolve(
    dirname(require.resolve('@midscene/playground')),
    '../../static',
  );
  const upstreamPage = await readFile(
    join(options.staticPath ?? upstreamStatic, 'index.html'),
    'utf8',
  );
  const page = upstreamPage.replace(
    '</head>',
    '<link rel="stylesheet" href="/ios-hid/ui/connect.css"><script src="/ios-hid/ui/connect.js" defer></script></head>',
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
