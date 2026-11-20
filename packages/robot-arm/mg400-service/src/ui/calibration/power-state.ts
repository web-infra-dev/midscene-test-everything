import type { EffectiveCapabilities, RuntimeState } from './robot-arm-api';

/** Mirrors the original calibration power controls, using the selected saved tool. */
export function calibrationPowerControl(
  runtime: RuntimeState | undefined,
  capabilities: EffectiveCapabilities,
  editable: boolean,
) {
  const state = runtime?.state;
  const stationary = Boolean(
    editable &&
      state?.connected &&
      state.status &&
      !state.status.quality.stale &&
      !state.moving &&
      !state.dragMode &&
      !state.paused &&
      !state.faults.length &&
      !runtime?.aiRun &&
      runtime?.operation?.status !== 'running',
  );
  if (runtime?.recoveryRequired)
    return {
      action: 'recover' as const,
      disabled: !stationary || runtime.requiresOperatorRecovery === false,
    };
  const action = state?.enabled ? ('payload' as const) : ('enable' as const);
  const supported =
    capabilities.controls.includes(
      action === 'payload'
        ? 'control.apply-payload'
        : 'control.enable-with-payload',
    ) ||
    (action === 'enable' && capabilities.controls.includes('control.enable'));
  return {
    action,
    disabled:
      !stationary ||
      !supported ||
      Boolean(runtime?.softwarePaused) ||
      runtime?.payloadApplication?.status === 'missing',
  };
}
