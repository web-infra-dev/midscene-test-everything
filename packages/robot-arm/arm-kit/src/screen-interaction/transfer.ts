import { assertSafeObservation } from '../calibration/verification/safe-position.js';
import type {
  CalibrationProfile,
  CartesianPose,
  ScreenProfile,
  ToolProfile,
} from '../contracts.js';
import {
  RobotArmError,
  calibrationAccepted,
  semanticJson,
} from '../contracts.js';
import { assertPose, distance } from '../domain.js';

export interface TransferScreen {
  calibration: CalibrationProfile;
  screen: ScreenProfile;
  tool: ToolProfile;
}
export interface TransferRouteInput {
  fromCalibrationId: string;
  fromCalibrationRevision?: number;
  toCalibrationRevision?: number;
  toCalibrationId: string;
  /** Measured flange poses between the saved observation positions, in travel order. */
  waypoints: CartesianPose[];
  /** Operator confirmation that the complete corridor is clear of fixtures and obstacles. */
  confirmed: boolean;
}
export interface PreparedTransferRoute extends TransferRouteInput {
  confirmed: true;
  contextKey: string;
  /** Complete route, including both observation positions. Direction is not reversible implicitly. */
  poses: CartesianPose[];
}
export function transferContextKey(screens: readonly TransferScreen[]): string {
  return semanticJson(
    screens
      .map(({ calibration, screen, tool }) => ({
        calibration,
        screen,
        tool,
      }))
      .sort((a, b) => a.calibration.id.localeCompare(b.calibration.id)),
  );
}
function sameOrientation(a: CartesianPose, b: CartesianPose): boolean {
  const keys = ['x', 'y', 'z', 'w'] as const;
  const dot = keys.reduce(
    (sum, key) => sum + a.orientation[key] * b.orientation[key],
    0,
  );
  return Math.abs(Math.abs(dot) - 1) < 1e-8;
}
/** Analytic plane-clearance checks for fixed-orientation linear travel.
 * This does not model the robot body or external obstacles: operator corridor
 * confirmation and adapter kinematic preflight are separate required gates.
 */
export function prepareTransferRoute(
  input: TransferRouteInput,
  screens: readonly TransferScreen[],
): PreparedTransferRoute {
  if (input.confirmed !== true)
    throw new RobotArmError(
      'CONFIRMATION_REQUIRED',
      'Confirm the complete transfer corridor, including fixtures and obstacles',
      409,
    );
  const from = screens.find(
    (entry) => entry.calibration.id === input.fromCalibrationId,
  );
  const to = screens.find(
    (entry) => entry.calibration.id === input.toCalibrationId,
  );
  if (!from || !to || from === to)
    throw new RobotArmError(
      'INVALID_TRANSFER',
      'Select two different calibrated screens',
    );
  if (
    (input.fromCalibrationRevision !== undefined &&
      input.fromCalibrationRevision !== from.calibration.revision) ||
    (input.toCalibrationRevision !== undefined &&
      input.toCalibrationRevision !== to.calibration.revision)
  )
    throw new RobotArmError(
      'TRANSFER_STALE',
      'Calibration changed before transfer validation; review both safe positions again',
      409,
    );
  if (!Array.isArray(input.waypoints) || input.waypoints.length > 64)
    throw new RobotArmError(
      'INVALID_TRANSFER',
      'At most 64 measured transfer waypoints are allowed',
    );
  if (
    from.calibration.robotProfileId !== to.calibration.robotProfileId ||
    from.tool.id !== to.tool.id ||
    semanticJson([
      from.tool.offsetMm,
      from.tool.contactDirection,
      from.tool.payload,
    ]) !==
      semanticJson([
        to.tool.offsetMm,
        to.tool.contactDirection,
        to.tool.payload,
      ])
  )
    throw new RobotArmError(
      'INVALID_TRANSFER',
      'Both screens must use the same robot installation and saved physical tool',
    );
  const poses = structuredClone([
    from.calibration.observationPose,
    ...input.waypoints,
    to.calibration.observationPose,
  ]);
  assertTransferClearance(poses, screens, from.tool);
  // At fixed orientation the contact point moves linearly. Clearance to every
  // plane is affine, so checking both segment endpoints bounds the whole segment.
  const length = poses
    .slice(1)
    .reduce(
      (sum, pose, i) => sum + distance(poses[i].positionMm, pose.positionMm),
      0,
    );
  if (length > 10000)
    throw new RobotArmError(
      'INVALID_TRANSFER',
      'Transfer route is longer than 10 metres',
    );
  return {
    ...structuredClone(input),
    confirmed: true,
    poses,
    contextKey: transferContextKey(screens),
  };
}

/** Every linear segment has fixed orientation and clears every selected screen plane. */
export function assertTransferClearance(
  poses: readonly CartesianPose[],
  screens: readonly TransferScreen[],
  tool: ToolProfile,
): void {
  for (const pose of poses) {
    assertPose(pose);
    if (!sameOrientation(poses[0], pose))
      throw new RobotArmError(
        'INVALID_TRANSFER',
        'Transfer routes currently require fixed tool orientation',
      );
    for (const entry of screens) {
      if (!calibrationAccepted(entry.calibration))
        throw new RobotArmError(
          'CALIBRATION_REQUIRED',
          'Transfer requires accepted calibration for every selected screen',
        );
      assertSafeObservation(
        entry.calibration,
        pose,
        tool.offsetMm,
        entry.screen.safeHeightMm,
      );
    }
  }
}

/** Includes intermediate poses for adapter/workspace checks, not only endpoints. */
export function sampleTransferRoute(
  poses: readonly CartesianPose[],
  maxStepMm = 5,
): CartesianPose[] {
  if (!Number.isFinite(maxStepMm) || maxStepMm <= 0)
    throw new Error('Positive transfer sampling step required');
  const result: CartesianPose[] = [];
  for (let index = 1; index < poses.length; index++) {
    const from = poses[index - 1];
    const to = poses[index];
    const steps = Math.max(
      1,
      Math.ceil(distance(from.positionMm, to.positionMm) / maxStepMm),
    );
    if (result.length + steps > 4096)
      throw new RobotArmError(
        'INVALID_TRANSFER',
        'Transfer route has too many validation samples',
      );
    for (let i = 1; i <= steps; i++) {
      const fraction = i / steps;
      result.push({
        ...structuredClone(from),
        positionMm: {
          x:
            from.positionMm.x +
            (to.positionMm.x - from.positionMm.x) * fraction,
          y:
            from.positionMm.y +
            (to.positionMm.y - from.positionMm.y) * fraction,
          z:
            from.positionMm.z +
            (to.positionMm.z - from.positionMm.z) * fraction,
        },
      });
    }
  }
  return result;
}
