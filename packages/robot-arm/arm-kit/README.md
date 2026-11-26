<p align="center">
  <img alt="Midscene Test Everything" width="160" src="https://github.com/user-attachments/assets/f60de3c1-dd6f-4213-97a1-85bf7c6e79e4"><br />
</p>

# Arm Kit

English / [简体中文](./README.zh.md)

`@midscene/arm-kit` provides the controller and adapter API for integrating custom robot arms with Midscene. `ArmController` manages one physical arm and queues operations for touchscreen devices that share it.

## Implement an adapter

Import `RobotArmAdapter`, `RobotDriver`, and `RobotKinematics` from `@midscene/arm-kit/adapter-development`. A `RobotArmAdapter` combines a vendor-specific driver with the identity, geometry, and readiness information the controller needs.

1. Set `contractVersion` to `1` and provide an `id`, `name`, and `connectionIdentity`. Use a stable connection identity for the physical controller. In `kinematics`, describe the joint order and units, Cartesian axes, and supported orientation (`fixed`, `yaw`, or `full`). Supply a `fixedOrientation` reference quaternion for `fixed` or `yaw`, and include joint and workspace limits where available.
2. Implement `connect()`, `disconnect()`, `getState()`, and `stop()` on `driver`. Report connection, enablement, motion, and faults from controller telemetry. Mark stale samples and preserve their original IDs and timestamps. Use `readinessPolicy` to declare the maximum sample age and the status fields that must be known before motion.
3. For touchscreen control, implement `moveLinear()` and `readPose()`. Declare the accepted speed and acceleration ranges in `motionLimits.linear`. Add optional methods for features the arm supports, such as `movePtp()` with `motionLimits.ptp`, or `startJog()` and `stopJog()` together. Convert vendor units at the driver boundary. A `CartesianPose` uses the robot base frame, millimetres, and a quaternion. Joint values use degrees for revolute joints and millimetres for prismatic joints.
4. Return a `MotionHandle` from each move. Use `createMotionHandle()` with a promise that resolves once controller feedback confirms the terminal outcome. Confirm arrival before reporting `completed`. Implement `stop()` so it can stop a move in progress even if its waiter times out or is cancelled.

The [DOBOT MG400 adapter](../adapter-mg400/src/mg400.ts) shows pose conversion, telemetry, and completion checks. The [fake adapter](./src/testkit/fake-adapter.ts) shows how to exercise the same contract with simulated hardware.

## Connect the adapter

Create one `ArmController` per physical arm and share it across the devices that arm controls.

```ts
import { ArmController } from '@midscene/arm-kit';
import type { RobotArmAdapter } from '@midscene/arm-kit/adapter-development';

export async function checkConnection(adapter: RobotArmAdapter) {
  const controller = new ArmController({ adapter });
  try {
    await controller.connect();
    return await controller.getStatus();
  } finally {
    await controller.close();
  }
}
```

The [MG400 service implementation](../mg400-service/src/server/index.ts) shows how to use an adapter factory, keep the controller open, and serve its touchscreens over Midscene Connect.

To set up and calibrate a DOBOT MG400, see the [MG400 device service README](../mg400-service/README.md).
