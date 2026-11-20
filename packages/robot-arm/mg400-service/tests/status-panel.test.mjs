import assert from 'node:assert/strict';
import { test } from '@rstest/core';
import { StatusPanel } from '../src/server/status-panel.ts';
function fixture(getCalibrationSelection) {
  const calls = [];
  const tool = {
    id: 'tool-a',
    name: 'Pen',
    revision: 2,
    payload: { massKg: 0.1 },
  };
  const profiles = {
    robots: [
      { id: 'robot-a', adapterId: 'test-arm', connectionIdentity: 'host' },
    ],
    tools: [tool],
    devices: [
      {
        cameraId: 'camera-a',
        robotProfileId: 'robot-a',
        toolProfileId: 'tool-a',
      },
    ],
  };
  const state = {
    state: {
      connected: true,
      enabled: false,
      moving: false,
      dragMode: false,
      faults: [],
      status: { quality: { stale: false } },
    },
  };
  const runtime = {
    profileStore: { list: () => profiles },
    state: async () => state,
    controllerState: async () => ({ vendor: 'test', raw: {} }),
    lifecycle: async (...args) => calls.push(args),
    applySavedPayload: async (input) => calls.push(['payload', input]),
  };
  let busy = false;
  let running = false;
  const setup = {
    session: 'session',
    assertSession(input) {
      if (input.session !== this.session) throw new Error('stale session');
    },
    async mutate(input, fn) {
      this.assertSession(input);
      if (busy) throw new Error('busy');
      busy = true;
      try {
        return await fn();
      } finally {
        busy = false;
      }
    },
  };
  const controls = {
    assertIdle() {
      if (running) throw new Error('running tasks');
    },
    interrupt: async (kind) => calls.push([kind]),
    resume: async () => calls.push(['resume']),
    recover: async () => calls.push(['recover']),
  };
  const panel = new StatusPanel({
    setup,
    getArm: () => ({
      id: 'test-arm',
      connectionIdentity: 'host',
      describeCapabilities: () => ({
        descriptors: [{ id: 'state.controller' }],
      }),
    }),
    getControls: () => controls,
    getCalibrationSelection,
    runtime: () => runtime,
  });
  return {
    panel,
    runtime,
    calls,
    state,
    tool,
    setRunning: (value) => {
      running = value;
    },
  };
}
const input = {
  action: 'enable',
  session: 'session',
  confirmed: true,
  cameraId: 'camera-a',
  toolProfileId: 'tool-a',
  toolRevision: 2,
};
test('enable resolves the selected device payload and rejects missing, wrong-camera and stale selections', async () => {
  const f = fixture();
  await assert.rejects(
    f.panel.command({ ...input, confirmed: false }),
    /Confirm/,
  );
  await assert.rejects(f.panel.command({ ...input, session: 'old' }), /stale/);
  await assert.rejects(
    f.panel.command({ ...input, cameraId: 'camera-b' }),
    /selected device/,
  );
  await assert.rejects(
    f.panel.command({ ...input, toolRevision: 1 }),
    /changed/,
  );
  assert.equal(f.calls.length, 0);
  await f.panel.command(input);
  assert.equal(f.calls[0][0], 'enable');
  assert.equal(f.calls[0][1].payload.massKg, 0.1);
});
test('ordinary controls reject running tasks and stale/moving states; interrupts bypass those gates', async () => {
  const f = fixture();
  f.setRunning(true);
  await assert.rejects(
    f.panel.command({ ...input, action: 'disable' }),
    /running tasks/,
  );
  await f.panel.command({ ...input, action: 'pause' });
  await f.panel.command({ ...input, action: 'emergencyStop' });
  assert.deepEqual(f.calls, [['pause'], ['emergencyStop']]);
  f.setRunning(false);
  f.state.state.status.quality.stale = true;
  await assert.rejects(
    f.panel.command({ ...input, action: 'clearFaults' }),
    /fresh/,
  );
  f.state.state.status.quality.stale = false;
  f.state.state.moving = true;
  await assert.rejects(
    f.panel.command({ ...input, action: 'resume' }),
    /stationary/,
  );
});
test('fault clearing never enables; read failures do not claim an empty confirmed alarm list', async () => {
  const f = fixture();
  f.state.state.faults = [{ code: 'alarm' }];
  await assert.rejects(f.panel.command(input), /Clear faults/);
  await f.panel.command({ ...input, action: 'clearFaults' });
  assert.deepEqual(f.calls, [['clearFaults']]);
  const result = await f.panel.read('camera-a', true);
  assert.equal(result.state.state.faults[0].code, 'alarm');
  assert.equal(result.tool.toolRevision, 2);
  f.runtime.state = async () => {
    throw new Error('State unavailable');
  };
  await assert.rejects(f.panel.read('camera-a', true), /State unavailable/);
});

test('the toolbar reads and confirms the saved calibration tool before device binding', async () => {
  const selection = {
    cameraId: 'camera-b',
    robotProfileId: 'robot-a',
    toolProfileId: 'tool-a',
  };
  const f = fixture((id) =>
    id === selection.cameraId ? selection : undefined,
  );
  assert.equal((await f.panel.read('camera-b')).tool.toolProfileId, 'tool-a');
  assert.equal((await f.panel.read('camera-c')).tool, undefined);
  await f.panel.command({ ...input, cameraId: 'camera-b' });
  assert.equal(f.calls[0][0], 'enable');
});

test('resolves the selected screen Device on a shared camera before camera fallback', () => {
  const f = fixture();
  const profiles = f.runtime.profileStore.list();
  profiles.tools.push({ ...f.tool, id: 'tool-b', name: 'Screen B tool' });
  profiles.devices.push({
    deviceId: 'screen-b',
    cameraId: 'camera-a',
    robotProfileId: 'robot-a',
    toolProfileId: 'tool-b',
  });
  assert.equal(f.panel.selection('screen-b').toolProfileId, 'tool-b');
  assert.equal(f.panel.selection('camera-a').toolProfileId, 'tool-a');
});
