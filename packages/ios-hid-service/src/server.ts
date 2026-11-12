import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runConnectivityTest } from '@midscene/core';
import { ModelConfigManager } from '@midscene/shared/env';
import express, { type Request } from 'express';
import { ControlError, ControlSessions } from './control-sessions.js';
import type { DeviceConfig } from './hardware/types.js';
import { PhoneCalibration } from './phone-calibration.js';
import { ensureToken, label } from './settings.js';
import { DeviceWorkspaces } from './workspaces.js';

const sessionIdParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string' },
};
const sessionSecurity = [{ deviceToken: [] }];

const openAPI = {
  openapi: '3.0.3',
  info: { title: 'Midscene iOS HID Device Service', version: '0.1.0' },
  components: {
    securitySchemes: { deviceToken: { type: 'http', scheme: 'bearer' } },
    schemas: {
      Device: {
        type: 'object',
        required: ['id', 'name', 'screenSource', 'status'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          screenSource: { type: 'string', enum: ['usb', 'camera', 'airplay'] },
          status: { type: 'string', enum: ['available', 'busy', 'offline'] },
        },
      },
    },
  },
  paths: {
    '/api/v1/sessions': {
      post: {
        summary: 'Acquire exclusive control of a ready device',
        security: sessionSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['deviceId'],
                properties: { deviceId: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Device control lease' },
          '409': { description: 'Device offline or in use' },
          '503': { description: 'Device service stopping or updating' },
        },
      },
    },
    '/api/v1/sessions/{id}': {
      parameters: [sessionIdParameter],
      delete: {
        summary: 'Release device control',
        security: sessionSecurity,
        responses: { '200': { description: 'Released' } },
      },
    },
    '/api/v1/sessions/{id}/heartbeat': {
      parameters: [sessionIdParameter],
      post: {
        summary: 'Renew device control lease',
        security: sessionSecurity,
        responses: {
          '200': { description: 'Renewed' },
          '410': { description: 'Control session ended' },
        },
      },
    },
    '/api/v1/sessions/{id}/screenshot': {
      parameters: [sessionIdParameter],
      get: {
        summary: 'Capture a device screenshot',
        security: sessionSecurity,
        responses: {
          '200': { description: 'Base64 JPEG and frame metadata' },
          '410': { description: 'Control session ended' },
        },
      },
    },
    '/api/v1/sessions/{id}/preview': {
      parameters: [sessionIdParameter],
      get: {
        summary: 'Stream the latest preview frames for a device',
        security: sessionSecurity,
        responses: {
          '200': {
            description: 'MJPEG preview stream',
            content: { 'multipart/x-mixed-replace': {} },
          },
          '410': { description: 'Control session ended' },
        },
      },
    },
    '/api/v1/sessions/{id}/actions': {
      parameters: [sessionIdParameter],
      post: {
        summary: 'Execute one device action',
        security: sessionSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['type'],
                properties: {
                  type: {
                    type: 'string',
                    enum: [
                      'home',
                      'back',
                      'tap',
                      'swipe',
                      'clearInput',
                      'typeText',
                      'key',
                    ],
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Action completed' },
          '400': { description: 'Invalid action' },
          '410': { description: 'Control session ended' },
        },
      },
    },
    '/api/v1/devices': {
      get: {
        summary: 'List saved device profiles',
        description:
          'Get the access token on the Mac with hid-service token. A phone is available after it is connected in the device manager.',
        security: [{ deviceToken: [] }],
        responses: {
          '200': {
            description: 'Saved device profiles',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['devices'],
                  properties: {
                    devices: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Device' },
                    },
                  },
                },
              },
            },
          },
          '401': { description: 'Missing or invalid access token' },
          '503': { description: 'Device backend unavailable' },
        },
      },
    },
  },
};

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
  const sessions = new ControlSessions((id) => workspaces.readyDevice(id));
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => {
    res
      .set('Cache-Control', 'no-store')
      .json({ service: label, pid: process.pid, version });
  });
  app.get('/api/openapi.json', (_req, res) => {
    res.json(openAPI);
  });
  const require = createRequire(import.meta.url);
  const swaggerAssets = dirname(require.resolve('swagger-ui-dist'));
  app.get('/api/docs/swagger-initializer.js', (_req, res) => {
    res
      .type('js')
      .send(
        "window.onload = () => SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#swagger-ui', validatorUrl: null });",
      );
  });
  app.use('/api/docs', express.static(swaggerAssets));
  const api = express.Router();
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const supplied = Buffer.from(req.get('Authorization') ?? '');
    if (supplied.length !== token.length || !timingSafeEqual(supplied, token)) {
      res
        .status(401)
        .set('WWW-Authenticate', 'Bearer')
        .json({ error: 'A device service access token is required' });
      return;
    }
    next();
  });
  api.get('/devices', (_req, res) => {
    void savedDevices()
      .then((devices) =>
        res.json({
          devices: devices.map(({ id, name, screen }) => ({
            id,
            name,
            screenSource: screen.source,
            status: sessions.busy(id)
              ? 'busy'
              : workspaces.readyDevice(id)
                ? 'available'
                : 'offline',
          })),
        }),
      )
      .catch(() =>
        res.status(503).json({ error: 'The device backend is unavailable' }),
      );
  });
  api.use('/sessions', sessions.router());
  app.use('/api/v1', api);
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
  app.post('/ios-hid/update/prepare', (req, res) => {
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
  const server = createServer(app);
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
