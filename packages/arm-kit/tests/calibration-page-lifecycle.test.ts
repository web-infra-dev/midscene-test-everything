import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it, rstest } from '@rstest/core';
import { runCalibrationPage } from '../src/calibration-server/standalone.js';
import { CalibrationWorkflow } from '../src/calibration/workflow.js';
import type { CameraSession } from '../src/camera/session.js';
import { CameraSessionManager } from '../src/camera/session.js';
import { ArmController } from '../src/controller.js';
import { RobotArmDevice } from '../src/device.js';
import { fixture } from './fixtures.js';

it('returns the saved result even when a review heartbeat follows Finish', async () => {
  const f = await fixture();
  await f.runtime.shutdown();
  const arm = new ArmController({ adapter: f.adapter, profileStore: f.store });
  await arm.connect();
  const abort = new AbortController();
  let listening!: (url: string) => void;
  const ready = new Promise<string>((resolve) => {
    listening = resolve;
  });
  await writeFile(path.join(f.directory, 'index.html'), '<html></html>');
  const work = runCalibrationPage({
    arm,
    camera: {
      camera: { id: 'cam' },
      getCorrection: () => undefined,
    } as unknown as CameraSession,
    deviceId: 'cam',
    phoneHost: '127.0.0.1',
    open: false,
    staticDirectory: f.directory,
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
    onListening: listening,
  });
  const status = rstest.spyOn(CalibrationWorkflow.prototype, 'status');
  try {
    const url = await Promise.race([
      ready,
      work.then(() => {
        throw new Error('Page closed before listening');
      }),
    ]);
    const post = (path: string) =>
      fetch(new URL(path, url), { method: 'POST' });
    expect((await post('_calibration/page?review')).status).toBe(204);
    expect((await post('_calibration/finish')).status).toBe(409);
    status.mockReturnValue({
      id: 'saved-run',
      stage: 'completed',
      result: f.calibration,
      phoneConnected: false,
      samples: 0,
      points: [],
      anchors: [],
      verification: [],
    });
    expect((await post('_calibration/finish')).status).toBe(204);
    // The server may have already returned the result by the time the heartbeat arrives.
    await post('_calibration/page?review').catch(() => undefined);
    await expect(work).resolves.toEqual(f.calibration);
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    abort.abort();
    await work.catch(() => undefined);
    status.mockRestore();
    await arm.close();
    await f.cleanup();
  }
});

it('expires abandoned standalone pages, closes the server and releases Device ownership on destroy', async () => {
  const f = await fixture();
  await f.runtime.shutdown();
  const directory = await mkdtemp(path.join(tmpdir(), 'calibration-page-'));
  await writeFile(
    path.join(directory, 'index.html'),
    '<html>Calibration</html>',
  );
  const arm = new ArmController({ adapter: f.adapter, profileStore: f.store });
  const owners = new Set<string>();
  class Cameras extends CameraSessionManager {
    override async acquire(_camera: string, owner: string) {
      owners.add(owner);
      return {
        camera: { id: 'fresh-camera', name: 'Camera' },
        stream: { getInfo: () => ({ state: 'running' }) },
        getCorrection: () => undefined,
      } as unknown as CameraSession;
    }
    override async release(_camera: string, owner: string) {
      owners.delete(owner);
    }
  }
  const device = new RobotArmDevice({
    arm,
    camera: 'fresh-camera',
    cameraManager: new Cameras(),
  });
  const abort = new AbortController();
  let listening!: (url: string) => void;
  const ready = new Promise<string>((resolve) => {
    listening = resolve;
  });
  const previous = f.store.getCalibration(f.calibration.id);
  const work = device
    .calibrate({
      open: false,
      staticDirectory: directory,
      pageTimeoutMs: 300,
      pageStartTimeoutMs: 5000,
      onListening: listening,
      signal: abort.signal,
    })
    .then(
      () => undefined,
      (error: Error) => error,
    );
  try {
    const url = await Promise.race([
      ready,
      work.then((error) => {
        throw error;
      }),
    ]);
    const heartbeat = new URL('/_calibration/page', url);
    expect((await fetch(heartbeat)).status).toBe(405);
    expect(
      (
        await fetch(heartbeat, {
          method: 'POST',
          headers: { Origin: 'https://example.com' },
        })
      ).status,
    ).toBe(403);
    expect((await fetch(heartbeat, { method: 'POST' })).status).toBe(204);
    await delay(150);
    expect((await fetch(heartbeat, { method: 'POST' })).status).toBe(204);
    // Loading assets/configuration is not a heartbeat and cannot preserve an abandoned page.
    expect((await fetch(url)).status).toBe(200);
    const result = await work;
    expect(result?.message).toContain('page disconnected');
    await expect(fetch(url)).rejects.toThrow();
    expect(f.store.getCalibration(f.calibration.id)).toEqual(previous);
    expect(f.store.deviceBinding('fresh-camera')).toBeUndefined();
    expect(f.adapter.movements).toHaveLength(0);
    await device.destroy();
    expect(owners.size).toBe(0);
    expect((await arm.getState()).connected).toBe(true);
  } finally {
    abort.abort();
    await work;
    await device.destroy();
    await arm.close();
    await f.cleanup();
    await rm(directory, { recursive: true, force: true });
  }
});
