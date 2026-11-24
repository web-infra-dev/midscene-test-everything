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
  RobotArmError,
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
import { SCREEN_DRIFT_DETECTION_ENABLED } from '@midscene/robotics-shared/contracts';
import type { InputAction } from '@midscene/universal-device/protocol';
import { createDeviceHandler } from '@midscene/universal-device/server';
import { PlaygroundArmControls } from './arm-controls.js';
import {
  type CameraPreviewView,
  clearStandaloneCorrection,
  rectifyPreviewFrame,
  registerClientPreview,
  saveStandaloneCorrection,
  streamCameraPreview,
  streamStandalonePreview,
} from './camera-preview.js';
import { CodeSetup } from './code-setup.js';
import { PlaygroundDevices } from './devices.js';
import { MarkerPreview } from './marker-preview.js';
import { PhonePairings } from './phone-pairings.js';
import {
  PreviewPerspectives,
  phoneFingerprint,
} from './preview-perspectives.js';
import { screenConnectPage } from './screen-connect-page.js';
import { ScreenControl } from './screen-control.js';
import type {
  PlaygroundSession,
  SessionContext,
  SessionInput,
} from './session.js';
import { StatusPanel } from './status-panel.js';
import type { TwinSceneSnapshot } from './twin-types.js';
import { TwinStream, buildTwinScene } from './twin.js';

export interface PlaygroundOptions {
  /** Resolve the controller address on startup and on each reconnect. */
  discoverHost?(): Promise<string>;
  createAdapter(host?: string): RobotArmAdapter | Promise<RobotArmAdapter>;
  connection?: { adapter: string; options: Record<string, string | number> };
  connectionDiagram?: 'ethernet';
  installationId?: string;
  /**
   * Start the configured connection without waiting for the browser. Defaults
   * to discovery; a simulator sets it because it has no controller to probe.
   */
  autoConnect?: boolean;
  deviceAccessToken?: string;
  port?: number;
  webRoot?: string;
}

export async function startArmPlayground({
  createAdapter,
  discoverHost,
  connection,
  connectionDiagram,
  installationId,
  autoConnect,
  port,
  webRoot,

  deviceAccessToken,
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
    autoConnect: autoConnect ?? Boolean(discoverHost),
    port,
    webRoot,

    deviceAccessToken,
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
interface HostOptions {
  autoConnect?: boolean;
  createSetup(context: SessionContext): HostSetup;
  deviceAccessToken?: string;
  port?: number;
  webRoot?: string;
  models?: unknown[];

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
  deviceAccessToken,
  port = 0,
  webRoot = fileURLToPath(new URL('../../dist/ui/', import.meta.url)),
  models = [],
  handleRequest,
}: HostOptions) {
  const markerPreviews = new Map<string, MarkerPreview>();
  const wifiInterfaces = await discoverWifiInterfaces();
  const phoneAddressCacheMs = 5_000;
  let phoneAddressCache:
    | {
        controllerHost: string | undefined;
        expiresAt: number;
        addresses: ReturnType<typeof phoneAddresses>;
      }
    | undefined;
  const phoneLinks = (token: string) => {
    const now = performance.now();
    if (
      !phoneAddressCache ||
      phoneAddressCache.controllerHost !== host ||
      now >= phoneAddressCache.expiresAt
    ) {
      phoneAddressCache = {
        controllerHost: host,
        expiresAt: now + phoneAddressCacheMs,
        addresses: phoneAddresses({ wifiInterfaces, controllerHost: host }),
      };
    }
    return phoneAddressCache.addresses.map(({ address, name }) => ({
      name,
      url: `http://${address}:${(server.address() as AddressInfo).port}/phone-calibration?token=${token}`,
    }));
  };
  const cameraManager = new CameraSessionManager();
  const pendingPerspectives = new PreviewPerspectives(cameraManager);
  const previewScreens = new Map<string, string>();
  let adapterName: string | undefined;
  let devices: PlaygroundDevices | undefined;
  let screenControl: ScreenControl | undefined;
  let arm: ArmController | undefined;
  let armControls: PlaygroundArmControls | undefined;
  const twinStream = new TwinStream(() => arm);
  let host: string | undefined;
  let connecting = false;
  let connectionError: string | undefined;
  const armResource = 'arm-controller';
  let armLifetime = new AbortController();
  let managerWrites = 0;
  const universalDeviceActions = () =>
    (arm?.describeCapabilities().screenActions ?? []).filter(
      (action): action is 'tap' | 'swipe' | 'longPress' | 'dragAndDrop' =>
        action === 'tap' ||
        action === 'swipe' ||
        action === 'longPress' ||
        action === 'dragAndDrop',
    );
  const ready = () =>
    Boolean(
      arm &&
        devices &&
        screenControl &&
        !connecting &&
        !setup.busy &&
        !managerWrites &&
        !screenControl.busy &&
        !devices.batch.active &&
        !devices.hasActiveScreenCalibration,
    );
  const deviceAPI = deviceAccessToken
    ? createDeviceHandler({
        token: deviceAccessToken,
        listDevices() {
          const screens = screenControl?.screens();
          return (devices?.screens() ?? [])
            .filter((screen) => screens?.get(screen.id)?.calibrationAccepted)
            .map((screen) => ({
              id: screen.id,
              name: screen.name,
              status:
                ready() && screens?.get(screen.id)?.ready
                  ? 'available'
                  : 'offline',
              actions: universalDeviceActions(),
              preview: 'mjpeg',
              resourceId: armResource,
            }));
        },
        readyDevice(id) {
          const entry = devices?.entries.get(id);
          const control = screenControl;
          if (
            !entry ||
            !control ||
            !ready() ||
            !control.screens().get(id)?.ready
          )
            return;
          const signal = armLifetime.signal;
          let sequence = 0;
          return {
            resourceId: armResource,
            signal,
            actions: universalDeviceActions(),
            async screenshot() {
              signal.throwIfAborted();
              const { width, height } = await entry.device.size();
              const image = await entry.device.screenshotBase64();
              return {
                jpeg: Buffer.from(
                  image.replace(/^data:image\/jpeg;base64,/, ''),
                  'base64',
                ),
                width,
                height,
                receivedAt: Date.now(),
                sequence: ++sequence,
              };
            },
            async execute(action: InputAction, cancellation) {
              cancellation.throwIfAborted();
              if (
                action.type !== 'tap' &&
                action.type !== 'swipe' &&
                action.type !== 'longPress' &&
                action.type !== 'dragAndDrop'
              )
                throw new Error('Unsupported mechanical arm action');
              await control.perform(id, action, cancellation);
            },
            openPreview(previewSignal) {
              let previous: number | undefined;
              return {
                async getFrame() {
                  previewSignal.throwIfAborted();
                  const frame = await entry.camera.stream.getFrame();
                  if (frame.id === previous) return;
                  previous = frame.id;
                  return {
                    sequence: frame.id,
                    jpeg: await rectifyPreviewFrame(entry.camera, frame),
                  };
                },
                async close() {},
              };
            },
          };
        },
      })
    : undefined;

  async function connectionStatus(fresh = false) {
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
      const status = fresh
        ? await controllerRuntime(arm).state(undefined, { fresh: true })
        : await arm.getStatus();
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
        ...(screenControl
          ? {
              control: {
                ...screenControl.controlState(),
                remoteBusy: deviceAPI?.sessions.busy(armResource) ?? false,
              },
            }
          : {}),
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
        screenControl = new ScreenControl(devices);
        armControls = new PlaygroundArmControls(arm);
        await devices.startAll(listCameras, [
          ...cameraManager.activeCameraIds(),
          ...[...markerPreviews.values()]
            .filter((p) => p.activePairing)
            .map((p) => p.cameraId),
        ]);
        for (const id of new Set(
          [...devices.entries.values()].map((entry) => entry.cameraId),
        ))
          await restoreMarkerPerspective(devices, id);
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
  async function restoreMarkerPerspective(
    registry: PlaygroundDevices,
    cameraId: string,
  ) {
    const pending = await pendingPerspectives.get(cameraId);
    if (!pending) return;
    const screen = registry.markerCalibration.previewTarget(
      cameraId,
      pending.phones,
    );
    const entry = screen && registry.entries.get(screen);
    if (!entry || devices !== registry) return;
    const geometry = await cameraManager.persistedPerspective(
      cameraId,
      pending.scope,
    );
    if (!geometry?.target) return;
    await entry.camera.setPerspective(geometry.correction, geometry.target);
    previewScreens.set(cameraId, screen);
    await pendingPerspectives.clear(cameraId, pending);
  }
  async function disconnectArm() {
    armLifetime.abort();
    armLifetime = new AbortController();
    for (const preview of markerPreviews.values()) preview.cancelHandoff();
    previewScreens.clear();
    const activeDevices = devices;
    const controller = arm;
    armControls = undefined;
    screenControl = undefined;
    devices = undefined;
    arm = undefined;
    try {
      await activeDevices?.close();
    } finally {
      await controller?.close();
    }
  }
  const context = {
    getArm: () => arm,
    replace: connectArm,
    disconnect: disconnectArm,
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
    if (deviceAPI?.handle(req, res)) return;
    if (
      url.pathname === '/s' ||
      url.pathname.startsWith('/phone-calibration')
    ) {
      try {
        if (
          (url.pathname === '/s' ||
            url.pathname === '/phone-calibration/connect') &&
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
              req.headers['user-agent'],
            ),
          );
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
        if (
          !calibration &&
          req.method === 'GET' &&
          ['/phone-calibration', '/phone-calibration/'].includes(
            url.pathname,
          ) &&
          req.headers.accept?.includes('text/html')
        ) {
          res.writeHead(302, {
            Location: '/s',
            'Cache-Control': 'no-store',
          });
          return res.end();
        }
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
    const port = (server.address() as AddressInfo).port;
    const managerOrigins = [
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
    ];
    if (origin && !managerOrigins.includes(origin))
      return send(403, { error: 'Origin not allowed' });
    if (url.pathname === '/api/arm/open-device' && req.method === 'GET') {
      if (
        req.headers['x-midscene-manager'] !== '1' ||
        !managerOrigins.includes(`http://${req.headers.host}`)
      )
        return send(403, { error: 'Open the arm manager on this computer' });
      if (!deviceAccessToken)
        return send(404, { error: 'Universal Device is unavailable' });
      return send(200, {
        url: managerOrigins[0],
        token: deviceAccessToken,
      });
    }
    const write = req.method !== 'GET' && req.method !== 'HEAD';
    const remoteBusy = deviceAPI?.sessions.busy(armResource);
    if (
      remoteBusy &&
      write &&
      !['/api/arm/stop', '/api/arm/control'].includes(url.pathname)
    )
      return send(409, {
        error:
          'Disconnect the Universal Device session before changing the arm configuration',
      });
    if (write) managerWrites++;
    try {
      if (url.pathname === '/api/arm' && req.method === 'GET')
        return send(
          200,
          await connectionStatus(url.searchParams.get('fresh') === 'true'),
        );
      if (url.pathname === '/api/twin/scene' && req.method === 'GET') {
        if (!arm || !devices) {
          const empty: TwinSceneSnapshot = {
            ready: false,
            blockedReasons: ['arm-disconnected'],
            screens: [],
            skippedScreens: [],
            generatedAt: new Date().toISOString(),
          };
          return send(200, empty);
        }
        return send(200, await buildTwinScene(arm, devices));
      }
      if (url.pathname === '/api/twin/stream' && req.method === 'GET') {
        twinStream.handle(req, res);
        return;
      }
      if (url.pathname === '/api/arm/stop' && req.method === 'POST') {
        if (!armControls || connecting)
          return send(409, { error: 'Connect the arm first' });
        await armControls.stop();
        return send(200, await connectionStatus());
      }
      if (url.pathname === '/api/arm/recover' && req.method === 'POST') {
        if (!armControls || connecting)
          return send(409, { error: 'Connect the arm first' });
        const recovery = await readBody(req);
        if (recovery.session !== undefined) setup.assertSession(recovery);
        if (recovery.confirmed !== true)
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
        const input = await readBody(req);
        if (
          deviceAPI?.sessions.busy(armResource) &&
          !['pause', 'emergencyStop'].includes(input.action)
        )
          return send(409, {
            error: 'The arm is reserved by a Universal Device session',
          });
        await statusPanel.command(input);
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
        const input = await readBody(req);
        if (setup.busy || screenControl?.busy)
          return send(409, {
            error: 'Wait for the current robot control to finish',
          });
        await setup.mutate(
          { session: input.session ?? setup.session },
          async () => {
            await disconnectArm();
            setup.session = randomUUID();
            setup.phase = 'unconfigured';
          },
        );
        return send(200, await connectionStatus());
      }
      if (
        setup.busy &&
        req.method !== 'GET' &&
        url.pathname.startsWith('/api/devices')
      )
        return send(409, { error: 'Wait for configuration changes to finish' });
      const actionRoute = /^\/api\/devices\/([^/]+)\/actions$/.exec(
        url.pathname,
      );
      if (actionRoute) {
        const control = screenControl;
        if (!devices || !control || connecting)
          return send(409, { error: 'Connect the arm first' });
        if (req.method !== 'POST')
          return send(405, { error: 'Method not allowed' });
        const id = decodeURIComponent(actionRoute[1]);
        const input = await readBody(req, 8192);
        if (control !== screenControl || connecting || setup.busy)
          return send(409, {
            error: 'Wait for configuration changes to finish',
          });
        return send(200, {
          result: await control.perform(id, input.action),
        });
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
        if (
          !['list', 'displays', 'status', 'discard-added-screen'].includes(
            input.action,
          )
        )
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
        const stop =
          input.action === 'stop' ||
          (input.action === 'command' && input.command === 'stop');
        if (
          screenControl?.busy &&
          !stop &&
          !['read', 'screens', 'clear', 'delete-calibration'].includes(
            input.action,
          )
        )
          return send(409, {
            error: 'Wait for the manual screen gesture to finish',
          });
        const batch = devices.batch;
        const current = batch.read();
        const otherCamera = current && current.cameraId !== input.cameraId;
        if (input.action === 'read')
          return send(200, otherCamera ? null : current);
        if (input.action === 'plan')
          return send(200, await batch.plan(input.cameraId));
        if (input.action === 'screens')
          return send(200, await batch.screens(input.cameraId));
        if (input.action === 'start')
          return send(200, await batch.start(input));
        if (otherCamera && input.action !== 'delete-calibration')
          return send(409, { error: 'Batch belongs to a different camera' });
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
        if (req.method === 'GET') {
          return send(200, { screens: devices.screens(true) });
        }
        if (req.method === 'POST') {
          const input = await readBody(req, 16384);
          if (screenControl?.busy)
            return send(409, {
              error: 'Wait for the manual screen gesture to finish',
            });
          if (
            typeof input.cameraId !== 'string' ||
            (input.name !== undefined &&
              (typeof input.name !== 'string' ||
                !input.name.trim() ||
                input.name.length > 100))
          )
            return send(400, { error: 'Select a camera and screen name' });
          return send(
            200,
            await devices.markerCalibration.addScreen(
              input.cameraId,
              input.name,
            ),
          );
        }
        return send(405, { error: 'Method not allowed' });
      }
      const calibrationRoute =
        /^\/api\/devices\/([^/]+)\/calibration(?:\/(.*))?$/.exec(url.pathname);
      if (calibrationRoute) {
        if (!devices) return send(409, { error: 'Connect the arm first' });
        const id = decodeURIComponent(calibrationRoute[1]);
        const action = calibrationRoute[2];
        if (screenControl?.busy && req.method === 'POST' && action !== 'cancel')
          throw new RobotArmError(
            'BUSY',
            'Wait for the manual screen gesture to finish.',
            409,
          );
        if (action === 'open' && req.method === 'POST') {
          const registry = devices;
          const host = await registry.ensureHost(id);
          const preview = [...markerPreviews.values()].find(
            (p) => p.cameraId === host.cameraId,
          );
          const pairing = preview?.activePairing;
          if (preview?.lastPairing && !preview.lastPairing.handoffToken) {
            const { newToken, savedToken } = preview.lastPairing;
            const target = registry.markerCalibration.previewTarget(
              host.cameraId,
              [newToken, ...(savedToken ? [savedToken] : [])].map(
                phoneFingerprint,
              ),
            );
            if (!target && id === host.cameraId)
              return send(200, { phase: 'prepared', pairingConflict: true });
            if (target === id) {
              if (!pairing)
                return send(200, {
                  phase: 'prepared',
                  awaitingPreview:
                    Date.now() - preview.lastViewed < 5 * 60_000 &&
                    host.service.phoneStatus().state !== 'connected',
                });
              const token = await registry.markerCalibration.adoptPreview(
                host.cameraId,
                id,
                pairing,
              );
              if (
                token &&
                devices === registry &&
                preview.activePairing === pairing
              )
                pairing.handoffToken = token;
            }
          }
          await registry.markerCalibration.resumeBoundPage(host);
          return send(200, { phase: 'prepared' });
        }
        if (action === 'cancel' && req.method === 'POST') {
          const { attemptId } = await readBody(req);
          if (typeof attemptId !== 'string' || !attemptId)
            return send(400, { error: 'Calibration attempt ID is required' });
          await devices.cancelCalibration(id, attemptId);
          return send(200, devices.status(id));
        }
        if (req.method === 'POST') devices.assertBatchIdle();
        if (action === 'start' && req.method === 'POST') {
          return send(200, await devices.startCalibration(id));
        }
        if (action === 'status' && req.method === 'GET')
          return send(200, devices.status(id));
        if (
          !SCREEN_DRIFT_DETECTION_ENABLED &&
          action === 'camera/validity' &&
          req.method === 'GET'
        )
          return send(200, { skipped: 'disabled' });
        const session = devices.entries.get(id)?.calibration;
        const host =
          action === 'camera/validity' && req.method === 'GET'
            ? await devices.ensureHost(id, true)
            : (devices.entries.get(id)?.host ?? session?.host);
        if (!host)
          return send(409, {
            error: 'Calibration is not ready',
            phase: session?.phase,
          });
        const registry = devices;
        if (
          url.pathname.endsWith('/calibration/camera/preview') &&
          req.method === 'GET'
        )
          registerClientPreview(
            url.searchParams.get('client') ?? undefined,
            `host:${id}:${url.searchParams.get('viewer') ?? 'preview'}`,
            res,
          );
        if (
          await host.handle(req, res, () => {
            if (registry !== devices || registry.entries.get(id)?.host !== host)
              throw new RobotArmError(
                'STALE_CONTEXT',
                'Device connection changed',
                409,
              );
            registry.assertBatchIdle();
            if (
              ![
                'assisted-calibration/setup',
                'assisted-calibration/setup/mapping',
              ].includes(action ?? '')
            ) {
              const attemptId = req.headers['x-calibration-attempt'];
              registry.assertCalibrationRunning(
                id,
                typeof attemptId === 'string' ? attemptId : '',
              );
            }
          })
        )
          return;
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
          if (url.searchParams.has('screen'))
            return send(400, {
              error: 'Only camera-level markers are supported',
            });
          if (
            !(await listCameras({ includeBuiltIn: true })).some(
              (camera) => camera.id === id,
            )
          )
            return send(404, { error: 'Camera not found' });
          const paired = [...markerPreviews.values()].find(
            (page) => page.cameraId === id,
          );
          if (paired) {
            paired.showMarkers();
            return send(200, {
              token: paired.token,
              links: phoneLinks(paired.token),
            });
          }
          const slot = Array.from({ length: 8 }, (_, i) => i + 1).find(
            (slot) =>
              ![...markerPreviews.values()].some((p) => p.slot === slot),
          );
          if (!slot)
            return send(409, { error: 'Close another marker preview first' });
          const preview = new MarkerPreview(id, slot);
          markerPreviews.set(preview.token, preview);
          return send(200, {
            token: preview.token,
            links: phoneLinks(preview.token),
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
      if (url.pathname === '/api/cameras' && req.method === 'GET') {
        const registry = devices;
        const refresh = url.searchParams.get('refresh') === 'true';
        // Automatic workspace refreshes must not probe the devices while a
        // capture process is running; only an explicit refresh may.
        const cameras = await listCameras({
          refresh,
          cachedOnly: !refresh,
          includeBuiltIn: true,
        });
        const deviceSession = registry ? setup.session : null;
        const screens = registry?.screens(true);
        const controlScreens = screenControl?.screens();
        const entries = await Promise.all(
          cameras.map(async (camera) => {
            const entry = registry?.entries.get(camera.id);
            // Camera-only mode has no Device, so read the same persisted
            // correction the Device will restore once the arm is connected.
            const stored = entry
              ? undefined
              : await cameraManager.persistedPerspective(
                  camera.id,
                  (await pendingPerspectives.get(camera.id))?.scope,
                );
            const correction =
              entry?.camera.getCorrection() ?? stored?.correction;
            return {
              ...camera,
              previewScreenId: registry
                ? previewScreens.get(camera.id)
                : undefined,
              screens: screens
                ?.filter((s) => s.cameraId === camera.id)
                .map((screen) => ({
                  ...screen,
                  control: controlScreens?.get(screen.id),
                })),
              hasCorrection: Boolean(correction),
              correction,
              imaging: entry?.camera.imagingStatus(),
              perspectiveTarget: entry
                ? entry.camera.getPerspectiveTarget()
                : stored?.target,
              error: registry?.cameraErrors.get(camera.id),
              stream: entry?.camera.stream.getInfo(),
            };
          }),
        );
        return send(200, {
          error: registry?.discoveryError,
          cameras: entries,
          deviceSession,
        });
      }
      // A tab keeps the source warm across raw/corrected image swaps. Tying the
      // owner to the response also releases it on navigation or a crashed tab.
      if (url.pathname === '/api/cameras/lease' && req.method === 'GET') {
        const id = url.searchParams.get('id');
        if (!id) return send(400, { error: 'Camera id is required' });
        if (devices)
          return send(409, { error: 'The connected arm owns the camera' });
        if (req.headers['sec-fetch-site'] === 'cross-site')
          return send(403, { error: 'Open camera previews in Playground' });
        const owner = randomUUID();
        await cameraManager.acquire(id, owner);
        try {
          if (!res.destroyed) {
            res.writeHead(200, {
              'Content-Type': 'application/octet-stream',
              'Cache-Control': 'no-store',
            });
            res.flushHeaders();
            await new Promise<void>((done) => res.once('close', done));
          }
        } finally {
          await cameraManager.release(id, owner);
        }
        return;
      }
      if (url.pathname === '/api/cameras/start' && req.method === 'POST') {
        const input = await readBody(req);
        const cameras = await listCameras({
          includeBuiltIn: true,
          cachedOnly: true,
        });
        const camera = cameras.find((entry) => entry.id === input.id);
        if (!camera) return send(404, { error: 'Camera not found' });
        const activeDevices = devices;
        if (!activeDevices)
          return send(409, { error: 'Connect the arm first' });
        const { camera: session } = await activeDevices.open(camera.id, true);
        await Promise.allSettled(
          activeDevices
            .screens()
            .filter(
              (screen) =>
                screen.cameraId === camera.id && screen.id !== camera.id,
            )
            .map((screen) => activeDevices.open(screen.id, true)),
        );
        if (await pendingPerspectives.get(camera.id))
          await setup.mutate({ session: setup.session }, () =>
            restoreMarkerPerspective(activeDevices, camera.id),
          );
        return send(200, { stream: session.stream.getInfo() });
      }
      if (
        url.pathname === '/api/cameras/correction' &&
        req.method === 'DELETE'
      ) {
        if (screenControl?.busy)
          return send(409, {
            error: 'Wait for the manual screen gesture to finish',
          });
        const id = url.searchParams.get('id');
        if (!id) return send(400, { error: 'Camera id is required' });
        if (devices || url.searchParams.has('session')) {
          setup.assertSession({
            session: url.searchParams.get('session') ?? '',
          });
          const screen = url.searchParams.get('screen') ?? id;
          if (!devices || devices.entries.get(screen)?.cameraId !== id)
            return send(409, {
              error: 'The selected screen is no longer running',
            });
          const registry = devices;
          await setup.mutate(
            { session: url.searchParams.get('session')! },
            async () => {
              await setup.stationary();
              registry.assertBatchIdle();
              await (
                await registry.ensureHost(screen, true)
              ).clearAppliedCorrection();
            },
          );
          return send(200, { ok: true });
        }
        if (url.searchParams.has('screen') || url.searchParams.has('all'))
          return send(400, {
            error: 'Only camera-level correction is supported',
          });
        await setup.mutate({ session: setup.session }, async () => {
          for (const [token, preview] of markerPreviews) {
            if (preview.cameraId !== id) continue;
            preview.close();
            markerPreviews.delete(token);
          }
          const pending = await pendingPerspectives.get(id);
          if (pending) await pendingPerspectives.clear(id, pending);
          else await clearStandaloneCorrection(cameraManager, id);
        });
        return send(200, { ok: true });
      }
      if (url.pathname === '/api/cameras/correction' && req.method === 'POST') {
        const input = await readBody(req, 65536);
        if (screenControl?.busy)
          return send(409, {
            error: 'Wait for the manual screen gesture to finish',
          });
        if (typeof input.id !== 'string' || !input.correction)
          return send(400, { error: 'Camera id and correction are required' });
        if (devices || input.session !== undefined) {
          setup.assertSession(input);
          if (input.evidence !== undefined)
            return send(409, {
              error: 'Reopen the marker capture for the connected screen.',
            });
          const screen = input.screen ?? input.id;
          if (!devices || devices.entries.get(screen)?.cameraId !== input.id)
            return send(409, {
              error: 'The selected screen is no longer running',
            });
          const registry = devices;
          const mappingError = await setup.mutate(input, async () => {
            await setup.stationary();
            registry.assertBatchIdle();
            const host = await registry.ensureHost(screen, true);
            return host.applyMarkerCorrection(
              input.correction,
              false,
              input.perspectiveTarget,
            );
          });
          return send(200, { ok: true, mappingError });
        }
        if (input.screen !== undefined)
          return send(400, {
            error: 'Only camera-level correction is supported',
          });
        const evidence = input.evidence;
        const check = () => {
          if (evidence === undefined) return;
          const preview = markerPreviews.get(evidence?.token);
          if (!preview || preview.cameraId !== input.id)
            throw Object.assign(
              new Error(
                'The marker capture belongs to another camera or has expired.',
              ),
              { status: 409 },
            );
          return preview.assertCaptured(evidence.pageKey);
        };
        const validity = await setup.mutate(
          { session: setup.session },
          async () => {
            check();
            const pairing = markerPreviews.get(evidence?.token)?.activePairing;
            const phones = pairing
              ? [
                  pairing.newToken,
                  ...(pairing.savedToken ? [pairing.savedToken] : []),
                ].map(phoneFingerprint)
              : (await pendingPerspectives.get(input.id))?.phones;
            if (phones) {
              if (!input.perspectiveTarget)
                throw Object.assign(
                  new Error('A marker perspective requires an output size.'),
                  { status: 400 },
                );
              return pendingPerspectives.save(
                input.id,
                input.correction,
                input.perspectiveTarget,
                phones,
                check,
                true,
              );
            }
            return saveStandaloneCorrection(
              cameraManager,
              input.id,
              input.correction,
              input.perspectiveTarget,
              undefined,
              undefined,
              true,
            );
          },
        );
        return send(200, { ok: true, validity });
      }
      if (url.pathname === '/api/cameras/stop' && req.method === 'POST') {
        const input = await readBody(req);
        if (screenControl?.busy)
          return send(409, {
            error: 'Wait for the manual screen gesture to finish',
          });
        await devices?.stop(input.id);
        return send(200, {});
      }
      if (
        url.pathname === '/api/cameras/imaging/activate' &&
        req.method === 'POST'
      ) {
        if (screenControl?.busy)
          return send(409, {
            error: 'Wait for the manual screen gesture to finish',
          });
        const input = await readBody(req);
        if (typeof input.id !== 'string' || typeof input.screenId !== 'string')
          return send(400, {
            error: 'Camera and screen ids are required',
          });
        const imaging = devices
          ? await devices.activateCameraImaging(input.id, input.screenId)
          : await cameraManager.activateScreen(input.id, input.screenId);
        return send(200, { imaging });
      }
      if (url.pathname === '/api/cameras/preview' && req.method === 'GET') {
        const id = url.searchParams.get('id') ?? '';
        const view = (url.searchParams.get('view') ??
          'raw') as CameraPreviewView;
        if (view !== 'raw' && view !== 'corrected')
          return send(400, { error: 'Unknown camera view' });
        const client = url.searchParams.get('client') ?? undefined;
        const viewer = url.searchParams.get('viewer') ?? undefined;
        const screenId = url.searchParams.get('screen') ?? undefined;
        if (!devices && id) {
          if (url.searchParams.has('screen'))
            return send(400, {
              error: 'Only camera-level preview is supported',
            });
          if (req.headers['sec-fetch-site'] === 'cross-site')
            return send(403, { error: 'Open camera previews in Playground' });
          await streamStandalonePreview(
            res,
            cameraManager,
            id,
            view,
            view === 'corrected'
              ? (await pendingPerspectives.get(id))?.scope
              : undefined,
            client,
            viewer,
          );
          return;
        }
        const entry = devices?.entries.get(id);
        if (!entry) return send(404, { error: 'Camera is not running' });
        await streamCameraPreview(
          res,
          entry,
          view === 'corrected',
          client,
          viewer,
          view === 'corrected' ? screenId : undefined,
        );
        return;
      }
      if (url.pathname === '/api/cameras/frame' && req.method === 'GET') {
        const id = url.searchParams.get('id');
        if (!id) return send(400, { error: 'Camera id is required' });
        const view = url.searchParams.get('view') ?? 'raw';
        if (view !== 'raw' && view !== 'corrected')
          return send(400, { error: 'Unknown camera view' });
        let jpeg: Buffer;
        if (devices) {
          const screen =
            view === 'corrected' ? url.searchParams.get('screen') : null;
          const entry = devices.entries.get(screen ?? id);
          if (!entry || (screen && entry.cameraId !== id))
            return send(404, { error: 'Camera or screen is not running' });
          const frame = await entry.camera.rawFrame();
          jpeg =
            view === 'corrected'
              ? await entry.camera.rectifiedFrame(frame, {
                  maxSide: 480,
                  sampling: 'nearest',
                })
              : frame;
        } else {
          if (view === 'corrected')
            return send(409, {
              error: 'Connect the device for a corrected frame',
            });
          if (req.headers['sec-fetch-site'] === 'cross-site')
            return send(403, { error: 'Open camera previews in Playground' });
          const owner = randomUUID();
          const camera = await cameraManager.acquire(id, owner);
          try {
            jpeg = await camera.rawFrame();
          } finally {
            await cameraManager.release(id, owner);
          }
        }
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'no-store',
        });
        return res.end(jpeg);
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
    } finally {
      if (write) managerWrites--;
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
        await deviceAPI?.close();
        await disconnectArm();
        for (const preview of markerPreviews.values()) preview.close();
        markerPreviews.clear();
        twinStream.close();
        await cameraManager.close();
        await drained;
      })();
      return closing;
    },
  };
}
