import { supportsFlangeContact } from '@midscene/robotics-shared/setup-contracts';
import type {
  AssistedCalibrationInput,
  AssistedCalibrationSetup,
  AssistedMappingInput,
  WebCalibrationMapping,
} from '../assisted-contracts.js';
import { mappingQualityWarnings } from '../assisted-contracts.js';
import {
  MARKER_CAPTURE_ATTEMPTS,
  hasMappingMarkerCoverage,
} from '../camera/calibration-markers.js';
import { RobotVisionError } from '../camera/errors.js';
import {
  RobotArmError,
  sameVisionMapping,
  semanticJson,
} from '../contracts.js';
import type { RobotArmRuntime } from '../runtime.js';
import { validateScreenMotionSettings } from '../screen-interaction/motion-policy.js';
import type { CalibrationVision } from './camera/vision.js';
import { invertMapping, project } from './phone/geometry.js';
import {
  type CalibrationPhoneSession,
  sameLayout,
  sameLayoutGeometry,
} from './phone/session.js';

function checkedMappingAccuracy(
  mapping: Pick<WebCalibrationMapping, 'markerErrorPx' | 'webToImage'> & {
    accuracy?: WebCalibrationMapping['accuracy'];
  },
) {
  project(mapping.webToImage, { x: 0, y: 0 });
  invertMapping(mapping.webToImage);
  if (!Number.isFinite(mapping.markerErrorPx) || mapping.markerErrorPx < 0)
    throw new RobotArmError('INVALID_MAPPING', 'Marker quality is unavailable');
  const accuracy = mapping.accuracy;
  if (
    !accuracy ||
    !hasMappingMarkerCoverage(
      accuracy.fit?.count,
      accuracy.validation?.count,
    ) ||
    [accuracy.fit, accuracy.validation].some(
      ({ meanErrorCssPx, maxErrorCssPx }) =>
        ![meanErrorCssPx, maxErrorCssPx].every(
          (px) => Number.isFinite(px) && px >= 0,
        ),
    )
  )
    throw new RobotArmError(
      'INVALID_MAPPING',
      'Camera mapping requires four to six visible markers from the page layout and finite corner errors.',
    );
  return accuracy;
}

export function calibrationGeometryKey(
  runtime: RobotArmRuntime,
  input: AssistedCalibrationInput,
) {
  const robot = runtime.profileStore.getRobot(input.robotProfileId);
  const tool = runtime.profileStore.getTool(input.toolProfileId);
  return semanticJson([
    runtime.connectionIdentity,
    robot.id,
    robot.geometryRevision,
    tool.id,
    tool.geometryRevision,
    tool.payload,
  ]);
}
/** Screen and camera configuration. This object never acquires a robot lease. */
export class CalibrationSetup {
  private input?: AssistedCalibrationInput;
  private geometryKey?: string;
  private mapping?: WebCalibrationMapping;
  constructor(
    private readonly runtime: RobotArmRuntime,
    private readonly phone: CalibrationPhoneSession,
    private readonly vision: CalibrationVision,
    private readonly deviceId?: string,
  ) {}
  status(): AssistedCalibrationSetup {
    return structuredClone({
      teaching:
        this.input &&
        this.runtime.profileStore.installationTeaching(this.input),
      prepared: Boolean(this.input),
      selection: this.input
        ? {
            robotProfileId: this.input.robotProfileId,
            toolProfileId: this.input.toolProfileId,
            cameraId: this.input.cameraId,
            width: this.input.width,
            height: this.input.height,
          }
        : undefined,
      phoneConnected: this.phone.available(),
      layout: this.phone.update?.layout,
      mapping: this.mapping,
    });
  }
  inputSnapshot() {
    if (!this.input)
      throw new RobotArmError(
        'SETUP_REQUIRED',
        'Prepare the phone and camera configuration first',
        409,
      );
    return structuredClone(this.input);
  }
  /**
   * Drops the page mapping built from a camera correction that no longer
   * applies. The camera and output size stay selected, so mapping the same
   * screen again needs no setup changes.
   */
  async clearMapping() {
    this.mapping = undefined;
    if (this.deviceId)
      await this.runtime.profileStore.saveCalibrationMapping(this.deviceId);
    return this.status();
  }
  /**
   * A manual perspective edit replaces only the camera-to-screen geometry.
   * Keep the verified page transform and accuracy evidence, but rebind them to
   * the new correction so later calibration does not need another marker pass.
   */
  async rebindCurrentMapping() {
    if (
      !this.mapping ||
      !this.input ||
      this.mapping.vision.width !== this.input.width ||
      this.mapping.vision.height !== this.input.height
    )
      return this.status();
    const vision = await this.vision.binding(this.visionOptions());
    this.mapping = { ...this.mapping, vision };
    if (this.deviceId && this.geometryKey)
      await this.runtime.profileStore.saveCalibrationMapping(this.deviceId, {
        geometryKey: this.geometryKey,
        accuracyBasis: 'outer-markers',
        mapping: this.mapping,
      });
    await this.updateSavedCameraMapping();
    return this.status();
  }
  prepare(input: AssistedCalibrationInput) {
    const previous = this.input;
    const previousGeometryKey = this.geometryKey;
    if (
      !input ||
      !input.cameraId ||
      ![input.width, input.height].every(
        (n) => Number.isInteger(n) && n >= 180 && n <= 4096,
      )
    )
      throw new RobotArmError(
        'INVALID_MAPPING',
        'Select a camera and corrected output size',
      );
    const robot = this.runtime.profileStore.getRobot(input.robotProfileId);
    const tool = this.runtime.profileStore.getTool(input.toolProfileId);
    if (
      tool.contactFrame === 'flange' &&
      !supportsFlangeContact(this.runtime.describeCapabilities())
    )
      throw new RobotArmError(
        'INVALID_PROFILE',
        'This adapter does not support flange contact calibration',
      );
    if (
      robot.adapterId !== this.runtime.id ||
      robot.connectionIdentity !== this.runtime.connectionIdentity
    )
      throw new RobotArmError(
        'PROFILE_MISMATCH',
        'Select the current robot installation',
      );
    const defaults = this.runtime.describeCapabilities().setupDefaults;
    const motion =
      input.motion ??
      (defaults?.motion
        ? {
            ...defaults.motion,
            actionSpeed: defaults.actionSpeed,
            actionAcceleration: defaults.actionAcceleration,
          }
        : undefined);
    if (!motion)
      throw new RobotArmError(
        'MOTION_SETTINGS_REQUIRED',
        'This adapter needs explicit screen motion settings',
      );
    const settings = {
      pressDepthMm: motion.pressDepthMm,
      safeHeightMm: motion.safeHeightMm,
      actionSpeed: motion.actionSpeed,
      actionAcceleration: motion.actionAcceleration,
      contactMs: motion.contactMs,
      swipeEndpointHoldMs: motion.swipeEndpointHoldMs,
      longPressMs: motion.longPressMs,
      dragHoldMs: motion.dragHoldMs,
      releaseSpeedFactor: motion.releaseSpeedFactor,
      releaseAccelerationFactor: motion.releaseAccelerationFactor,
      successorStartLeadMs: motion.successorStartLeadMs,
      motionTimeoutMs: motion.motionTimeoutMs,
    };
    validateScreenMotionSettings(settings);
    this.input = structuredClone({
      robotProfileId: input.robotProfileId,
      toolProfileId: input.toolProfileId,
      cameraId: input.cameraId,
      width: input.width,
      height: input.height,
      motion: settings,
    });
    this.geometryKey = calibrationGeometryKey(this.runtime, this.input!);
    if (
      previousGeometryKey !== this.geometryKey ||
      previous?.cameraId !== this.input.cameraId ||
      previous?.width !== this.input.width ||
      previous?.height !== this.input.height
    )
      this.mapping = undefined;
    return this.status();
  }
  async restore(
    input: AssistedCalibrationInput,
    mapping: WebCalibrationMapping,
  ) {
    checkedMappingAccuracy(mapping);
    if (
      mapping.vision.cameraId !== input.cameraId ||
      mapping.vision.width !== input.width ||
      mapping.vision.height !== input.height
    )
      throw new RobotArmError(
        'INVALID_MAPPING',
        'Saved camera and output size do not match the recording',
      );
    this.prepare(input);
    if (
      !sameVisionMapping(
        await this.vision.binding(this.visionOptions()),
        mapping.vision,
      )
    )
      throw new RobotArmError(
        'VISION_BINDING_CHANGED',
        'Camera correction changed. Check camera mapping.',
        409,
      );
    this.mapping = structuredClone(mapping);
  }
  private visionOptions() {
    const i = this.inputSnapshot();
    return {
      cameraId: i.cameraId,
      width: i.width,
      height: i.height,
    };
  }
  async assertCurrent() {
    await this.vision.assertPerspectiveCurrent?.();
    this.phone.assertAvailable();
    if (
      !this.mapping ||
      !this.phone.update ||
      !sameLayout(this.mapping.layout, this.phone.update.layout) ||
      this.geometryKey !==
        calibrationGeometryKey(this.runtime, this.inputSnapshot())
    )
      throw new RobotArmError(
        'MAPPING_REQUIRED',
        'Check camera mapping before starting calibration',
        409,
      );
    if (
      !sameVisionMapping(
        await this.vision.binding(this.visionOptions()),
        this.mapping.vision,
      )
    )
      throw new RobotArmError(
        'VISION_BINDING_CHANGED',
        'Camera correction changed. Check camera mapping.',
        409,
      );
    return structuredClone(this.mapping);
  }
  async map(
    output?: AssistedMappingInput,
    beforeCapture?: () => Promise<void>,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    this.inputSnapshot();
    if (output) {
      if (
        output.cameraId !== this.input!.cameraId ||
        ![output.width, output.height].every(
          (n) => Number.isInteger(n) && n >= 180 && n <= 4096,
        )
      )
        throw new RobotArmError(
          'INVALID_MAPPING',
          'The camera or output size changed. Prepare camera mapping again.',
        );
      this.input!.width = output.width;
      this.input!.height = output.height;
    }
    const layout = structuredClone(this.phone!.assertAvailable().layout);
    let reusable = this.mapping;
    if (!reusable && this.deviceId) {
      const saved = this.runtime.profileStore.calibrationMapping(this.deviceId);
      if (
        saved?.accuracyBasis === 'outer-markers' &&
        saved.geometryKey === this.geometryKey &&
        sameLayoutGeometry(saved.mapping.layout, layout)
      ) {
        try {
          checkedMappingAccuracy(saved.mapping);
          reusable = { ...saved.mapping, layout };
        } catch {
          // Rebuild the page mapping using the current corrected image.
        }
      }
    }
    // Camera-step entry may ensure the mapping again. Reuse verified
    // geometry without another marker scan. Each collection starts fresh.
    if (
      reusable &&
      sameLayout(layout, reusable.layout) &&
      this.geometryKey === calibrationGeometryKey(this.runtime, this.input!) &&
      reusable.vision.width === this.input!.width &&
      reusable.vision.height === this.input!.height &&
      sameVisionMapping(
        await this.vision.binding(this.visionOptions()),
        reusable.vision,
      )
    ) {
      if (!this.mapping) await this.vision.assertPerspectiveCurrent?.();
      signal?.throwIfAborted();
      this.phone!.assertAvailable();
      if (
        !sameLayout(layout, this.phone!.update!.layout) ||
        this.geometryKey !== calibrationGeometryKey(this.runtime, this.input!)
      )
        throw new RobotArmError(
          'CALIBRATION_INVALID',
          'Phone layout, robot or tool changed during camera mapping',
          409,
        );
      this.mapping = reusable;
      await this.updateSavedCameraMapping();
      return this.status()!;
    }
    this.mapping = undefined;
    const pageId = this.phone.assertAvailable().pageId;
    await beforeCapture?.();
    const display = this.phone.assertAvailable();
    const checkPage = () => {
      signal?.throwIfAborted();
      const page = this.phone.assertAvailable();
      if (
        page.pageId !== pageId ||
        !sameLayout(layout, page.layout) ||
        (display.markersPainted &&
          (!page.markersPainted ||
            page.markerRequest !== display.markerRequest))
      )
        throw new RobotArmError(
          'PAGE_CHANGED',
          'The phone page changed during detection',
          409,
        );
    };
    checkPage();
    let shot = await this.vision.snapshot(this.visionOptions());
    const initialBinding = shot.binding!;
    let body: Awaited<ReturnType<CalibrationVision['detectMarkers']>>;
    for (let attempt = 1; ; attempt++) {
      checkPage();
      try {
        body = await this.vision.detectMarkers(
          Buffer.from(shot.base64, 'base64'),
          layout.markers,
        );
        break;
      } catch (error) {
        checkPage();
        if (
          attempt >= MARKER_CAPTURE_ATTEMPTS ||
          !(error instanceof RobotVisionError) ||
          !['NO_SCREEN_DETECTED', 'CALIBRATION_MISMATCH'].includes(error.code)
        )
          throw error;
        shot = await this.vision.snapshot(this.visionOptions());
        if (!sameVisionMapping(initialBinding, shot.binding!))
          throw new RobotArmError(
            'VISION_BINDING_CHANGED',
            'Camera correction changed during marker detection',
            409,
          );
      }
    }
    checkPage();
    const accuracy = checkedMappingAccuracy(body);
    const latest = await this.vision.binding(this.visionOptions());
    checkPage();
    if (!sameVisionMapping(latest, shot.binding!))
      throw new RobotArmError(
        'VISION_BINDING_CHANGED',
        'Camera correction changed during marker detection',
        409,
      );
    this.mapping = {
      vision: shot.binding!,
      layout,
      webToImage: body.webToImage,
      markerErrorPx: body.markerErrorPx,
      accuracy,
    };
    try {
      await this.updateSavedCameraMapping();
      if (
        this.deviceId &&
        this.geometryKey &&
        !mappingQualityWarnings(this.mapping.accuracy, this.mapping.layout)
          .length
      )
        await this.runtime.profileStore.saveCalibrationMapping(this.deviceId, {
          geometryKey: this.geometryKey,
          accuracyBasis: 'outer-markers',
          mapping: this.mapping,
        });
    } catch (error) {
      this.mapping = undefined;
      throw error;
    }
    return this.status();
  }

  private async updateSavedCameraMapping() {
    const mapping = this.mapping!;
    const input = this.input!;
    const store = this.runtime.profileStore;
    // A Device mapping is a draft for its next calibration. Only acceptance
    // publishes it. The standalone workstation flow can update its own preview.
    if (this.deviceId !== undefined) return;
    // A weak draft remains reviewable. Publishing it over an accepted
    // workstation's live coordinates goes through explicit calibration acceptance.
    if (mappingQualityWarnings(mapping.accuracy, mapping.layout).length) return;
    const binding = store.list().workstation;
    if (
      !binding?.calibrationProfileId ||
      binding.robotProfileId !== input.robotProfileId ||
      binding.toolProfileId !== input.toolProfileId ||
      binding.cameraId !== input.cameraId
    )
      return;
    const calibration = store.getCalibration(binding.calibrationProfileId);
    const previousLayout = calibration.verification?.web?.layout;
    // A new viewport may be prepared for a new mechanical calibration. Never
    // attach that mapping to an older calibration's different phone frame.
    if (!previousLayout || !sameLayoutGeometry(previousLayout, mapping.layout))
      return;
    await this.runtime.configure(async () => {
      const screen = store.getScreen(binding.screenProfileId);
      await store.putScreen({
        ...screen,
        pixelWidth: mapping.vision.width,
        pixelHeight: mapping.vision.height,
        phoneMapping: {
          width: calibration.phoneFrame.width,
          height: calibration.phoneFrame.height,
          imageToPhone: invertMapping(mapping.webToImage),
          visionFingerprint: mapping.vision.fingerprint,
        },
      });
      await store.confirmVision(
        { ...mapping.vision, confirmedAt: new Date().toISOString() },
        binding.revision,
      );
    });
  }
}
