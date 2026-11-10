import type {
  EffectiveCapabilities,
  RuntimeState,
} from '@midscene/robotics-shared/contracts';
import { expect, it } from '@rstest/core';
import { calibrationPowerControl } from '../src/power-state';

const capabilities = {
  controls: ['control.enable', 'control.apply-payload'],
} as EffectiveCapabilities;
const runtime = () =>
  ({
    state: {
      connected: true,
      enabled: false,
      moving: false,
      faults: [],
      status: { quality: { stale: false } },
    },
    recoveryRequired: false,
    softwarePaused: false,
    payloadApplication: { status: 'unconfirmed' },
  }) as RuntimeState;

it('uses payload synchronization for an enabled arm and recovery before enabling', () => {
  const state = runtime();
  expect(calibrationPowerControl(state, capabilities, true)).toEqual({
    action: 'enable',
    disabled: false,
  });
  state.state.enabled = true;
  expect(calibrationPowerControl(state, capabilities, true)).toEqual({
    action: 'payload',
    disabled: false,
  });
  state.recoveryRequired = true;
  state.requiresOperatorRecovery = false;
  expect(calibrationPowerControl(state, capabilities, true).disabled).toBe(
    true,
  );
  state.requiresOperatorRecovery = true;
  expect(calibrationPowerControl(state, capabilities, true)).toEqual({
    action: 'recover',
    disabled: false,
  });
});
it('blocks controls during motion, stale telemetry, active operations and missing payload', () => {
  for (const change of [
    (s: RuntimeState) => {
      s.state.moving = true;
    },
    (s: RuntimeState) => {
      s.state.status!.quality.stale = true;
    },
    (s: RuntimeState) => {
      s.aiRun = { requestId: 'other-task' };
    },
    (s: RuntimeState) => {
      s.softwarePaused = true;
    },
    (s: RuntimeState) => {
      s.payloadApplication!.status = 'missing';
    },
  ]) {
    const state = runtime();
    change(state);
    expect(calibrationPowerControl(state, capabilities, true).disabled).toBe(
      true,
    );
  }
  expect(calibrationPowerControl(runtime(), capabilities, false).disabled).toBe(
    true,
  );
  const enabled = runtime();
  enabled.state.enabled = true;
  expect(
    calibrationPowerControl(
      enabled,
      { controls: ['control.enable'] } as EffectiveCapabilities,
      true,
    ).disabled,
  ).toBe(true);
});
