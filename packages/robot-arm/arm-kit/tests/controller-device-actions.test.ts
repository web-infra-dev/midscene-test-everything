import { expect, it } from '@rstest/core';
import type { VisionBinding } from '../src/contracts.js';
import { controllerRuntime } from '../src/controller-runtime.js';
import { ArmController } from '../src/controller.js';
import { fixture } from './fixtures.js';
const vision: VisionBinding = {
  cameraId: 'cam',
  cameraName: 'Camera',
  perspectiveProfileKey: 'p',
  fingerprint: 'f',
  width: 1000,
  height: 500,
};
async function setup() {
  const f = await fixture();
  await f.runtime.shutdown();
  const arm = new ArmController({ adapter: f.adapter, profileStore: f.store });
  await arm.connect();
  await controllerRuntime(arm).lifecycle('enable');
  return {
    ...f,
    arm,
    dispose: async () => {
      await arm.close();
      await f.cleanup();
    },
  };
}
it('serializes real screen actions and validates each camera inside the queue', async () => {
  const f = await setup();
  try {
    const events: string[] = [];
    const a = f.arm.executeForDevice(
      'a',
      f.request({ type: 'tap', point: { x: 500, y: 250 } }),
      async () => {
        events.push('a');
        return vision;
      },
    );
    const b = f.arm.executeForDevice(
      'b',
      f.request({ type: 'tap', point: { x: 600, y: 250 } }),
      async () => {
        expect(f.arm.current()?.status).not.toBe('running');
        events.push('b');
        return vision;
      },
    );
    await Promise.all([a, b]);
    expect(events).toEqual(['a', 'b']);
    expect(f.adapter.movements.length).toBeGreaterThan(0);
  } finally {
    await f.dispose();
  }
});
it('keeps device context independent of changes to the legacy selected workstation', async () => {
  const f = await setup();
  try {
    const request = f.request({ type: 'tap', point: { x: 500, y: 250 } });
    request.contextKey = f.store.contextKey(
      request,
      request.calibrationProfileId,
      vision,
    );
    const current = f.store.list().workstation!;
    await f.store.putWorkstation({ ...current, cameraId: 'another-camera' });
    expect(f.store.contextKey(request, request.calibrationProfileId)).not.toBe(
      request.contextKey,
    );
    expect(
      f.store.contextKey(request, request.calibrationProfileId, vision),
    ).toBe(request.contextKey);
    await f.arm.executeForDevice('a', request, async () => vision);
  } finally {
    await f.dispose();
  }
});
it('rejects a changed device mapping before any motion', async () => {
  const f = await setup();
  try {
    await expect(
      f.arm.executeForDevice(
        'a',
        f.request({ type: 'tap', point: { x: 500, y: 250 } }),
        async () => ({ ...vision, fingerprint: 'changed' }),
      ),
    ).rejects.toMatchObject({ code: 'EXECUTION_CONTEXT_CHANGED' });
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    await f.dispose();
  }
});
it('cancels only the selected owner while other queued work remains runnable', async () => {
  const f = await setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const a = f.arm
      .executeForDevice(
        'a',
        f.request({ type: 'tap', point: { x: 500, y: 250 } }),
        async () => {
          await gate;
          return vision;
        },
      )
      .catch((e) => e.message);
    const b = f.arm.executeForDevice(
      'b',
      f.request({ type: 'tap', point: { x: 600, y: 250 } }),
      async () => vision,
    );
    f.arm.cancelDevice('a');
    release();
    expect(await a).toBe('Device work cancelled');
    await b;
  } finally {
    release();
    await f.dispose();
  }
});

it('does not expose legacy runtime mutation or lifecycle bypasses', async () => {
  const f = await setup();
  try {
    for (const method of [
      'motion',
      'execute',
      'shutdown',
      'initialize',
      'lifecycle',
      'putRobot',
      'putTool',
      'profileStore',
      'startCalibration',
    ])
      expect(method in f.arm).toBe(false);
    expect((await f.arm.getState()).connected).toBe(true);
  } finally {
    await f.dispose();
  }
});

it('drains the active owner before closing and rejects later work without moving', async () => {
  const f = await setup();
  let release!: () => void;
  let entered!: () => void;
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const action = f.arm.executeForDevice(
      'a',
      f.request({ type: 'tap', point: { x: 500, y: 250 } }),
      async () => {
        entered();
        await gate;
        return vision;
      },
    );
    const rejected = expect(action).rejects.toThrow('Arm queue is closed');
    await reading;
    let closed = false;
    const closing = f.arm.close();
    expect(f.arm.close()).toBe(closing);
    void closing.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    await expect(f.arm.connect()).rejects.toThrow('Arm controller is closed');
    await expect(
      f.arm.executeForDevice(
        'b',
        f.request({ type: 'tap', point: { x: 600, y: 250 } }),
        async () => vision,
      ),
    ).rejects.toThrow('Arm queue is closed');
    release();
    await rejected;
    await closing;
    await expect(f.arm.recover()).rejects.toThrow('Arm controller is closed');
    expect(f.adapter.movements).toHaveLength(0);
  } finally {
    release?.();
    await f.dispose();
  }
});
it('pause blocks shared actions, resume recovers the queue without replaying interrupted work', async () => {
  const f = await setup();
  try {
    await f.arm.pause();
    expect((await f.arm.getStatus()).softwarePaused).toBe(true);
    await expect(
      f.arm.executeForDevice(
        'a',
        f.request({ type: 'tap', point: { x: 500, y: 250 } }),
        async () => vision,
      ),
    ).rejects.toThrow('recovery');
    await f.arm.resume();
    expect((await f.arm.getStatus()).softwarePaused).toBe(false);
    await f.arm.executeForDevice(
      'a',
      f.request({ type: 'tap', point: { x: 500, y: 250 } }),
      async () => vision,
    );
  } finally {
    await f.dispose();
  }
});
