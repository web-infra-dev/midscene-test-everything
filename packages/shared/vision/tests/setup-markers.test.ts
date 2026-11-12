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
  const margin = 40;
  const detectionFrame = await sharp(jpeg)
    .extend({
      top: margin,
      right: margin,
      bottom: margin,
      left: margin,
      background: '#aaa',
    })
    .jpeg()
    .toBuffer();
  let detecting = true;
  const stream = {
    id: 'capture',
    deviceId: 'camera',
    getFrame: async () => ({ jpeg: detecting ? detectionFrame : jpeg }),
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
    const detected = response();
    await session.handle(request(session, {}), detected, '/markers');
    detecting = false;
    const result = JSON.parse(detected.body);
    assert.equal(result.width, width);
    assert.equal(result.height, height);
    assert.ok(
      Math.hypot(
        result.correction.points.topLeft.x - margin,
        result.correction.points.topLeft.y - margin,
      ) < 5,
    );
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
