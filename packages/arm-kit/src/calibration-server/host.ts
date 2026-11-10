import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import type { AssistedCalibrationInput } from '../assisted-contracts.js';
import { screenPoseMm } from '../calibration/geometry.js';
import {
  calibrationPhonePage,
  phoneMarkerElements,
} from '../calibration/phone/page.js';
import { sameLayout } from '../calibration/phone/session.js';
import { CalibrationWorkflow } from '../calibration/workflow.js';
import {
  MARKER_CAPTURE_ATTEMPTS,
  captureScreenMarkers,
  recognizeScreenMarkers,
} from '../camera/calibration-markers.js';
import type { CameraSession } from '../camera/session.js';
import { calibrationAccepted } from '../contracts.js';
import {
  type CameraCorrection,
  RobotArmError,
  type ToolProfile,
  semanticJson,
} from '../contracts.js';
import { controllerRuntime } from '../controller-runtime.js';
import type { ArmController } from '../controller.js';
import { contactPoint, flangePose } from '../domain.js';
import { sharedCalibrationTool } from '../runtime/profile-store.js';
import { createCalibrationHandler } from './handler.js';

import { PhoneSocketServer } from './phone-socket.js';

export interface CalibrationHostOptions {
  arm: ArmController;
  camera: CameraSession;
  deviceId: string;
  input?: AssistedCalibrationInput;
  markerCodes?: readonly number[];
  basePath?: string;
  phoneLinks?: () => { name: string; url: string }[];
}
/** One Device's calibration endpoints. Listening, origin checks and static assets belong to the host. */
export class CalibrationHost {
  readonly service: CalibrationWorkflow;
  readonly basePath: string;
  private readonly control;
  readonly phoneSocket: PhoneSocketServer;
  private readonly streams = new Set<ServerResponse>();
  private autoOutput = false;
  private input?: AssistedCalibrationInput;
  constructor(private readonly options: CalibrationHostOptions) {
    this.basePath = (options.basePath ?? '/api/calibration').replace(
      /\/+$/,
      '',
    );
    this.input = options.input && structuredClone(options.input);
    this.service = new CalibrationWorkflow(controllerRuntime(options.arm), {
      deviceId: options.deviceId,
      vision: options.camera,
      phoneLinks: options.phoneLinks,
      markerCodes: options.markerCodes,
      referencePosition: () => {
        const store = controllerRuntime(options.arm).profileStore;
        const binding = store.deviceBinding(options.deviceId);
        if (!binding || !this.input) return undefined;
        const teaching = store.installationTeaching(this.input);
        const calibration = store.getCalibration(binding.calibrationProfileId);
        if (
          !teaching ||
          !calibrationAccepted(calibration) ||
          binding.robotProfileId !== this.input.robotProfileId ||
          binding.toolProfileId !== this.input.toolProfileId ||
          calibration.robotGeometryRevision !==
            store.getRobot(binding.robotProfileId).geometryRevision ||
          calibration.toolGeometryRevision !==
            store.getTool(binding.toolProfileId).geometryRevision ||
          calibration.screenGeometryRevision !==
            store.getScreen(binding.screenProfileId).geometryRevision ||
          binding.vision.fingerprint !==
            this.service.setup().mapping?.vision.fingerprint
        )
          return undefined;
        const tool = store.getTool(binding.toolProfileId);
        const screen = store.getScreen(binding.screenProfileId);
        const center = screenPoseMm(
          calibration,
          tool,
          { x: screen.physicalWidthMm / 2, y: screen.physicalHeightMm / 2 },
          -Math.max(20, screen.safeHeightMm),
        );
        const tip = contactPoint(center, tool.offsetMm);
        const floor = contactPoint(teaching.referencePose, tool.offsetMm).z;
        return flangePose(
          { ...tip, z: Math.max(tip.z, floor) },
          center.orientation,
          tool.offsetMm,
        );
      },
    });
    this.phoneSocket = new PhoneSocketServer(this.service);
    this.control = createCalibrationHandler({
      service: this.service,
      basePath: this.basePath,
    });
  }
  async prepare(): Promise<void> {
    if (!this.input) {
      const store = controllerRuntime(this.options.arm).profileStore;
      const runtime = controllerRuntime(this.options.arm);
      const remembered = store.calibrationSetup(this.options.deviceId);
      const robot = remembered && store.getRobot(remembered.robotProfileId);
      if (
        remembered &&
        remembered.cameraId === this.options.camera.camera.id &&
        robot?.adapterId === runtime.id &&
        robot.connectionIdentity === runtime.connectionIdentity
      ) {
        const { deviceId: _deviceId, autoOutput, ...selection } = remembered;
        this.input = selection;
        this.autoOutput = autoOutput;
      }
      const saved = store.deviceBinding(this.options.deviceId);
      if (!this.input && saved) {
        const screen = store.getScreen(saved.screenProfileId);
        this.input = {
          robotProfileId: saved.robotProfileId,
          toolProfileId: saved.toolProfileId,
          cameraId: this.options.camera.camera.id,
          width: saved.vision.width,
          height: saved.vision.height,
          motion: screen,
        };
      }
      if (!this.input && runtime.describeCapabilities().setupDefaults?.motion) {
        const cameraId = this.options.camera.camera.id;
        const tool = sharedCalibrationTool(
          store.list(),
          cameraId,
          runtime.id,
          runtime.connectionIdentity,
        );
        if (tool) {
          const selection = { ...tool, cameraId, width: 720, height: 1280 };
          await this.service.prepare(selection);
          if (!this.input) {
            this.input = selection;
            this.autoOutput = true;
          }
          return;
        }
      }
    }
    if (this.input) {
      if (this.input.cameraId !== this.options.camera.camera.id)
        throw new RobotArmError(
          'VISION_BINDING_CHANGED',
          'Calibration input references another camera',
        );
      await this.service.prepare(this.input);
    }
  }
  /** Save measured setup without replacing an accepted Device binding. */
  async configure(input: {
    width?: number;
    height?: number;
    tool: Pick<ToolProfile, 'offsetMm' | 'contactDirection' | 'payload'>;
    motion?: AssistedCalibrationInput['motion'];
  }) {
    this.editable();
    // A fresh session needs an initial render size before the phone connects.
    const width = input?.width ?? this.input?.width ?? 720;
    const height = input?.height ?? this.input?.height ?? 1280;
    if (
      !input ||
      !input.tool ||
      (input.width === undefined) !== (input.height === undefined) ||
      ![width, height].every(
        (value) => Number.isInteger(value) && value >= 180 && value <= 4096,
      )
    )
      throw new RobotArmError(
        'INVALID_MAPPING',
        'Select a corrected output size between 180 and 4096 pixels',
        400,
      );
    const arm = controllerRuntime(this.options.arm);
    let robot = arm.profileStore
      .list()
      .robots.find(
        (entry) =>
          entry.adapterId === arm.id &&
          entry.connectionIdentity === arm.connectionIdentity,
      );
    robot ??= await arm.putRobot({
      id: randomUUID(),
      name: arm.id,
      installation: this.options.deviceId,
      adapterId: arm.id,
      connectionIdentity: arm.connectionIdentity,
    });
    // Devices on this arm share a physical tool. Reuse an identical accepted
    // tool; changed measured geometry creates a draft and never mutates it.
    const geometryKey = (
      tool: Pick<ToolProfile, 'offsetMm' | 'contactDirection' | 'payload'>,
    ) => semanticJson([tool.offsetMm, tool.contactDirection, tool.payload]);
    const remembered = arm.profileStore.calibrationSetup(this.options.deviceId);
    const rememberedTool =
      remembered?.robotProfileId === robot.id
        ? arm.profileStore.getTool(remembered.toolProfileId)
        : undefined;
    const existing =
      (rememberedTool && geometryKey(rememberedTool) === geometryKey(input.tool)
        ? rememberedTool
        : undefined) ??
      arm.profileStore
        .list()
        .devices?.filter((binding) => binding.robotProfileId === robot.id)
        .map((binding) => arm.profileStore.getTool(binding.toolProfileId))
        .find((tool) => geometryKey(tool) === geometryKey(input.tool)) ??
      arm.profileStore
        .list()
        .tools.find((tool) => geometryKey(tool) === geometryKey(input.tool));
    const tool =
      existing ??
      (await arm.putTool({
        ...input.tool,
        id: randomUUID(),
        name: 'Touch tool',
      }));
    const selection: AssistedCalibrationInput = {
      robotProfileId: robot.id,
      toolProfileId: tool.id,
      cameraId: this.options.camera.camera.id,
      width,
      height,
      motion: input.motion ?? this.input?.motion,
    };
    await this.service.prepare(selection);
    this.autoOutput =
      input.width === undefined && (!this.input || this.autoOutput);
    await arm.profileStore.saveCalibrationSetup({
      ...selection,
      deviceId: this.options.deviceId,
      autoOutput: this.autoOutput,
    });
    this.input = selection;
    return this.configuration();
  }
  async enable(syncPayload = false) {
    this.editable();
    if (!this.input)
      throw new RobotArmError(
        'SETUP_REQUIRED',
        'Save tool configuration first',
        409,
      );
    const arm = controllerRuntime(this.options.arm);
    const tool = arm.profileStore.getTool(this.input.toolProfileId);
    const request = {
      robotProfileId: this.input.robotProfileId,
      toolProfileId: tool.id,
      toolRevision: tool.revision,
    };
    if (syncPayload) await arm.applySavedPayload(request);
    else await arm.lifecycle('enable', request);
    return this.configuration();
  }
  async recover() {
    this.editable();
    await this.options.arm.recover();
    return this.configuration();
  }
  private autoOutputSize() {
    const screen = this.service.setup().layout?.screen;
    if (!this.autoOutput || !screen) return undefined;
    const bounded = (n: number) => Math.min(4096, Math.max(180, Math.round(n)));
    return { width: bounded(screen.width), height: bounded(screen.height) };
  }

  async configuration() {
    if (!this.input) await this.prepare();
    const { camera, deviceId } = this.options;
    const arm = controllerRuntime(this.options.arm);
    const state = await arm.state(this.input?.toolProfileId);
    const correction = camera.getCorrection();
    const saved = arm.profileStore.deviceBinding(deviceId);
    const { selection, teaching, mapping } = this.service.setup();
    return {
      deviceId,
      capabilities: arm.describeCapabilities(),
      armState: state,
      input: this.input,
      installationTaught: Boolean(teaching),
      mappingReady: Boolean(mapping),
      correctionOutput: this.autoOutputSize(),
      output: selection
        ? {
            cameraId: selection.cameraId,
            width: selection.width,
            height: selection.height,
          }
        : undefined,
      camera: {
        ...camera.camera,
        online: camera.stream.getInfo().state === 'running',
        profileKey: correction ? camera.camera.id : undefined,
      },
      correction,
      perspectiveValidity: camera.getPerspectiveValidity(),
      correctionKey:
        correction && selection
          ? (
              await camera.binding({
                cameraId: camera.camera.id,
                width: selection.width,
                height: selection.height,
              })
            ).fingerprint
          : undefined,
      result: saved
        ? arm.profileStore.getCalibration(saved.calibrationProfileId)
        : undefined,
      editable: this.isEditable(),
      measuredSetup: this.input
        ? {
            width: this.input.width,
            height: this.input.height,
            tool: arm.profileStore.getTool(this.input.toolProfileId),
          }
        : undefined,
      ready: Boolean(
        this.input &&
          state.state.connected &&
          state.state.enabled &&
          ['applied', 'not-required'].includes(
            state.payloadApplication?.status ?? 'unknown',
          ) &&
          !state.recoveryRequired &&
          !state.softwarePaused,
      ),
    };
  }
  private isEditable() {
    const state = this.service.status();
    return (
      !state ||
      ['ready', 'completed', 'cancelled', 'interrupted'].includes(state.stage)
    );
  }
  private editable() {
    if (!this.isEditable())
      throw new RobotArmError(
        'BUSY',
        'Finish or cancel calibration before changing the camera correction',
        409,
      );
  }
  private async saveCorrection(
    correction: CameraCorrection,
    allowMismatch = false,
    output?: { width: number; height: number },
    assertCurrent?: () => void,
  ) {
    const validity = await this.options.camera.checkCorrection(
      correction,
      undefined,
      allowMismatch,
    );
    this.editable();
    assertCurrent?.();
    if (output)
      await this.options.camera.setPerspective(correction, {
        ...output,
        rotation: correction.rotation,
      });
    else await this.options.camera.setCorrection(correction);
    const size = this.autoOutputSize();
    if (size && this.input) {
      const selection = { ...this.input, ...size };
      await this.service.prepare(selection);
      await controllerRuntime(
        this.options.arm,
      ).profileStore.saveCalibrationSetup({
        ...selection,
        deviceId: this.options.deviceId,
        autoOutput: this.autoOutput,
      });
      this.input = selection;
    }
    return validity;
  }

  get deviceId() {
    return this.options.deviceId;
  }
  get cameraId() {
    return this.options.camera.camera.id;
  }
  async clearAppliedCorrection() {
    this.editable();
    await this.service.clearMapping();
    await this.options.camera.clearCorrection();
  }
  async applyMarkerCorrection(
    correction: CameraCorrection,
    allowMismatch = false,
    output?: { width: number; height: number },
    assertCurrent?: () => void,
  ) {
    this.editable();
    const validity = await this.saveCorrection(
      correction,
      allowMismatch,
      output,
      assertCurrent,
    );
    if (validity.state === 'invalid') {
      await this.service.clearMapping();
      return 'The screen outline does not match the camera view. Recalibrate before moving.';
    }
    if (this.input) {
      try {
        await this.service.mapSetup();
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }
  }
  private alignmentTask?: Promise<void>;
  alignForBatch(signal: AbortSignal) {
    if (this.alignmentTask) return this.alignmentTask;
    const abort = new AbortController();
    this.alignment = abort;
    const task = this.alignScreen(AbortSignal.any([signal, abort.signal]));
    this.alignmentTask = task.finally(() => {
      this.alignmentTask = undefined;
      this.alignment = undefined;
    });
    return this.alignmentTask;
  }
  private alignment?: AbortController;
  private async alignScreen(signal: AbortSignal) {
    this.editable();
    const session = this.service.status();
    if (
      (session?.stage === 'interrupted' && session.samples > 0) ||
      (session?.stage === 'ready' &&
        (session.referencePosition || session.safePosition))
    )
      throw new RobotArmError(
        'BUSY',
        'Resume or cancel the current calibration first',
        409,
      );
    let request = this.service.requestMarkerDisplay();
    let accepted = false;
    try {
      for (let attempt = 1; ; attempt++) {
        let deadline = Date.now() + 12000;
        let observed = this.service.markerObservation(request);
        while (!observed) {
          // The operator may need time to enter fullscreen or reopen the iOS home screen app.
          if (!this.service.setup().phoneConnected)
            deadline = Date.now() + 12000;
          if (Date.now() >= deadline)
            throw new RobotArmError(
              'PAGE_CHANGED',
              'The phone did not report visible screen markers. Keep the paired page in the foreground.',
              409,
            );
          await delay(80, undefined, { signal });
          observed = this.service.markerObservation(request);
        }
        const { pageId, layout } = observed;
        this.service.setMarkerCapture({
          request,
          attempt,
          captureAt: Date.now() + 3000,
        });
        await delay(3000, undefined, { signal });
        const check = () => {
          signal.throwIfAborted();
          this.editable();
          const current = this.service.markerObservation(request);
          if (current?.pageId !== pageId || !sameLayout(layout, current.layout))
            throw new RobotArmError(
              'PAGE_CHANGED',
              'The phone display changed during marker detection',
              409,
            );
        };
        const camera = this.options.camera;
        const output = this.autoOutputSize() ?? this.input ?? layout.screen;
        let correction: CameraCorrection;
        try {
          ({ correction } = await recognizeScreenMarkers(() => {
            check();
            return camera.rawFrame();
          }, layout));
          check();
          // Check the candidate in the corrected image before replacing the saved corners.
          const frame = await camera.correctedFrame(correction, output);
          await camera.detectMarkers(frame, layout.markers);
          check();
        } catch (error) {
          signal.throwIfAborted();
          const current = this.service.markerObservation(request);
          if (
            !current ||
            current.pageId !== pageId ||
            !sameLayout(layout, current.layout)
          ) {
            // Discard the whole batch when the phone leaves fullscreen or is reopened.
            request = this.service.requestMarkerDisplay();
            attempt = 0;
            continue;
          }
          if (
            attempt >= MARKER_CAPTURE_ATTEMPTS ||
            !error ||
            typeof error !== 'object' ||
            !('code' in error) ||
            !['CALIBRATION_MISMATCH', 'NO_SCREEN_DETECTED'].includes(
              String(error.code),
            )
          )
            throw error;
          check();
          request = this.service.requestMarkerDisplay(true);
          continue;
        }
        await this.saveCorrection(correction);
        if (this.input) await this.service.mapSetup();
        check();
        accepted = true;
        return;
      }
    } finally {
      this.service.setMarkerCapture();
      this.service.finishMarkerDisplay(request, accepted);
    }
  }
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    assertAssistedWrite?: () => void,
  ): Promise<boolean> {
    if (
      req.method === 'GET' &&
      new URL(req.url ?? '/', 'http://localhost').pathname ===
        `${this.basePath}/assisted-calibration/events`
    ) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      });
      this.streams.add(res);
      let last: string | undefined;
      const publish = () => {
        if (res.destroyed || res.writableEnded || res.writableNeedDrain) return;
        try {
          const data = JSON.stringify({
            session: this.service.status(),
            phone: this.service.phoneStatus(),
            setup: this.service.setup(),
          });
          if (data !== last) {
            res.write(`data: ${data}\n\n`);
            last = data;
          }
        } catch {
          res.destroy();
        }
      };
      const unsubscribe = this.service.subscribe(publish);
      const heartbeat = setInterval(() => {
        if (!res.writableNeedDrain) res.write(': heartbeat\n\n');
      }, 15000);
      res.on('drain', publish);
      res.once('close', () => {
        unsubscribe();
        clearInterval(heartbeat);
        this.streams.delete(res);
      });
      publish();
      return true;
    }
    if (await this.control(req, res, assertAssistedWrite)) return true;
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (!path.startsWith(`${this.basePath}/`)) return false;
    const send = (status: number, value: unknown) => {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(value));
    };
    const relative = path.slice(this.basePath.length);
    try {
      if (relative === '/installation-teaching' && req.method === 'POST') {
        if (!this.input)
          throw new RobotArmError(
            'SETUP_REQUIRED',
            'Save tool configuration first',
            409,
          );
        const runtime = controllerRuntime(this.options.arm);
        const input = await readJson(req);
        const binding = {
          ...this.input,
          screenProfileId: this.options.deviceId,
        };
        switch (input.action) {
          case 'read':
            send(
              200,
              runtime.profileStore.installationTeaching(binding) ?? null,
            );
            break;
          case 'draft':
            send(200, runtime.installationTeachingDraft(binding));
            break;
          case 'state':
            send(200, await runtime.state(binding.toolProfileId));
            break;
          case 'capture':
            send(
              200,
              await runtime.captureInstallationPoint(binding, input.point),
            );
            break;
          case 'save':
            send(
              200,
              await runtime.teachInstallation({
                binding,
                draftId: input.draftId,
                corridorConfirmed: input.corridorConfirmed,
              }),
            );
            break;
          case 'enter-drag':
            if (!(await runtime.state(binding.toolProfileId)).state.enabled)
              await this.enable();
            await runtime.enterDragMode(binding);
            send(200, {});
            break;
          case 'exit-drag':
            await runtime.exitDragMode();
            send(200, {});
            break;
          case 'position':
            runtime.assertStopRevision(input.stopRevision);
            if (
              runtime.profileStore.installationTeaching(binding)?.id !==
              input.teachingId
            )
              throw new RobotArmError(
                'STALE_CONTEXT',
                'Installation teaching changed',
                409,
              );
            if (input.confirmed !== true)
              throw new RobotArmError(
                'CONFIRMATION_REQUIRED',
                'Confirm before returning to a taught position',
                409,
              );
            await runtime.positionInstallationPoint(binding, input.point);
            send(200, {});
            break;
          default:
            throw new RobotArmError(
              'INVALID_COMMAND',
              'Unknown teaching command',
            );
        }
      } else if (relative === '/configuration' && req.method === 'GET')
        send(200, await this.configuration());
      else if (relative === '/configuration' && req.method === 'POST')
        send(200, await this.configure(await readJson(req)));
      else if (
        (relative === '/enable' || relative === '/payload') &&
        req.method === 'POST'
      ) {
        const input = await readJson(req);
        if (input.confirmed !== true)
          throw new RobotArmError(
            'CONFIRMATION_REQUIRED',
            'Confirm enabling the arm or applying its saved tool payload',
            400,
          );
        send(200, await this.enable(relative === '/payload'));
      } else if (relative === '/recover' && req.method === 'POST') {
        send(200, await this.recover());
      } else if (relative === '/camera/validity' && req.method === 'GET') {
        const abort = new AbortController();
        const cancel = () => abort.abort();
        res.once('close', cancel);
        try {
          const check = await this.options.camera.checkPerspective({
            signal: abort.signal,
          });
          send(200, {
            ...check,
            summary: this.options.camera.getPerspectiveValidity(),
          });
        } finally {
          res.off('close', cancel);
        }
      } else if (relative === '/camera/frame' && req.method === 'GET') {
        const jpeg = await this.options.camera.rawFrame();
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'no-store',
        });
        res.end(jpeg);
      } else if (relative === '/camera/preview' && req.method === 'GET') {
        const stream = this.options.camera.stream;
        if (!['starting', 'running'].includes(stream.getInfo().state))
          throw new RobotArmError(
            'VISION_UNAVAILABLE',
            'Camera is not running',
          );
        res.writeHead(200, {
          'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
          'Cache-Control': 'no-store',
        });
        let blocked = false;
        const frame = ({ jpeg }: { jpeg: Buffer }) => {
          if (blocked || res.destroyed) return;
          blocked = !res.write(
            Buffer.concat([
              Buffer.from(
                `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`,
              ),
              jpeg,
              Buffer.from('\r\n'),
            ]),
          );
        };
        const end = () => res.end();
        res.on('drain', () => {
          blocked = false;
        });
        stream.on('frame', frame);
        stream.once('stopped', end);
        stream.once('failed', end);
        res.once('close', () => {
          stream.off('frame', frame);
          stream.off('stopped', end);
          stream.off('failed', end);
        });
      } else if (
        (relative === '/camera/markers' || relative === '/camera/detect') &&
        req.method === 'POST'
      ) {
        this.editable();
        const setup = this.service.setup();
        const layout = setup.layout;
        if (!layout || !setup.phoneConnected)
          throw new RobotArmError('INVALID_MAPPING', 'Connect Phone', 409);
        const result = await captureScreenMarkers(
          () => this.options.camera.rawFrame(),
          layout,
        );
        const current = this.service.setup();
        this.editable();
        if (
          !current.phoneConnected ||
          !current.layout ||
          !sameLayout(current.layout, layout)
        )
          throw new RobotArmError(
            'INVALID_MAPPING',
            'The phone page changed during marker detection',
            409,
          );
        send(
          200,
          relative === '/camera/detect'
            ? {
                ...result.correction,
                frameDataUrl: `data:image/jpeg;base64,${result.jpeg}`,
              }
            : result.correction,
        );
      } else if (relative === '/camera/align' && req.method === 'POST') {
        const abort = new AbortController();
        const cancel = () => abort.abort();
        res.once('close', cancel);
        try {
          await this.alignForBatch(abort.signal);
          send(200, await this.configuration());
        } finally {
          res.off('close', cancel);
        }
      } else if (relative === '/camera/check' && req.method === 'POST') {
        const correction = await readJson(req);
        const setup = this.service.setup();
        const output = this.autoOutputSize() ?? setup.selection;
        if (!output || !setup.phoneConnected || !setup.layout)
          throw new RobotArmError('INVALID_MAPPING', 'Connect Phone', 409);
        const frame = await this.options.camera.correctedFrame(
          correction,
          output,
        );
        const { accuracy } = await this.options.camera.detectMarkers(
          frame,
          setup.layout.markers,
        );
        send(200, { ok: true, accuracy });
      } else if (relative === '/camera/correction' && req.method === 'POST') {
        this.editable();
        const input = await readJson(req);
        this.editable();
        if (!this.service.setup().phoneConnected)
          throw new RobotArmError(
            'PHONE_UNAVAILABLE',
            'Enter the required phone display mode first',
            409,
          );
        await this.saveCorrection(input);
        send(200, await this.configuration());
      } else if (relative === '/camera/correction' && req.method === 'DELETE') {
        // Clearing keeps the screen, its page link and its saved size; the
        // camera simply stops applying the perspective to that screen. Drop the
        // page mapping first: a busy calibration must fail before anything is
        // released.
        await this.clearAppliedCorrection();
        send(200, await this.configuration());
      } else send(404, { error: '404 Not Found' });
    } catch (error) {
      if (!res.headersSent)
        send(error instanceof RobotArmError ? error.status : 500, {
          error: error instanceof Error ? error.message : String(error),
          ...(relative === '/camera/validity'
            ? { summary: this.options.camera.getPerspectiveValidity() }
            : {}),
        });
      else res.destroy();
    }
    return true;
  }
  /** Serve this only behind the host's per-session phone access token. No arm commands are exposed here. */
  async handlePhone(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    try {
      if (
        (path === '/phone-calibration' || path === '/phone-calibration/') &&
        req.method === 'GET'
      ) {
        const pageId = this.service.openPhonePage();
        if (req.headers.accept === 'application/json') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          });
          res.end(
            JSON.stringify({
              pageId,
              markers: phoneMarkerElements(this.options.markerCodes),
            }),
          );
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        });
        res.end(calibrationPhonePage(pageId, this.options.markerCodes));
      } else {
        res.writeHead(404);
        res.end();
      }
    } catch (error) {
      res.writeHead(error instanceof RobotArmError ? error.status : 400, {
        'Content-Type': 'application/json',
      });
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  async close() {
    this.alignment?.abort();
    this.phoneSocket.close();
    for (const res of this.streams) res.end();
    await this.service.stop();
  }
}
async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 65536)
      throw new RobotArmError('INVALID_REQUEST', 'Request too large', 413);
    chunks.push(bytes);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result))
      throw new Error();
    return result;
  } catch {
    throw new RobotArmError('INVALID_REQUEST', 'Expected JSON object', 400);
  }
}
