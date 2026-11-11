import type { ArmController } from '@midscene/arm-kit';
import { controllerRuntime } from '@midscene/arm-kit/internal/controller-runtime';
import { sharedCalibrationTool } from '@midscene/arm-kit/internal/runtime/profile-store';
import type { PlaygroundArmControls } from './arm-controls.js';
import type { PlaygroundSession, SessionInput } from './session.js';

type SelectedTool = {
  cameraId?: string;
  robotProfileId?: string;
  toolProfileId?: string;
};
interface PanelOptions {
  setup: PlaygroundSession;
  getArm(): ArmController | undefined;
  getControls(): PlaygroundArmControls | undefined;
  getCalibrationSelection(cameraId?: string | null): SelectedTool | undefined;
  runtime?: typeof controllerRuntime;
}
interface ControlInput extends SessionInput {
  action:
    | 'enable'
    | 'disable'
    | 'clearFaults'
    | 'pause'
    | 'resume'
    | 'emergencyStop'
    | 'payload'
    | 'recover';
  confirmed?: boolean;
  cameraId?: string;
  toolRevision?: number;
  toolProfileId?: string;
}

/** Resolves payload from the selected camera, never from a client-supplied profile ID. */
export class StatusPanel {
  private runtime: typeof controllerRuntime;
  constructor(private options: PanelOptions) {
    this.runtime = options.runtime ?? controllerRuntime;
  }
  arm() {
    const arm = this.options.getArm();
    if (!arm) throw new Error('Connect the arm first');
    return arm;
  }
  selection(cameraId?: string | null) {
    const arm = this.arm();
    const runtime = this.runtime(arm);
    const profiles = runtime.profileStore.list();
    const calibration = this.options.getCalibrationSelection?.(cameraId);
    if (calibration && calibration.cameraId !== cameraId) return;
    if (!cameraId) return;
    const physicalCameraId =
      profiles.screenTargets?.find((target) => target.id === cameraId)
        ?.cameraId ?? cameraId;
    const measured = profiles.calibrationSetups?.find(
      (setup) =>
        setup.deviceId === cameraId && setup.cameraId === physicalCameraId,
    );
    const binding =
      calibration ??
      measured ??
      profiles.devices?.find((item) => item.deviceId === cameraId) ??
      sharedCalibrationTool(profiles, arm.id, arm.connectionIdentity) ??
      profiles.devices?.find((item) => item.cameraId === cameraId) ??
      (profiles.workstation?.cameraId === cameraId
        ? profiles.workstation
        : undefined);
    if (!binding) return;
    const robot = profiles.robots.find(
      (item) => item.id === binding.robotProfileId,
    );
    const tool = profiles.tools.find(
      (item) => item.id === binding.toolProfileId,
    );
    if (
      !robot ||
      !tool ||
      robot.adapterId !== arm.id ||
      robot.connectionIdentity !== arm.connectionIdentity
    )
      return;
    return {
      robotProfileId: robot.id,
      toolProfileId: tool.id,
      toolRevision: tool.revision,
      name: tool.name,
      payload: tool.payload,
    };
  }
  async read(cameraId?: string | null, details = false) {
    const arm = this.arm();
    const runtime = this.runtime(arm);
    const tool = this.selection(cameraId);
    const state = await runtime.state(tool?.toolProfileId);
    const capabilities = arm.describeCapabilities();
    let joints = state.state.status?.joints;
    if (
      details &&
      !state.state.moving &&
      !state.state.dragMode &&
      state.operation?.status !== 'running' &&
      capabilities.descriptors.some((item) => item.id === 'state.joints')
    ) {
      try {
        joints = await runtime.readJoints();
      } catch {
        joints = undefined;
      }
    }
    let controller;
    let controllerError;
    if (
      details &&
      capabilities.descriptors.some((item) => item.id === 'state.controller')
    ) {
      try {
        controller = await runtime.controllerState();
      } catch (error) {
        controllerError =
          error instanceof Error ? error.message : String(error);
      }
    }
    return {
      session: this.options.setup.session,
      state,
      capabilities,
      joints,
      tool,
      controller,
      controllerError,
      queriedAt: new Date().toISOString(),
    };
  }
  async command(input: ControlInput) {
    const controls = this.options.getControls();
    if (!controls) throw new Error('Connect the arm first');
    const kind = input.action;
    if (
      ![
        'enable',
        'disable',
        'clearFaults',
        'pause',
        'resume',
        'emergencyStop',
        'payload',
        'recover',
      ].includes(kind)
    )
      throw new Error('Unsupported robot control');
    this.options.setup.assertSession(input);
    const arm = this.arm();
    const runtime = this.runtime(arm);
    if (kind === 'pause' || kind === 'emergencyStop')
      return controls.interrupt(kind);
    if (input.confirmed !== true) throw new Error('Confirm the robot control');
    return this.options.setup.mutate(input, async () => {
      controls.assertIdle();
      const snapshot = await runtime.state();
      const state = snapshot.state;
      if (
        !state.connected ||
        !state.status ||
        state.status.quality.stale ||
        state.moving ||
        state.dragMode ||
        snapshot.operation?.status === 'running'
      )
        throw new Error('Wait for a fresh, stationary robot state');
      if (kind === 'resume') return controls.resume();
      if (kind === 'recover') return controls.recover();
      if (kind === 'enable' || kind === 'payload') {
        const tool = this.selection(input.cameraId);
        if (!tool?.payload)
          throw new Error(
            'Save the selected device tool and payload in calibration first',
          );
        if (
          input.toolRevision !== tool.toolRevision ||
          input.toolProfileId !== tool.toolProfileId
        )
          throw new Error(
            'Tool configuration changed. Review it again before enabling',
          );
        if (
          state.faults.length ||
          state.paused ||
          snapshot.softwarePaused ||
          snapshot.recoveryRequired
        )
          throw new Error('Clear faults and recover the robot first');
        if (kind === 'enable' && state.enabled)
          throw new Error('Robot is already enabled');
        if (kind === 'payload') return runtime.applySavedPayload(tool);
        return runtime.lifecycle('enable', tool);
      }
      return runtime.lifecycle(kind);
    });
  }
}
