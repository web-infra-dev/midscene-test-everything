import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { calibrationPageMarkers } from '@midscene/robotics-shared/assisted-contracts';
import { test } from '@rstest/core';
import sharp from 'sharp';
import { markerSvg } from '../dist/camera/calibration-markers.js';
import type { CameraStreamManager } from '../dist/camera/camera-stream-manager.js';
import type { CameraStream } from '../dist/camera/camera-stream.js';
import { ScreenPhoneServer } from '../dist/phone/server.js';
import type { CameraSetupPreview } from '../dist/setup/session.js';
import { CameraSetupSession } from '../dist/setup/session.js';

function request(session: CameraSetupSession, body: unknown) {
  return Object.assign(Readable.from([JSON.stringify(body)]), {
    method: 'POST',
    headers: { 'x-midscene-setup': session.id },
  }) as unknown as IncomingMessage;
}
function response() {
  const res = {
    body: '',
    status: 200,
    setHeader() {},
    end(value: string) {
      this.body = value;
    },
    writeHead(code: number) {
      this.status = code;
      return this;
    },
  };
  return res as unknown as ServerResponse & { body: string; status: number };
}
test('AI detection uses a fresh raw frame and returns editable corners without saving credentials', async () => {
  const jpeg = await sharp({
    create: { width: 600, height: 800, channels: 3, background: 'white' },
  })
    .jpeg()
    .toBuffer();
  const config = {
    modelName: 'mock',
    modelFamily: 'qwen3.6',
    baseUrl: 'http://model.test',
    apiKey: 'test-only-key',
  };
  const points = {
    topLeft: { x: 50, y: 50 },
    topRight: { x: 550, y: 50 },
    bottomRight: { x: 550, y: 750 },
    bottomLeft: { x: 50, y: 750 },
  };
  let called = false;
  let saved = false;
  const session = new CameraSetupSession({
    onConfirm: async () => {
      saved = true;
    },
    screenDetector: async (bytes, model) => {
      called = true;
      assert.deepEqual(bytes, jpeg);
      assert.deepEqual(model, config);
      return {
        points,
        attempt: {
          input: {
            jpegBase64: jpeg.toString('base64'),
            width: 600,
            height: 800,
            prompt: 'test',
            modelName: config.modelName,
            modelFamily: config.modelFamily,
          },
        },
      };
    },
  });
  // biome-ignore lint/complexity/useLiteralKeys: Bracket access preserves type checking for non-public test hooks.
  session['stream'] = {
    getFrame: async (options: { fresh?: boolean } = {}) => {
      assert.equal(options.fresh, true);
      return { jpeg };
    },
  } as CameraStream;
  const res = response();
  await session.handle(
    request(session, { modelConfig: config }),
    res,
    '/detect',
  );
  assert.equal(called, true);
  assert.equal(saved, false);
  assert.deepEqual(JSON.parse(res.body), {
    sourceWidth: 600,
    sourceHeight: 800,
    rotation: 0,
    points,
  });
  assert.ok(!res.body.includes(config.apiKey));
  await session.close();
});
test('rejects malformed model settings before invoking AI', async () => {
  const session = new CameraSetupSession({
    onConfirm: async () => {},
    screenDetector: async () => {
      assert.fail('must not invoke AI');
    },
  });
  // biome-ignore lint/complexity/useLiteralKeys: Bracket access preserves type checking for non-public test hooks.
  session['stream'] = {} as CameraStream;
  await assert.rejects(
    session.handle(
      request(session, { modelConfig: { apiKey: 123 } }),
      response(),
      '/detect',
    ),
    /Invalid detection model/,
  );
  await session.close();
});

test('failed confirmation keeps capture available and retry can transfer it without rescanning', async () => {
  const width = 400;
  const height = 800;
  const markers = calibrationPageMarkers(width, height);
  const svg = markers
    .map((marker) =>
      markerSvg(marker.code).replace(
        '<svg ',
        `<svg x="${marker.x - marker.size / 2}" y="${marker.y - marker.size / 2}" width="${marker.size}" height="${marker.size}" `,
      ),
    )
    .join('');
  const jpeg = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/>${svg}</svg>`,
    ),
  )
    .jpeg()
    .toBuffer();
  const phone = new ScreenPhoneServer();
  phone.receivePhone({
    pageId: phone.session.openPage(),
    sequence: 1,
    visible: true,
    layout: {
      revision: 1,
      width,
      height,
      screen: { width, height, devicePixelRatio: 2 },
      markers,
    },
  });
  const stream = {
    id: 'capture',
    deviceId: 'camera',
    getFrame: async () => ({ jpeg }),
    getOptions: () => ({ width, height, fps: 30 }),
  } as unknown as CameraStream;
  let stopped = 0;
  let attempts = 0;
  let transferred: CameraSetupPreview | undefined;
  const session = new CameraSetupSession({
    phone,
    streams: {
      async delete(id: string) {
        assert.equal(id, stream.id);
        stopped++;
      },
    } as CameraStreamManager,
    reuseValidatedSettings: true,
    async onConfirm(_settings, preview) {
      assert.ok(preview);
      assert.equal(preview.stream, stream);
      if (++attempts === 1) {
        await preview.release();
        throw new Error('Pointer verification failed');
      }
      preview.transfer();
      transferred = preview;
    },
  });
  // biome-ignore lint/complexity/useLiteralKeys: Inject capture without opening hardware.
  session['stream'] = stream;
  // biome-ignore lint/complexity/useLiteralKeys: The setup owns this test capture.
  session['ownsStream'] = true;
  const settings = {
    cameraId: 'camera',
    width,
    height,
    correction: {
      sourceWidth: width,
      sourceHeight: height,
      rotation: 0,
      points: {
        topLeft: { x: 0, y: 0 },
        topRight: { x: width - 1, y: 0 },
        bottomRight: { x: width - 1, y: height - 1 },
        bottomLeft: { x: 0, y: height - 1 },
      },
    },
  };
  const confirm = (value: unknown) =>
    session.handle(request(session, value), response(), '/confirm');
  try {
    await assert.rejects(confirm(settings), /Pointer verification failed/);
    assert.equal(stopped, 0);
    const frame = response();
    await session.handle({ method: 'GET' } as IncomingMessage, frame, '/frame');
    assert.equal(frame.body, jpeg);
    phone.disconnectPhone();
    await assert.rejects(
      confirm({ ...settings, width: width + 1 }),
      /Keep the phone calibration page visible/,
    );
    await confirm(settings);
    assert.equal((await session.result).cameraId, settings.cameraId);
    assert.equal(attempts, 2);
  } finally {
    await session.close();
    await phone.close();
  }
  assert.equal(stopped, 0);
  await transferred?.release();
  assert.equal(stopped, 1);
});
