import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { afterAll, test } from '@rstest/core';
import sharp from 'sharp';
import {
  RectifiedPreviewPool,
  rectifiedPreviewPool,
} from '../dist/camera/rectified-preview-pool.js';
import { transformRectifiedPreview } from '../dist/camera/rectified-preview-transform.js';

afterAll(() => rectifiedPreviewPool.close());

class FakeWorker extends EventEmitter {
  readonly posts: Array<{ message: Record<string, unknown> }> = [];

  unref() {}

  postMessage(message: Record<string, unknown>) {
    this.posts.push({ message });
  }

  async terminate() {
    return 0;
  }
}

const request = {
  correction: {
    sourceWidth: 120,
    sourceHeight: 90,
    rotation: 0,
    points: {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 110, y: 10 },
      bottomRight: { x: 110, y: 80 },
      bottomLeft: { x: 10, y: 80 },
    },
  },
  target: { width: 120, height: 90, rotation: 0 },
  options: { maxSide: 80, sampling: 'bilinear' },
};

async function testJpeg() {
  return sharp({
    create: {
      width: 120,
      height: 90,
      channels: 3,
      background: { r: 30, g: 120, b: 210 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

test('preview workers preserve the main-thread rectification result', async () => {
  const jpeg = await testJpeg();
  const expected = await transformRectifiedPreview(jpeg, request);
  const actual = await rectifiedPreviewPool.transform(jpeg, request);
  assert.deepEqual(actual, expected);
  const metadata = await sharp(actual).metadata();
  assert.deepEqual([metadata.width, metadata.height], [80, 60]);
});

test('dispatches queued work after a worker fails', async () => {
  const workers: FakeWorker[] = [];
  const pool = new RectifiedPreviewPool(2, () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as never;
  });
  try {
    const failed = pool
      .transform(Buffer.from([1]), request)
      .catch((error) => error);
    const queued = pool.transform(Buffer.from([2]), request);

    assert.equal(workers.length, 1);
    assert.equal(workers[0].posts.length, 1);

    workers[0].emit('error', new Error('worker crashed'));
    assert.equal(workers.length, 2);
    assert.equal(workers[1].posts.length, 1);

    const next = workers[1].posts[0].message;
    workers[1].emit('message', {
      id: next.id,
      jpeg: Uint8Array.from([8, 9]),
    });

    assert.equal(((await failed) as Error).message, 'worker crashed');
    assert.deepEqual(await queued, Buffer.from([8, 9]));
  } finally {
    await pool.close();
  }
});

test('dispatches queued work after a worker exits with code zero', async () => {
  const workers: FakeWorker[] = [];
  const pool = new RectifiedPreviewPool(2, () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as never;
  });
  try {
    const exited = pool
      .transform(Buffer.from([1]), request)
      .catch((error) => error);
    const queued = pool.transform(Buffer.from([2]), request);

    workers[0].emit('exit', 0);
    assert.equal(workers.length, 2);
    assert.equal(workers[1].posts.length, 1);

    const next = workers[1].posts[0].message;
    workers[1].emit('message', {
      id: next.id,
      jpeg: Uint8Array.from([6, 7]),
    });

    assert.match(((await exited) as Error).message, /exited/);
    assert.deepEqual(await queued, Buffer.from([6, 7]));
  } finally {
    await pool.close();
  }
});

test('preserves RobotArmError metadata from a worker', async () => {
  const pool = new RectifiedPreviewPool(2);
  try {
    const error = await pool
      .transform(await testJpeg(), {
        ...request,
        correction: {
          ...request.correction,
          sourceWidth: request.correction.sourceWidth + 1,
        },
      })
      .catch((cause) => cause);
    assert.equal(error.name, 'RobotArmError');
    assert.equal(error.code, 'VISION_BINDING_CHANGED');
    assert.equal(error.status, 409);
  } finally {
    await pool.close();
  }
});
