# Midscene Robotics

[English](./README.md)

用 Midscene 通过蓝牙操作 iPhone，或通过机械臂操作触屏。两种设备共用 Universal Device Playground 和 SDK。

## 快速开始

在仓库根目录运行：

```sh
pnpm install
pnpm build
```

| 设备 | 启动命令 | 管理台 | 获取 Token |
| --- | --- | --- | --- |
| 机械臂（DOBOT MG400） | `pnpm --filter @midscene/arm-service start` | [localhost:5173](http://localhost:5173/) | **机械臂配置 → Universal Device** |
| iPhone（在连接手机的 Mac 上运行） | `pnpm ios-airlink install` | [localhost:5801](http://localhost:5801/) | `pnpm ios-airlink token` |

在管理台添加设备并完成配置。然后运行 `pnpm dev:playground`，打开 [localhost:5800](http://localhost:5800/)，填入服务地址和 Token，再选择设备。

## 脚本与接口

将 [.env.example](./.env.example) 复制为 `.env`，填入服务和模型配置，然后运行：

```sh
pnpm exec tsx examples/universal-device.ts
```

示例通过 `agentFromUniversalDevice()` 读取当前屏幕。两个服务都可以在 `/api/docs/` 打开 Swagger UI，在 `/api/openapi.json` 查看接口定义。

[MIT 许可证](./LICENSE)
