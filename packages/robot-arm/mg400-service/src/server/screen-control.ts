import {
  type ActionResult,
  RobotArmError,
  type ScreenAction,
  calibrationAccepted,
  hasScreenMapping,
} from '@midscene/arm-kit';
import { controllerRuntime } from '@midscene/arm-kit/internal/controller-runtime';
import type { PlaygroundDevices } from './devices.js';

export type ScreenControlReason =
  | 'CALIBRATION_REQUIRED'
  | 'SCREEN_MAPPING_REQUIRED'
  | 'MAPPING_REQUIRED'
  | 'CONFIGURATION_UNAVAILABLE';

export interface ScreenControlInfo {
  id: string;
  calibrationId?: string;
  calibrationAccepted: boolean;
  pixelWidth?: number;
  pixelHeight?: number;
  ready: boolean;
  reason?: ScreenControlReason;
}

export interface ManualScreenControl {
  screenId: string;
  action: ScreenAction['type'];
  startedAt: number;
}

/** Serializes screen gestures before handing them to the controller queue. */
export class ScreenControl {
  private manual?: ManualScreenControl;
  constructor(private readonly devices: PlaygroundDevices) {}

  get busy(): boolean {
    return Boolean(this.manual);
  }

  get manualAction(): ManualScreenControl | undefined {
    return this.manual && { ...this.manual };
  }

  /** Per-screen control metadata, joined with the accepted calibration. */
  screens(): Map<string, ScreenControlInfo> {
    const profiles = controllerRuntime(this.devices.arm).profileStore;
    const data = profiles.list();
    const result = new Map<string, ScreenControlInfo>();
    for (const screen of this.devices.screens()) {
      const binding = profiles.deviceBinding(screen.id);
      const calibration = binding
        ? (data.calibrations ?? []).find(
            (item) => item.id === binding.calibrationProfileId,
          )
        : undefined;
      const profile = calibration
        ? (data.screens ?? []).find(
            (item) => item.id === calibration.screenProfileId,
          )
        : undefined;
      const accepted = calibrationAccepted(calibration);
      const mapped = Boolean(profile?.phoneMapping);
      const measured = hasScreenMapping(profile);
      let reason: ScreenControlReason | undefined;
      if (!accepted || !binding) reason = 'CALIBRATION_REQUIRED';
      else if (!measured) reason = 'SCREEN_MAPPING_REQUIRED';
      else if (
        !mapped ||
        !screen.correction ||
        !screen.perspectiveTarget ||
        !this.devices.entries
          .get(screen.id)
          ?.camera.isBindingCurrent(binding.vision)
      )
        reason = 'MAPPING_REQUIRED';
      result.set(screen.id, {
        id: screen.id,
        calibrationId: calibration?.id,
        calibrationAccepted: accepted,
        ...(measured
          ? {
              pixelWidth: profile!.pixelWidth,
              pixelHeight: profile!.pixelHeight,
            }
          : {}),
        ready: !reason,
        ...(reason ? { reason } : {}),
      });
    }
    return result;
  }

  controlState() {
    return {
      ...this.devices.arm.controlState(),
      manualBusy: this.busy,
      manualAction: this.manualAction,
    };
  }

  async perform(
    screenId: string,
    action: ScreenAction,
    signal?: AbortSignal,
  ): Promise<ActionResult> {
    const entry = this.devices.entries.get(screenId);
    if (!entry)
      throw new RobotArmError(
        'VISION_UNAVAILABLE',
        'Start the camera before touching its screen',
        409,
      );
    if (this.manual)
      throw new RobotArmError(
        'BUSY',
        'A manual screen gesture is already running.',
        409,
      );
    if (this.devices.batch.active)
      throw new RobotArmError(
        'BUSY',
        'Stop the calibration batch before touching the screen manually.',
        409,
      );
    if (this.devices.hasActiveScreenCalibration)
      throw new RobotArmError(
        'BUSY',
        'Wait for calibration to finish before touching the screen manually.',
        409,
      );
    if (
      !action ||
      typeof action !== 'object' ||
      !['tap', 'longPress', 'swipe', 'dragAndDrop'].includes(action.type)
    )
      throw new RobotArmError(
        'INVALID_ACTION',
        'Screen action is required',
        422,
      );
    this.manual = {
      screenId,
      action: action.type,
      startedAt: Date.now(),
    };
    try {
      return await entry.device.perform(action, signal);
    } finally {
      this.manual = undefined;
    }
  }
}
