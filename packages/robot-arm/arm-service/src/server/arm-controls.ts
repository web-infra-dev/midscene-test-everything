import type { ArmController } from '@midscene/arm-kit';

/** Dispatch a physical stop immediately and coalesce concurrent stop requests. */
export class PlaygroundArmControls {
  private stopping?: Promise<void>;
  constructor(private arm: ArmController) {}

  stop() {
    if (this.stopping) return this.stopping;
    this.stopping = this.arm.stop().finally(() => {
      this.stopping = undefined;
    });
    return this.stopping;
  }

  interrupt(kind: 'pause' | 'emergencyStop') {
    if (!['pause', 'emergencyStop'].includes(kind))
      throw new Error('Unsupported interrupt');
    return this.arm[kind]();
  }

  assertIdle() {
    if (this.stopping) throw new Error('Wait for the physical stop to finish');
  }

  async resume() {
    this.assertIdle();
    await this.arm.resume();
  }

  async recover() {
    this.assertIdle();
    await this.arm.recover();
  }
}
