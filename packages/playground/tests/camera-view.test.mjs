import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from '@rstest/core';
import {
  clearStandaloneCorrection,
  saveStandaloneCorrection,
  streamCameraPreview,
  streamStandalonePreview,
} from '../src/server/camera-preview.ts';

function fixture() {
  const stream = new EventEmitter();
  const res = Object.assign(new EventEmitter(), {
    frames: [],
    destroyed: false,
    writableEnded: false,
    writable: true,
    writeHead() {
      this.headersSent = true;
    },
    write(data) {
      this.frames.push(data.toString());
      return this.writable;
    },
    end() {
      this.writableEnded = true;
      this.emit('close');
    },
    destroy() {
      this.destroyed = true;
      this.emit('close');
    },
  });
  let calls = 0;
  const entry = {
    camera: { stream },
    device: {
      configuration: async () => ({}),
      screenshotBase64: async () => {
        calls++;
        return Buffer.from('corrected').toString('base64');
      },
    },
  };
  return { stream, res, entry, calls: () => calls };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('raw preview keeps camera pixels and respects response backpressure', async () => {
  const f = fixture();
  await streamCameraPreview(f.res, f.entry);
  f.res.writable = false;
  f.stream.emit('frame', { jpeg: Buffer.from('raw') });
  f.stream.emit('frame', { jpeg: Buffer.from('dropped') });
  assert.equal(f.res.frames.length, 1);
  assert.ok(f.res.frames[0].includes('raw'));
  assert.equal(f.calls(), 0);
  f.res.emit('drain');
  f.stream.emit('frame', { jpeg: Buffer.from('next') });
  assert.equal(f.res.frames.length, 2);
  f.res.destroy();
  assert.equal(f.stream.listenerCount('frame'), 0);
});

test('corrected preview uses accepted device mapping and never queues parallel transforms', async () => {
  const f = fixture();
  let finish;
  let calls = 0;
  f.entry.device.screenshotBase64 = () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  await streamCameraPreview(f.res, f.entry, true);
  f.stream.emit('frame', { jpeg: Buffer.from('raw') });
  f.stream.emit('frame', { jpeg: Buffer.from('raw') });
  assert.equal(calls, 1);
  finish(Buffer.from('corrected').toString('base64'));
  await tick();
  assert.ok(f.res.frames[0].includes('corrected'));
  assert.ok(!f.res.frames[0].includes('raw'));
  f.stream.emit('stopped');
  assert.equal(f.stream.listenerCount('frame'), 0);
  assert.equal(f.res.writableEnded, true);
});

test('invalid calibration rejects corrected view before streaming; transform failure never falls back to raw', async () => {
  const f = fixture();
  f.entry.device.configuration = async () => {
    throw new Error('Calibration required');
  };
  await assert.rejects(
    streamCameraPreview(f.res, f.entry, true),
    /Calibration required/,
  );
  assert.equal(f.res.headersSent, undefined);
  f.entry.device.configuration = async () => ({});
  f.entry.device.screenshotBase64 = async () => {
    throw new Error('Mapping changed');
  };
  await streamCameraPreview(f.res, f.entry, true);
  f.stream.emit('frame', { jpeg: Buffer.from('raw') });
  await tick();
  assert.equal(f.res.destroyed, true);
  assert.equal(f.res.frames.length, 0);
  assert.equal(f.stream.listenerCount('frame'), 0);
});

test('closing a preview during correction discards the pending frame', async () => {
  const f = fixture();
  let finish;
  f.entry.device.screenshotBase64 = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  await streamCameraPreview(f.res, f.entry, true);
  f.stream.emit('frame', { jpeg: Buffer.from('raw') });
  f.res.destroy();
  finish(Buffer.from('corrected').toString('base64'));
  await tick();
  assert.equal(f.res.frames.length, 0);
});

test('camera-only MJPEG releases its lease when the viewer leaves, including during startup', async () => {
  for (const early of [false, true]) {
    const f = fixture();
    const owners = new Set();
    const cameras = {
      async acquire(id, owner) {
        assert.equal(id, 'camera');
        owners.add(owner);
        if (early) f.res.destroy();
        return f.entry.camera;
      },
      async release(id, owner) {
        assert.equal(id, 'camera');
        assert.ok(owners.delete(owner));
      },
    };
    const pending = streamStandalonePreview(f.res, cameras, 'camera');
    if (!early) {
      await tick();
      f.stream.emit('frame', { jpeg: Buffer.from('raw-preview') });
      assert.ok(f.res.frames[0].includes('raw-preview'));
      f.res.destroy();
    }
    await pending;
    assert.equal(owners.size, 0);
  }
});

test('camera-only corrected preview rectifies each frame with the saved target', async () => {
  const f = fixture();
  const owners = new Set();
  const rectified = [];
  const correction = {
    sourceWidth: 1920,
    sourceHeight: 1080,
    rotation: 0,
    points: {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 1000, y: 10 },
      bottomRight: { x: 1000, y: 500 },
      bottomLeft: { x: 10, y: 500 },
    },
  };
  const target = { width: 1080, height: 2400, rotation: 0 };
  const cameras = {
    async acquire(id, owner) {
      assert.equal(id, 'camera');
      owners.add(owner);
      return {
        stream: f.stream,
        getCorrection: () => correction,
        getPerspectiveTarget: () => target,
        rectifiedFrame: async (jpeg, options) => {
          rectified.push({ jpeg: jpeg.toString(), options });
          return Buffer.from('rectified');
        },
      };
    },
    async release(id, owner) {
      assert.equal(id, 'camera');
      assert.ok(owners.delete(owner));
    },
  };
  const pending = streamStandalonePreview(
    f.res,
    cameras,
    'camera',
    'corrected',
  );
  await tick();
  f.stream.emit('frame', { jpeg: Buffer.from('raw') });
  await tick();
  assert.deepEqual(rectified, [
    {
      jpeg: 'raw',
      options: { maxSide: 900, maxPixels: 450000, sampling: 'nearest' },
    },
  ]);
  assert.ok(f.res.frames[0].includes('rectified'));
  assert.ok(!f.res.frames[0].includes('raw'));
  f.stream.emit('stopped');
  assert.equal(f.res.writableEnded, true);
  await pending;
  assert.equal(owners.size, 0);
});

test('camera-only corrected preview requires a saved target before streaming', async () => {
  const f = fixture();
  const owners = new Set();
  const cameras = {
    async acquire(id, owner) {
      owners.add(owner);
      return {
        stream: f.stream,
        getCorrection: () => undefined,
        getPerspectiveTarget: () => undefined,
        rectifiedFrame: async () => Buffer.from('rectified'),
      };
    },
    async release(id, owner) {
      owners.delete(owner);
    },
  };
  await assert.rejects(
    streamStandalonePreview(f.res, cameras, 'camera', 'corrected'),
    /Save perspective correction/,
  );
  assert.equal(f.res.headersSent, undefined);
  assert.equal(f.res.frames.length, 0);
  assert.equal(owners.size, 0);
});

test('a new camera preview retires the previous multipart response', async () => {
  const first = fixture();
  const second = fixture();
  let owners = 0;
  const cameras = {
    async acquire(_id, _owner) {
      owners++;
      return first.entry.camera;
    },
    async release(_id, _owner) {
      owners--;
    },
  };
  const pendingFirst = streamStandalonePreview(first.res, cameras, 'camera');
  await tick();
  const pendingSecond = streamStandalonePreview(second.res, cameras, 'camera');
  await tick();
  assert.equal(first.res.destroyed, true);
  assert.equal(second.res.destroyed, false);
  second.res.destroy();
  await Promise.all([pendingFirst, pendingSecond]);
  assert.equal(owners, 0);
});

test('camera-only correction is checked and saved through a released lease', async () => {
  const owners = new Set();
  const checked = [];
  const saved = [];
  const target = { width: 1080, height: 2400, rotation: 0 };
  const correction = {
    sourceWidth: 1920,
    sourceHeight: 1080,
    rotation: 0,
    points: {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 1000, y: 10 },
      bottomRight: { x: 1000, y: 500 },
      bottomLeft: { x: 10, y: 500 },
    },
  };
  const cameras = {
    async acquire(id, owner) {
      assert.equal(id, 'camera');
      owners.add(owner);
      return {
        checkCorrection: async (value) => checked.push(value),
        setPerspective: async (value, nextTarget) =>
          saved.push({ correction: value, target: nextTarget }),
      };
    },
    async release(id, owner) {
      assert.equal(id, 'camera');
      assert.ok(owners.delete(owner));
    },
  };
  await saveStandaloneCorrection(cameras, 'camera', correction, target);
  assert.deepEqual(checked, [correction]);
  assert.deepEqual(saved, [{ correction, target }]);
  assert.equal(owners.size, 0);
});

test('camera-only correction clear does not need a camera lease', async () => {
  const cleared = [];
  const cameras = {
    async clearPerspective(id) {
      cleared.push(id);
    },
  };
  await clearStandaloneCorrection(cameras, 'camera');
  assert.deepEqual(cleared, ['camera']);
});
