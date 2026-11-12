import { randomUUID } from 'node:crypto';
import type {
  ArmController,
  ControllerMotionSettingsUpdate,
  RobotArmAdapter,
} from '@midscene/arm-kit';
import { controllerRuntime } from '@midscene/arm-kit/internal/controller-runtime';
import type { ProfileStore } from '@midscene/arm-kit/internal/runtime/profile-store';

export interface SessionContext {
  getArm(): ArmController | undefined;
  replace(
    adapter: RobotArmAdapter,
    store: ProfileStore,
    storageId: string,
    address?: string,
  ): Promise<void>;
  disconnect(): Promise<void>;
}
export interface SessionInput {
  session: string;
}

export class PlaygroundSession {
  session = randomUUID();
  phase = 'unconfigured';
  busy = false;
  pending?: Promise<unknown>;
  getArm: SessionContext['getArm'];
  replace: SessionContext['replace'];
  disconnect: SessionContext['disconnect'];
  constructor(context: SessionContext) {
    this.getArm = context.getArm;
    this.replace = context.replace;
    this.disconnect = context.disconnect;
  }
  assertSession(input: SessionInput) {
    if (input.session !== this.session)
      throw Object.assign(
        new Error('Configuration changed. Reload before saving.'),
        { status: 409, code: 'STALE_SESSION' },
      );
  }
  async mutate<T>(input: SessionInput, fn: () => Promise<T>) {
    this.assertSession(input);
    if (this.busy)
      throw Object.assign(new Error('Configuration is busy'), { status: 409 });
    this.busy = true;
    try {
      const pending = Promise.resolve().then(fn);
      this.pending = pending;
      return await pending;
    } finally {
      this.busy = false;
      this.pending = undefined;
    }
  }
  async stationary({ disabled = false } = {}) {
    const arm = this.getArm();
    if (!arm) return;
    const s = await arm.getStatus();
    if (
      s.operation?.status === 'running' ||
      s.state.moving ||
      s.state.dragMode ||
      s.state.paused ||
      s.state.status?.quality.stale ||
      (disabled && s.state.enabled)
    )
      throw Object.assign(
        new Error(
          disabled
            ? 'Disable the stationary robot before replacing its connection.'
            : 'Wait for the robot to be stationary.',
        ),
        { status: 409 },
      );
  }
  async motion(input?: SessionInput & ControllerMotionSettingsUpdate) {
    const arm = this.getArm();
    if (!arm) throw new Error('Connect the arm first');
    const runtime = controllerRuntime(arm);
    if (input === undefined) return runtime.controllerMotionSettings();
    return this.mutate(input, async () => {
      await this.stationary({ disabled: true });
      return runtime.updateControllerMotionSettings(input);
    });
  }
  async disable(input: SessionInput) {
    return this.mutate(input, async () => {
      await this.stationary();
      const arm = this.getArm();
      if (!arm) throw new Error('Connect first');
      await controllerRuntime(arm).lifecycle('disable');
      return { ok: true };
    });
  }
}
