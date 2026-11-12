# Midscene Robotics

[中文](./README.zh.md)

Use Midscene to operate an iPhone over Bluetooth or a touchscreen with a robot arm. Both connect to the same Open Device Playground and SDK.

## Quick start

From the repository root:

```sh
pnpm install
pnpm build
```

| Device | Start the service | Manager | Get the token |
| --- | --- | --- | --- |
| Robot arm (DOBOT MG400) | `pnpm --filter @midscene/arm-service start` | [localhost:5173](http://localhost:5173/) | **Robot settings → Open Device** |
| iPhone (on the Mac connected to the phone) | `pnpm iphone-use install` | [localhost:5801](http://localhost:5801/) | `pnpm iphone-use token` |

Add the device and follow the setup steps in its manager. Then run `pnpm dev:playground`, open [localhost:5800](http://localhost:5800/), and enter the service URL and token to select a device.

## Scripts and API

Copy [.env.example](./.env.example) to `.env`, fill in the service and model settings, and run:

```sh
pnpm exec tsx examples/open-device.ts
```

The example uses `agentFromOpenDevice()` to read the current screen. Both services serve Swagger UI at `/api/docs/` and the OpenAPI schema at `/api/openapi.json`.

[Protocol draft](./packages/open-device/rfc/index.html) · [MIT license](./LICENSE)
