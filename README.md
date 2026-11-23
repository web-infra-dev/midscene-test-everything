<p align="center">
  <img alt="Midscene Test Everything" width="160" src="https://github.com/user-attachments/assets/f60de3c1-dd6f-4213-97a1-85bf7c6e79e4"><br />
</p>

<h1 align="center">Midscene Test Everything</h1>

<p align="center">
  <strong>If you can see it, you can test it.</strong><br />
  Drive end-to-end tests on any interface with vision models — car screens, physical phones, embedded panels, and whatever you build next.
</p>

<p align="center">
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

Automate physical touchscreens (car cockpits, industrial panels) via a robotic arm and camera observation. We provide the complete physical automation toolchain:
- **Spatial Calibration & Mapping**: Camera calibration and screen-to-arm coordinate transformation.
- **Motion Control Primitives**: Reusable tap, swipe, and gesture execution for automated testing.
- **Modular Arm SDK ([`arm-kit`](./packages/robot-arm/arm-kit/README.md))**: Pluggable interface to connect and control any robotic arm.
- **End-to-End Reference Demo**: Ready-to-run setup based on the **DOBOT MG400**.

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

Get started: [`ios-airlink`](./packages/ios-airlink/README.md)

### 🤝 Showcase your solution

We warmly welcome community contributions of successful integrations across different devices and scenarios! If you have built an alternative hardware solution, connectivity protocol, or unique platform practice, feel free to [open an issue](https://github.com/web-infra-dev/midscene-test-everything/issues/new) to let us know. We would love to feature and link your project right here for the community to see.

## 🏗️ Architecture & Workflow

We provide the complete infrastructure needed to bridge any physical device into vision-based AI testing:
- **AI Testing Infrastructure (Provided)**: Natural-language test execution (`aiAct`, `aiAssert`), Web Playground for live visual inspection, session management, and Agent tooling (MCP Server, CLI).
- **Universal Device Interface**: A minimal contract where developers only need to connect screen capture (`screenshot`) and action execution (`execute`).

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

### 1. Prerequisites: What you need to prepare

A complete physical test pipeline typically requires three fundamental components:
- **Target Screen**: The physical display under test (e.g. in-car screen, physical smartphone, industrial panel);
- **Visual Sensing**: A reliable way to capture the display (an overhead camera, HDMI/USB capture card, or screen mirroring);
- **Input Actuator**: A mechanism to interact with the screen (a robotic arm, Bluetooth HID module, stylus, or dedicated control API).

### 2. End-to-End Demos

#### Demo 1: Implementing a Device Service

Wrap your screen capture and actuator logic into a standard service with `@midscene/universal-device/server`:

```ts
import { createServer } from 'node:http';
import { createDeviceHandler } from '@midscene/universal-device/server';

const api = createDeviceHandler({
  token: process.env.MIDSCENE_UNIVERSAL_DEVICE_SERVICE_TOKEN ?? 'my-token',
  listDevices: () => [{ id: 'my-screen', name: 'My Screen', status: 'available', actions: ['tap'] }],
  readyDevice: (id) => ({
    signal: new AbortController().signal,
    // 1. Visual sensing: return current screen frame
    screenshot: async () => ({ jpeg: getScreenJpeg(), width: 1920, height: 1080, sequence: 1, receivedAt: Date.now() }),
    // 2. Action execution: trigger hardware tap/swipe
    execute: async (action) => { if (action.type === 'tap') await myHardware.tap(action.point.x, action.point.y); },
  }),
});

createServer((req, res) => { if (!api.handle(req, res)) res.writeHead(404).end(); }).listen(5801);
```

#### Demo 2: Visual Debugging in Playground (Optional)

Once the service is running, open the browser Playground to inspect live screen feeds and manually test hardware interactions:

```sh
npx @midscene/universal-device-playground
```

#### Demo 3: Writing Natural-Language E2E Tests

With the device service ready, drive your tests in plain language via the Midscene Agent:

```ts
import { agentFromUniversalDevice } from '@midscene/universal-device';

const agent = await agentFromUniversalDevice({ host: 'http://localhost:5801' });

try {
  await agent.aiAct('Open the music app and search for "Jay Chou"');
  await agent.aiAssert('The search results list shows songs by Jay Chou');
} finally {
  await agent.destroy();
}
```

See the [Universal Device documentation](./packages/universal-device/README.md) for complete protocol specs and advanced usage.

## 📦 Packages

| Package | What it does |
| --- | --- |
| [`universal-device`](./packages/universal-device/README.md) | Shared device interface, TypeScript SDK, HTTP API, CLI, and MCP server |
| [`universal-device-playground`](./packages/universal-device-playground/README.md) | Preview device screens and try actions in a browser |
| [`mg400-service`](./packages/robot-arm/mg400-service/README.md) | DOBOT MG400 device service, including setup, calibration, and touchscreen control |
| [`arm-kit`](./packages/robot-arm/arm-kit/README.md) | Adapter API for integrating custom robot arms |
| [`ios-airlink`](./packages/ios-airlink/README.md) | Connect to and control physical iPhones from macOS |

## 🤝 Contributing

See the [contributing guide](./CONTRIBUTING.md) for local setup and development checks.

## 🙏 Credits

- Special thanks to our community contributor, the [AVATR Robotic team](https://www.avatr.com), who spearheaded the development of the core architecture, camera calibration, and motion control for this physical testing solution, thoroughly validating it in real-world automotive cockpit scenarios.
- [iphone-use](https://github.com/xhoantran/iphone-use) is the source of parts of the Bluetooth HID descriptors used in iOS AirLink.

## 📖 License

Midscene Test Everything is licensed under the [MIT License](./LICENSE). You are welcome to use it and contribute.
