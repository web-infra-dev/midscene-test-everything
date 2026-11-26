<p align="center">
  <img alt="Midscene Test Everything" width="160" src="https://github.com/user-attachments/assets/f60de3c1-dd6f-4213-97a1-85bf7c6e79e4"><br />
</p>

<h1 align="center">Midscene Test Everything</h1>

<p align="center">
  <strong>看得见的界面，就能测。</strong><br />
  用视觉模型驱动任意界面的端到端测试：车机屏幕、iPhone 真机、嵌入式面板，以及你接下来要接入的任何设备。
</p>

<p align="center">
  <a href="./README.md">English</a> / 简体中文
</p>

<p align="center">
  <a href="https://github.com/web-infra-dev/midscene-test-everything/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/web-infra-dev/midscene-test-everything/ci.yml?branch=main&label=CI&style=flat-square&color=00a8f0" alt="CI" /></a>
  <a href="https://github.com/web-infra-dev/midscene/tree/main/packages/connect"><img src="https://img.shields.io/badge/Docs-Midscene%20Connect-00a8f0?style=flat-square" alt="Docs" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-00a8f0?style=flat-square" alt="License" /></a>
  <a href="./package.json"><img src="https://img.shields.io/badge/Node.js-%5E20.19%20%7C%7C%20%5E22.12%20%7C%7C%20%3E%3D24-00a8f0?style=flat-square" alt="Node.js" /></a>
  <a href="https://midscenejs.com/zh/"><img src="https://badge.midscenejs.com/by-midscene" alt="E2E by Midscene.js" /></a>
</p>

## 💡 项目背景

[Midscene.js](https://github.com/web-infra-dev/midscene) 是**视觉驱动的端到端测试框架**：像人类一样看屏幕截图找元素、做操作，无需依赖 DOM 树或系统无障碍接口。

但在车机触屏、工控屏、或无法开启调试的 iPhone 上，往往根本没有软件测试驱动。只要界面能被**看到**（截图、摄像头）且能被**操作**（HID、机械臂），视觉模型就能测试它。

本项目致力于探索**通用化的跨设备接入方案**，让任何屏幕都能快速接入视觉 AI 测试。

## 🎬 案例展示

### 🦾 机械臂 × 物理触屏（车机等无调试接口屏幕）

车机、工控屏等封闭系统通常没有调试接口。我们的方案是**用机械臂配合摄像头，像真人一样观察和操作屏幕**。

我们探索并跑通了包含相机标定、坐标转换与机械臂控制在内的完整物理自动化方案。仓库中提供了基于 **DOBOT MG400** 的参考示例（Demo）；你可以直接照抄该方案，也能通过 [`arm-kit`](./packages/robot-arm/arm-kit/README.zh.md) 像拼积木一样接入任意型号的机械臂。

<!-- TODO：替换为机械臂演示视频（上传到 GitHub 获取 user-attachments 链接）。 -->
> 🎥 _视频占位：机械臂演示视频即将补充。_

> [!NOTE]
> **特别致谢来自社区的贡献者 —— [阿维塔科技 Robotic 团队](https://www.avatr.com)**
>
> 这套机械臂物理触屏自动化方案的核心架构研发与真实场景落地，均由阿维塔团队主导完成并开源贡献。正是得益于他们在车载智能座舱实战中沉淀的标定算法与控制工程经验，才让这套通用物理测试基础设施成为现实。
>
> *提示：演示视频中展示的 DOBOT MG400 机械臂仅作为跑通全流程的参考 Demo，并非购买建议，开发者可以根据自己的实际业务场景与预算灵活选型。*

### 📱 蓝牙 HID × iPhone 真机

无需越狱或开启开发者模式，通过 Mac 蓝牙 HID 驱动 iPhone 真机自动化，屏幕源支持 USB、AirPlay 或外接摄像头。

<!-- TODO：替换为 iOS AirLink 演示视频（上传到 GitHub 获取 user-attachments 链接）。 -->
> 🎥 _视频占位：iOS AirLink 演示视频即将补充。_

开始使用：[`ios-airlink`](./packages/ios-airlink/README.zh.md)

### 🤝 欢迎贡献你的成功案例

我们非常欢迎社区贡献更多不同设备与场景的成功接入实践！如果你有其他优秀的硬件方案、连接协议或独特平台的实战经验，欢迎[提交 Issue](https://github.com/web-infra-dev/midscene-test-everything/issues/new) 告诉我们。我们会把你的方案链接展示在这个版块，让更多开发者看到你的精彩实践。

## 🏗️ 架构分工与工作流程

真实物理屏幕与设备的自动化测试往往涉及软硬件协同，并非几分钟就能轻巧跑通的简单任务。为了让接入尽可能清晰、低成本，我们做了彻底的分工：**框架负责所有通用的 AI 测试基建，开发者仅需提供硬件的画面采集与动作执行。**

```text
┌────────────────────────────────────────────────────────┐
│          @midscene/connect 提供（通用测试基建）          │
│  • 自然语言 E2E 测试 (aiAct / aiAssert / aiQuery)        │
│  • CLI、Skill 与浏览器 Playground                       │
│  • HTTP 服务（Token 鉴权、Swagger 接口文档）             │
└───────────────────────────┬────────────────────────────┘
                            │ Midscene Connect 协议 (HTTP)
┌───────────────────────────┴────────────────────────────┐
│          开发者负责（一个 device.mjs 文件）              │
│  • screenshot()：采集当前画面 (PNG/JPEG)                │
│  • actions：tap / swipe / typeText / homeButton 等      │
│  • 自定义动作（参数用 JSON Schema 描述）                 │
└────────────────────────────────────────────────────────┘
```

### 1. 前置准备：硬件三要素

一套完整的物理测试链路通常需要具备以下三项要素：
- **被测屏幕**：车机中控屏、物理手机、智能家居面板等目标设备；
- **画面感知**：能稳定采集屏幕画面的途径（外置摄像头、HDMI/USB 采集卡、网络/蓝牙投屏等）；
- **操作执行**：能对屏幕施加物理或逻辑操作的机构（机械臂、蓝牙 HID 芯片、物理触控笔或专属控制 API）。

### 2. 端到端接入示例（Demos）

#### Demo 1：定义并启动设备

在一个文件里描述画面采集与操作执行，再用 [`@midscene/connect`](https://github.com/web-infra-dev/midscene/tree/main/packages/connect) 启动服务：

```js
// my-screen.mjs
export default {
  name: 'My Screen',
  pointerType: 'touch',
  async connect() {
    return {
      screenshot: () => getScreenJpeg(), // 1. 画面采集
      actions: {
        tap: (p) => myHardware.tap(p.x, p.y), // 2. 操作执行
        swipe: (from, to) => myHardware.swipe(from, to),
      },
    };
  },
};
```

```sh
npx @midscene/connect serve ./my-screen.mjs
```

服务启动后会打印访问地址，接口文档位于 `/api/docs/`。

#### Demo 2：使用 Playground 调试设备（可选）

```sh
npx @midscene/connect playground --url http://127.0.0.1:5820
```

#### Demo 3：编写并运行自然语言 E2E 测试

```ts
import { agentOverConnectProtocol } from '@midscene/connect';

const agent = await agentOverConnectProtocol({ url: 'http://127.0.0.1:5820' });

try {
  await agent.aiAct('打开音乐应用，搜索“周杰伦”');
  await agent.aiAssert('列表中展示了周杰伦的歌曲');
} finally {
  await agent.destroy();
}
```

iOS AirLink 与 MG400 服务会同时托管多台设备，每台设备的地址是 `http://<host>:<port>/devices/<id>`，`GET /devices` 可列出全部设备。

## 📦 主要组件

| 组件 | 用途 |
| --- | --- |
| [`mg400-service`](./packages/robot-arm/mg400-service/README.zh.md) | DOBOT MG400 设备服务，提供配置、校准和触屏操作 |
| [`arm-kit`](./packages/robot-arm/arm-kit/README.zh.md) | 机械臂适配器接口，可用于接入自定义机械臂 |
| [`ios-airlink`](./packages/ios-airlink/README.md) | 在 macOS 上连接和控制 iPhone 真机 |
| [`robotics-vision`](./packages/shared/vision/README.zh.md) | 跨平台摄像头采集、ArUco 屏幕标定与透视校正 |

## 🤝 参与贡献

本地开发环境和检查命令见[贡献指南](./CONTRIBUTING.md)。

## 🙏 致谢

- 特别感谢来自社区的贡献者 [阿维塔科技 Robotic 团队](https://www.avatr.com)：主导研发了机械臂物理触屏自动化方案的核心架构、相机标定与运动控制能力，并在真实车载座舱测试场景中完成了全面落地验证。
- iOS AirLink 的部分蓝牙 HID 描述符改编自 [iphone-use](https://github.com/xhoantran/iphone-use)。

## 📖 许可证

Midscene Test Everything 项目基于 [MIT 协议](./LICENSE)，请自由地享受和参与开源。
