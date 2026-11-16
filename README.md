# Midscene Robotics

[中文](./README.zh.md)

Use Midscene to operate an iPhone over Bluetooth or a touchscreen with a robot arm. Both connect to the same Universal Device Playground and SDK.

## Quick start

From the repository root:

```sh
pnpm install
pnpm build
```

| Device | Start the service | Manager | Get the token |
| --- | --- | --- | --- |
| Robot arm (DOBOT MG400) | `pnpm --filter @midscene/arm-service start` | [localhost:5173](http://localhost:5173/) | **Robot settings → Universal Device** |
| iPhone (on the Mac connected to the phone) | `pnpm ios-airlink install` | [localhost:5801](http://localhost:5801/) | `pnpm ios-airlink token` |

Add the device and follow the setup steps in its manager. Then run `pnpm dev:playground`, open [localhost:5800](http://localhost:5800/), and enter the service URL and token to select a device.

## Scripts and API

Copy [.env.example](./.env.example) to `.env`, fill in the service and model settings, and run:

```sh
pnpm exec tsx examples/universal-device.ts
```

The example uses `agentFromUniversalDevice()` to read the current screen. Both services serve Swagger UI at `/api/docs/` and the OpenAPI schema at `/api/openapi.json`.

[Protocol draft](./packages/universal-device/rfc/index.html) · [MIT license](./LICENSE)
