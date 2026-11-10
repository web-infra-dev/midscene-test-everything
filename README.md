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

Open the printed URL. Playground checks `192.168.1.6` and `192.168.2.6` and connects automatically to the only MG400 accepting Dashboard commands. If only one controller responds and it refuses those commands, the adapter requests TCP/IP development mode and verifies the change with a fresh mode query. Choose **Skip to cameras** even while discovery is running. Both entry points use the same camera workspace. Use **Connect robot** in the sidebar to connect later; connecting or disconnecting keeps the workspace open and preserves the selected camera and view when available. For a custom address, ports or network setup, start with `pnpm dev --manual`. Once connected, follow calibration and configure a model to run tasks. Confirm workspace clearance before movement; use **Stop robot** to stop. If recovery is required, check the stationary robot and select **Check Recovery**.

Choose **Detect screen markers** in the camera preview or **Screen Calibration** in robot settings. Both use the phone already paired with that camera. Phone pairing links automatically prefer the computer’s active Wi-Fi and exclude the controller’s wired subnet and virtual interfaces. Scan once to pair a new phone and keep the page in the foreground. You can skip the arm connection, detect the markers, and save the perspective first. On connection, a returning phone’s result goes to its bound screen; a new phone can use the unclaimed default screen. Opening that screen’s calibration continues on the same phone without scanning again. A different phone cannot overwrite a bound screen. The phone asks for a wake lock first. Android creates no wake video, so the browser cannot hand fullscreen to its media player, and uses the system wake lock only on HTTPS. Tap **Enter full screen** on the phone: Android opens the browser's element fullscreen and keeps whatever orientation the phone had, without forcing a rotation. On HarmonyOS, enter full screen when prompted. On iOS, use Safari’s **Share → Add to Home Screen**, then open the page from its icon. Detection waits for the required display mode and visible markers before capturing frames. The paired phone stays in full screen when you return to the Playground home page and can be reused for the next run.

Playground decodes the same eight camera frames for all target screens and fits each screen independently. If too few frames pass, it captures up to two more batches for the affected screens. High-confidence results can apply automatically. Review weaker or partial results and retry only the affected screens. When the live outline check detects a mismatch, the review can apply the visual result after confirmation. Image-based movement still requires a valid perspective and page mapping. With or without the robot, **Edit perspective** opens a fresh frame of the selected camera. In camera-only mode, detection also opens the perspective editor with original and corrected views. Compare the images, edit the four corners, choose the output size and rotation, then select **Use this result**. After saving, the camera stage switches to the corrected stream at the saved screen aspect ratio. Use **Original** or **Corrected** to switch views. In camera-only mode, **Clear perspective correction** deletes the saved screen outline, output size and rotation and returns to the original view. When connected, clearing a perspective from the preview or the **Camera Mapping** checklist releases the selected screen’s mapping and keeps its saved perspective.

Playground automatically checks each saved screen outline against live frames. The same local geometry check runs before saving correction, before SDK screenshots and touch actions, at calibration boundaries, during sample collection, and when a multi-screen batch gains the Controller queue or resumes. A confirmed mismatch blocks further image-based movement and shows the affected screen with a recalibration action. Low contrast or occlusion stays unverified and cannot clear a confirmed mismatch; recovery needs three distinct aligned frames spanning at least 1.5 seconds. Evidence is stored separately from geometry and does not change mapping fingerprints or erase accepted calibrations. Camera failure, stale frames, cancellation and phone layout changes cannot start a suspended movement.

Keep all six phone markers visible during camera calibration. If the camera misses a marker in a low-contrast frame, it retries once with contrast enhancement.

The wizard follows Touch Tool → Camera Mapping → Teach Installation → Screen Calibration. The step bar stays at the top. The controls and live camera preview scroll together, side by side on wide screens and with the preview above the controls on narrow screens. In the preview pane, switch between **Live Preview** and **Setup illustration** without leaving the current step. In Teach Installation, record the calibration reference 20–50 mm above the screen. Choose **Teach Camera Boundary**, move straight towards the camera while leaving clearance for the full arm, and record the boundary at least 20 mm from the reference. Confirm the clear corridor and save installation teaching. Teaching is shared by screens using the same robot, tool and camera; changed robot or tool geometry requires teaching again. Moving to either taught position, including the return to the reference before automatic sampling, uses the configured action speed and acceleration. The reference defines the minimum free-travel height and contact exploration remains bounded below it.

Saving **Touch Tool** records the measured length and payload before screen calibration. When you reopen robot settings, the wizard uses saved progress to open the next step, or opens **Screen Calibration** if the earlier steps are complete. Select an earlier step in the header to edit it. Enable uses the saved payload and still requires operator confirmation. An unconfigured screen on the same robot and camera can reuse the measurements when the saved setups agree on the tool.

Collect samples, fit and automatically check the boundary. With valid teaching, calibration preflights both lateral camera-avoidance exits before the opposite side, lifts to the taught travel height and moves at 10% of the configured motion speed and acceleration. Only measured arrival records the Safe Position. Parking clears the combined footprint of known screens, including gaps between them. Unreachable candidates fall back to manual Safe Position recording; a failed submitted move interrupts calibration. Review and save once the result is ready.

In **Camera Mapping**, open the phone page on each device, then choose the page and observing camera on the computer. A QR code can open the page. Each browser keeps a stable page identity. Marker detection binds pages to screen targets. After applying, **Original** shows all saved screen outlines. Choose a screen and select **Corrected** to see only its live rectified image at the saved aspect ratio. This preview is available before physical screen calibration. **Restore Home** releases the page session. **Clear Perspective** keeps the saved result for that screen. Deleting a screen binding, deleting a saved perspective and forgetting an offline page are separate actions.

When the selected screen already has a taught reference, the guided calibration opens at sampling preparation. After a service restart, opening the screen reconnects its paired phone. Confirm camera mapping again before collecting samples. If the controller needs recovery, the screen calibration page shows **Check Recovery** before sampling. With one mapped screen, **Screen Calibration** opens that screen directly. With multiple screens, **Calibrate [screen name]** starts only the selected screen. Cancel the current attempt before switching screens. A retry keeps that screen’s paired phone and camera mapping, starts with no samples, and only replaces its saved result after successful acceptance. **Calibrate multiple screens** opens a separate batch confirmation.

The Screen Calibration step shows the original per-screen cards, planned order, placement prompts, run history and batch confirmation. A batch holds the same Controller queue throughout exploration and operator waits. A queued single-screen session cannot collect samples before it owns that queue. Accepted geometry provides measured starts; newly mapped screens can use a plane estimate from accepted screens or wait for manual placement. Fixed screens and any computed transfer corridor require confirmation before starting. Automatic acceptance checks measured geometry, full boundary verification and a measured camera-avoidance Safe Position; otherwise it waits for review. Retry or skip affects only the current screen. Stop preempts pending batch commands and exits Drag Mode before releasing the queue. Stopping retains completed results, and a service restart leaves the history stopped for explicit recovery. Resuming preserves the confirmed travel height and rechecks geometry, teaching, screen mappings and the current position against the confirmed corridor. After calibration, use the screen selector for preview and tasks. In the SDK, give each screen a distinct `id` and `screenId` in `RobotArmDevice`, with the same physical `camera`.

The speaker icon in the top toolbar enables or mutes Chinese/English browser speech and short progress tones. Prompts announce marker-capture countdowns, calibration movement, camera avoidance, result confirmation, robot faults and stop outcomes. Speech follows the interface language, requires browser activation, stays silent in hidden tabs and never blocks robot commands. Targets use a fixed 10% inset; fitted touches must cover at least 60% of the full screen. **Fast** (sliding) is selected by default. **Regular** probes each point separately. If fast collection fails, confirm the switch to Regular to start a fresh collection. In Fast mode, confirm in one checkbox that the screen is fixed and horizontal and the workspace is clear. Use **Previous Step** in arm calibration to review earlier measurements, then **Next** to return to the current step.

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
