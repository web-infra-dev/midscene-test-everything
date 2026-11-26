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
  <a href="https://github.com/web-infra-dev/midscene/tree/main/packages/connect"><img src="https://img.shields.io/badge/Docs-Midscene%20Connect-00a8f0?style=flat-square" alt="Docs" /></a>
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
- **AI Testing Infrastructure (Provided)**: [`@midscene/connect`](https://github.com/web-infra-dev/midscene/tree/main/packages/connect) in the Midscene repository provides natural-language test execution (`aiAct`, `aiAssert`), a Playground for live visual inspection, and Agent tooling (CLI, Skill).
- **Device Definition**: A minimal contract. Developers connect screen capture (`screenshot`) and input primitives (`tap`, `swipe`, ...) in one `.mjs` file.

```text
┌────────────────────────────────────────────────────────┐
│            Provided by @midscene/connect               │
│  • Natural-language E2E tests (aiAct / aiAssert)       │
│  • CLI, Skill, and browser Playground                  │
│  • HTTP server with token auth and Swagger docs        │
└───────────────────────────┬────────────────────────────┘
                            │ Midscene Connect protocol (HTTP)
┌───────────────────────────┴────────────────────────────┐
│            Implemented by developers (device.mjs)      │
│  • screenshot(): capture the screen (PNG/JPEG)         │
│  • actions: tap / swipe / typeText / homeButton / ...  │
│  • custom actions with JSON Schema params              │
└────────────────────────────────────────────────────────┘
```

### 1. Prerequisites: What you need to prepare

A complete physical test pipeline typically requires three fundamental components:
- **Target Screen**: The physical display under test (e.g. in-car screen, physical smartphone, industrial panel);
- **Visual Sensing**: A reliable way to capture the display (an overhead camera, HDMI/USB capture card, or screen mirroring);
- **Input Actuator**: A mechanism to interact with the screen (a robotic arm, Bluetooth HID module, stylus, or dedicated control API).

### 2. End-to-End Demos

#### Demo 1: Define and serve a device

Describe your screen capture and actuator in one file, then serve it with [`@midscene/connect`](https://github.com/web-infra-dev/midscene/tree/main/packages/connect):

```js
// my-screen.mjs
export default {
  name: 'My Screen',
  pointerType: 'touch',
  async connect() {
    return {
      screenshot: () => getScreenJpeg(), // 1. Visual sensing
      actions: {
        tap: (p) => myHardware.tap(p.x, p.y), // 2. Input
        swipe: (from, to) => myHardware.swipe(from, to),
      },
    };
  },
};
```

```sh
npx @midscene/connect serve ./my-screen.mjs
```

The service prints its URL and serves API docs at `/api/docs/`.

#### Demo 2: Visual debugging in the Playground (optional)

```sh
npx @midscene/connect playground --url http://127.0.0.1:5820
```

#### Demo 3: Natural-language E2E tests

```ts
import { agentOverConnectProtocol } from '@midscene/connect';

const agent = await agentOverConnectProtocol({ url: 'http://127.0.0.1:5820' });

try {
  await agent.aiAct('Open the music app and search for "Jay Chou"');
  await agent.aiAssert('The search results list shows songs by Jay Chou');
} finally {
  await agent.destroy();
}
```

iOS AirLink and the MG400 service host many devices. Each one is at `http://<host>:<port>/devices/<id>`, and `GET /devices` lists them.

## 📦 Packages

| Package | What it does |
| --- | --- |
| [`mg400-service`](./packages/robot-arm/mg400-service/README.md) | DOBOT MG400 device service, including setup, calibration, and touchscreen control |
| [`arm-kit`](./packages/robot-arm/arm-kit/README.md) | Adapter API for integrating custom robot arms |
| [`ios-airlink`](./packages/ios-airlink/README.md) | Connect to and control physical iPhones from macOS |
| [`robotics-vision`](./packages/shared/vision/README.md) | Cross-platform camera capture, ArUco screen calibration, and perspective correction |

## 🤝 Contributing

See the [contributing guide](./CONTRIBUTING.md) for local setup and development checks.

## 🙏 Credits

- Special thanks to our community contributor, the [AVATR Robotic team](https://www.avatr.com), who spearheaded the development of the core architecture, camera calibration, and motion control for this physical testing solution, thoroughly validating it in real-world automotive cockpit scenarios.
- [iphone-use](https://github.com/xhoantran/iphone-use) is the source of parts of the Bluetooth HID descriptors used in iOS AirLink.

## 📖 License

Midscene Test Everything is licensed under the [MIT License](./LICENSE). You are welcome to use it and contribute.
