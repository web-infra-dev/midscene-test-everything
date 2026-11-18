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

[Midscene.js](https://github.com/web-infra-dev/midscene) is a **vision-driven E2E testing framework**. Instead of relying on DOM trees, selectors, or accessibility labels, it looks at screenshots the way a user does: it finds elements by appearance, acts on what it sees, and verifies the visible result. Midscene already covers Web, Android, iOS, HarmonyOS, and desktop.

But plenty of interfaces have no test driver at all — an in-car touchscreen, a kiosk, a smart-home panel, a locked-down iPhone. As long as an interface can be **seen** (a screenshot, a capture card, a camera) and **operated** (an API, a HID device, a robot arm), a vision model can test it.

This repository is where we explore **general-purpose ways to connect any interface** to Midscene, so developers can use vision models to run E2E tests on whatever screen they need to test:

```text
 Natural-language test  ──▶  Midscene GUI Agent (vision model)
                                     │
                         Universal Device protocol (HTTP)
                    discovery · sessions · screenshots · input
                                     │
         ┌───────────────────────────┼───────────────────────────┐
   Robot arm + camera        Bluetooth HID + mirroring       Your own device
   (car screens, panels)     (physical iPhone)               (anything with a screen)
```

## 🔥 Features

- **Test interfaces you can't instrument.** No SDK, debug mode, or code change on the device under test — screen capture plus physical or HID input is enough.
- **One open protocol for any device.** Expose device discovery, screenshots, and input over HTTP, and every Midscene capability works on top of it.
- **Natural-language tests, the same API everywhere.** Use `aiAct`, `aiAssert`, `aiQuery`, and the rest of the [Midscene Agent API](https://midscenejs.com/) on any connected device.
- **Ready for AI agents.** Connect a device to Codex, Claude Code, Cursor, and other agents through the built-in MCP server and Skills.

## 🎬 Showcase

### 🦾 Robot arm × in-car touchscreen

A DOBOT MG400 robot arm taps and swipes a real in-car screen while an overhead camera captures the display. Midscene reads the screen, decides where to touch, and verifies the result — without touching the car's software.

<!-- TODO: Replace with the robot arm demo video (upload to GitHub to get a user-attachments URL). -->
> 🎥 _Video placeholder: robot arm demo coming soon._

> [!NOTE]
> **This approach is contributed by the [AVATR Robotic team](https://github.com/avatr-robot).**
>
> <!-- TODO(AVATR Robotic team): Introduce the team, the in-vehicle testing scenarios behind this solution, and how it is used in production. -->
> _Placeholder: an introduction from the AVATR Robotic team is coming soon._

Get started: [`arm-service`](./packages/robot-arm/arm-service/README.md) · [Setup guide](https://midscenejs.com/universal-device/quick-start#dobot-mg400) · Bring your own arm with [`arm-kit`](./packages/robot-arm/arm-kit/README.md)

### 📱 iOS AirLink × physical iPhone

Run automated tests on a physical iPhone from a Mac over Bluetooth HID — no jailbreak, no Developer Mode. Use USB, AirPlay, or an external camera as the screen source.

<!-- TODO: Replace with the iOS AirLink demo video (upload to GitHub to get a user-attachments URL). -->
> 🎥 _Video placeholder: iOS AirLink demo coming soon._

Get started: [`ios-airlink`](./packages/ios-airlink/README.md) · [Setup guide](https://midscenejs.com/universal-device/quick-start#ios-airlink)

### 🧩 Your device next

Have a screen Midscene can't reach yet? Implement the Universal Device protocol with `createDeviceHandler()` from `@midscene/universal-device/server`, and your device gets the full Midscene toolkit. [Contributions are welcome](./CONTRIBUTING.md).

## ⚡ Quick start

Once a device service is running, write tests against it in natural language:

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

See the [Universal Device documentation](https://midscenejs.com/universal-device/) for model configuration, device setup, the CLI, and the MCP server.

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

- Thanks to the [AVATR Robotic team](https://github.com/avatr-robot) for contributing the robot arm automation approach and its DOBOT MG400 implementation.
- [iphone-use](https://github.com/xhoantran/iphone-use) is the source of parts of the Bluetooth HID descriptors used in iOS AirLink.

## 📖 License

Midscene Test Everything is licensed under the [MIT License](./LICENSE). You are welcome to use it and contribute.
