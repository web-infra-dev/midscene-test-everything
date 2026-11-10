import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CameraSessionManager } from '@midscene/arm-kit';
import type { CameraBackend } from '@midscene/arm-kit';
import { cameraPerspectiveFile } from '@midscene/arm-kit/internal/camera/session';
import { expect, it } from '@rstest/core';
import {
  BASE_SCREEN_ID,
  MAX_CAMERA_SCREENS,
  addCameraScreen,
  assertCameraScreen,
  listCameraScreens,
  removeCameraScreen,
} from '../src/server/camera-screens';

const backend = {
  listDevices: async () => [],
  openStream: async () => {
    throw new Error('not used by this test');
  },
} as unknown as CameraBackend;

it('keeps the base screen and persists named screens per camera', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'camera-screens-'));
  const cameras = new CameraSessionManager(backend, directory);
  try {
    const base = await listCameraScreens(cameras, 'camera');
    expect(base).toHaveLength(1);
    expect(base[0]).toMatchObject({
      id: BASE_SCREEN_ID,
      name: 'Screen 1',
      base: true,
      hasCorrection: false,
    });

    const second = await addCameraScreen(cameras, 'camera');
    const third = await addCameraScreen(cameras, 'camera', 'Right phone');
    expect(second).toMatchObject({ base: false, name: 'Screen 2' });
    expect(third).toMatchObject({ base: false, name: 'Right phone' });
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
    await mkdir(directory, { recursive: true });
    await writeFile(
      cameraPerspectiveFile(directory, 'camera', third.id),
      JSON.stringify({
        cameraId: 'camera',
        correction,
        perspectiveTarget: target,
      }),
    );
    expect(await listCameraScreens(cameras, 'camera')).toMatchObject([
      { id: BASE_SCREEN_ID, hasCorrection: false },
      { id: second.id, hasCorrection: false },
      {
        id: third.id,
        hasCorrection: true,
        correction,
        perspectiveTarget: target,
      },
    ]);

    await removeCameraScreen(cameras, 'camera', second.id);
    expect(await listCameraScreens(cameras, 'camera')).toMatchObject([
      { id: BASE_SCREEN_ID },
      { id: third.id },
    ]);
    await expect(
      removeCameraScreen(cameras, 'camera', second.id),
    ).rejects.toThrow('Screen not found');
    await expect(
      removeCameraScreen(cameras, 'camera', BASE_SCREEN_ID),
    ).rejects.toThrow('base screen');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('rejects screens beyond the marker-slot limit and unknown marker screens', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'camera-screens-'));
  const cameras = new CameraSessionManager(backend, directory);
  try {
    for (let index = 2; index <= MAX_CAMERA_SCREENS; index += 1)
      await addCameraScreen(cameras, 'camera');
    await expect(addCameraScreen(cameras, 'camera')).rejects.toMatchObject({
      status: 409,
    });
    await assertCameraScreen(cameras, 'camera');
    await assertCameraScreen(cameras, 'camera', BASE_SCREEN_ID);
    await expect(
      assertCameraScreen(cameras, 'camera', 'missing-screen'),
    ).rejects.toMatchObject({ status: 404 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
