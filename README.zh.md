<p align="center">
  <img alt="Midscene Test Everything" width="160" src="https://github.com/user-attachments/assets/f60de3c1-dd6f-4213-97a1-85bf7c6e79e4"><br />
</p>

<h1 align="center">Midscene Test Everything</h1>

<p align="center">
  <strong>看得见的界面，就能测。</strong><br />
  用视觉模型驱动任意界面的端到端测试：车机屏幕、iPhone 真机、嵌入式面板，以及你接下来要接入的任何设备。
</p>

<p align="center">
  <a href="https://midscenejs.com/zh/universal-device/">文档</a> ·
  <a href="https://github.com/web-infra-dev/midscene">Midscene.js</a> ·
  <a href="./README.md">English</a> / 简体中文
</p>

<p align="center">
  <a href="https://github.com/web-infra-dev/midscene-test-everything/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/web-infra-dev/midscene-test-everything/ci.yml?branch=main&label=CI&style=flat-square&color=00a8f0" alt="CI" /></a>
  <a href="https://midscenejs.com/zh/universal-device/"><img src="https://img.shields.io/badge/Docs-Universal%20Device-00a8f0?style=flat-square" alt="Docs" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-00a8f0?style=flat-square" alt="License" /></a>
  <a href="./package.json"><img src="https://img.shields.io/badge/Node.js-%5E20.19%20%7C%7C%20%5E22.12%20%7C%7C%20%3E%3D24-00a8f0?style=flat-square" alt="Node.js" /></a>
  <a href="https://midscenejs.com/zh/"><img src="https://badge.midscenejs.com/by-midscene" alt="E2E by Midscene.js" /></a>
</p>

## 💡 项目背景

[Midscene.js](https://github.com/web-infra-dev/midscene) 是一个**视觉驱动的端到端测试框架**。它不依赖 DOM 树、选择器或无障碍标注，而是像用户一样看截图：按外观定位元素，根据画面执行操作，再验证界面上可见的结果。目前 Midscene 已支持 Web、Android、iOS、HarmonyOS 和桌面端。

但还有大量界面根本没有可用的测试驱动：车机触屏、自助终端、智能家居面板、无法开启调试的 iPhone…… 只要一个界面能被**看到**（截图、采集卡、摄像头）并且能被**操作**（API、HID 设备、机械臂），视觉模型就能测试它。

我们在这个仓库里探索**更多通用化的接入方案**，让开发者可以用视觉模型驱动任意界面的端到端测试：

```text
   自然语言测试用例  ──▶  Midscene GUI Agent（视觉模型）
                                   │
                     Universal Device 开放协议（HTTP）
                      设备发现 · 会话 · 截图 · 输入
                                   │
       ┌───────────────────────────┼───────────────────────────┐
  机械臂 + 摄像头             蓝牙 HID + 投屏               你自己的设备
  （车机屏幕、面板）          （iPhone 真机）              （任何有屏幕的设备）
```

## 🔥 特性

- **测试无法插桩的界面**：被测设备无需集成 SDK、开启调试模式或修改代码，只要能采集画面、能物理或 HID 输入即可。
- **一个开放协议接入任意设备**：通过 HTTP 提供设备发现、截图和输入接口，就能使用 Midscene 的全部能力。
- **自然语言写测试，各端同一套 API**：在任意已接入设备上使用 `aiAct`、`aiAssert`、`aiQuery` 等 [Midscene Agent API](https://midscenejs.com/zh/)。
- **为 AI Agent 准备好**：通过内置的 MCP Server 和 Skills，将设备接入 Codex、Claude Code、Cursor 等 Agent。

## 🎬 案例展示

### 🦾 机械臂 × 车机触屏

DOBOT MG400 机械臂在真实车机屏幕上点击和滑动，顶部摄像头采集画面。Midscene 读取屏幕、决定点击位置并验证结果，全程无需改动车机软件。

<!-- TODO：替换为机械臂演示视频（上传到 GitHub 获取 user-attachments 链接）。 -->
> 🎥 _视频占位：机械臂演示视频即将补充。_

> [!NOTE]
> **该方案由[阿维塔 Robotic 团队](https://github.com/avatr-robot)提供。**
>
> <!-- TODO(阿维塔 Robotic 团队)：补充团队介绍、方案背后的车机测试场景，以及在实际生产中的使用情况。 -->
> _占位：阿维塔 Robotic 团队的方案介绍即将补充。_

参阅 [MG400 配置指南](./packages/robot-arm/arm-service/README.zh.md)，或用 [`arm-kit`](./packages/robot-arm/arm-kit/README.zh.md) 接入你自己的机械臂。

### 📱 iOS AirLink × iPhone 真机

在 Mac 上通过蓝牙 HID 对 iPhone 真机运行自动化测试，无需越狱，也无需开启开发者模式。屏幕来源可选 USB、AirPlay 或外接摄像头。

<!-- TODO：替换为 iOS AirLink 演示视频（上传到 GitHub 获取 user-attachments 链接）。 -->
> 🎥 _视频占位：iOS AirLink 演示视频即将补充。_

开始使用：[`ios-airlink`](./packages/ios-airlink/README.md) · [配置指南](https://midscenejs.com/zh/universal-device/quick-start#ios-airlink)

### 🧩 下一个就是你的设备

有 Midscene 还够不着的屏幕？用 `@midscene/universal-device/server` 中的 `createDeviceHandler()` 实现 Universal Device 协议，你的设备就能用上 Midscene 的全部能力。[欢迎贡献](./CONTRIBUTING.md)。

## ⚡ 快速上手

启动设备服务后，就可以用自然语言编写测试：

```ts
import { agentFromUniversalDevice } from '@midscene/universal-device';

const agent = await agentFromUniversalDevice({ host: 'http://localhost:5801' });

try {
  await agent.aiAct('打开音乐应用，搜索“周杰伦”');
  await agent.aiAssert('搜索结果列表中显示了周杰伦的歌曲');
} finally {
  await agent.destroy();
}
```

模型配置、设备接入、CLI 和 MCP Server 的用法见 [Universal Device 文档](https://midscenejs.com/zh/universal-device/)。

## 📦 主要组件

| 组件 | 用途 |
| --- | --- |
| [`universal-device`](./packages/universal-device/README.zh.md) | 统一设备接口、TypeScript SDK、HTTP API、CLI 和 MCP Server |
| [`universal-device-playground`](./packages/universal-device-playground/README.md) | 在浏览器里预览设备画面并调试操作 |
| [`arm-service`](./packages/robot-arm/arm-service/README.zh.md) | DOBOT MG400 设备服务，提供配置、校准和触屏操作 |
| [`arm-kit`](./packages/robot-arm/arm-kit/README.zh.md) | 机械臂适配器接口，可用于接入自定义机械臂 |
| [`ios-airlink`](./packages/ios-airlink/README.md) | 在 macOS 上连接和控制 iPhone 真机 |

## 🤝 参与贡献

本地开发环境和检查命令见[贡献指南](./CONTRIBUTING.md)。

## 🙏 致谢

- 感谢[阿维塔 Robotic 团队](https://github.com/avatr-robot)贡献机械臂自动化方案，并提供 DOBOT MG400 的具体实现。
- iOS AirLink 的部分蓝牙 HID 描述符改编自 [iphone-use](https://github.com/xhoantran/iphone-use)。

## 📖 许可证

Midscene Test Everything 项目基于 [MIT 协议](./LICENSE)，请自由地享受和参与开源。
