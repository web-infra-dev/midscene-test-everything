import assert from 'node:assert/strict';
import type {
  CameraStream,
  CameraStreamManager,
} from '@midscene/robotics-vision';
import { test } from '@rstest/core';
import { CameraPreviews } from '../dist/host/camera-previews.js';

function cameraManager() {
  const streams = new Map<
    string,
    { id: string; deviceId: string; getFrame: () => Promise<{ jpeg: Buffer }> }
  >();
  let sequence = 0;
  return {
    streams,
    async create({ deviceId }: { deviceId: string }) {
      if ([...streams.values()].some((s) => s.deviceId === deviceId))
        throw Error('Camera already owned');
      const stream = {
        id: String(++sequence),
        deviceId,
        getFrame: async () => ({ jpeg: Buffer.from(deviceId) }),
      };
      streams.set(stream.id, stream);
      return stream;
    },
    async delete(id: string) {
      assert.ok(streams.delete(id));
    },
  };
}

test('preview releases its camera before calibration takes ownership', async () => {
  const cameras = cameraManager();
  const previews = new CameraPreviews(
    cameras as unknown as CameraStreamManager,
  );
  const preview = await previews.open('camera-a');
  assert.equal(
    Buffer.from((await previews.frame(preview.id)).jpeg, 'base64').toString(),
    'camera-a',
  );
  await assert.rejects(cameras.create({ deviceId: 'camera-a' }), /owned/);
  await previews.release(preview.id);
  await previews.release(preview.id);
  const calibration = await cameras.create({ deviceId: 'camera-a' });
  await previews.close();
  assert.ok(
    cameras.streams.has(calibration.id),
    'preview cleanup must not close calibration streams',
  );
});

test('only abandoned previews expire; reading frames renews the lease', async () => {
  let time = 0;
  const cameras = cameraManager();
  const previews = new CameraPreviews(
    cameras as unknown as CameraStreamManager,
    () => time,
  );
  const abandoned = await previews.open('camera-a');
  const active = await previews.open('camera-b');
  time = 25000;
  await previews.frame(active.id);
  time = 31000;
  await previews.sweep();
  await assert.rejects(previews.frame(abandoned.id), /expired/);
  assert.equal(cameras.streams.size, 1);
  await previews.close();
  assert.equal(cameras.streams.size, 0);
});

test('closing during camera startup waits and releases the late stream', async () => {
  let finish!: (stream: CameraStream) => void;
  const released: string[] = [];
  const previews = new CameraPreviews({
    create: () =>
      new Promise<CameraStream>((resolve) => {
        finish = resolve;
      }),
    delete: async (id: string) => {
      released.push(id);
    },
  } as unknown as CameraStreamManager);
  const opening = previews.open('slow-camera');
  const closing = previews.close();
  finish({ id: 'late-stream' } as CameraStream);
  const { id } = await opening;
  await closing;
  assert.deepEqual(released, ['late-stream']);
  await assert.rejects(previews.frame(id), /expired/);
});
