<p align="center">
  <img alt="Midscene Test Everything" width="160" src="https://github.com/user-attachments/assets/f60de3c1-dd6f-4213-97a1-85bf7c6e79e4"><br />
</p>

<h1 align="center">Midscene Test Everything</h1>

<p align="center">
  <strong>If you can see it, you can test it.</strong><br />
  Drive end-to-end tests on any interface with vision models — car screens, physical phones, embedded panels, and whatever you build next.
</p>

<p align="center">
  <a href="https://midscenejs.com/universal-device/">Docs</a> ·
  <a href="https://github.com/web-infra-dev/midscene">Midscene.js</a> ·
  English / <a href="./README.zh.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/web-infra-dev/midscene-test-everything/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/web-infra-dev/midscene-test-everything/ci.yml?branch=main&label=CI&style=flat-square&color=00a8f0" alt="CI" /></a>
  <a href="https://midscenejs.com/universal-device/"><img src="https://img.shields.io/badge/Docs-Universal%20Device-00a8f0?style=flat-square" alt="Docs" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-00a8f0?style=flat-square" alt="License" /></a>
  <a href="./package.json"><img src="https://img.shields.io/badge/Node.js-%5E20.19%20%7C%7C%20%5E22.12%20%7C%7C%20%3E%3D24-00a8f0?style=flat-square" alt="Node.js" /></a>
  <a href="https://midscenejs.com/"><img src="https://badge.midscenejs.com/by-midscene" alt="E2E by Midscene.js" /></a>
</p>

## 💡 Why this project

[Midscene.js](https://github.com/web-infra-dev/midscene) is a **vision-driven E2E testing framework**: it interacts with screens visually like a human, without relying on DOM trees or OS accessibility labels.

However, many interfaces (car touchscreens, embedded panels, or locked-down iPhones) have no software test driver at all. As long as a screen can be **seen** (screenshots, cameras) and **operated** (HID, robot arms), vision models can test it.

This repository explores **universal physical & device integrations**, bringing vision AI testing to any screen.

## 🎬 Showcase

### 🦾 Robot Arm × Physical Touchscreen (Car Screens & Beyond)

Automotive cockpits and industrial panels rarely expose debug bridges. Our approach is **using a robotic arm paired with a camera to operate and observe physical screens just like a human**.

We explored and validated a complete physical automation workflow (camera calibration, coordinate mapping, and motion control) as reusable infrastructure. We provide an end-to-end reference demo based on the **DOBOT MG400**; you can replicate this setup directly, or assemble like LEGO by plugging in any robot arm via [`arm-kit`](./packages/robot-arm/arm-kit/README.md).

<!-- TODO: Replace with the robot arm demo video (upload to GitHub to get a user-attachments URL). -->
> 🎥 _Video placeholder: robot arm demo coming soon._

> [!NOTE]
> **Special thanks to our community contributor — [AVATR Robotic team](https://www.avatr.com)**
>
> The core architecture and real-world production rollout of this robot arm testing solution were led and open-sourced by the AVATR team. Their extensive hands-on experience and calibration engineering in automotive cockpits made this universal infrastructure possible.
>
> *Note: The DOBOT MG400 robotic arm shown in the demo is strictly a reference implementation to showcase the end-to-end workflow, not a hardware endorsement or purchase recommendation. Developers are encouraged to choose hardware tailored to their own requirements.*

### 📱 Bluetooth HID × Physical iPhone

Run automated tests on physical iPhones over Mac Bluetooth HID with zero jailbreak or Developer Mode. Uses USB, AirPlay, or cameras for screen capture.

<!-- TODO: Replace with the iOS AirLink demo video (upload to GitHub to get a user-attachments URL). -->
> 🎥 _Video placeholder: iOS AirLink demo coming soon._

Get started: [`ios-airlink`](./packages/ios-airlink/README.md) · [Setup guide](https://midscenejs.com/universal-device/quick-start#ios-airlink)

### 🤝 Showcase your solution

We warmly welcome community contributions of successful integrations across different devices and scenarios! If you have built an alternative hardware solution, connectivity protocol, or unique platform practice, feel free to [open an issue](https://github.com/web-infra-dev/midscene-test-everything/issues/new) to let us know. We would love to feature and link your project right here for the community to see.

## 🏗️ Architecture & Division of Responsibilities

We maintain a clean separation of concerns: **the framework handles all generic AI testing infrastructure, while developers only implement hardware-specific sensing and control.**

```text
┌────────────────────────────────────────────────────────┐
│               Provided by this project (Infra)         │
│  • Natural-language E2E tests (aiAct / aiAssert)       │
│  • Web Playground (live visual inspection & debugging) │
│  • Server foundation (session locks, auth, OpenAPI)    │
│  • AI Agent tooling (built-in MCP Server, CLI, Skills) │
└───────────────────────────┬────────────────────────────┘
                            │ Universal Device Protocol (HTTP)
┌───────────────────────────┴────────────────────────────┐
│               Implemented by developers (Core API)     │
│  • screenshot(): capture screen frame (JPEG Buffer)    │
│  • execute(action): execute physical tap/swipe actions │
│  • listDevices(): report device info & supported actions│
└────────────────────────────────────────────────────────┘
```

- **What you get**: Zero prompt engineering, coordinate guessing, or concurrency headaches — turn-key natural language testing, browser playground, and Agent integrations out of the box.
- **What you implement**: Plug your screen capture (`screenshot`) and hardware actions (`execute`) into `createDeviceHandler()`.

## ⚡ Quick start

### 1. Run tests (Connected device)

```ts
import { agentFromUniversalDevice } from '@midscene/universal-device';

const agent = await agentFromUniversalDevice({ host: 'http://localhost:5801' });
await agent.aiAct('Open the music app and search for "Jay Chou"');
await agent.aiAssert('The search results list shows songs by Jay Chou');
await agent.destroy();
```
*Or launch `npx @midscene/universal-device-playground` for visual debugging in your browser.*

### 2. Connect a new device (Implement core interfaces)

Expose your device in a few lines with `@midscene/universal-device/server`:

```ts
import { createServer } from 'node:http';
import { createDeviceHandler } from '@midscene/universal-device/server';

const api = createDeviceHandler({
  token: 'service-token',
  listDevices: () => [{ id: 'my-screen', name: 'My Screen', status: 'available', actions: ['tap'] }],
  readyDevice: (id) => ({
    signal: new AbortController().signal,
    screenshot: async () => ({ jpeg: getScreenJpeg(), width: 1920, height: 1080, sequence: 1, receivedAt: Date.now() }),
    execute: async (action) => { if (action.type === 'tap') await myHardware.tap(action.point.x, action.point.y); },
  }),
});

createServer((req, res) => { if (!api.handle(req, res)) res.writeHead(404).end(); }).listen(5801);
```

See the [Universal Device documentation](https://midscenejs.com/universal-device/) for complete protocol specs and advanced usage.

## 📦 Packages

| Package | What it does |
| --- | --- |
| [`universal-device`](./packages/universal-device/README.md) | Shared device interface, TypeScript SDK, HTTP API, CLI, and MCP server |
| [`universal-device-playground`](./packages/universal-device-playground/README.md) | Preview device screens and try actions in a browser |
| [`arm-service`](./packages/robot-arm/arm-service/README.md) | DOBOT MG400 device service, including setup, calibration, and touchscreen control |
| [`arm-kit`](./packages/robot-arm/arm-kit/README.md) | Adapter API for integrating custom robot arms |
| [`ios-airlink`](./packages/ios-airlink/README.md) | Connect to and control physical iPhones from macOS |

## 🤝 Contributing

See the [contributing guide](./CONTRIBUTING.md) for local setup and development checks.

## 🙏 Credits

- Special thanks to our community contributor, the [AVATR Robotic team](https://www.avatr.com), who spearheaded the development of the core architecture, camera calibration, and motion control for this physical testing solution, thoroughly validating it in real-world automotive cockpit scenarios.
- [iphone-use](https://github.com/xhoantran/iphone-use) is the source of parts of the Bluetooth HID descriptors used in iOS AirLink.

## 📖 License

Midscene Test Everything is licensed under the [MIT License](./LICENSE). You are welcome to use it and contribute.
