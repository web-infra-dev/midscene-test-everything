import type { ApplicationContext } from '../../application/context.js';
import type { CalibrationSession } from '../../contracts.js';
import {
  scaleAcceleration,
  scaleSpeed,
} from '../../screen-interaction/motion-policy.js';
import {
  cameraAvoidanceTargets,
  taughtCameraSide,
} from '../camera-avoidance.js';
import { calibrationQuad } from '../screen-position.js';
import type { CalibrationHost } from './commands.js';
import { assertSafeObservation } from './safe-position.js';
import { atTravelHeight } from './travel-height.js';

/** Only a complete preflight may fall back. A failed submitted move propagates. */
export async function avoidCamera(
  host: CalibrationHost,
  s: CalibrationSession,
  ctx: ApplicationContext,
): Promise<boolean> {
  if (!ctx.installationTeaching || !s.candidate || !s.auto) return false;
  const candidate = s.candidate;
  const data = host.profileStore.list();
  const obstacles = (data.devices ?? [])
    .filter(
      (d) =>
        d.robotProfileId === ctx.robot.id &&
        d.toolProfileId === ctx.tool.id &&
        d.screenProfileId !== ctx.screen.id,
    )
    .flatMap((d) => {
      const c = data.calibrations.find((c) => c.id === d.calibrationProfileId);
      const screen = data.screens.find((p) => p.id === d.screenProfileId);
      const quad = c && screen && calibrationQuad(c, screen);
      return quad ? [quad] : [];
    });
  const targets = cameraAvoidanceTargets(
    candidate,
    ctx.screen,
    ctx.tool,
    taughtCameraSide(candidate, ctx.screen, ctx.installationTeaching),
    obstacles,
  );
  const options = {
    speed: scaleSpeed(ctx.screen.actionSpeed, 0.1),
    acceleration: scaleAcceleration(ctx.screen.actionAcceleration, 0.1),
  };
  const actual = await host.stationaryPose(ctx);
  const lift = atTravelHeight(
    host.safeLift(actual, candidate, ctx, false),
    ctx,
  );
  for (const proposed of targets) {
    host.check();
    const target = atTravelHeight(proposed, ctx);
    try {
      assertSafeObservation(
        candidate,
        target,
        ctx.tool.offsetMm,
        ctx.screen.safeHeightMm,
      );
      await host.preflight(
        [
          { name: 'Camera avoidance lift', pose: lift, options },
          { name: 'Camera avoidance exit', pose: target, options },
        ],
        ctx,
      );
    } catch (error) {
      host.check();
      if (host.interrupted()) throw error;
      continue;
    }
    s.auto.avoidingCamera = true;
    host.progress?.(s);
    try {
      await host.move(lift, ctx, options.speed, options.acceleration);
      await host.stable(lift, ctx);
      await host.move(target, ctx, options.speed, options.acceleration);
      await host.stable(target, ctx);
      host.check();
      const measured = await host.stationaryPose(ctx);
      assertSafeObservation(
        candidate,
        measured,
        ctx.tool.offsetMm,
        ctx.screen.safeHeightMm,
      );
      candidate.observationPose = measured;
      s.auto.observationRecorded = true;
      s.auto.cameraAvoidanceRecorded = true;
      s.stage = 'verification';
      return true;
    } finally {
      s.auto.avoidingCamera = false;
      host.progress?.(s);
    }
  }
  return false;
}
