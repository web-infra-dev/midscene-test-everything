import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ArmController,
  CameraSessionManager,
  listCameras,
} from '@midscene/arm-kit';
import type { RobotArmAdapter } from '@midscene/arm-kit';
import { controllerRuntime } from '@midscene/arm-kit/internal/controller-runtime';
import {
  discoverWifiInterfaces,
  phoneAddresses,
} from '@midscene/arm-kit/internal/network/phone-addresses';
import type { ProfileStore } from '@midscene/arm-kit/internal/runtime/profile-store';
import { RobotActionAuditStore } from '@midscene/arm-kit/internal/runtime/robot-action-audit-store';
import {
  robotAuditDirectory,
  robotDataRoot,
} from '@midscene/arm-kit/internal/storage/layout';
import { PlaygroundArmControls } from './arm-controls.js';
import { CameraCalibrationSession } from './camera-calibration-session.js';
import {
  type CameraPreviewView,
  clearStandaloneCorrection,
  saveStandaloneCorrection,
  streamCameraPreview,
  streamStandalonePreview,
} from './camera-preview.js';
import {
  BASE_SCREEN_ID,
  addCameraScreen,
  assertCameraScreen,
  listCameraScreens,
  removeCameraScreen,
} from './camera-screens.js';
import { CodeSetup } from './code-setup.js';
import { PlaygroundDevices } from './devices.js';
import { MarkerPreview } from './marker-preview.js';
import { PhonePairings } from './phone-pairings.js';
import { screenConnectPage } from './screen-connect-page.js';
import type {
  PlaygroundSession,
  SessionContext,
  SessionInput,
} from './session.js';
import { StatusPanel } from './status-panel.js';
import { PlaygroundTasks } from './tasks.js';

export interface PlaygroundOptions {
  /** Resolve the controller address on startup and on each reconnect. */
  discoverHost?(): Promise<string>;
  createAdapter(host?: string): RobotArmAdapter | Promise<RobotArmAdapter>;
  connection?: { adapter: string; options: Record<string, string | number> };
  connectionDiagram?: 'ethernet';
  installationId?: string;
  port?: number;
  webRoot?: string;
  /** Additional local frontend origins allowed during development. */
  developmentOrigins?: string[];
}

export async function startArmPlayground({
  createAdapter,
  discoverHost,
  connection,
  connectionDiagram,
  installationId,
  port,
  webRoot,
  developmentOrigins,
}: PlaygroundOptions) {
  if (typeof createAdapter !== 'function')
    throw new TypeError('createAdapter is required');
  return startPlaygroundHost({
    createSetup: (context) =>
      new CodeSetup(
        context,
        createAdapter,
        installationId,
        connection,
        connectionDiagram,
        discoverHost,
      ),
    autoConnect: Boolean(discoverHost),
    port,
    webRoot,
    developmentOrigins,
  });
}

interface HostSetup extends PlaygroundSession {
  initialize?(): Promise<void>;
  status(): unknown;
  reconnect(input: SessionInput): Promise<unknown>;
  configure?(input: SessionInput): Promise<unknown>;
}
type Send = (status: number, data: unknown) => void;
async function readBody(req: IncomingMessage, limit = 8192) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > limit) throw new Error('Request too large');
  }
  return JSON.parse(text || '{}');
}
function screenIdFrom(value: string | null | undefined) {
  return !value || value === BASE_SCREEN_ID ? undefined : value;
}
interface HostOptions {
  autoConnect?: boolean;
  createSetup(context: SessionContext): HostSetup;
  port?: number;
  webRoot?: string;
  models?: unknown[];
  developmentOrigins?: string[];
  handleRequest?(context: {
    url: URL;
    req: IncomingMessage;
    send: Send;
    body: typeof readBody;
    setup: HostSetup;
  }): Promise<boolean>;
}
export async function startPlaygroundHost({
  createSetup,
  autoConnect = false,
  port = 0,
  webRoot = fileURLToPath(new URL('../../dist/ui/', import.meta.url)),
  models = [],
  handleRequest,
  developmentOrigins = [],
}: HostOptions) {
  const markerPreviews = new Map<string, MarkerPreview>();
  const calibrationSessions = new Map<string, CameraCalibrationSession>();
  const calibrationSessionsByBind = new Map<string, CameraCalibrationSession>();
  /** Camera-only workspace leases, keyed by lease token -> camera id. */
  const cameraLeases = new Map<string, string>();
  const wifiInterfaces = await discoverWifiInterfaces();
  const phoneLinks = (token: string) =>
    phoneAddresses({ wifiInterfaces, controllerHost: host }).map(
      ({ address, name }) => ({
        name,
        url: `http://${address}:${(server.address() as AddressInfo).port}/phone-calibration?token=${token}`,
      }),
    );
  const phoneBindLinks = (token: string) =>
    phoneAddresses({ wifiInterfaces, controllerHost: host }).map(
      ({ address, name }) => ({
        name,
        url: `http://${address}:${(server.address() as AddressInfo).port}/phone-calibration?bind=${token}`,
      }),
    );
  const cameraManager = new CameraSessionManager();
  let adapterName: string | undefined;
  let devices: PlaygroundDevices | undefined;
  let tasks: PlaygroundTasks | undefined;
  let arm: ArmController | undefined;
  let armControls: PlaygroundArmControls | undefined;
  let host: string | undefined;
  let connecting = false;
  let connectionError: string | undefined;
  async function connectionStatus() {
    if (connecting || setup.phase === 'connecting')
      return { phase: 'connecting', host, setupSession: setup.session };
    if (!arm)
      return {
        phase: 'disconnected',
        host,
        error: connectionError,
        setupSession: setup.session,
      };
    try {
      const status = await arm.getStatus();
      const state = status.state;
      return {
        phase: state.connected ? 'connected' : 'disconnected',
        host,
        state,
        runtime: status,
        capabilities: arm.describeCapabilities(),
        adapter: {
          name: adapterName,
          connectionIdentity: arm.connectionIdentity,
        },
        setupSession: setup.session,
        recoveryRequired: status.recoveryRequired,
        softwarePaused: status.softwarePaused,
      };
    } catch (error) {
      return {
        phase: 'error',
        host,
        error: error instanceof Error ? error.message : String(error),
        setupSession: setup.session,
      };
    }
  }
  async function connectArm(
    adapter: RobotArmAdapter,
    profileStore: ProfileStore,
    storageId: string,
    address?: string,
  ) {
    connecting = true;
    armControls = undefined;
    connectionError = undefined;
    try {
      if (arm) await disconnectArm();
      host = address;
      adapterName = adapter.name;
      const auditStore = new RobotActionAuditStore({
        filePath: join(robotAuditDirectory(storageId), 'actions.jsonl'),
      });
      await auditStore.load();
      const candidate = new ArmController({
        auditStore,
        adapter,
        profileStore,
      });
      try {
        await candidate.connect();
        arm = candidate;
        const pairings = new PhonePairings(
          join(
            robotDataRoot(),
            'phone-pairings',
            `${createHash('sha256').update(storageId).digest('hex')}.json`,
          ),
        );
        await pairings.load();
        devices = new PlaygroundDevices(arm, {
          cameras: cameraManager,
          pairings,
          phoneLinks,
        });
        tasks = new PlaygroundTasks(devices);
        armControls = new PlaygroundArmControls(arm, tasks);
        await devices.startAll();
      } catch (error) {
        if (arm) await disconnectArm();
        else await candidate.close();
        throw error;
      }
    } catch (error) {
      connectionError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      connecting = false;
    }
  }
  async function disconnectArm() {
    const activeTasks = tasks;
    const activeDevices = devices;
    const controller = arm;
    armControls = undefined;
    tasks = undefined;
    devices = undefined;
    arm = undefined;
    try {
      await activeTasks?.close();
    } finally {
      try {
        await activeDevices?.close();
      } finally {
        await controller?.close();
      }
    }
  }
  const context = {
    getArm: () => arm,
    replace: connectArm,
    disconnect: disconnectArm,
    hasTasks: () =>
      Boolean(
        tasks
          ?.list()
          .some((task) => task.phase === 'running' || task.phase === 'closing'),
      ),
  };
  const setup = createSetup(context);
  await setup.initialize?.();
  const statusPanel = new StatusPanel({
    setup,
    getCalibrationSelection(cameraId) {
      if (!cameraId) return;
      const session = devices?.entries.get(cameraId)?.calibration;
      if (session?.phase === 'running' && !session.abort.signal.aborted) {
        const selection = session.host?.service.setup().selection;
        return selection && { ...selection, cameraId };
      }
    },
    getArm: () => arm,
    getControls: () => armControls,
  });

  const server = createServer(async (req, res) => {
    const url = URL.parse(req.url ?? '/', 'http://127.0.0.1');
    const send: Send = (status, data) => {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(data));
    };
    if (!url) return send(400, { error: 'Invalid URL' });
    if (url.pathname.startsWith('/phone-calibration')) {
      try {
        if (
          url.pathname === '/phone-calibration/connect' &&
          req.method === 'GET'
        ) {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
          });
          return res.end(screenConnectPage());
        }
        if (
          url.pathname === '/phone-calibration/register' &&
          req.method === 'POST'
        ) {
          if (
            req.headers.origin &&
            ![
              `http://${req.headers.host}`,
              `https://${req.headers.host}`,
            ].includes(req.headers.origin)
          )
            return send(403, { error: 'Origin not allowed' });
          if (!devices) return send(409, { error: 'Connect the arm first' });
          return send(
            200,
            await devices.markerCalibration.register(
              await readBody(req, 16384),
            ),
          );
        }
        if (
          url.pathname === '/phone-calibration' &&
          req.method === 'GET' &&
          url.searchParams.get('bind')
        ) {
          const session = calibrationSessionsByBind.get(
            url.searchParams.get('bind')!,
          );
          if (!session)
            return send(410, {
              error: 'Calibration session expired. Scan the new code.',
            });
          try {
            const preview = await session.bind(cameraManager);
            markerPreviews.set(preview.token, preview);
            res.writeHead(302, {
              Location: `/phone-calibration?token=${preview.token}`,
              'Cache-Control': 'no-store',
              'Referrer-Policy': 'no-referrer',
            });
            return res.end();
          } catch (error) {
            return send(
              error instanceof Error && 'status' in error
                ? Number(error.status)
                : 409,
              {
                error: error instanceof Error ? error.message : String(error),
              },
            );
          }
        }
        const page = await devices?.markerCalibration.phoneHost(
          url.searchParams.get('token'),
        );
        if (page) return page.handlePhone(req, res);
        const preview = markerPreviews.get(url.searchParams.get('token') ?? '');
        if (
          preview &&
          req.method === 'GET' &&
          url.pathname === '/phone-calibration'
        ) {
          if (req.headers.accept === 'application/json')
            return send(200, preview.renewPage());
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
          });
          return res.end(preview.page());
        }
        const calibration = await devices?.resolvePhoneHost(
          url.searchParams.get('token'),
        );
        if (!calibration)
          return send(503, {
            error: 'Phone session is not ready. Reconnecting…',
          });
        return calibration.handlePhone(req, res);
      } catch (error) {
        return send(
          error instanceof Error && 'status' in error
            ? Number(error.status)
            : 503,
          {
            error:
              error instanceof Error
                ? error.message
                : 'Phone session is not ready. Reconnecting…',
          },
        );
      }
    }
    if (
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
        req.socket.remoteAddress ?? '',
      )
    )
      return send(403, { error: 'Open Playground on the host computer' });
    // Local browser operations must originate from this app, never a remote site.
    const origin = req.headers.origin;
    if (
      origin &&
      ![
        `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        `http://localhost:${(server.address() as AddressInfo).port}`,
        ...developmentOrigins,
      ].includes(origin)
    )
      return send(403, { error: 'Origin not allowed' });
    try {
      if (url.pathname === '/api/arm' && req.method === 'GET')
        return send(200, await connectionStatus());
      if (url.pathname === '/api/arm/stop' && req.method === 'POST') {
        if (!armControls || connecting)
          return send(409, { error: 'Connect the arm first' });
        await armControls.stop();
        return send(200, await connectionStatus());
      }
      if (url.pathname === '/api/arm/recover' && req.method === 'POST') {
        if (!armControls || connecting)
          return send(409, { error: 'Connect the arm first' });
        if ((await readBody(req)).confirmed !== true)
          return send(400, { error: 'Confirm recovery first' });
        await armControls.recover();
        return send(200, await connectionStatus());
      }
      if (url.pathname === '/api/arm/status-panel' && req.method === 'GET')
        return send(
          200,
          await statusPanel.read(
            url.searchParams.get('cameraId'),
            url.searchParams.get('details') === 'true',
          ),
        );
      if (url.pathname === '/api/arm/control' && req.method === 'POST') {
        await statusPanel.command(await readBody(req));
        return send(200, { ok: true });
      }
      if (url.pathname === '/api/setup' && req.method === 'GET') {
        return send(200, {
          setup: setup.status(),
          setupAdapters: models,
        });
      }
      if (
        handleRequest &&
        (await handleRequest({ url, req, send, body: readBody, setup }))
      )
        return;
      if (
        setup.configure &&
        url.pathname === '/api/setup/connection' &&
        req.method === 'POST'
      )
        return send(200, await setup.configure(await readBody(req)));
      if (url.pathname === '/api/setup/reconnect' && req.method === 'POST')
        return send(200, await setup.reconnect(await readBody(req)));
      if (url.pathname === '/api/setup/motion-settings')
        return send(
          200,
          await setup.motion(
            req.method === 'POST' ? await readBody(req) : undefined,
          ),
        );
      if (url.pathname === '/api/setup/disable' && req.method === 'POST')
        return send(200, await setup.disable(await readBody(req)));
      if (url.pathname === '/api/arm/connect' && req.method === 'POST') {
        if (!setup.configure)
          return send(200, await setup.reconnect(await readBody(req)));
        return send(409, {
          error: 'Use the connection form to configure the robot',
        });
      }
      if (url.pathname === '/api/arm/disconnect' && req.method === 'POST') {
        if (setup.busy)
          return send(409, {
            error: 'Wait for the current robot control to finish',
          });
        await setup.mutate({ session: setup.session }, async () => {
          await disconnectArm();
          setup.phase = 'unconfigured';
        });
        return send(200, await connectionStatus());
      }
      if (
        setup.busy &&
        req.method !== 'GET' &&
        (url.pathname.startsWith('/api/tasks') ||
          url.pathname.startsWith('/api/devices'))
      )
        return send(409, { error: 'Wait for configuration changes to finish' });
      if (url.pathname === '/api/tasks') {
        if (!tasks) return send(409, { error: 'Connect the arm first' });
        if (req.method === 'GET') return send(200, { tasks: tasks.list() });
        if (req.method === 'POST') {
          const input = await readBody(req);
          if (
            typeof input.cameraId !== 'string' ||
            (input.name !== undefined && typeof input.name !== 'string')
          )
            return send(400, { error: 'Select a camera' });
          return send(200, await tasks.create(input.cameraId, input.name));
        }
      }
      const taskRoute = /^\/api\/tasks\/([^/]+)(\/.*)?$/.exec(url.pathname);
      if (taskRoute) {
        const id = taskRoute[1];
        const entry = tasks?.entries.get(id);
        if (!entry || entry.closed)
          return send(404, { error: 'Task not found' });
        if (!taskRoute[2] && req.method === 'DELETE') {
          await tasks!.remove(id);
          return send(200, {});
        }
        if (taskRoute[2] === '/config' && req.method === 'POST') {
          await tasks!.configure(id, (await readBody(req)).aiConfig);
          return send(200, { status: 'ok' });
        }
        req.url = `${taskRoute[2] || '/'}${url.search}`;
        return entry.server.app(req, res);
      }
      if (url.pathname === '/api/audit/actions' && req.method === 'GET') {
        const store = arm && controllerRuntime(arm).auditStore;
        return send(200, {
          status: store?.status(),
          records: store?.recent(100) ?? [],
        });
      }
      const configurationRoute =
        /^\/api\/devices\/([^/]+)\/(configuration|motion-settings|safe-position)$/.exec(
          url.pathname,
        );
      if (configurationRoute) {
        if (!devices) return send(409, { error: 'Connect the arm first' });
        const id = decodeURIComponent(configurationRoute[1]);
        if (req.method === 'GET' && configurationRoute[2] === 'configuration')
          return send(200, await devices.configuration(id));
        if (req.method !== 'POST' || configurationRoute[2] === 'configuration')
          return send(405, { error: 'Method not allowed' });
        if (
          tasks
            ?.list()
            .some(
              (task) => task.phase === 'running' || task.phase === 'closing',
            )
        )
          return send(409, {
            error: 'Stop tasks before changing device configuration',
          });
        const input = await readBody(req, 16384);
        const abort = new AbortController();
        const cancel = () => {
          if (!res.writableEnded)
            abort.abort(new Error('Configuration request disconnected'));
        };
        res.once('close', cancel);
        try {
          return send(
            200,
            await devices.updateConfiguration(
              id,
              configurationRoute[2],
              input,
              abort.signal,
            ),
          );
        } finally {
          res.off('close', cancel);
        }
      }
      const transferRoute = /^\/api\/devices\/([^/]+)\/transfer$/.exec(
        url.pathname,
      );
      if (transferRoute) {
        if (!devices) return send(409, { error: 'Connect the arm first' });
        const id = decodeURIComponent(transferRoute[1]);
        if (req.method === 'GET')
          return send(200, await devices.transferConfiguration(id));
        if (req.method === 'POST') {
          const input = await readBody(req, 65536);
          if (
            typeof input.targetId !== 'string' ||
            input.targetId === id ||
            input.confirmed !== true ||
            !Array.isArray(input.waypoints) ||
            input.waypoints.length > 64
          )
            return send(400, {
              error:
                'Select a different target and confirm the measured transfer corridor',
            });
          const abort = new AbortController();
          const disconnected = () => {
            if (!res.writableEnded)
              abort.abort(new Error('Transfer validation cancelled'));
          };
          res.once('close', disconnected);
          try {
            return send(
              200,
              await devices.configureTransfer(
                id,
                input.targetId,
                input,
                abort.signal,
              ),
            );
          } finally {
            res.off('close', disconnected);
          }
        }
        return send(405, { error: 'Method not allowed' });
      }
      if (
        url.pathname === '/api/marker-calibrations' ||
        url.pathname === '/api/screen-pages'
      ) {
        if (!devices) return send(409, { error: 'Connect the arm first' });
        if (req.method !== 'POST')
          return send(405, { error: 'Method not allowed' });
        const input = await readBody(req, 16384);
        if (!['list', 'displays', 'status'].includes(input.action))
          devices.assertBatchIdle();
        return send(
          200,
          await (url.pathname === '/api/screen-pages'
            ? devices.markerCalibration.pageAction(input)
            : devices.markerCalibration.markerAction(input)),
        );
      }
      if (url.pathname === '/api/calibration-batch') {
        if (!devices) return send(409, { error: 'Connect the arm first' });
        if (req.method === 'GET')
          return send(200, { batch: devices.batch.read() });
        if (req.method !== 'POST')
          return send(405, { error: 'Method not allowed' });
        const input = await readBody(req, 16384);
        const batch = devices.batch;
        if (input.action === 'read') return send(200, batch.read());
        if (input.action === 'plan')
          return send(200, await batch.plan(input.cameraId));
        if (input.action === 'screens')
          return send(200, await batch.screens(input.cameraId));
        if (input.action === 'start')
          return send(200, await batch.start(input));
        if (input.action === 'clear') {
          await batch.clear();
          return send(200, {});
        }
        if (input.action === 'delete-calibration') {
          await arm!.configureForDevice('calibration-delete', async () => {
            await controllerRuntime(arm!).profileStore.retireCalibration(
              input.calibrationProfileId,
            );
          });
          return send(200, {});
        }
        if (input.action === 'prepare-mapping') {
          const row = batch
            .read()
            ?.items.find(
              (row) => row.screenProfileId === input.binding?.screenProfileId,
            );
          if (!row)
            return send(409, { error: 'Select the batch screen first.' });
          await (await devices.ensureHost(row.deviceId)).alignForBatch(
            AbortSignal.timeout(90000),
          );
          return send(200, {});
        }
        return send(
          200,
          await batch.command(
            input.revision,
            input.action === 'command' ? input.command : input.action,
            input.id,
          ),
        );
      }
      if (url.pathname === '/api/screens') {
        if (!devices) return send(409, { error: 'Connect the arm first' });
        if (req.method === 'GET')
          return send(200, { screens: devices.screens() });
        if (req.method === 'POST') {
          const input = await readBody(req, 16384);
          if (
            typeof input.cameraId !== 'string' ||
            typeof input.name !== 'string' ||
            !input.name.trim() ||
            input.name.length > 100
          )
            return send(400, { error: 'Select a camera and screen name' });
          return send(200, await devices.addScreen(input.cameraId, input.name));
        }
        return send(405, { error: 'Method not allowed' });
      }
      const calibrationRoute =
        /^\/api\/devices\/([^/]+)\/calibration(?:\/(.*))?$/.exec(url.pathname);
      if (calibrationRoute) {
        if (!devices) return send(409, { error: 'Connect the arm first' });
        const id = decodeURIComponent(calibrationRoute[1]);
        const action = calibrationRoute[2];
        if (action === 'open' && req.method === 'POST') {
          await devices.ensureHost(id);
          return send(200, { phase: 'prepared' });
        }
        if (req.method === 'POST') devices.assertBatchIdle();
        if (action === 'start' && req.method === 'POST') {
          const status = await devices.startCalibration(id);
          // A camera-only page can join the calibrated Device without a second scan.
          const preview = [...markerPreviews.values()].find(
            (p) => p.cameraId === id && !p.screenId,
          );
          if (preview) {
            const session = devices.entries.get(id)?.calibration;
            await session?.ready;
            if (
              session?.phase === 'running' &&
              session.host?.service.phoneStatus().state === 'waiting'
            )
              preview.handoffToken = session.token;
          }
          return send(200, status);
        }
        if (action === 'status' && req.method === 'GET')
          return send(200, devices.status(id));
        if (action === 'cancel' && req.method === 'POST') {
          await devices.cancelCalibration(id);
          return send(200, devices.status(id));
        }
        const session = devices.entries.get(id)?.calibration;
        if (req.method === 'POST' && action?.startsWith('assisted-calibration'))
          devices.assertCalibrationRunning(id);
        const host =
          action === 'camera/validity' && req.method === 'GET'
            ? await devices.ensureHost(id)
            : (devices.entries.get(id)?.host ?? session?.host);
        if (!host)
          return send(409, {
            error: 'Calibration is not ready',
            phase: session?.phase,
          });
        if (await host.handle(req, res)) return;
      }
      if (url.pathname === '/api/cameras/markers') {
        const id = url.searchParams.get('id');
        const token = url.searchParams.get('token');
        // Reclaim abandoned browser sessions on the next request.
        for (const [key, item] of markerPreviews) {
          if (Date.now() - item.lastViewed > 5 * 60_000) {
            item.close();
            markerPreviews.delete(key);
          }
        }
        if (!token && id && req.method === 'POST') {
          const screenId = screenIdFrom(url.searchParams.get('screen'));
          if (
            !(await listCameras({ includeBuiltIn: !devices })).some(
              (camera) => camera.id === id,
            )
          )
            return send(404, { error: 'Camera not found' });
          await assertCameraScreen(cameraManager, id, screenId);
          const paired = [...markerPreviews.values()].find(
            (page) => page.cameraId === id && page.screenId === screenId,
          );
          if (paired) {
            paired.showMarkers();
            return send(200, {
              token: paired.token,
              links: phoneLinks(paired.token),
              screen: screenId ?? BASE_SCREEN_ID,
            });
          }
          const slot = Array.from({ length: 8 }, (_, i) => i + 1).find(
            (slot) =>
              ![...markerPreviews.values()].some((p) => p.slot === slot),
          );
          if (!slot)
            return send(409, { error: 'Close another marker preview first' });
          const preview = new MarkerPreview(id, slot, screenId);
          markerPreviews.set(preview.token, preview);
          return send(200, {
            token: preview.token,
            links: phoneLinks(preview.token),
            screen: screenId ?? BASE_SCREEN_ID,
          });
        }
        const preview = markerPreviews.get(token ?? '');
        if (!preview)
          return send(404, {
            error: 'Marker preview expired. Reopen it from the camera.',
          });
        preview.lastViewed = Date.now();
        if (req.method === 'GET') return send(200, preview.status());
        if (req.method === 'POST' && url.searchParams.has('showMarkers')) {
          preview.showMarkers();
          return send(200, preview.status());
        }
        if (req.method === 'POST') {
          const abort = new AbortController();
          const cancel = () => abort.abort();
          res.once('close', cancel);
          try {
            return send(
              200,
              await preview.capture(
                cameraManager,
                url.searchParams.get('pageKey'),
                abort.signal,
              ),
            );
          } finally {
            res.off('close', cancel);
          }
        }
        return send(405, { error: 'Method not allowed' });
      }
      if (url.pathname.startsWith('/api/cameras/calibration-sessions')) {
        if (devices)
          return send(409, {
            error: 'Calibrate screens through the connected device',
          });
        for (const [key, item] of calibrationSessions) {
          if (Date.now() - item.lastViewed > 5 * 60_000) {
            await item.close(cameraManager);
            for (const preview of item.previews)
              markerPreviews.delete(preview.token);
            calibrationSessions.delete(key);
            calibrationSessionsByBind.delete(item.bindToken);
          }
        }
        const action = url.pathname.slice(
          '/api/cameras/calibration-sessions'.length,
        );
        if (action === '' && req.method === 'POST') {
          const input = await readBody(req);
          if (typeof input.id !== 'string')
            return send(400, { error: 'Camera id is required' });
          if (
            !(await listCameras({ includeBuiltIn: true })).some(
              (camera) => camera.id === input.id,
            )
          )
            return send(404, { error: 'Camera not found' });
          const screens = await listCameraScreens(cameraManager, input.id);
          const session = new CameraCalibrationSession(input.id, screens);
          calibrationSessions.set(session.token, session);
          calibrationSessionsByBind.set(session.bindToken, session);
          return send(200, {
            token: session.token,
            bindToken: session.bindToken,
            links: phoneBindLinks(session.bindToken),
            targets: session.status(),
          });
        }
        const token = url.searchParams.get('token');
        const session = token ? calibrationSessions.get(token) : undefined;
        if (!session)
          return send(404, { error: 'Calibration session expired' });
        session.lastViewed = Date.now();
        if (action === '' && req.method === 'GET')
          return send(200, {
            token: session.token,
            bindToken: session.bindToken,
            links: phoneBindLinks(session.bindToken),
            targets: session.status(),
          });
        if (action === '' && req.method === 'DELETE') {
          await session.close(cameraManager);
          for (const preview of session.previews)
            markerPreviews.delete(preview.token);
          calibrationSessions.delete(session.token);
          calibrationSessionsByBind.delete(session.bindToken);
          return send(200, { ok: true });
        }
        if (action === '/detect' && req.method === 'POST') {
          const abort = new AbortController();
          const cancel = () => abort.abort();
          res.once('close', cancel);
          try {
            return send(200, {
              screens: await session.detect(cameraManager, abort.signal),
            });
          } finally {
            res.off('close', cancel);
          }
        }
        if (action === '/apply' && req.method === 'POST') {
          return send(200, await session.apply(cameraManager));
        }
        return send(405, { error: 'Method not allowed' });
      }
      if (url.pathname === '/api/cameras/screens') {
        const id = url.searchParams.get('id');
        if (req.method === 'GET') {
          if (!id) return send(400, { error: 'Camera id is required' });
          return send(200, {
            screens: await listCameraScreens(cameraManager, id),
          });
        }
        if (devices)
          return send(409, {
            error: 'Configure screens through the connected device',
          });
        if (req.method === 'POST') {
          const input = await readBody(req);
          if (typeof input.id !== 'string')
            return send(400, { error: 'Camera id is required' });
          if (
            !(await listCameras({ includeBuiltIn: true })).some(
              (camera) => camera.id === input.id,
            )
          )
            return send(404, { error: 'Camera not found' });
          return send(200, {
            screen: await addCameraScreen(cameraManager, input.id, input.name),
          });
        }
        if (req.method === 'DELETE') {
          if (!id) return send(400, { error: 'Camera id is required' });
          const screenId = url.searchParams.get('screen');
          if (!screenId) return send(400, { error: 'Screen id is required' });
          await removeCameraScreen(cameraManager, id, screenId);
          for (const [token, preview] of markerPreviews) {
            if (preview.cameraId === id && preview.screenId === screenId) {
              preview.close();
              markerPreviews.delete(token);
            }
          }
          return send(200, { ok: true });
        }
        return send(405, { error: 'Method not allowed' });
      }
      if (url.pathname === '/api/cameras' && req.method === 'GET') {
        const cameras = await listCameras({
          refresh: url.searchParams.get('refresh') === 'true',
          includeBuiltIn: !devices,
        });
        const entries = await Promise.all(
          cameras.map(async (camera) => {
            const entry = devices?.entries.get(camera.id);
            // Camera-only mode has no Device, so read the same persisted
            // correction the Device will restore once the arm is connected.
            const stored = entry
              ? undefined
              : await cameraManager.persistedPerspective(camera.id);
            return {
              ...camera,
              hasCorrection: Boolean(
                entry?.camera.getCorrection() ?? stored?.correction,
              ),
              perspectiveTarget: entry
                ? entry.camera.getPerspectiveTarget()
                : stored?.target,
              error: devices?.cameraErrors.get(camera.id),
              stream: entry?.camera.stream.getInfo(),
            };
          }),
        );
        return send(200, {
          error: devices?.discoveryError,
          cameras: entries,
        });
      }
      if (url.pathname === '/api/cameras/start' && req.method === 'POST') {
        const input = await readBody(req);
        const cameras = await listCameras();
        const camera = cameras.find((entry) => entry.id === input.id);
        if (!camera) return send(404, { error: 'Camera not found' });
        if (!devices) return send(409, { error: 'Connect the arm first' });
        const { camera: session } = await devices.open(camera.id, true);
        const stream = session.stream;
        return send(200, { stream: stream.getInfo() });
      }
      if (url.pathname === '/api/cameras/lease') {
        if (req.method === 'POST') {
          if (devices)
            return send(409, {
              error: 'The connected arm owns the camera lease',
            });
          const input = await readBody(req);
          if (typeof input.id !== 'string')
            return send(400, { error: 'Camera id is required' });
          const lease = randomUUID();
          await cameraManager.acquire(input.id, `lease:${lease}`);
          cameraLeases.set(lease, input.id);
          return send(200, { lease });
        }
        if (req.method === 'DELETE') {
          const lease = url.searchParams.get('lease');
          const id = lease ? cameraLeases.get(lease) : undefined;
          if (lease && id) {
            cameraLeases.delete(lease);
            await cameraManager.release(id, `lease:${lease}`);
          }
          return send(200, { ok: true });
        }
        return send(405, { error: 'Method not allowed' });
      }
      if (
        url.pathname === '/api/cameras/correction' &&
        req.method === 'DELETE'
      ) {
        if (devices)
          return send(409, {
            error: 'Clear the correction through the connected device',
          });
        const id = url.searchParams.get('id');
        if (!id) return send(400, { error: 'Camera id is required' });
        if (url.searchParams.get('all') === 'true') {
          for (const [key, session] of calibrationSessions) {
            if (session.cameraId !== id) continue;
            await session.close(cameraManager);
            for (const preview of session.previews)
              markerPreviews.delete(preview.token);
            calibrationSessions.delete(key);
            calibrationSessionsByBind.delete(session.bindToken);
          }
          for (const [token, preview] of markerPreviews) {
            if (preview.cameraId !== id) continue;
            preview.close();
            markerPreviews.delete(token);
          }
          const screens = await listCameraScreens(cameraManager, id);
          for (const screen of screens) {
            if (!screen.base)
              await removeCameraScreen(cameraManager, id, screen.id);
          }
          await clearStandaloneCorrection(cameraManager, id);
          return send(200, {
            ok: true,
            screens: await listCameraScreens(cameraManager, id),
          });
        }
        const screenId = screenIdFrom(url.searchParams.get('screen'));
        if (screenId) await assertCameraScreen(cameraManager, id, screenId);
        await clearStandaloneCorrection(cameraManager, id, screenId);
        return send(200, { ok: true });
      }
      if (url.pathname === '/api/cameras/correction' && req.method === 'POST') {
        if (devices)
          return send(409, {
            error: 'Save the correction through the connected device',
          });
        const input = await readBody(req, 65536);
        if (typeof input.id !== 'string' || !input.correction)
          return send(400, { error: 'Camera id and correction are required' });
        const screenId = screenIdFrom(input.screen);
        if (screenId)
          await assertCameraScreen(cameraManager, input.id, screenId);
        await saveStandaloneCorrection(
          cameraManager,
          input.id,
          input.correction,
          input.perspectiveTarget,
          screenId,
        );
        return send(200, { ok: true });
      }
      if (url.pathname === '/api/cameras/stop' && req.method === 'POST') {
        const input = await readBody(req);
        await tasks?.closeCamera(input.id);
        await devices?.stop(input.id);
        return send(200, {});
      }
      if (url.pathname === '/api/cameras/preview' && req.method === 'GET') {
        const id = url.searchParams.get('id') ?? '';
        const view = (url.searchParams.get('view') ??
          'raw') as CameraPreviewView;
        if (view !== 'raw' && view !== 'corrected')
          return send(400, { error: 'Unknown camera view' });
        if (!devices && id) {
          if (req.headers['sec-fetch-site'] === 'cross-site')
            return send(403, { error: 'Open camera previews in Playground' });
          const screenId = screenIdFrom(url.searchParams.get('screen'));
          if (screenId) await assertCameraScreen(cameraManager, id, screenId);
          await streamStandalonePreview(res, cameraManager, id, view, screenId);
          return;
        }
        const entry = devices?.entries.get(id);
        if (!entry) return send(404, { error: 'Camera is not running' });
        await streamCameraPreview(res, entry, view === 'corrected');
        return;
      }
      if (url.pathname === '/api/cameras/frame' && req.method === 'GET') {
        const stream = devices?.entries.get(url.searchParams.get('id') ?? '')
          ?.camera.stream;
        if (!stream) return send(404, { error: 'Camera is not running' });
        const frame = await stream.getFrame();
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'no-store',
        });
        return res.end(frame.jpeg);
      }
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
        const root = resolve(webRoot);
        const file = resolve(
          root,
          `.${decodeURIComponent(
            url.pathname === '/' ? '/index.html' : url.pathname,
          )}`,
        );
        if (!file.startsWith(root + sep))
          return send(404, { error: 'Not found' });
        const types: Record<string, string> = {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.woff2': 'font/woff2',
          '.wasm': 'application/wasm',
          '.json': 'application/json',
        };
        try {
          const data = await readFile(file);
          res.writeHead(200, {
            'Content-Type': types[extname(file)] ?? 'application/octet-stream',
          });
          return res.end(data);
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              'code' in error &&
              ['ENOENT', 'EISDIR'].includes(String(error.code))
            )
          )
            throw error;
        }
      }
      return send(404, { error: 'Not found' });
    } catch (error) {
      if (!res.headersSent && !res.destroyed)
        send(
          error instanceof Error &&
            'status' in error &&
            typeof error.status === 'number'
            ? error.status
            : 500,
          {
            error: error instanceof Error ? error.message : String(error),
            code:
              error instanceof Error && 'code' in error
                ? error.code
                : undefined,
          },
        );
      else res.destroy();
    }
  });
  server.on('upgrade', async (req, socket, head) => {
    try {
      const url = URL.parse(req.url ?? '/', 'http://localhost');
      if (!url) return socket.destroy();
      const token = url.searchParams.get('token');
      const calibration =
        markerPreviews.get(token ?? '') ??
        (await devices?.markerCalibration.phoneHost(token)) ??
        (await devices?.resolvePhoneHost(token));
      if (!calibration) return socket.destroy();
      calibration.phoneSocket.upgrade(req, socket, head);
    } catch {
      socket.destroy();
    }
  });
  await new Promise<void>((accept, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      server.off('error', reject);
      accept();
    });
  });
  if (autoConnect)
    void setup.reconnect({ session: setup.session }).catch(() => {
      // The connection page exposes the error and lets the operator retry.
    });
  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close() {
      closing ??= (async () => {
        const drained = new Promise((resolve) => server.close(resolve));
        server.closeAllConnections();
        await setup.pending?.catch(() => {});
        await disconnectArm();
        for (const session of calibrationSessions.values())
          await session.close(cameraManager);
        calibrationSessions.clear();
        calibrationSessionsByBind.clear();
        for (const preview of markerPreviews.values()) preview.close();
        markerPreviews.clear();
        cameraLeases.clear();
        await cameraManager.close();
        await drained;
      })();
      return closing;
    },
  };
}
