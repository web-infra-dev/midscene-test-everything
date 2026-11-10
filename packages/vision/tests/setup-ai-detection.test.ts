import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { test } from '@rstest/core';
import sharp from 'sharp';
import type { CameraStream } from '../dist/camera/camera-stream.js';
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
