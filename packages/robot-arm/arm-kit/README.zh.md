# Arm Kit

[English](./README.md) / 简体中文

`@midscene/arm-kit` 提供机械臂控制器和适配器接口，用于将自定义机械臂接入 Midscene。每个 `ArmController` 管理一台实体机械臂，并为共用该机械臂的触屏设备统一排队执行操作。

## 实现适配器

从 `@midscene/arm-kit/adapter-development` 导入 `RobotArmAdapter`、`RobotDriver` 和 `RobotKinematics`。`RobotArmAdapter` 封装厂商驱动，并向控制器提供设备标识、运动学参数和就绪条件。

1. 将 `contractVersion` 设为 `1`，填写 `id`、`name` 和 `connectionIdentity`。同一台实体控制器使用稳定的连接标识。在 `kinematics` 中声明关节顺序和单位、笛卡尔运动轴以及支持的姿态类型（`fixed`、`yaw` 或 `full`）。使用 `fixed` 或 `yaw` 时，通过 `fixedOrientation` 提供参考四元数。有实测或设备规格数据时，填写关节限位和工作空间范围。
2. 在 `driver` 中实现 `connect()`、`disconnect()`、`getState()` 和 `stop()`。从控制器反馈中读取连接、使能、运动和故障状态。标记过期采样，并保留原始采样 ID 和时间戳。在 `readinessPolicy` 中声明采样的最大有效时长，以及运动前必须已知的状态字段。
3. 要支持触屏操作，实现 `moveLinear()` 和 `readPose()`，并在 `motionLimits.linear` 中声明允许的速度及加速度范围。按设备能力补充可选方法，例如实现 `movePtp()` 时同时配置 `motionLimits.ptp`，实现点动时同时提供 `startJog()` 和 `stopJog()`。在驱动层转换厂商单位。`CartesianPose` 使用机械臂基坐标系，位置以毫米表示，姿态用四元数表示。旋转关节用度，直线关节用毫米。
4. 每个运动方法返回一个 `MotionHandle`。把一个等待控制器确认最终结果的 Promise 传给 `createMotionHandle()`。确认到位后才返回 `completed`。即使调用方等待超时或取消等待，`stop()` 也要能停止进行中的运动。

[DOBOT MG400 适配器](../adapter-mg400/src/mg400.ts) 展示了位姿转换、状态读取和到位确认。[模拟适配器](./src/testkit/fake-adapter.ts) 展示了如何用模拟硬件验证同一套接口。

## 接入适配器

每台实体机械臂创建一个 `ArmController`，由该机械臂控制的设备共用这个实例。

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

[MG400 服务实现](../arm-service/src/server/index.ts) 展示了如何使用适配器工厂、保持控制器连接，以及将触屏设备注册到 Universal Device。

如果要配置和标定 DOBOT MG400，参见 [MG400 设备服务](../arm-service/README.zh.md)。
