import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, rstest } from '@rstest/core';
import { CameraSessionManager } from '../src/camera/session.js';
import type { CameraBackend, CameraSource } from '../src/camera/types.js';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'arm-camera-test-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const closes: ReturnType<typeof rstest.fn>[] = [];
  const backend: CameraBackend = {
    listDevices: async () => [
      { id: 'camera', name: 'Camera', backend: 'avfoundation' },
    ],
    openStream: rstest.fn(async () => {
      const source = new EventEmitter() as CameraSource;
      source.close = rstest.fn(async () => {});
      closes.push(source.close as ReturnType<typeof rstest.fn>);
      return source;
    }),
  };
  const manager = new CameraSessionManager(backend, directory);
  cleanup.push(() => manager.close());
  return { manager, backend, closes };
}
it('shares one source and keeps it alive until the last device releases it', async () => {
  const { manager, backend, closes } = await fixture();
  const [a, b] = await Promise.all([
    manager.acquire('camera', 'a'),
    manager.acquire('camera', 'b'),
  ]);
  expect(a).toBe(b);
  expect(backend.openStream).toHaveBeenCalledTimes(1);
  await manager.release('camera', 'a');
  expect(closes[0]).not.toHaveBeenCalled();
  await manager.release('camera', 'b');
  expect(closes[0]).toHaveBeenCalledTimes(1);
});
it('waits for the old source to stop before reopening the same camera', async () => {
  const { manager, backend, closes } = await fixture();
  await manager.acquire('camera', 'a');
  const stopping = gate();
  closes[0].mockImplementation(() => stopping.promise);
  const released = manager.release('camera', 'a');
  const reopened = manager.acquire('camera', 'b');
  await rstest.waitFor(() => expect(closes[0]).toHaveBeenCalled());
  expect(backend.openStream).toHaveBeenCalledTimes(1);
  stopping.resolve();
  await released;
  await reopened;
  expect(backend.openStream).toHaveBeenCalledTimes(2);
});
it('close during discovery rejects acquisition without leaking a source', async () => {
  const { manager, backend, closes } = await fixture();
  const discovery = gate();
  const started = gate();
  backend.listDevices = async () => {
    started.resolve();
    await discovery.promise;
    return [{ id: 'camera', name: 'Camera', backend: 'avfoundation' }];
  };
  const acquisition = manager.acquire('camera', 'a');
  const rejected = expect(acquisition).rejects.toThrow('closed');
  await started.promise;
  const closed = manager.close();
  discovery.resolve();
  await rejected;
  await closed;
  expect(closes[0]).toHaveBeenCalledTimes(1);
  await expect(manager.acquire('camera', 'b')).rejects.toThrow('closed');
});
it('persists correction by camera identity and invalidates the binding when geometry changes', async () => {
  const { manager } = await fixture();
  const session = await manager.acquire('camera', 'a');
  const options = { cameraId: 'camera', width: 400, height: 800 };
  await expect(session.binding(options)).rejects.toThrow('Correct the camera');
  const correction = {
    sourceWidth: 1920,
    sourceHeight: 1080,
    rotation: 0 as const,
    points: {
      topLeft: { x: 100, y: 100 },
      topRight: { x: 500, y: 100 },
      bottomRight: { x: 500, y: 900 },
      bottomLeft: { x: 100, y: 900 },
    },
  };
  await session.setCorrection(correction);
  const first = await session.binding(options);
  expect(
    (await session.binding({ ...options, width: 800 })).fingerprint,
  ).not.toBe(first.fingerprint);
  correction.points.topLeft.x = 101;
  expect((await session.binding(options)).fingerprint).toBe(first.fingerprint);
  await manager.release('camera', 'a');
  const restored = await manager.acquire('camera', 'b');
  expect((await restored.binding(options)).fingerprint).toBe(first.fingerprint);
  await restored.setCorrection(correction);
  expect((await restored.binding(options)).fingerprint).not.toBe(
    first.fingerprint,
  );
});

it('persists the perspective output target with the camera correction', async () => {
  const { manager } = await fixture();
  const session = await manager.acquire('camera', 'a');
  const correction = {
    sourceWidth: 1920,
    sourceHeight: 1080,
    rotation: 0 as const,
    points: {
      topLeft: { x: 100, y: 100 },
      topRight: { x: 500, y: 100 },
      bottomRight: { x: 500, y: 900 },
      bottomLeft: { x: 100, y: 900 },
    },
  };
  const target = { width: 1080, height: 2400, rotation: 0 as const };
  await session.setPerspective(correction, target);
  expect(session.getPerspectiveTarget()).toEqual(target);
  await manager.release('camera', 'a');
  const restored = await manager.acquire('camera', 'b');
  expect(restored.getPerspectiveTarget()).toEqual(target);
  await restored.setCorrection({ ...correction, rotation: 90 });
  expect(restored.getPerspectiveTarget()).toEqual(target);
});

it('clears one screen correction while the other screens keep theirs', async () => {
  const { manager } = await fixture();
  const correction = {
    sourceWidth: 1920,
    sourceHeight: 1080,
    rotation: 0 as const,
    points: {
      topLeft: { x: 100, y: 100 },
      topRight: { x: 500, y: 100 },
      bottomRight: { x: 500, y: 900 },
      bottomLeft: { x: 100, y: 900 },
    },
  };
  const left = await manager.acquire('camera', 'left-owner', 'left');
  const right = await manager.acquire('camera', 'right-owner', 'right');
  await left.setCorrection(correction);
  await right.setCorrection(correction);
  await left.clearCorrection();
  expect(left.getCorrection()).toBeUndefined();
  expect(right.getCorrection()).toEqual(correction);
  await manager.release('camera', 'left-owner');
  const restored = await manager.acquire('camera', 'left-again', 'left');
  expect(restored.getCorrection()).toBeUndefined();
  expect(restored.hasSavedPerspective()).toBe(true);
  expect(await manager.persistedPerspective('camera', 'left')).toBeUndefined();
  await restored.setCorrection(correction);
  expect(restored.getCorrection()).toEqual(correction);
  await manager.release('camera', 'left-again');
  await manager.release('camera', 'right-owner');
});

it('reads a saved target without opening the camera and rectifies a live frame for preview', async () => {
  const { manager } = await fixture();
  const session = await manager.acquire('camera', 'a');
  const correction = {
    sourceWidth: 100,
    sourceHeight: 100,
    rotation: 0 as const,
    points: {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 90, y: 10 },
      bottomRight: { x: 90, y: 90 },
      bottomLeft: { x: 10, y: 90 },
    },
  };
  const target = { width: 40, height: 80, rotation: 0 as const };
  await session.setPerspective(correction, target);
  await manager.release('camera', 'a');
  // The stream is closed now; the list still needs the accepted output shape.
  expect(await manager.persistedPerspective('camera')).toEqual({
    correction,
    target,
  });
  expect(await manager.persistedPerspective('missing')).toBeUndefined();
  const { default: sharp } = await import('sharp');
  const jpeg = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 24, g: 120, b: 240 },
    },
  })
    .jpeg()
    .toBuffer();
  const restored = await manager.acquire('camera', 'b');
  const rectified = await restored.rectifiedFrame(jpeg);
  const metadata = await sharp(rectified).metadata();
  expect(metadata.width).toBe(40);
  expect(metadata.height).toBe(80);
  const preview = await restored.rectifiedFrame(jpeg, { maxSide: 20 });
  const previewMetadata = await sharp(preview).metadata();
  expect(previewMetadata.width).toBe(10);
  expect(previewMetadata.height).toBe(20);
  // The saved output target owns the preview rotation, so a sideways target
  // rotates the phone content even though the marker correction itself is 0.
  const quadrants = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="50" height="50" fill="#ff0000"/><rect x="50" width="50" height="50" fill="#00ff00"/><rect y="50" width="50" height="50" fill="#ffff00"/><rect x="50" y="50" width="50" height="50" fill="#0000ff"/></svg>`,
    ),
  )
    .jpeg({ quality: 100 })
    .toBuffer();
  await restored.setPerspective(correction, {
    width: 80,
    height: 80,
    rotation: 90,
  });
  const rotated = await sharp(
    await restored.rectifiedFrame(quadrants, { sampling: 'nearest' }),
  )
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offset = (10 * rotated.info.width + 10) * 3;
  expect(rotated.data[offset]).toBeGreaterThan(150);
  expect(rotated.data[offset + 1]).toBeGreaterThan(150);
  expect(rotated.data[offset + 2]).toBeLessThan(100);
  await expect(
    restored.rectifiedFrame(
      await sharp({
        create: {
          width: 120,
          height: 100,
          channels: 3,
          background: { r: 0, g: 0, b: 0 },
        },
      })
        .jpeg()
        .toBuffer(),
    ),
  ).rejects.toThrow('dimensions changed');
});

it('clears a saved perspective, its target and its evidence without opening the camera', async () => {
  const { manager, backend } = await fixture();
  const session = await manager.acquire('camera', 'a');
  const correction = {
    sourceWidth: 100,
    sourceHeight: 100,
    rotation: 0 as const,
    points: {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 90, y: 10 },
      bottomRight: { x: 90, y: 90 },
      bottomLeft: { x: 10, y: 90 },
    },
  };
  await session.setPerspective(correction, {
    width: 40,
    height: 80,
    rotation: 0,
  });
  await manager.clearPerspective('camera');
  expect(session.getCorrection()).toBeUndefined();
  expect(session.hasSavedPerspective()).toBe(false);
  expect(session.getPerspectiveTarget()).toBeUndefined();
  expect(await manager.persistedPerspective('camera')).toBeUndefined();
  await manager.release('camera', 'a');
  expect(backend.openStream).toHaveBeenCalledTimes(1);
  // Clearing an already-clear camera is idempotent and must not start it.
  await manager.clearPerspective('camera');
  expect(backend.openStream).toHaveBeenCalledTimes(1);
  expect(await manager.persistedPerspective('camera')).toBeUndefined();
});

it('clears while the camera is still opening instead of queueing behind it', async () => {
  const { manager, backend } = await fixture();
  const discovery = gate();
  backend.listDevices = async () => {
    await discovery.promise;
    return [{ id: 'camera', name: 'Camera', backend: 'avfoundation' }];
  };
  const acquiring = manager.acquire('camera', 'a');
  // A serialized clear would wait for acquire; the operator needs it now.
  await manager.clearPerspective('camera');
  discovery.resolve();
  await acquiring;
});

it('bounds a capture process that never exits and keeps the camera queue usable', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'arm-camera-hang-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const backend: CameraBackend = {
    listDevices: async () => [
      { id: 'camera', name: 'Camera', backend: 'dshow' },
    ],
    openStream: rstest.fn(async () => {
      const source = new EventEmitter() as CameraSource;
      // ffmpeg can miss its exit notification on a wedged device driver.
      source.close = rstest.fn(() => new Promise<void>(() => {}));
      return source;
    }),
  };
  const manager = new CameraSessionManager(backend, directory, 25);
  cleanup.push(() => manager.close());
  await manager.acquire('camera', 'a');
  const started = Date.now();
  await manager.release('camera', 'a');
  expect(Date.now() - started).toBeLessThan(1_000);
  // The next viewer must get a fresh stream instead of the dead session.
  await manager.acquire('camera', 'b');
  expect(backend.openStream).toHaveBeenCalledTimes(2);
  await manager.release('camera', 'b');
});

it('isolates two screen corrections on one physical camera and restores each independently', async () => {
  const { manager, backend, closes } = await fixture();
  const a = await manager.acquire('camera', 'a', 'left');
  const b = await manager.acquire('camera', 'b', 'right');
  const aPreview = await manager.acquire('camera', 'preview', 'left');
  expect(a).toBe(aPreview);
  expect(a).not.toBe(b);
  expect(a.stream).toBe(b.stream);
  expect(backend.openStream).toHaveBeenCalledTimes(1);
  const correction = {
    sourceWidth: 1920,
    sourceHeight: 1080,
    rotation: 0 as const,
    points: {
      topLeft: { x: 100, y: 100 },
      topRight: { x: 500, y: 100 },
      bottomRight: { x: 500, y: 900 },
      bottomLeft: { x: 100, y: 900 },
    },
  };
  await a.setCorrection(correction);
  await b.setCorrection({
    ...correction,
    points: Object.fromEntries(
      Object.entries(correction.points).map(([key, value]) => [
        key,
        { ...value, x: value.x + 600 },
      ]),
    ) as typeof correction.points,
  });
  const first = await a.binding({
    cameraId: 'camera',
    width: 400,
    height: 800,
  });
  await b.setCorrection({ ...b.getCorrection()!, rotation: 90 });
  expect(
    (await a.binding({ cameraId: 'camera', width: 400, height: 800 }))
      .fingerprint,
  ).toBe(first.fingerprint);
  await manager.release('camera', 'a');
  await manager.release('camera', 'preview');
  expect(closes[0]).not.toHaveBeenCalled();
  await manager.release('camera', 'b');
  const restoredA = await manager.acquire('camera', 'new-a', 'left');
  const restoredB = await manager.acquire('camera', 'new-b', 'right');
  expect(restoredA.getCorrection()).toEqual(correction);
  expect(restoredB.getCorrection()?.rotation).toBe(90);
});
it('persists and clears a screen correction without touching the base camera', async () => {
  const { manager } = await fixture();
  const base = await manager.acquire('camera', 'base-owner');
  const left = await manager.acquire('camera', 'left-owner', 'left');
  const correction = {
    sourceWidth: 1920,
    sourceHeight: 1080,
    rotation: 0 as const,
    points: {
      topLeft: { x: 100, y: 100 },
      topRight: { x: 500, y: 100 },
      bottomRight: { x: 500, y: 900 },
      bottomLeft: { x: 100, y: 900 },
    },
  };
  const target = { width: 400, height: 800, rotation: 0 as const };
  await base.setPerspective(correction, target);
  await left.setCorrection({ ...correction, rotation: 90 });
  expect(await manager.persistedPerspective('camera')).toEqual({
    correction,
    target,
  });
  expect(await manager.persistedPerspective('camera', 'left')).toEqual({
    correction: { ...correction, rotation: 90 },
  });
  await manager.clearPerspective('camera', 'left');
  expect(left.getCorrection()).toBeUndefined();
  expect(await manager.persistedPerspective('camera', 'left')).toBeUndefined();
  expect(await manager.persistedPerspective('camera')).toEqual({
    correction,
    target,
  });
  expect(base.getCorrection()).toEqual(correction);
  await manager.clearPerspective('camera');
  expect(await manager.persistedPerspective('camera')).toBeUndefined();
});

it('rejects accepted vision evidence after the perspective changes or the camera identity differs', async () => {
  const { manager } = await fixture();
  const camera = await manager.acquire('camera', 'binding-test');
  await camera.setCorrection({
    sourceWidth: 1000,
    sourceHeight: 900,
    rotation: 0,
    points: {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 450, y: 10 },
      bottomRight: { x: 450, y: 850 },
      bottomLeft: { x: 10, y: 850 },
    },
  });
  const binding = await camera.binding({
    cameraId: 'camera',
    width: 400,
    height: 800,
  });
  expect(camera.isBindingCurrent(binding)).toBe(true);
  expect(
    camera.isBindingCurrent({ ...binding, cameraId: 'other-camera' }),
  ).toBe(false);
  await camera.setCorrection({ ...camera.getCorrection()!, rotation: 90 });
  expect(camera.isBindingCurrent(binding)).toBe(false);
});

it('isolates drift evidence per screen on the shared stream without changing mapping fingerprints', async () => {
  const { renderFrame } = await import('./fixtures/perspective-frame.js');
  const { manager, backend } = await fixture();
  const left = await manager.acquire('camera', 'left-owner', 'left');
  const right = await manager.acquire('camera', 'right-owner', 'right');
  const leftRect = { x: 100, y: 150, width: 330, height: 420 };
  const frame = await renderFrame({
    screen: { ...leftRect, x: leftRect.x + 22 },
    quad: leftRect,
    extra:
      '<rect x="786" y="136" width="358" height="448" rx="26" fill="#141416"/><rect x="800" y="150" width="330" height="420" rx="16" fill="#3f3f4a"/>',
  });
  await left.setCorrection({
    points: frame.points,
    sourceWidth: frame.sourceWidth,
    sourceHeight: frame.sourceHeight,
    rotation: 0,
  });
  await right.setCorrection({
    sourceWidth: 1280,
    sourceHeight: 720,
    rotation: 0,
    points: {
      topLeft: { x: 800, y: 150 },
      topRight: { x: 1130, y: 150 },
      bottomRight: { x: 1130, y: 570 },
      bottomLeft: { x: 800, y: 570 },
    },
  });
  const options = { cameraId: 'camera', width: 400, height: 800 };
  const before = await left.binding(options);
  const source = await (backend.openStream as ReturnType<typeof rstest.fn>).mock
    .results[0].value;
  source.emit('frame', frame.jpeg);
  expect((await left.checkPerspective()).validity.state).toBe('invalid');
  expect((await right.checkPerspective()).validity.state).toBe('valid');
  const after = await left.binding(options);
  expect(after.fingerprint).toBe(before.fingerprint);
  expect(after.validity?.state).toBe('invalid');
  expect(left.isBindingCurrent(before)).toBe(false);
  expect(right.isBindingCurrent(await right.binding(options))).toBe(true);
});
