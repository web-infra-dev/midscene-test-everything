import { RobotArmError } from '@midscene/arm-kit/internal/contracts';
import { describe, expect, it, rstest } from '@rstest/core';
import {
  Mg400MotionSettingsClient,
  type MotionSettingsFiles,
  type MotionSettingsPort,
} from '../src/mg400-motion-settings.js';
const coordinate = {
  velocity: [1000, 600],
  acceleration: [30000, 6000],
  jerk: [30000, 40000],
  firmwareField: 7,
};
const range = (max: number, def: number) => ({ min: 1, max, def });
function setup() {
  const data: Record<string, unknown> = {
    'settings/common.json': { ratio: 100, preserve: true },
    'settings/playback/coordinate.json': structuredClone(coordinate),
    'properties/default.json': {
      common: { ratio: range(100, 50) },
      playback: {
        coordinate: {
          velocity: [range(2000, 1000), {}, {}, range(2000, 600)],
          acceleration: [range(100000, 30000), {}, {}, range(100000, 6000)],
          jerk: [range(80000, 30000), {}, {}, range(80000, 40000)],
        },
      },
    },
  };
  const events: string[] = [];
  const files: MotionSettingsFiles = {
    read: rstest.fn(async (path) => structuredClone(data[path])),
    replace: rstest.fn(async (path, value) => {
      events.push(`save:${path}`);
      data[path] = structuredClone(value);
    }),
  };
  const port: MotionSettingsPort = {
    files: async (_signal, work) => work(files),
    apply: rstest.fn(async (path) => {
      events.push(`apply:${path}`);
      return { status: true };
    }),
    assertStopped: rstest.fn(async () => {}),
  };
  return {
    data,
    files,
    port,
    events,
    client: new Mg400MotionSettingsClient(port),
  };
}
describe('MG400 Studio motion settings', () => {
  it('reads actual controller values and device-provided ranges without writes', async () => {
    const f = setup();
    const result = await f.client.read();
    expect(result.values).toEqual({
      globalSpeedPercent: 100,
      linearSpeed: 1000,
      linearAcceleration: 30000,
      linearJerk: 30000,
    });
    expect(result.ranges.linearSpeed).toEqual({
      min: 1,
      max: 2000,
      default: 1000,
    });
    expect(f.files.replace).not.toHaveBeenCalled();
    expect(f.port.apply).not.toHaveBeenCalled();
  });
  it('persists each changed file before applying and preserves rotation and firmware fields', async () => {
    const f = setup();
    const before = await f.client.read();
    const values = {
      globalSpeedPercent: 80,
      linearSpeed: 2000,
      linearAcceleration: 60000,
      linearJerk: 80000,
    };
    const after = await f.client.update({ revision: before.revision, values });
    expect(after.values).toEqual(values);
    expect(after.revision).not.toBe(before.revision);
    expect(f.data['settings/playback/coordinate.json']).toEqual({
      velocity: [2000, 600],
      acceleration: [60000, 6000],
      jerk: [80000, 40000],
      firmwareField: 7,
    });
    expect(f.data['settings/common.json']).toEqual({
      ratio: 80,
      preserve: true,
    });
    expect(f.events).toEqual([
      'save:settings/playback/coordinate.json',
      'apply:/settings/playback/coordinate',
      'save:settings/common.json',
      'apply:/settings/common',
    ]);
    expect(f.port.assertStopped).toHaveBeenCalledTimes(4);
  });
  it('does not rewrite unchanged settings', async () => {
    const f = setup();
    const before = await f.client.read();
    await f.client.update({ revision: before.revision, values: before.values });
    expect(f.files.replace).not.toHaveBeenCalled();
    expect(f.port.apply).not.toHaveBeenCalled();
  });
  it('binds revisions to the controller connection identity', async () => {
    const f = setup();
    const other = new Mg400MotionSettingsClient(f.port, 'other-controller');
    const before = await f.client.read();
    await expect(
      other.update({ revision: before.revision, values: before.values }),
    ).rejects.toMatchObject({ code: 'STALE_CONTROLLER_SETTINGS' });
    expect(f.files.replace).not.toHaveBeenCalled();
  });
  it('rejects stale values after an external settings change', async () => {
    const f = setup();
    const before = await f.client.read();
    f.data['settings/common.json'] = { ratio: 50 };
    await expect(
      f.client.update({ revision: before.revision, values: before.values }),
    ).rejects.toMatchObject({ code: 'STALE_CONTROLLER_SETTINGS' });
    expect(f.files.replace).not.toHaveBeenCalled();
  });
  it.each([
    { linearSpeed: 2001 },
    { linearAcceleration: 100001 },
    { linearJerk: 80001 },
    { globalSpeedPercent: 101 },
    { globalSpeedPercent: 1.5 },
    { linearSpeed: Number.NaN },
    { linearSpeed: 0 },
    { linearSpeed: Number.POSITIVE_INFINITY },
  ])('rejects values outside controller bounds: %j', async (patch) => {
    const f = setup();
    const before = await f.client.read();
    await expect(
      f.client.update({
        revision: before.revision,
        values: { ...before.values, ...patch },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    expect(f.files.replace).not.toHaveBeenCalled();
  });
  it('requires stopped and disabled hardware before changing a file', async () => {
    const f = setup();
    const before = await f.client.read();
    rstest
      .mocked(f.port.assertStopped)
      .mockRejectedValue(
        new RobotArmError('CONTROLLER_SETTINGS_NOT_IDLE', 'Enabled robot'),
      );
    await expect(
      f.client.update({
        revision: before.revision,
        values: { ...before.values, linearSpeed: 1500 },
      }),
    ).rejects.toMatchObject({ code: 'CONTROLLER_SETTINGS_NOT_IDLE' });
    expect(f.files.replace).not.toHaveBeenCalled();
    expect(f.port.apply).not.toHaveBeenCalled();
  });
  it('reports persisted but unapplied settings without retry or rollback on an application failure', async () => {
    const f = setup();
    const before = await f.client.read();
    rstest.mocked(f.port.apply).mockRejectedValue(new Error('Disconnected'));
    await expect(
      f.client.update({
        revision: before.revision,
        values: { ...before.values, globalSpeedPercent: 80, linearSpeed: 1500 },
      }),
    ).rejects.toMatchObject({
      code: 'CONTROLLER_SETTINGS_UNCONFIRMED',
      details: {
        persistedPaths: ['settings/playback/coordinate.json'],
        before: expect.objectContaining({
          revision: before.revision,
          values: before.values,
        }),
        applicationUnconfirmed: true,
      },
    });
    expect(f.port.apply).toHaveBeenCalledTimes(1);
    expect(f.data['settings/common.json']).toMatchObject({ ratio: 100 });
  });
  it.each([
    { status: false },
    { code: 12 },
    { status: 3 },
    { error: 'Invalid parameter' },
    null,
  ])('rejects failed application acknowledgements: %j', async (response) => {
    const f = setup();
    const before = await f.client.read();
    rstest.mocked(f.port.apply).mockResolvedValue(response);
    await expect(
      f.client.update({
        revision: before.revision,
        values: { ...before.values, linearSpeed: 1500 },
      }),
    ).rejects.toMatchObject({ code: 'CONTROLLER_SETTINGS_UNCONFIRMED' });
  });
  it('interrupts after persistence without submitting an application or a second file', async () => {
    const f = setup();
    const before = await f.client.read();
    rstest
      .mocked(f.files.replace)
      .mockImplementationOnce(async (path, value) => {
        f.data[path] = value;
        f.client.interrupt();
      });
    await expect(
      f.client.update({
        revision: before.revision,
        values: { ...before.values, globalSpeedPercent: 80, linearSpeed: 1500 },
      }),
    ).rejects.toMatchObject({ code: 'CONTROLLER_SETTINGS_UNCONFIRMED' });
    expect(f.port.apply).not.toHaveBeenCalled();
  });
  it('rejects malformed controller data instead of using example defaults', async () => {
    const f = setup();
    f.data['settings/playback/coordinate.json'] = {
      ...coordinate,
      velocity: [1000],
    };
    await expect(f.client.read()).rejects.toMatchObject({
      code: 'PROTOCOL_ERROR',
    });
  });
});
