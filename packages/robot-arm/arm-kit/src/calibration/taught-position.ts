import {
  CAMERA_BOUNDARY_EPSILON_MM,
  cameraBoundaryExcessMm,
} from '../application/teaching-constraints.js';
import type { AutomaticCaptureHost } from '../assisted-contracts.js';
import { RobotArmError, isRobotArmError } from '../contracts.js';
import type {
  CartesianPose,
  InstallationTeaching,
  ScreenMotionSettings,
  ToolProfile,
  Vector3,
} from '../contracts.js';
import {
  contactPoint,
  distance,
  flangePose,
  quaternionDistance,
} from '../domain.js';

// Match the 0.5 mm measured arrival tolerance for the start of the route only.
const BOUNDARY_READBACK_NOISE_MM = 0.5;

export function sameTravelPose(a: CartesianPose, b: CartesianPose): boolean {
  return (
    distance(a.positionMm, b.positionMm) <= 1e-6 &&
    quaternionDistance(a.orientation, b.orientation) <= 1e-6
  );
}

export function insideTaughtTravelSpace(
  tip: Vector3,
  teaching: InstallationTeaching,
  minimumTipZMm: number,
) {
  return (
    tip.z >= minimumTipZMm &&
    cameraBoundaryExcessMm(tip, teaching) <= CAMERA_BOUNDARY_EPSILON_MM
  );
}

export async function moveToTaughtPosition(
  host: Required<Pick<AutomaticCaptureHost, 'read' | 'preflight' | 'move'>>,
  teaching: InstallationTeaching | undefined,
  tool: ToolProfile,
  target: CartesianPose,
  motion: Pick<ScreenMotionSettings, 'actionSpeed' | 'actionAcceleration'>,
  minimumTipZMm = Number.NEGATIVE_INFINITY,
  travel?: {
    attemptId: string;
    direction: 'approach' | 'return';
    allowDirect?: boolean;
  },
) {
  const current = await host.read();
  const from = contactPoint(current, tool.offsetMm);
  const to = contactPoint(target, tool.offsetMm);
  const travelFloor = Math.max(
    teaching ? contactPoint(teaching.referencePose, tool.offsetMm).z : to.z,
    minimumTipZMm,
  );
  const z = Math.max(from.z, to.z, travelFloor);
  const excess = teaching ? cameraBoundaryExcessMm(from, teaching) : 0;
  // With a fixed orientation, both the tip height and its signed distance
  // from the camera plane interpolate linearly over the whole move.
  const direct =
    travel?.allowDirect &&
    teaching?.corridorConfirmed &&
    insideTaughtTravelSpace(from, teaching, travelFloor) &&
    insideTaughtTravelSpace(to, teaching, travelFloor) &&
    quaternionDistance(current.orientation, target.orientation) <= 1e-6;
  if (
    teaching &&
    excess > 0 &&
    excess <= BOUNDARY_READBACK_NOISE_MM + CAMERA_BOUNDARY_EPSILON_MM
  ) {
    const { normal } = teaching.cameraBoundary;
    from.x -= excess * normal.x;
    from.y -= excess * normal.y;
  }
  const route = direct
    ? [target]
    : [
        flangePose({ ...from, z }, current.orientation, tool.offsetMm),
        flangePose({ ...to, z }, target.orientation, tool.offsetMm),
        target,
      ];
  const legs = direct
    ? (['direct'] as const)
    : (['lift', 'traverse', 'lower'] as const);
  const options = {
    speed: motion.actionSpeed,
    acceleration: motion.actionAcceleration,
  };
  await host.preflight(route, options);
  let reached = current;
  for (const [index, leg] of legs.entries()) {
    const pose = route[index];
    try {
      if (
        sameTravelPose(reached, pose) &&
        // An out-of-bounds readback still needs the corrective lift.
        !(index === 0 && excess > CAMERA_BOUNDARY_EPSILON_MM)
      )
        continue;
      // A successful move already confirms arrival at this waypoint. Use
      // the requested pose to collapse an identical following waypoint.
      await host.move(pose, {
        ...options,
        referenceTravel: travel && {
          attemptId: travel.attemptId,
          direction: travel.direction,
          leg,
        },
      });
      reached = pose;
    } catch (error) {
      if (!isRobotArmError(error)) throw error;
      throw new RobotArmError(error.code, error.message, error.status, {
        ...error.details,
        taughtPositionLeg: leg,
      });
    }
  }
}
