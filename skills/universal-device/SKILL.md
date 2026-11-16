---
name: universal-device
description: >
  Vision-driven device automation using Midscene Universal Device. Operates
  entirely from screenshots through a connected Universal Device service. Use
  when the user wants to inspect, tap, swipe, scroll, type, or interact with a
  connected device screen.
---

# Universal Device Automation

Automate any device connected to a Midscene Universal Device service. You act as the visual planner: capture screenshots, inspect the image to determine pixel coordinates, and execute one action at a time.

> **CRITICAL RULES — VIOLATIONS WILL BREAK THE WORKFLOW**
>
> 1. **Never run commands in the background.** Every command must run synchronously so you can read its JSON output and inspect the screenshot before deciding the next step.
> 2. **Run only one action at a time.** Wait for it to finish, take a new screenshot, inspect the image to verify the UI changed as expected, and only then decide on the next action. **Never chain multiple `action` commands together.**
> 3. **Allow sufficient timeout** (at least 30–120 seconds) for device actions to complete.
> 4. **Keep tokens out of CLI flags and logs.** Pass `MIDSCENE_UNIVERSAL_DEVICE_SERVICE_TOKEN` via environment variables or `.env`, and never echo the token value in chat replies.

## Prerequisites — Check Connection Environment

Before running any device command, check whether the service URL and token are already set in the environment:

```bash
[ -n "$MIDSCENE_UNIVERSAL_DEVICE_SERVICE_URL" ] && echo "URL: SET ($MIDSCENE_UNIVERSAL_DEVICE_SERVICE_URL)" || echo "URL: NOT_SET"
[ -n "$MIDSCENE_UNIVERSAL_DEVICE_SERVICE_TOKEN" ] && echo "TOKEN: SET" || echo "TOKEN: NOT_SET"
```

If either `URL` or `TOKEN` is `NOT_SET`, **ask the user** to enter the missing Universal Device service URL and/or token. Once the user provides them, pass them via environment variables (or save them to `.env`, which the CLI loads automatically) and **continue the task directly**:

```env
MIDSCENE_UNIVERSAL_DEVICE_SERVICE_URL="http://<host>:<port>"
MIDSCENE_UNIVERSAL_DEVICE_SERVICE_TOKEN="your-service-token"
# Optional when only one device is connected:
MIDSCENE_UNIVERSAL_DEVICE_ID="your-device-id"
```

## Core Workflow

Always follow this step-by-step loop:

### Step 1: Discover the Device

List connected devices and inspect their status and capabilities:

```bash
npx -y @midscene/universal-device devices
```

- Check `status`:
  - `"available"`: Ready to control.
  - `"busy"`: Another session is controlling the device. Inform the user before retrying.
  - `"offline"`: Ask the user to check the device service and reconnect the device.
- Check `actions`: Only send action types included in this array.
- Check `inputGuidance`: If present, **strictly follow these device-specific instructions** throughout the task.
- If multiple devices are returned and the target is ambiguous, ask the user which `id` to use and pass `--device <id>` on subsequent commands.

### Step 2: Screenshot & Inspect

Capture the current screen and read the saved image file using your image-viewing tool:

```bash
npx -y @midscene/universal-device --device <id> screenshot ./device-screen.jpg
```

The command prints `{"file":"./device-screen.jpg","width":...,"height":...}`.
- Origin `(0, 0)` is the **top-left corner** of the image.
- Always calculate coordinates in the `width × height` pixel space returned by the command (if your viewer downscales the image for display, scale coordinates back to the original dimensions).

### Step 3: Execute One Action, Then Verify

Send a single action:

```bash
npx -y @midscene/universal-device --device <id> action '{"type":"tap","point":{"x":120,"y":240}}'
```

A successful response confirms the physical input has finished, but UI transitions, on-screen keyboards, momentum scrolling, or network loads on the device may still be settling. Wait briefly (`sleep 1` for animations/keyboards, `sleep 2`–`3` for app launches or page loads) before capturing the verification screenshot:

```bash
sleep 1
npx -y @midscene/universal-device --device <id> screenshot ./device-screen.jpg
```

Inspect the new screenshot to confirm the screen reached the expected state (if it is still loading or animating, wait and capture another screenshot before acting).

### Step 4: Report Results Proactively

After completing the task, summarize what was done and report the final state observed on the screen to the user.

## Command & Action Reference

### CLI Options
- `--host <url>`: Service URL (or set `MIDSCENE_UNIVERSAL_DEVICE_SERVICE_URL`)
- `--device <id>`: Target device ID (or set `MIDSCENE_UNIVERSAL_DEVICE_ID`; optional when the service has a single device)

### Supported Actions (`action '<json>'` or `action -`)

Only use actions listed in the target device's `actions` array. When `typeText`, `home`, or `back` are not supported by the device, use pointer actions (`tap`, `swipe`) to interact with on-screen buttons and the on-screen keyboard instead.

```bash
# Tap
npx -y @midscene/universal-device action '{"type":"tap","point":{"x":200,"y":400}}'

# Double tap
npx -y @midscene/universal-device action '{"type":"doubleTap","point":{"x":200,"y":400}}'

# Long press (durationMs: 0..5000, optional)
npx -y @midscene/universal-device action '{"type":"longPress","point":{"x":200,"y":400},"durationMs":800}'

# Swipe (durationMs: 0..5000, optional)
npx -y @midscene/universal-device action '{"type":"swipe","from":{"x":200,"y":600},"to":{"x":200,"y":200},"durationMs":350}'

# Drag and drop (durationMs: 0..5000, optional)
npx -y @midscene/universal-device action '{"type":"dragAndDrop","from":{"x":150,"y":300},"to":{"x":150,"y":700},"durationMs":600}'

# Scroll (direction: "up" | "down"; steps: 1..24 and point are optional)
npx -y @midscene/universal-device action '{"type":"scroll","direction":"down","steps":4,"point":{"x":200,"y":400}}'

# Type text (use `action -` via stdin when text contains quotes or special characters; replace: boolean is optional)
npx -y @midscene/universal-device action - <<'EOF'
{"type":"typeText","text":"hello world","replace":true}
EOF

# Press a key (e.g. "Enter", "Backspace", "Escape")
npx -y @midscene/universal-device action '{"type":"key","key":"Enter"}'

# Clear focused input / Navigate
npx -y @midscene/universal-device action '{"type":"clearInput"}'
npx -y @midscene/universal-device action '{"type":"home"}'
npx -y @midscene/universal-device action '{"type":"back"}'
```
