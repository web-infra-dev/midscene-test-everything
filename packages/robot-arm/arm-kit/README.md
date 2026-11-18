<p align="center">
  <img alt="Midscene Test Everything" width="160" src="https://github.com/user-attachments/assets/f60de3c1-dd6f-4213-97a1-85bf7c6e79e4"><br />
</p>

# Arm Kit

`@midscene/arm-kit` provides the controller and adapter API for integrating custom robot arms.

Implement the `RobotArmAdapter` contract from `@midscene/arm-kit/adapter-development`. The adapter translates vendor commands and units and reports when motion completes. The controller queues operations for devices that share the arm.

See the [DOBOT MG400 adapter](../adapter-mg400) for an example implementation and the [MG400 device service](../arm-service/README.md) for an example of how to use it.
