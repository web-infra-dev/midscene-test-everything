<p align="center">
  <img alt="Midscene Test Everything" width="160" src="https://github.com/user-attachments/assets/f60de3c1-dd6f-4213-97a1-85bf7c6e79e4"><br />
</p>

# Universal Device Playground

Playground lets you preview a connected device's screen and try actions in a browser.

From the repository root, run:

```sh
pnpm install
pnpm build
pnpm dev:playground
```

Open the URL printed in the terminal. Enter the device service URL and token, then select a device. You can connect to the [DOBOT MG400 service](../robot-arm/arm-service/README.md), [iOS AirLink](../ios-airlink/README.md), or your own Universal Device service.
