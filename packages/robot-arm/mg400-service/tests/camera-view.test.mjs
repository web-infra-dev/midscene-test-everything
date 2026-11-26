import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from '@rstest/core';
import {
  clearStandaloneCorrection,
  registerClientPreview,
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
    writeHead(_status, headers) {
      this.headersSent = true;
      this.headers = headers;
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
    camera: {
      camera: { id: 'camera', name: 'Camera', backend: 'avfoundation' },
      stream,
      getRectifiedPreviewTarget: () => ({
        width: 400,
        height: 800,
        rotation: 0,
      }),
      rectifiedFrame: async () => {
        calls++;
        return Buffer.from('corrected');
      },
    },
  };
  return { stream, res, entry, calls: () => calls };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('raw preview keeps camera pixels and respects response backpressure', async () => {
  const f = fixture();
  await streamCameraPreview(f.res, f.entry);
  assert.equal(f.res.headers.Connection, 'close');
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

test('corrected preview uses bounded concurrent transforms and preserves order', async () => {
  const f = fixture();
  const finishes = [];
  let calls = 0;
  f.entry.camera.rectifiedFrame = (jpeg) => {
    assert.equal(jpeg.toString(), 'raw');
    calls++;
    return new Promise((resolve) => {
      finishes.push(resolve);
    });
  };
  await streamCameraPreview(f.res, f.entry, true);
  f.stream.emit('frame', { jpeg: Buffer.from('raw') });
  f.stream.emit('frame', { jpeg: Buffer.from('raw') });
  assert.equal(calls, 2);
  finishes[1](Buffer.from('corrected-2'));
  finishes[0](Buffer.from('corrected-1'));
  await tick();
  assert.ok(f.res.frames[0].includes('corrected-1'));
  assert.ok(f.res.frames[1].includes('corrected-2'));
  assert.ok(!f.res.frames[0].includes('raw'));
  f.stream.emit('stopped');
  assert.equal(f.stream.listenerCount('frame'), 0);
  assert.equal(f.res.writableEnded, true);
});

test('a capped corrected preview drops frames while a transform is pending', async () => {
  const f = fixture();
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  f.entry.camera.rectifiedFrame = () => {
    calls++;
    return pending;
  };
  await streamCameraPreview(f.res, f.entry, true, undefined, 'twin-test');
  f.stream.emit('frame', { jpeg: Buffer.from('first') });
  f.stream.emit('frame', { jpeg: Buffer.from('second') });
  assert.equal(calls, 1);
  finish(Buffer.from('corrected'));
  await tick();
  assert.equal(f.res.frames.length, 1);
  f.res.destroy();
});

test('missing perspective rejects corrected view before streaming; transform failure never falls back to raw', async () => {
  const f = fixture();
  const getTarget = f.entry.camera.getRectifiedPreviewTarget;
  f.entry.camera.getRectifiedPreviewTarget = () => undefined;
  await assert.rejects(
    streamCameraPreview(f.res, f.entry, true),
    /Save perspective correction/,
  );
  assert.equal(f.res.headersSent, undefined);
  f.entry.camera.getRectifiedPreviewTarget = getTarget;
  f.entry.camera.rectifiedFrame = async () => {
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
  f.entry.camera.rectifiedFrame = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  await streamCameraPreview(f.res, f.entry, true);
  f.stream.emit('frame', { jpeg: Buffer.from('raw') });
  f.res.destroy();
  finish(Buffer.from('corrected'));
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
      options: { maxSide: 1600, maxPixels: 1440000, sampling: 'bilinear' },
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

test('two viewers can share a camera and closing one only releases its lease', async () => {
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
  assert.equal(first.res.destroyed, false);
  first.res.destroy();
  await pendingFirst;
  assert.equal(owners, 1);
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
  const pageLayout = {
    revision: 1,
    width: 360,
    height: 761,
    topInset: 39,
    screen: { width: 360, height: 800, devicePixelRatio: 3 },
    markers: [],
  };
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
    async acquire(id, owner, screenId) {
      assert.equal(id, 'camera');
      owners.add(owner);
      return {
        checkCorrection: async (value, _jpeg, allowMismatch, layout) => {
          checked.push({ value, screenId, allowMismatch, layout });
          return { state: 'valid' };
        },
        setPerspective: async (value, nextTarget) =>
          saved.push({ correction: value, target: nextTarget, screenId }),
      };
    },
    async release(id, owner) {
      assert.equal(id, 'camera');
      assert.ok(owners.delete(owner));
    },
  };
  await saveStandaloneCorrection(
    cameras,
    'camera',
    correction,
    target,
    'right-screen',
    () => pageLayout,
  );
  assert.deepEqual(checked, [
    {
      value: correction,
      screenId: 'right-screen',
      allowMismatch: false,
      layout: pageLayout,
    },
  ]);
  assert.deepEqual(saved, [{ correction, target, screenId: 'right-screen' }]);
  assert.equal(owners.size, 0);
});

test('a manual camera-only correction saves when its outline no longer matches', async () => {
  const saved = [];
  const seen = [];
  const validity = { state: 'invalid', reasonCode: 'SHIFTED' };
  const correction = {
    sourceWidth: 1920,
    sourceHeight: 1080,
    rotation: 0,
    points: {
      topLeft: { x: 100, y: 100 },
      topRight: { x: 900, y: 100 },
      bottomRight: { x: 900, y: 500 },
      bottomLeft: { x: 100, y: 500 },
    },
  };
  const target = { width: 1080, height: 2400, rotation: 0 };
  const cameras = {
    async acquire() {
      return {
        checkCorrection: async (_value, _jpeg, allowMismatch) => {
          seen.push(allowMismatch);
          return validity;
        },
        setPerspective: async (value, nextTarget) =>
          saved.push({ correction: value, target: nextTarget }),
      };
    },
    async release() {},
  };
  const result = await saveStandaloneCorrection(
    cameras,
    'camera',
    correction,
    target,
    undefined,
    undefined,
    true,
  );
  assert.deepEqual(seen, [true]);
  assert.equal(result, validity);
  assert.deepEqual(saved, [{ correction, target }]);
});

test('camera-only correction clear does not need a camera lease', async () => {
  const cleared = [];
  const cameras = {
    async clearPerspective(id, screenId) {
      cleared.push({ id, screenId });
    },
  };
  await clearStandaloneCorrection(cameras, 'camera', 'right-screen');
  assert.deepEqual(cleared, [{ id: 'camera', screenId: 'right-screen' }]);
});

test('standalone corrected preview acquires the selected screen', async () => {
  const f = fixture();
  const acquired = [];
  const owners = new Set();
  const cameras = {
    async acquire(id, owner, screenId) {
      acquired.push({ id, screenId });
      owners.add(owner);
      return {
        stream: f.stream,
        getCorrection: () => ({
          sourceWidth: 2,
          sourceHeight: 2,
          rotation: 0,
          points: {
            topLeft: { x: 0, y: 0 },
            topRight: { x: 1, y: 0 },
            bottomRight: { x: 1, y: 1 },
            bottomLeft: { x: 0, y: 1 },
          },
        }),
        getPerspectiveTarget: () => ({ width: 2, height: 2, rotation: 0 }),
        rectifiedFrame: async () => Buffer.from('rectified'),
      };
    },
    async release(_id, owner) {
      owners.delete(owner);
    },
  };
  const pending = streamStandalonePreview(
    f.res,
    cameras,
    'camera',
    'corrected',
    'right-screen',
  );
  await tick();
  assert.deepEqual(acquired, [{ id: 'camera', screenId: 'right-screen' }]);
  f.res.destroy();
  await pending;
  assert.equal(owners.size, 0);
});

test('a new preview from the same tab retires its previous multipart response', async () => {
  const first = fixture();
  const second = fixture();
  const cameras = {
    async acquire() {
      return first.entry.camera;
    },
    async release() {},
  };
  const pendingFirst = streamStandalonePreview(
    first.res,
    cameras,
    'camera',
    'raw',
    undefined,
    'tab-one',
  );
  await tick();
  const pendingSecond = streamStandalonePreview(
    second.res,
    cameras,
    'camera',
    'raw',
    undefined,
    'tab-one',
  );
  await tick();
  assert.equal(first.res.destroyed, true);
  assert.equal(first.res.writableEnded, true);
  assert.equal(second.res.destroyed, false);
  second.res.destroy();
  await Promise.all([pendingFirst, pendingSecond]);
});

test('different tabs keep their own connected preview', async () => {
  const first = fixture();
  const second = fixture();
  await streamCameraPreview(first.res, first.entry, false, 'tab-a');
  await streamCameraPreview(second.res, second.entry, false, 'tab-b');
  assert.equal(first.res.destroyed, false);
  assert.equal(second.res.destroyed, false);
  first.res.destroy();
  second.res.destroy();
});

test('a connected raw/corrected swap retires the same tab response', async () => {
  const raw = fixture();
  const corrected = fixture();
  await streamCameraPreview(raw.res, raw.entry, false, 'tab-swap');
  await streamCameraPreview(corrected.res, corrected.entry, true, 'tab-swap');
  assert.equal(raw.res.destroyed, true);
  assert.equal(corrected.res.destroyed, false);
  corrected.res.destroy();
});

test('simultaneous preview slots in one tab stay alive', async () => {
  const stage = fixture();
  const marker = fixture();
  await streamCameraPreview(
    stage.res,
    stage.entry,
    false,
    'tab-slots',
    'stage',
  );
  await streamCameraPreview(
    marker.res,
    marker.entry,
    false,
    'tab-slots',
    'marker',
  );
  assert.equal(stage.res.destroyed, false);
  assert.equal(marker.res.destroyed, false);
  stage.res.destroy();
  marker.res.destroy();
});

test('global preview registry caps one tab at four streams', () => {
  const first = fixture();
  const second = fixture();
  const third = fixture();
  const fourth = fixture();
  const fifth = fixture();
  registerClientPreview('tab-cap', 'first', first.res);
  registerClientPreview('tab-cap', 'second', second.res);
  assert.equal(first.res.destroyed, false);
  registerClientPreview('tab-cap', 'third', third.res);
  registerClientPreview('tab-cap', 'fourth', fourth.res);
  assert.equal(first.res.destroyed, false);
  assert.equal(second.res.destroyed, false);
  assert.equal(third.res.destroyed, false);
  assert.equal(fourth.res.destroyed, false);
  registerClientPreview('tab-cap', 'fifth', fifth.res);
  assert.equal(first.res.destroyed, true);
  assert.equal(first.res.writableEnded, true);
  assert.equal(second.res.destroyed, false);
  assert.equal(third.res.destroyed, false);
  assert.equal(fourth.res.destroyed, false);
  assert.equal(fifth.res.destroyed, false);
  const other = fixture();
  registerClientPreview('tab-other', 'first', other.res);
  assert.equal(other.res.destroyed, false);
  second.res.destroy();
  third.res.destroy();
  fourth.res.destroy();
  fifth.res.destroy();
  other.res.destroy();
});
