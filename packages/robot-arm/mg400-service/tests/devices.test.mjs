import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { registerControllerRuntime } from '@midscene/arm-kit/internal/controller-runtime';
import { test } from '@rstest/core';
import { PlaygroundDevices } from '../src/server/devices.ts';

function fixture(pairings, screenTargets = []) {
  const acquisitions = [];
  const owners = new Map();
  let opens = 0;
  let closes = 0;
  let state;
  const camera = {
    camera: { id: 'a' },
    stream: { getInfo: () => ({ state: 'running' }) },
  };
  const cameras = {
    async acquire(id, owner, screenId) {
      acquisitions.push({ id, screenId });
      await delay(5);
      const set = owners.get(id) ?? new Set();
      if (!set.size) opens++;
      set.add(owner);
      owners.set(id, set);
      return camera;
    },
    async release(id, owner) {
      const set = owners.get(id);
      set?.delete(owner);
      if (set && !set.size) {
        closes++;
        owners.delete(id);
      }
    },
    async close() {
      assert.equal(owners.size, 0);
    },
  };
  const host = {
    prepare: async () => {},
    close: async () => {},
    service: {
      status: () => state,
      resetAttempt: () => {
        state = undefined;
      },
      stop: async () => {
        state = { stage: 'cancelled' };
      },
    },
  };
  class Host {
    constructor({ deviceId, camera }) {
      this.deviceId = deviceId;
      this.cameraId = camera.camera.id;
    }
    prepare = host.prepare;
    close = host.close;
    service = host.service;
  }
  class Device {
    constructor(options) {
      this.options = options;
      this.owner = {};
    }
    async connect() {
      await cameras.acquire(this.options.camera, this.owner);
    }
    withCalibration(interaction, signal) {
      this.pending = interaction(signal);
      return this.pending;
    }
    async destroy() {
      await this.pending?.catch(() => undefined);
      await cameras.release(this.options.camera, this.owner);
    }
  }
  const arm = {};
  registerControllerRuntime(arm, {
    // Calibration starts once a shared tool is configured for the arm, so the
    // stub has to answer that lookup; individual tests do not inspect it.
    profileStore: {
      list: () => ({ screenTargets }),
      sharedCalibrationTool: () => ({ toolProfileId: 'tool' }),
    },
  });
  const registry = new PlaygroundDevices(arm, {
    cameras,
    Device,
    Host,
    phoneLinks: () => [],
    pairings,
  });
  return {
    registry,
    acquisitions,
    owners,
    camera,
    get host() {
      return [...registry.entries.values()][0]?.host ?? host;
    },
    counts: () => ({ opens, closes }),
    complete: () => {
      state = { stage: 'completed', result: { id: 'saved' } };
    },
  };
}

test('preview and Device share one session; concurrent opens and stops do not leak owners', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([
    f.registry.open('a'),
    f.registry.open('a'),
  ]);
  assert.equal(a, b);
  assert.equal(a.camera, f.camera);
  assert.equal(f.owners.get('a').size, 2);
  await f.registry.open('b');
  await Promise.all([f.registry.stop('a'), f.registry.stop('a')]);
  assert.equal(f.owners.has('a'), false);
  assert.equal(f.owners.has('b'), true);
  await f.registry.close();
  assert.deepEqual(f.counts(), { opens: 2, closes: 2 });
});

test('reopening during stop waits for cleanup; closed registry rejects new leases', async () => {
  const f = fixture();
  await f.registry.open('a');
  const stopping = f.registry.stop('a');
  const reopened = f.registry.open('a');
  await stopping;
  await reopened;
  assert.equal(f.owners.get('a').size, 2);
  await f.registry.close();
  await assert.rejects(f.registry.open('a'), /closed/);
});

test('embedded calibration is owned by Device; phone token expires after completion', async () => {
  const f = fixture();
  await f.registry.startCalibration('a');
  const session = f.registry.entries.get('a').calibration;
  assert.equal(f.registry.phoneHost(session.token), f.host);
  assert.equal(f.registry.phoneHost('unknown'), undefined);
  f.complete();
  await session.pending;
  assert.equal(f.registry.status('a').phase, 'completed');
  assert.equal(f.registry.phoneHost(session.token), undefined);
  await f.registry.close();
});

test('cancelled and completed leases start fresh; old cancel requests cannot end the retry', async () => {
  const f = fixture();
  try {
    const opening = f.registry.startCalibration('a');
    await f.registry.cancelCalibration('a');
    await assert.rejects(opening);
    assert.equal(f.registry.status('a').phase, 'idle');
    const first = await f.registry.startCalibration('a');
    await f.registry.cancelCalibration('a', first.attemptId);
    const second = await f.registry.startCalibration('a');
    assert.notEqual(second.attemptId, first.attemptId);
    await f.registry.cancelCalibration('a', first.attemptId);
    await delay(220);
    assert.equal(f.registry.status('a').phase, 'running');
    assert.equal(f.host.service.status(), undefined);
    f.complete();
    await f.registry.entries.get('a').calibration.pending;
    const third = await f.registry.startCalibration('a');
    await delay(220);
    assert.equal(f.registry.status('a').phase, 'running');
    assert.notEqual(third.attemptId, second.attemptId);
  } finally {
    await f.registry.close();
  }
});

test('stopping a camera cancels calibration before releasing both camera leases', async () => {
  const f = fixture();
  await f.registry.startCalibration('a');
  const session = f.registry.entries.get('a').calibration;
  await f.registry.stop('a');
  assert.equal(session.phase, 'cancelled');
  assert.equal(f.owners.size, 0);
  await f.registry.close();
});

test('transfer configuration uses both accepted Devices and rejects an outdated editor snapshot', async () => {
  const f = fixture();
  f.registry.arm.transferRoutes = () => [];
  const a = await f.registry.open('a');
  const b = await f.registry.open('b');
  const pose = {
    frame: 'base',
    positionMm: { x: 1, y: 2, z: 3 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  };
  let revision = 1;
  a.device.getCalibration = async () => ({
    id: 'ca',
    revision,
    observationPose: pose,
    toolProfileId: 'tool',
  });
  b.device.getCalibration = async () => ({
    id: 'cb',
    revision: 1,
    observationPose: pose,
    toolProfileId: 'tool',
  });
  const calls = [];
  a.device.configureTransferTo = async (target, options) => {
    calls.push({ target, options });
  };
  try {
    const source = await f.registry.transferConfiguration('a');
    const target = await f.registry.transferConfiguration('b');
    const input = {
      sourceVersion: source.version,
      targetVersion: target.version,
      confirmed: true,
      waypoints: [pose],
    };
    const abort = new AbortController();
    await f.registry.configureTransfer('a', 'b', input, abort.signal);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].target, b.device);
    assert.equal(calls[0].options.signal, abort.signal);
    assert.deepEqual(calls[0].options.waypoints, [pose]);
    revision++;
    await assert.rejects(f.registry.configureTransfer('a', 'b', input), {
      code: 'TRANSFER_STALE',
    });
    assert.equal(calls.length, 1);
    abort.abort(new Error('Closed editor'));
    await assert.rejects(
      f.registry.configureTransfer('a', 'b', input, abort.signal),
      /Closed editor/,
    );
    await assert.rejects(
      f.registry.configureTransfer('a', 'a', input),
      /different/,
    );
  } finally {
    await f.registry.close();
  }
});

test('connection startup opens every discovered camera and isolates a failed camera', async () => {
  const f = fixture();
  const acquire = f.registry.cameras.acquire;
  f.registry.cameras.acquire = async (id, owner) => {
    if (id === 'busy') throw new Error('Camera is occupied');
    return acquire(id, owner);
  };
  await f.registry.startAll(async () => [
    { id: 'a' },
    { id: 'busy' },
    { id: 'b' },
  ]);
  assert.deepEqual([...f.registry.entries.keys()].sort(), ['a', 'b']);
  assert.equal(f.registry.cameraErrors.get('busy'), 'Camera is occupied');
  await f.registry.startAll(async () => [{ id: 'a' }, { id: 'b' }]);
  assert.equal(f.counts().opens, 2);
  f.registry.cameras.acquire = acquire;
  await f.registry.open('busy');
  assert.equal(f.registry.cameraErrors.has('busy'), false);
  await f.registry.close();
});

test('camera discovery failure does not reject robot connection startup', async () => {
  const f = fixture();
  await f.registry.startAll(async () => {
    throw new Error('Camera permission denied');
  });
  assert.equal(f.registry.discoveryError, 'Camera permission denied');
  assert.equal(f.registry.entries.size, 0);
  await f.registry.startAll(async () => []);
  assert.equal(f.registry.discoveryError, undefined);
  await f.registry.close();
});

test('cancel and reopen preserve the phone link without exposing an inactive host', async () => {
  const f = fixture();
  await f.registry.startCalibration('a');
  const first = f.registry.entries.get('a').calibration;
  await f.registry.cancelCalibration('a');
  assert.equal(f.registry.phoneHost(first.token), undefined);
  await f.registry.startCalibration('a');
  const second = f.registry.entries.get('a').calibration;
  assert.notEqual(first, second);
  assert.equal(second.token, first.token);
  assert.equal(f.registry.phoneHost(first.token), f.host);
  await f.registry.startCalibration('b');
  assert.notEqual(f.registry.entries.get('b').calibration.token, first.token);
  await f.registry.close();
});

test('known phone pairing restores its input host after restart without starting collection', async () => {
  const pairings = {
    token: async () => 'persisted-token',
    camera: (token) =>
      token === 'persisted-token' ? 'phone-camera' : undefined,
  };
  const f = fixture(pairings);
  assert.equal(await f.registry.resolvePhoneHost('unknown'), undefined);
  await Promise.all([
    f.registry.resolvePhoneHost('persisted-token'),
    f.registry.startCalibration('phone-camera'),
  ]);
  assert.equal(f.registry.phoneHost('persisted-token'), f.host);
  assert.equal(f.registry.entries.size, 1);
  assert.equal(
    f.registry.entries.get('phone-camera').calibration.token,
    'persisted-token',
  );
  await f.registry.close();
});

test('a persisted default screen retains the original camera correction scope across restarts', async () => {
  const f = fixture(undefined, [
    { id: 'a', cameraId: 'a', name: 'Default' },
    { id: 'second', cameraId: 'a', name: 'Second' },
  ]);
  const first = await f.registry.open('a');
  assert.equal(first.device.options.screenId, undefined);
  assert.deepEqual(f.acquisitions[0], { id: 'a', screenId: undefined });
  const second = await f.registry.open('second');
  assert.equal(second.device.options.screenId, 'second');
  assert.deepEqual(f.acquisitions[2], { id: 'a', screenId: 'second' });
  await f.registry.close();
});

test('reading readiness after stop does not reacquire a stopped camera', async () => {
  const f = fixture();
  await f.registry.open('a');
  await f.registry.stop('a');
  await assert.rejects(f.registry.configuration('a'), {
    code: 'VISION_UNAVAILABLE',
  });
  assert.equal(f.owners.size, 0);
  assert.equal(f.counts().opens, 1);
  await f.registry.close();
});
