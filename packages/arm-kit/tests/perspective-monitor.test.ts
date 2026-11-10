import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, rstest } from '@rstest/core';
import sharp from 'sharp';
import { PerspectiveMonitor } from '../src/camera/perspective-monitor.js';
import type { CameraFrame } from '../src/camera/types.js';
import type { CameraCorrection } from '../src/contracts.js';
import { SCREEN, renderFrame } from './fixtures/perspective-frame.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  rstest.useRealTimers();
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'outline-monitor-'));
  cleanups.push(() => rm(directory, { force: true, recursive: true }));
  const aligned = await renderFrame({ screen: SCREEN });
  const shifted = await renderFrame({
    screen: { ...SCREEN, x: SCREEN.x + 22 },
    quad: SCREEN,
  });
  const weak = await sharp({
    create: { width: 1280, height: 720, channels: 3, background: '#222222' },
  })
    .jpeg()
    .toBuffer();
  const correction: CameraCorrection = {
    points: aligned.points,
    sourceWidth: 1280,
    sourceHeight: 720,
    rotation: 0,
  };
  let frame: CameraFrame = {
    id: 1,
    capturedAt: Date.now(),
    jpeg: shifted.jpeg,
  };
  let key = 'mapping';
  const source = {
    file: () => join(directory, 'evidence.json'),
    key: () => key,
    correction: () => correction,
    referenceFrame: (): CameraFrame | undefined => frame,
    frame: rstest.fn(async () => frame),
  };
  const monitor = new PerspectiveMonitor(source);
  const next = (jpeg = frame.jpeg, at = Date.now(), id = frame.id + 1) => {
    frame = { id, capturedAt: at, jpeg };
  };
  return {
    monitor,
    source,
    aligned,
    shifted,
    weak,
    correction,
    next,
    changeKey: () => {
      key = 'new-mapping';
    },
  };
}
it('keeps observed evidence out of geometry, restores mismatch after reload, and retains it on weak frames', async () => {
  const f = await fixture();
  const before = structuredClone(f.correction);
  expect((await f.monitor.check())!.validity.state).toBe('invalid');
  expect(f.correction).toEqual(before);
  const restored = new PerspectiveMonitor(f.source);
  await restored.load();
  expect(restored.summary()?.state).toBe('invalid');
  f.next(f.weak);
  expect((await restored.check())!.validity).toMatchObject({
    state: 'invalid',
    temporal: { retainedMismatch: true, currentState: 'unverified' },
  });
  expect(
    JSON.parse(await readFile(f.source.file(), 'utf8')).validity.state,
  ).toBe('invalid');
});
it('requires distinct fresh aligned frames for stable recovery and does not clear mismatch on a duplicate frame', async () => {
  const f = await fixture();
  rstest.useFakeTimers({ now: Date.now() });
  await f.monitor.check();
  for (let i = 0; i < 3; i++) {
    rstest.advanceTimersByTime(750);
    f.next(f.aligned.jpeg);
    const state = (await f.monitor.check())!.validity.state;
    expect(state).toBe(i === 2 ? 'valid' : 'invalid');
    if (i === 0) {
      rstest.advanceTimersByTime(100);
      expect((await f.monitor.check())!.validity.state).toBe('invalid');
    }
  }
});
it('does not replace a measured mismatch on stale frames, camera errors or changed dimensions', async () => {
  const f = await fixture();
  await f.monitor.check();
  f.next(f.aligned.jpeg, Date.now() - 3000);
  await expect(f.monitor.check()).rejects.toMatchObject({
    code: 'VISION_UNAVAILABLE',
  });
  f.source.frame.mockRejectedValueOnce(new Error('camera disconnected'));
  await expect(f.monitor.check()).rejects.toThrow('camera disconnected');
  const wrongSize = await sharp(f.aligned.jpeg).resize(640, 360).toBuffer();
  f.next(wrongSize);
  await expect(f.monitor.check()).rejects.toMatchObject({
    code: 'VISION_BINDING_CHANGED',
  });
  expect(f.monitor.summary()?.state).toBe('invalid');
});
it('discards a late check when correction changes and allows a clean retry with the new mapping', async () => {
  const f = await fixture();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((done) => {
    entered = done;
  });
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const read = f.source.frame.getMockImplementation()!;
  f.source.frame.mockImplementationOnce(async () => {
    entered();
    await gate;
    return read();
  });
  const pending = f.monitor.check();
  const rejected = expect(pending).rejects.toMatchObject({
    code: 'VISION_BINDING_CHANGED',
  });
  await started;
  f.changeKey();
  await f.monitor.reset();
  release();
  await rejected;
  expect(f.monitor.summary()).toBeUndefined();
  f.next(f.aligned.jpeg);
  expect((await f.monitor.check())!.validity.state).toBe('valid');
});
it('shares concurrent checks while cancellation only rejects the cancelled observer', async () => {
  const f = await fixture();
  const abort = new AbortController();
  const first = f.monitor.check({ signal: abort.signal });
  const second = f.monitor.check();
  abort.abort();
  await expect(first).rejects.toThrow();
  expect((await second)!.validity.state).toBe('invalid');
  expect(f.source.frame).toHaveBeenCalledTimes(1);
});
it('expires positive evidence, retains confirmed mismatch, and drops evidence after mapping changes', async () => {
  const f = await fixture();
  rstest.useFakeTimers({ now: Date.now() });
  f.next(f.aligned.jpeg);
  await f.monitor.check();
  rstest.advanceTimersByTime(31 * 60_000);
  expect(f.monitor.summary()).toMatchObject({
    state: 'unverified',
    expired: true,
  });
  f.next(f.shifted.jpeg);
  await f.monitor.check();
  rstest.advanceTimersByTime(31 * 60_000);
  expect(f.monitor.summary()).toMatchObject({
    state: 'invalid',
    expired: true,
  });
  f.changeKey();
  expect(f.monitor.summary()).toBeUndefined();
});

it('uses only phone-confirmed frames and retains a confirmed mismatch while the phone is away', async () => {
  const f = await fixture();
  const reference = f.source.referenceFrame;
  f.source.referenceFrame = () => undefined;
  expect(await f.monitor.check()).toBeUndefined();
  await f.monitor.assertCurrent();
  expect(f.monitor.summary()).toBeUndefined();
  f.source.referenceFrame = reference;
  await expect(f.monitor.assertCurrent()).rejects.toMatchObject({
    code: 'CALIBRATION_MISMATCH',
  });
  f.next(f.aligned.jpeg);
  f.source.referenceFrame = () => undefined;
  expect(await f.monitor.check()).toBeUndefined();
  await expect(f.monitor.assertCurrent()).rejects.toMatchObject({
    code: 'CALIBRATION_MISMATCH',
  });
  f.next(f.aligned.jpeg, Date.now() - 3000);
  await expect(f.monitor.assertCurrent()).rejects.toMatchObject({
    code: 'VISION_UNAVAILABLE',
  });
});
