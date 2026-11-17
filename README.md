# Midscene Test Everything

[![CI](https://img.shields.io/github/actions/workflow/status/web-infra-dev/midscene-test-everything/ci.yml?branch=main&label=CI&style=flat-square&colorA=564341&colorB=EDED91)](https://github.com/web-infra-dev/midscene-test-everything/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/Docs-Universal%20Device-blue?style=flat-square&colorA=564341&colorB=EDED91)][universal-device]
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square&colorA=564341&colorB=EDED91)](./LICENSE)
[![Supported Node.js versions](https://img.shields.io/badge/Node.js-%5E20.19.0%20%7C%7C%20%5E22.12.0%20%7C%7C%20%3E%3D24.0.0-blue?style=flat-square&colorA=564341&colorB=EDED91)](./package.json)

English | [简体中文](./README.zh.md)

Midscene Test Everything brings Midscene's AI-powered end-to-end testing to any device through the open Universal Device protocol.

## 🔥 Features

- **Open protocol for custom devices.** Connect your own hardware to Midscene by exposing device discovery, screen capture, and input over HTTP.
- **AI-powered end-to-end testing.** Write tests in natural language and run them on any connected device with the [Midscene GUI Agent](https://midscenejs.com/).
- **MCP and Skills.** Use MCP or Skills to connect a device to agents such as Codex, Claude Code, and Cursor.

## 🎬 Showcase

- **[DOBOT MG400 robot arm](./packages/robot-arm/arm-service/README.md).** Test in-car touchscreens and embedded interfaces through physical touch without changing the device software.
- **[iOS AirLink](./packages/ios-airlink/README.md).** Run automated tests on a physical iPhone over Bluetooth HID without jailbreaking or enabling Developer Mode.

## 📚 Documentation

- [Universal Device documentation][universal-device]

## 📦 Packages

| Package | What it does |
| --- | --- |
| [`universal-device`](./packages/universal-device/README.md) | Provides the shared device interface, TypeScript SDK, and HTTP API |
| [`arm-kit`](./packages/robot-arm/arm-kit/README.md) | Provides an adapter API for integrating custom robot arms |
| [`arm-service`](./packages/robot-arm/arm-service) | Implements the DOBOT MG400 device service, including setup, calibration, and touchscreen control |
| [`ios-airlink`](./packages/ios-airlink) | Connects to and controls physical iPhones from macOS |
| [`universal-device-playground`](./packages/universal-device-playground/README.md) | Previews device screens and lets you try actions in a browser |

## 🤝 Contributing

See the [contributing guide](./CONTRIBUTING.md) for local setup and development checks.

## 🙏 Credits

- Thanks to the [contributors from AVATR](https://github.com/avatr-robot) for contributing the robot arm automation approach and its implementation for the DOBOT MG400.
- [iphone-use](https://github.com/xhoantran/iphone-use) is the source of parts of the Bluetooth HID descriptors used in iOS AirLink.

## 📖 License

Midscene Test Everything is licensed under the [MIT License](./LICENSE). You are welcome to use it and contribute.

[universal-device]: https://midscenejs.com/universal-device/
