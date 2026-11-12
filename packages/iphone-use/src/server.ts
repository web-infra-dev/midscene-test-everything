import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { runConnectivityTest } from '@midscene/core';
import {
  ControlError,
  createDeviceHandler,
} from '@midscene/open-device/server';
import { ModelConfigManager } from '@midscene/shared/env';
import express, { type Request } from 'express';
import type { DeviceConfig } from './hardware/types.js';
import { PhoneCalibration } from './phone-calibration.js';
import { ensureToken, label } from './settings.js';
import { DeviceWorkspaces } from './workspaces.js';

function localRequest(req: Request) {
  const port = req.socket.localPort;
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
    req.socket.remoteAddress ?? '',
  );
  const names = ['localhost', '127.0.0.1', '[::1]'];
  const hosts = names.map((name) => `${name}:${port}`);
  if (port === 80) hosts.push(...names);
  const origin = req.headers.origin;
  return (
    loopback &&
    hosts.includes(req.headers.host ?? '') &&
    (!origin || hosts.some((host) => origin === `http://${host}`))
  );
}

export async function runServer(
  port: number,
  {
    accessToken,
    workspaces: suppliedWorkspaces,
    listDevices,
  }: {
    accessToken?: string;
    listDevices?: () => Promise<DeviceConfig[]>;
    workspaces?: DeviceWorkspaces;
  } = {},
) {
  const serviceToken = accessToken ?? (await ensureToken());
  const token = Buffer.from(`Bearer ${serviceToken}`);
  const phoneCalibration = new PhoneCalibration(serviceToken);
  const workspaces = suppliedWorkspaces ?? new DeviceWorkspaces();
  const savedDevices = listDevices ?? (() => workspaces.listDevices());
  const { version } = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const phoneActions = [
    'home',
    'back',
    'clearInput',
    'tap',
    'doubleTap',
    'longPress',
    'swipe',
    'scroll',
    'dragAndDrop',
    'typeText',
    'key',
  ] as const;
  const deviceAPI = createDeviceHandler({
    token: serviceToken,
    readyDevice: (id) => {
      const device = workspaces.readyDevice(id);
      return device && { ...device, actions: [...phoneActions] };
    },
    async listDevices() {
      return (await savedDevices()).map(({ id, name, screen }) => ({
        id,
        name,
        screenSource: screen.source,
        status: workspaces.readyDevice(id) ? 'available' : 'offline',
        actions: [...phoneActions],
        preview: 'mjpeg',
        inputGuidance:
          'Input supports ASCII only. For other text, tap the on-screen keyboard and verify the committed text. Avoid starting swipes on the floating AssistiveTouch menu.',
      }));
    },
  });
  const sessions = deviceAPI.sessions;
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => {
    res
      .set('Cache-Control', 'no-store')
      .json({ service: label, pid: process.pid, version });
  });
  app.get('/phone-calibration', (req, res) => {
    const phone = phoneCalibration.authenticate(req);
    if (phone) phone.handle(req, res);
    else res.status(403).end();
  });
  app.use((req, res, next) => {
    if (localRequest(req)) next();
    else
      res.status(403).json({
        error: 'Open the device manager on the Mac running this service',
      });
  });
  app.post('/iphone-use/update/prepare', (req, res) => {
    const supplied = Buffer.from(req.get('Authorization') ?? '');
    res.set('Cache-Control', 'no-store');
    if (supplied.length !== token.length || !timingSafeEqual(supplied, token)) {
      res
        .status(401)
        .json({ error: 'A device service access token is required' });
      return;
    }
    if (req.get('X-Midscene-Service-Pid') !== String(process.pid)) {
      res.status(409).json({
        error: 'The device service process changed. Retry the update.',
      });
      return;
    }
    try {
      const result = sessions.prepareUpdate();
      res.status(result.busy.length ? 409 : 200).json(result);
    } catch (error) {
      if (!(error instanceof ControlError)) throw error;
      res.status(error.status).json({ error: error.message });
    }
  });
  app.post(
    '/connectivity-test',
    express.json({ limit: '64kb' }),
    (req, res) => {
      const config = req.body;
      if (
        !config ||
        typeof config !== 'object' ||
        Array.isArray(config) ||
        Object.values(config).some((value) => typeof value !== 'string')
      ) {
        res.status(400).json({ error: 'Invalid model configuration' });
        return;
      }
      void (async () => {
        const model = new ModelConfigManager(config);
        const result = await runConnectivityTest({
          defaultModelConfig: model.getModelConfig('default'),
          locateModelConfig: model.getModelConfig('locate'),
          planningModelConfig: model.getModelConfig('planning'),
          insightModelConfig: model.getModelConfig('insight'),
        });
        res.json(result);
      })().catch((error: Error) =>
        res.status(400).json({ error: error.message }),
      );
    },
  );
  workspaces.mount(app, (id) => sessions.busy(id), phoneCalibration);
  app.use(express.static(fileURLToPath(new URL('./ui/', import.meta.url))));
  const server = createServer((req, res) => {
    if (!deviceAPI.handle(req, res)) app(req, res);
  });
  server.on('upgrade', (req, stream, head) => {
    const phone = req.url?.startsWith('/phone-calibration/session?')
      ? phoneCalibration.authenticate(req)
      : undefined;
    if (phone) phone.upgrade(req, stream, head);
    else stream.destroy();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '0.0.0.0', () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    await sessions.close();
    await workspaces.close();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Device service has no TCP address');
  return {
    server,
    port: address.port,
    async close() {
      const closed = new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      server.closeAllConnections();
      try {
        await sessions.close();
        await workspaces.close();
      } finally {
        await phoneCalibration.close();
        await closed;
      }
    },
  };
}
