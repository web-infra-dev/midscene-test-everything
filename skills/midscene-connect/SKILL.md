---
name: midscene-connect
description: >
  Vision-driven automation for any screen served with Midscene Connect (iOS
  AirLink phones, robot-arm touchscreens, or a custom `midscene-connect serve`
  device). Use when the user wants to inspect, tap, swipe, type, or run
  natural-language steps and assertions on such a device.
---

# Midscene Connect Device Automation

Drive a device exposed over the Midscene Connect protocol with the `midscene-connect` CLI. Every command works from screenshots; Midscene's vision model locates elements.

> **CRITICAL RULES**
>
> 1. **Never run commands in the background.** Run each command synchronously and read its output before deciding the next step.
> 2. **One action at a time.** After each action, inspect the screenshot the command saves before continuing.
> 3. **Allow 30–120 seconds** per command; physical devices are slow.
> 4. **Keep tokens out of chat and command lines.** Use `MIDSCENE_CONNECT_TOKEN` from the environment or `.env`.

## Prerequisites

```bash
[ -n "$MIDSCENE_CONNECT_URL" ] && echo "URL: $MIDSCENE_CONNECT_URL" || echo "URL: NOT_SET"
[ -n "$MIDSCENE_CONNECT_TOKEN" ] && echo "TOKEN: SET" || echo "TOKEN: NOT_SET"
[ -n "$MIDSCENE_MODEL_NAME" ] && echo "MODEL: SET" || echo "MODEL: NOT_SET"
```

- `MIDSCENE_CONNECT_URL` is a **device URL**: `http://<host>:5801/devices/<id>` for iOS AirLink, `http://<host>:<port>/devices/<screen-id>` for the arm service, or the URL printed by `midscene-connect serve`. List devices of a multi-device service with `curl -H "Authorization: Bearer $MIDSCENE_CONNECT_TOKEN" http://<host>:<port>/devices`.
- If anything is `NOT_SET`, ask the user for it, save it to `.env` (the CLI loads it automatically), and continue. Model settings follow the Midscene model configuration (`MIDSCENE_MODEL_BASE_URL`, `MIDSCENE_MODEL_API_KEY`, `MIDSCENE_MODEL_NAME`, `MIDSCENE_MODEL_FAMILY`).

## Workflow

1. **Check the device** and see which commands it supports:

   ```bash
   npx -y @midscene/connect connect
   npx -y @midscene/connect --help
   ```

   `connect` prints the device name and saves a screenshot. Device-specific instructions in the description must be followed throughout the task. `--help` lists only the actions this device supports (e.g. `tap`, `swipe`, `input`, `homebutton`, plus custom actions).

2. **Act.** Prefer one natural-language step per command, or a single targeted action:

   ```bash
   npx -y @midscene/connect act --prompt "open Settings and tap General"
   npx -y @midscene/connect tap --locate "the search box"
   npx -y @midscene/connect input --value "hello" --locate "the search box"
   npx -y @midscene/connect homebutton
   ```

3. **Verify** with the screenshot saved by the command, or capture a new one, then assert:

   ```bash
   npx -y @midscene/connect take_screenshot
   npx -y @midscene/connect assert --prompt "the General settings page is visible"
   ```

   If the screen is still animating, wait (`sleep 1`–`3`) and capture again. Repeat **act → verify** until the goal is reached or a blocker (login, permission prompt) needs the user.

4. **Report** the steps taken and the final state. Each command prints the path of the Midscene report it updated; share it with the user.
