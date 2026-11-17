# Universal Device

`@midscene/universal-device` connects Midscene to device services over HTTP. The protocol covers device discovery, exclusive sessions, screenshots, and input.

- Use `listUniversalDevices()` to find devices and `agentFromUniversalDevice()` to run Midscene tests on a connected device. Call `agent.destroy()` when the test finishes to release the session.
- Use `createDeviceHandler()` from `@midscene/universal-device/server` to expose your hardware's screen and input actions.
- Use the `universal-device` CLI to inspect and operate devices or start the MCP server.

[Universal Device documentation](https://midscenejs.com/universal-device/)
