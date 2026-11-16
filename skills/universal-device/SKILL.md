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

### Step 1: Discover, Check Status, and Acquire Lease

List connected devices or inspect the target device status:

```bash
npx -y @midscene/universal-device devices
npx -y @midscene/universal-device --device <id> status
```

Example output (`devices`):
```json
[
  {
    "id": "device-1",
    "name": "Target Screen",
    "status": "available",
    "actions": ["tap", "longPress", "swipe", "dragAndDrop"],
    "inputGuidance": "Optional device-specific instructions from the service."
  }
]
```

- Check `status`:
  - `"available"`: Ready to control.
  - `"busy"`: Another session is controlling the device. Inform the user before retrying.
  - `"offline"`: Ask the user to check the device service and reconnect the device.
- Check `actions`: Only send action types included in this array (look up their JSON format in the **Action Schema Dictionary** below).
- Check `inputGuidance`: If present, **strictly follow these device-specific instructions** throughout the task.
- If multiple devices are returned and the target is ambiguous, ask the user which `id` to use and pass `--device <id>` on subsequent commands.

Lock the device exclusively for your multi-step task before acting:

```bash
npx -y @midscene/universal-device --device <id> acquire
```

This holds an exclusive lease (default 3 minutes idle timeout, automatically renewed on every `screenshot` and `action`).

### Step 2: Screenshot & Inspect

Capture the current screen to a **new, unique file path** (for example `/tmp/device-screen-01.jpg`, incrementing for each step) so you preserve step history, keep the workspace clean, and avoid stale image-viewer caches, then read the saved image:

```bash
npx -y @midscene/universal-device --device <id> screenshot /tmp/device-screen-01.jpg
```

The command prints `{"file":"/tmp/device-screen-01.jpg","width":...,"height":...}`.
- Origin `(0, 0)` is the **top-left corner** of the image.
- Always calculate coordinates in the `width × height` pixel space returned by the command (if your viewer downscales the image for display, scale coordinates back to the original dimensions).

### Step 3: Execute One Action, Verify, and Repeat Until Done

Send a single action based on what you observed in the screenshot:

```bash
npx -y @midscene/universal-device --device <id> action '{"type":"tap","point":{"x":120,"y":240}}'
```

A successful response confirms the physical input has finished, but UI transitions, on-screen keyboards, momentum scrolling, or network loads on the device may still be settling. Wait briefly (`sleep 1` for animations/keyboards, `sleep 2`–`3` for app launches or page loads) before capturing the verification screenshot:

```bash
sleep 1
npx -y @midscene/universal-device --device <id> screenshot /tmp/device-screen-02.jpg
```

Always use a fresh filename for each verification screenshot (e.g., `02`, `03`, ...) instead of overwriting the previous path, then inspect the new image to verify the screen change:
- If the screen is still loading or animating, wait briefly and take another screenshot.
- **Repeat this `Action → Wait → Screenshot & Inspect` loop** step by step until the user's goal is completely achieved (or you hit a blocker such as a login/permission prompt that requires user input).

### Step 4: Release Device & Report Results

Always release the exclusive lease when the task finishes (or if you hit an unrecoverable error/blocker so other users can access the device immediately):

```bash
npx -y @midscene/universal-device --device <id> release
```

Then summarize the actions taken and report the final state observed on the screen to the user.

## Command & Action Reference

### CLI Options
- `--host <url>`: Service URL (or set `MIDSCENE_UNIVERSAL_DEVICE_SERVICE_URL`)
- `--device <id>`: Target device ID (or set `MIDSCENE_UNIVERSAL_DEVICE_ID`; optional when the service has a single device)

### Action Schema Dictionary (`action '<json>'` or `action -`)

The Universal Device protocol defines the standard action types below. **Only use the subset listed in the target device's `actions` array** returned by `devices`. When `typeText`, `home`, or `back` are not in the device's `actions`, use pointer actions (`tap`, `swipe`) to interact with on-screen buttons and the on-screen keyboard instead.

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
