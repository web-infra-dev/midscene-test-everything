---
name: open-device
description: Inspect and control a user-selected device through Midscene Open Device. Use when the user asks to view a connected screen, tap, swipe, type, or perform another supported action on an iPhone or robot-arm-controlled device.
---

# Open Device

Control connected phones or robot-arm devices with the `open-device` CLI.

If `open-device` isn't on `PATH` in a local repo checkout, run `node packages/open-device/dist/cli.js` directly instead of `pnpm --filter ... cli` (pnpm prints extra headers to stdout and changes the working directory, which breaks JSON output and relative screenshot paths).

## Setup

- **Service URL**: Defaults to `http://localhost:5801`. Override with `OPEN_DEVICE_SERVICE_URL` or `--host URL`.
- **Token**: Set `OPEN_DEVICE_SERVICE_TOKEN` in the environment. Never pass tokens as CLI flags or echo them into logs or replies.

## Workflow

1. **Pick the device**: Run `open-device devices` to see available devices, their status, and what `actions` they support. If there are multiple devices and it's not obvious which one to use, ask the user.
   - If a device is `busy`, tell the user before retrying.
   - If it's `offline`, report it and ask the user to check the device manager.
2. **Look before you act**: Capture a screenshot first so you know what's actually on screen and have exact pixel coordinates (origin `(0, 0)` at top-left, using the `width`/`height` printed by the command—if your viewer scales the image, scale coordinates back).
3. **Run one action, then re-check**: Send a supported action, then take a fresh screenshot to see what changed before deciding the next step.

## Examples

```sh
open-device --device DEVICE_ID screenshot /tmp/device-screen.jpg
open-device --device DEVICE_ID action '{"type":"tap","point":{"x":120,"y":240}}'
open-device --device DEVICE_ID action '{"type":"swipe","from":{"x":120,"y":440},"to":{"x":120,"y":150},"durationMs":350}'
```

When typing text with quotes, newlines, or special characters, pipe JSON via stdin instead of fighting shell escaping:

```sh
open-device --device DEVICE_ID action - <<'EOF'
{"type":"typeText","text":"hello \"world\""}
EOF
```

Run `open-device --help` for common action formats, or check `/api/docs` on the device service for the full schema.
