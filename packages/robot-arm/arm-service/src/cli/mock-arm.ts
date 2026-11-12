import type { RobotArmAdapter } from '@midscene/arm-kit';
import { robotSetupDefaults } from '@midscene/arm-kit/adapter-development';
import { FakeAdapter } from '@midscene/arm-kit/internal/testkit';

/**
 * Development stand-in for a Dobot MG400.
 *
 * It publishes the same four-axis kinematics, motion constraints and setup
 * defaults the hardware adapter declares, so the Playground can walk through
 * connection, tool setup and camera mapping. Every command stays inside the
 * process: no controller is opened, no motion is sent and nothing here proves
 * a physical calibration. Use it to work on the camera pipeline.
 */
export class MockMg400Adapter implements RobotArmAdapter {
  readonly contractVersion = 1 as const;
  readonly id = 'mg400-mock';
  readonly name = 'MG400 simulator (no hardware)';
  readonly connectionIdentity = 'mock://mg400';
  readonly setupDefaults = robotSetupDefaults('mg400');
  private readonly fake = new FakeAdapter({
    jointCount: 4,
    orientation: 'yaw',
  });
  readonly driver = this.fake.driver;
  readonly kinematics = this.fake.kinematics;
  readonly readinessPolicy = this.fake.readinessPolicy;
  readonly motionLimits = this.fake.motionLimits;

  latestToolVectorSample() {
    return this.fake.latestToolVectorSample();
  }
}
