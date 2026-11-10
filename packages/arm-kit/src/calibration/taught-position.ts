import { cameraBoundaryExcessMm } from '../application/teaching-constraints.js';
import type { AutomaticCaptureHost } from '../assisted-contracts.js';
import type {
  CartesianPose,
  InstallationTeaching,
  ScreenMotionSettings,
  ToolProfile,
} from '../contracts.js';
import { contactPoint, flangePose } from '../domain.js';

// Only reconcile a measured start with the plane, never relax a target check.
const BOUNDARY_READBACK_NOISE_MM = 0.001;

export async function moveToTaughtPosition(
  host: Required<Pick<AutomaticCaptureHost, 'read' | 'preflight' | 'move'>>,
  teaching: InstallationTeaching,
  tool: ToolProfile,
  target: CartesianPose,
  motion: Pick<ScreenMotionSettings, 'actionSpeed' | 'actionAcceleration'>,
  minimumTipZMm = Number.NEGATIVE_INFINITY,
) {
  const current = await host.read();
  const from = contactPoint(current, tool.offsetMm);
  const to = contactPoint(target, tool.offsetMm);
  const z = Math.max(
    from.z,
    to.z,
    contactPoint(teaching.referencePose, tool.offsetMm).z,
    minimumTipZMm,
  );
  const excess = cameraBoundaryExcessMm(from, teaching);
  if (excess > 0 && excess <= BOUNDARY_READBACK_NOISE_MM) {
    const { normal } = teaching.cameraBoundary;
    from.x -= excess * normal.x;
    from.y -= excess * normal.y;
  }
  const route = [
    flangePose({ ...from, z }, current.orientation, tool.offsetMm),
    flangePose({ ...to, z }, target.orientation, tool.offsetMm),
    target,
  ];
  const options = {
    speed: motion.actionSpeed,
    acceleration: motion.actionAcceleration,
  };
  await host.preflight(route, options);
  for (const pose of route) await host.move(pose, options);
}
