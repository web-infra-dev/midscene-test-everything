# Midscene Test Everything

[![CI](https://img.shields.io/github/actions/workflow/status/web-infra-dev/midscene-test-everything/ci.yml?branch=main&label=CI&style=flat-square&colorA=564341&colorB=EDED91)](https://github.com/web-infra-dev/midscene-test-everything/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/Docs-Universal%20Device-blue?style=flat-square&colorA=564341&colorB=EDED91)][universal-device]
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square&colorA=564341&colorB=EDED91)](./LICENSE)
[![Supported Node.js versions](https://img.shields.io/badge/Node.js-%5E20.19.0%20%7C%7C%20%5E22.12.0%20%7C%7C%20%3E%3D24.0.0-blue?style=flat-square&colorA=564341&colorB=EDED91)](./package.json)

[English](./README.md) | 简体中文

Midscene Test Everything 通过 Universal Device 开放协议，将 Midscene 的 AI 端到端测试能力带到任意设备。

## 🔥 特性

- **开放协议，支持自定义设备**：通过 HTTP 提供设备发现、截图和输入接口，将自有硬件接入 Midscene。
- **AI 端到端测试**：用自然语言写测试，让 [Midscene GUI Agent](https://midscenejs.com/) 在任意已接入的设备上执行。
- **MCP 与 Skills**：通过 MCP 或 Skills，将指定设备接入 Codex、Claude Code、Cursor 等 Agent。

## 🎬 案例展示

- **[DOBOT MG400 机械臂](./packages/robot-arm/arm-service/README.md)**：通过物理触控测试车机屏幕和嵌入式界面，无需改动设备软件。
- **[iOS AirLink](./packages/ios-airlink/README.md)**：通过蓝牙 HID 在 iPhone 真机上运行自动化测试，无需越狱或开启开发者模式。

## 📚 文档

- [Universal Device 文档][universal-device]

## 📦 主要组件

| 组件 | 用途 |
| --- | --- |
| [`universal-device`](./packages/universal-device/README.md) | 提供统一设备接口、TypeScript SDK 和 HTTP API |
| [`arm-kit`](./packages/robot-arm/arm-kit/README.md) | 提供机械臂适配器接口，可用于接入自定义机械臂 |
| [`arm-service`](./packages/robot-arm/arm-service) | 实现 DOBOT MG400 的设备服务，提供配置、校准和触屏操作 |
| [`ios-airlink`](./packages/ios-airlink) | 在 macOS 上连接和控制 iPhone 真机 |
| [`universal-device-playground`](./packages/universal-device-playground/README.md) | 在浏览器里预览设备画面并调试操作 |

## 🤝 参与贡献

本地开发环境和检查命令见[贡献指南](./CONTRIBUTING.md)。

## 📖 许可证

Midscene Test Everything 项目基于 [MIT 协议](./LICENSE)，请自由地享受和参与开源。

[universal-device]: https://midscenejs.com/zh/universal-device/
