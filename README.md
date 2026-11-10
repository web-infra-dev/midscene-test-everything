# Midscene Robotics

English · [简体中文](./README.zh.md) · [Midscene.js](https://midscenejs.com/)

Let Midscene operate physical touchscreens with a camera and a robot arm. Includes a browser Playground, a Node.js SDK and a DOBOT MG400 adapter.

## Quick Start

Prepare an MG400 with a stylus, a camera and a touchscreen. Use Node.js `^20.19.0 || ^22.12.0 || >=24.0.0` and pnpm 9.3.0.

```sh
pnpm install
pnpm build
pnpm dev
```

Open the printed URL. Playground checks `192.168.1.6` and `192.168.2.6` and connects automatically to the only MG400 accepting Dashboard commands. If only one controller responds and it refuses those commands, the adapter requests TCP/IP development mode and verifies the change with a fresh mode query. If neither is available, retry or choose **Skip to cameras** for a live preview. Skipping keeps the normal camera workspace layout; use **Connect robot** in the setup sidebar to open the connection dialog while keeping the preview visible. For a custom address, ports or network setup, start with `pnpm dev --manual`. Once connected, follow calibration and configure a model to run tasks. Confirm workspace clearance before movement; use **Stop robot** to stop.

Choose **Detect screen markers** in the camera preview or **Screen Calibration** in robot settings. Both use the phone already paired with that camera. Phone pairing links automatically prefer the computer’s active Wi-Fi and exclude the controller’s wired subnet and virtual interfaces. Scan once to pair a new phone and keep the page in the foreground. The phone asks for a wake lock first. Android creates no wake video, so the browser cannot hand fullscreen to its media player, and uses the system wake lock only on HTTPS. Tap **Enter full screen** on the phone: Android opens the browser's element fullscreen and keeps whatever orientation the phone had, without forcing a rotation. On HarmonyOS, enter full screen when prompted. On iOS, use Safari’s **Share → Add to Home Screen**, then open the page from its icon. Detection waits for the required display mode and visible markers before capturing frames. The paired phone stays in full screen when you return to the Playground home page and can be reused for the next run.

Playground checks marker stability across eight frames. Robot setup also verifies four fit markers and two independent markers in the corrected image. Each group must have a mean error of at most 2 CSS px and a maximum error of at most 3 CSS px. In the calibration wizard, review the detected outlines and corrected views, then apply the passing results together. Selecting **Camera correction** later opens the saved outline and corrected view in the wizard. Choose **Next** to continue. Occluded markers are repositioned on retry. In camera-only mode, detection opens the perspective editor with original and corrected views. Compare the images, edit the four corners, choose the output size and rotation, then select **Use this result**. The camera stage then switches to the corrected stream, framed at the saved phone-screen size, and you can switch between **Original** and **Corrected**. **Clear perspective correction** removes the saved outline and output size and returns the stage to the original view.

Playground automatically checks each saved screen outline against live frames. The same local geometry check runs before saving correction, before SDK screenshots and touch actions, at calibration boundaries, during sample collection, and when a multi-screen batch gains the Controller queue or resumes. A confirmed mismatch blocks further image-based movement and shows the affected screen with a recalibration action. Low contrast or occlusion stays unverified and cannot clear a confirmed mismatch; recovery needs three distinct aligned frames spanning at least 1.5 seconds. Evidence is stored separately from geometry and does not change mapping fingerprints or erase accepted calibrations. Camera failure, stale frames, cancellation and phone layout changes cannot start a suspended movement.

Keep all six phone markers visible during camera calibration. If the camera misses a marker in a low-contrast frame, it retries once with contrast enhancement.

The wizard follows Touch Tool → Camera Mapping → Teach Installation → Screen Calibration. A live camera pane stays visible across the wizard, including phone binding and batch waits; it stays beside the controls on a wide screen and above them in a narrow window. In Teach Installation, record the calibration reference 20–50 mm above the screen. Choose **Teach Camera Boundary**, move straight towards the camera while leaving clearance for the full arm, and record the boundary at least 20 mm from the reference. Confirm the clear corridor and save installation teaching. Teaching is shared by screens using the same robot, tool and camera; changed robot or tool geometry requires teaching again. The reference defines the minimum free-travel height and contact exploration remains bounded below it.

Collect samples, fit and automatically check the boundary. With valid teaching, calibration preflights both lateral camera-avoidance exits before the opposite side, lifts to the taught travel height and moves at 10% of the configured motion speed and acceleration. Only measured arrival records the Safe Position. Parking clears the combined footprint of known screens, including gaps between them. Unreachable candidates fall back to manual Safe Position recording; a failed submitted move interrupts calibration. Review and save once the result is ready.

Multi-screen binding is part of **Camera Mapping** in the calibration wizard. Open the screen page on every phone with the shared QR code or pairing code. Each browser keeps a stable screen identity; pages can be assigned, renamed and returned home in the original binding interface. All screens are detected from the same eight-frame batch. Review each result, retry only failed screens and apply the passing perspectives together. Each screen keeps an independent correction, marker ID set, phone pairing and accepted Device binding while sharing one camera stream.

The Screen Calibration step shows the original per-screen cards, planned order, placement prompts, run history and batch confirmation. A batch holds the same Controller queue throughout exploration and operator waits. A queued single-screen session cannot collect samples before it owns that queue. Accepted geometry provides measured starts; newly mapped screens can use a plane estimate from accepted screens or wait for manual placement. Fixed screens and any computed transfer corridor require confirmation before starting. Automatic acceptance checks measured geometry, full boundary verification and a measured camera-avoidance Safe Position; otherwise it waits for review. Retry or skip affects only the current screen. Stop preempts pending batch commands and exits Drag Mode before releasing the queue. Stopping retains completed results, and a service restart leaves the history stopped for explicit recovery. Resuming preserves the confirmed travel height and rechecks geometry, teaching, screen mappings and the current position against the confirmed corridor. After calibration, use the screen selector for preview and tasks. In the SDK, give each screen a distinct `id` and `screenId` in `RobotArmDevice`, with the same physical `camera`.

The speaker icon in the top toolbar enables or mutes Chinese/English browser speech and short progress tones. Prompts announce marker-capture countdowns, calibration movement, camera avoidance, result confirmation, robot faults and stop outcomes. Speech follows the interface language, requires browser activation, stays silent in hidden tabs and never blocks robot commands. Targets use a fixed 10% inset; fitted touches must cover at least 60% of the full screen. Fast and sliding modes require a fixed, horizontal screen. Use **Previous Step** in arm calibration to review earlier measurements, then **Next** to return to the current step.

## SDK & Adapters

See the [SDK example](./examples/mg400/run.mjs). To support another arm, implement `RobotArmAdapter` from `@midscene/arm-kit/adapter-development`; refer to the [MG400 adapter](./packages/adapter-mg400/src/mg400.ts).

## Project Structure

```text
packages/arm-kit/           Node.js SDK
packages/adapter-mg400/     MG400 adapter
packages/calibration-ui/    Calibration UI
packages/shared/            Shared types and utilities
packages/playground/        Reusable Playground
apps/playground/            MG400 Playground launcher
examples/mg400/             SDK examples
```

Calibration code is in `packages/arm-kit/src/calibration`: phone and camera setup, sample collection and fitting, and boundary verification.

## License

[MIT](./LICENSE).
