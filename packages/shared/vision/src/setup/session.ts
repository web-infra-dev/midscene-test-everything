import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import sharp from 'sharp';
import {
  detectCalibrationMarkers,
  detectScreenFromMarkers,
} from '../camera/calibration-markers.js';
import { CameraStreamManager } from '../camera/camera-stream-manager.js';
import type { CameraStream } from '../camera/camera-stream.js';
import { cameraBackend, listCameras } from '../camera/index.js';
import {
  PerspectiveTransformer,
  resolveRotation,
} from '../camera/perspective-transformer.js';
import { validateQuad } from '../camera/vision-geometry.js';
import { ScreenPhoneServer } from '../phone/server.js';
import { sameLayout } from '../phone/session.js';
import type { CameraScreenSettings } from '../screen.js';

export interface CameraSetupPreview {
  stream: CameraStream;
  transfer(): void;
  release(): Promise<void>;
}

export interface CameraSetupOptions {
  cameraId?: string;
  initialValue?: CameraScreenSettings;
  streams?: CameraStreamManager;
  phone?: ScreenPhoneServer;
  reuseValidatedSettings?: boolean;
  onConfirm(
    settings: CameraScreenSettings,
    preview?: CameraSetupPreview,
  ): Promise<void>;
}

/** Mountable in an existing server; owns only streams it creates. */
export class CameraSetupSession {
  readonly id = randomUUID();
  private phone: ScreenPhoneServer;
  readonly result: Promise<CameraScreenSettings>;
  private resolve!: (value: CameraScreenSettings) => void;
  private reject!: (reason: Error) => void;
  private streams: CameraStreamManager;
  private stream?: CameraStream;
  private ownsStream = false;
  private validatedSettings?: string;
  private settled = false;
  private closing = false;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private options: CameraSetupOptions) {
    this.phone = options.phone ?? new ScreenPhoneServer();
    this.streams = options.streams ?? new CameraStreamManager(cameraBackend());
    this.result = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    // An HTTP caller may not have subscribed to the result yet.
    void this.result.catch(() => undefined);
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
  ): Promise<void> {
    if (this.closing) throw new Error('Camera setup closed');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && path === '/state') {
      if (!this.options.phone) await this.phone.start();
      const cameras = await listCameras({ includeBuiltIn: true });
      if (
        this.options.cameraId &&
        !cameras.some((camera) => camera.id === this.options.cameraId)
      )
        throw new Error('The camera requested by the script is not connected');
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          cameras: this.options.cameraId
            ? cameras.filter((camera) => camera.id === this.options.cameraId)
            : cameras,
          selectedCameraId: this.options.cameraId,
          initialValue: this.options.initialValue,
          phone: this.phone.status(
            this.options.phone ? req.socket.localPort : undefined,
          ),
          layout: this.phone.session.update?.layout,
          phoneConnected: this.phone.session.connected(),
        }),
      );
      return;
    }
    if (req.method === 'GET' && path === '/frame') {
      if (!this.stream) throw new Error('Select a camera first');
      const frame = await this.stream.getFrame({
        fresh: true,
        timeoutMs: 10_000,
      });
      res.setHeader('Content-Type', 'image/jpeg');
      res.end(frame.jpeg);
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    // A capability URL is not enough for mutations: require a non-simple header.
    if (req.headers['x-midscene-setup'] !== this.id) {
      res.writeHead(403).end();
      return;
    }
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 65536) throw new Error('Request too large');
    }
    const value = JSON.parse(body || '{}');
    const operation = this.pending.then(async () => {
      if (this.closing || this.settled)
        throw new Error('Camera setup finished');
      if (path === '/select') {
        if (this.options.cameraId && value.cameraId !== this.options.cameraId)
          throw new Error('Select the camera requested by the script');
        await this.releaseStream();
        const devices = await listCameras({ includeBuiltIn: true });
        const camera = devices.find((device) => device.id === value.cameraId);
        if (!camera) throw new Error('Camera not found');
        this.stream = this.streams.findByDevice(camera.id);
        this.ownsStream = !this.stream;
        this.stream ??= await this.streams.create({
          deviceId: camera.id,
          ...camera.defaultCaptureSettings,
        });
        await this.stream.getFrame({ timeoutMs: 15_000 });
        res.setHeader('Content-Type', 'application/json');
        res.end('{}');
        return;
      }
      if (path === '/markers') {
        if (!this.stream) throw new Error('Select a camera first');
        const layout = structuredClone(
          this.phone.session.assertConnected().layout,
        );
        const correction = await detectScreenFromMarkers(
          async () => (await this.stream!.getFrame({ fresh: true })).jpeg,
          layout,
        );
        if (!sameLayout(layout, this.phone.session.assertConnected().layout))
          throw new Error('The phone page changed during marker detection');
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            correction,
            width: Math.min(
              4096,
              Math.max(180, Math.round(layout.screen.width)),
            ),
            height: Math.min(
              4096,
              Math.max(180, Math.round(layout.screen.height)),
            ),
          }),
        );
        return;
      }
      if (path === '/preview' || path === '/confirm' || path === '/check') {
        if (!this.stream) throw new Error('Select a camera first');
        const settings = value as CameraScreenSettings;
        if (settings.cameraId !== this.stream.deviceId)
          throw new Error('Camera changed');
        validateQuad(settings.correction.points);
        resolveRotation(settings.correction.rotation);
        const frame = await this.stream.getFrame();
        const metadata = await sharp(frame.jpeg).metadata();
        if (
          settings.correction.sourceWidth !== metadata.width ||
          settings.correction.sourceHeight !== metadata.height
        )
          throw new Error('Camera resolution changed; reload the preview');
        if (
          Object.values(settings.correction.points).some(
            (p) =>
              p.x < 0 ||
              p.y < 0 ||
              p.x >= metadata.width! ||
              p.y >= metadata.height!,
          )
        )
          throw new Error('Screen corners must be inside the camera frame');
        const capture = this.stream.getOptions();
        settings.capture = {
          width: capture.width,
          height: capture.height,
          fps: capture.fps,
        };
        const settingsKey = JSON.stringify([this.stream.id, settings]);
        if (path === '/confirm' && this.validatedSettings === settingsKey) {
          await this.confirm(settings, res);
          return;
        }
        // Transform also validates output dimensions and pixel budget.
        const jpeg = await new PerspectiveTransformer().transform(frame.jpeg, {
          points: settings.correction.points,
          rotation: settings.correction.rotation,
          targetWidth: settings.width,
          targetHeight: settings.height,
        });
        if (path === '/preview') {
          res.setHeader('Content-Type', 'image/jpeg');
          res.end(jpeg);
          return;
        }
        const layout = structuredClone(
          this.phone.session.assertConnected().layout,
        );
        const { accuracy } = await detectCalibrationMarkers(
          jpeg,
          layout.markers,
        );
        if (!sameLayout(layout, this.phone.session.assertConnected().layout))
          throw new Error('The phone page changed during marker detection');
        for (const [label, quality, purpose] of [
          ['Fit', accuracy.fit, 'fit'],
          ['Independent check', accuracy.validation, 'check'],
        ] as const) {
          if (
            quality.count !==
              layout.markers.filter((marker) => marker.purpose === purpose)
                .length ||
            quality.count === 0 ||
            quality.meanErrorCssPx > 2 ||
            quality.maxErrorCssPx > 3
          ) {
            throw new Error(
              `${label} error: keep all screen markers visible and aligned.`,
            );
          }
        }
        if (path === '/check') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ accuracy }));
          return;
        }
        if (this.options.reuseValidatedSettings)
          this.validatedSettings = settingsKey;
        await this.confirm(settings, res);
        return;
      }
      if (path === '/cancel') {
        this.settled = true;
        this.reject(new Error('Camera setup cancelled'));
        res.end('{}');
        return;
      }
      res.writeHead(404).end();
    });
    this.pending = operation.catch(() => undefined);
    await operation;
  }

  private async confirm(settings: CameraScreenSettings, res: ServerResponse) {
    await this.options.onConfirm(settings, this.confirmationPreview());
    await this.releaseStream();
    this.settled = true;
    this.resolve(settings);
    res.setHeader('Content-Type', 'application/json');
    res.end('{}');
  }

  private confirmationPreview(): CameraSetupPreview | undefined {
    const stream = this.stream;
    if (!stream || !this.ownsStream) return;
    // The editor owns capture until the caller has successfully opened a session.
    let transferred = false;
    return {
      stream,
      transfer: () => {
        this.ownsStream = false;
        transferred = true;
      },
      release: async () => {
        if (transferred) await this.streams.delete(stream.id);
      },
    };
  }

  private async releaseStream() {
    if (this.stream && this.ownsStream)
      await this.streams.delete(this.stream.id);
    this.stream = undefined;
    this.ownsStream = false;
    this.validatedSettings = undefined;
  }

  async close() {
    if (this.closing) return;
    this.closing = true;
    if (!this.settled) {
      this.settled = true;
      this.reject(new Error('Camera setup closed'));
    }
    await this.pending;
    try {
      await this.releaseStream();
    } finally {
      if (!this.options.phone) await this.phone.close();
    }
  }
}

export function createCameraSetup(options: CameraSetupOptions) {
  return new CameraSetupSession(options);
}
