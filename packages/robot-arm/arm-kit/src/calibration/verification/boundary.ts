// Pinned upstream dev 710f60809: only module paths and host evidence fields differ.
import type {
  ApplicationContext,
  MotionTarget,
} from '../../application/context.js';
import {
  type CalibrationSession,
  type CartesianPose,
  RobotArmError,
  type ScreenProfile,
} from '../../contracts.js';
import { validateMotionOptions } from '../../kernel/motion.js';
import { screenPoseMm } from '../geometry.js';
import type { CalibrationHost } from './commands.js';
import { atTravelHeight } from './travel-height.js';

export const BOUNDARY_HOVER_HOLD_MS = 500;
export const BOUNDARY_HOVER_HOLD_MS_FAST = 150;
// Verification is a light contact demonstration, not force-controlled pressing.
// Keep the sliding contour away from OS edge-gesture origins.
const BOUNDARY_CONTACT_DEPTH_MM = 0.1;
const BOUNDARY_CONTACT_MIN_INSET_MM = 8;
const BOUNDARY_CONTACT_INSET_FRACTION = 0.15;

export async function runBoundaryVerification(
  host: CalibrationHost,
  s: CalibrationSession,
  ctx: ApplicationContext,
  group: 'hover' | 'contact' = 'hover',
  settings: {
    allowUnacceptedHover?: boolean;
    /**
     * Pose to return to when the candidate has no Safe Position yet. Automatic
     * exploration verifies before the operator records one, so it parks at the
     * session start pose instead of saving that pose as the Safe Position.
     */
    returnPose?: CartesianPose;
    /**
     * Fast exploration uses shorter hover holds after passing the shared
     * calibration quality checks. Both modes use the configured action speed
     * and acceleration.
     */
    fast?: boolean;
    /** Automatic hover verification hands off at corner 1 to the contact group. */
    continueAtBoundary?: boolean;
  } = {},
) {
  if (s.stage !== 'verification' || !s.candidate || s.dragMode)
    throw new RobotArmError(
      'INVALID_STAGE',
      'Record the observation pose and exit Drag Mode before verification',
      409,
    );
  if (
    group === 'contact' &&
    !settings.allowUnacceptedHover &&
    !s.boundary?.hoverHuman
  )
    throw new RobotArmError(
      'HOVER_NOT_VERIFIED',
      'Accept the complete hover boundary verification first',
      409,
    );
  await host.ready();
  host.validateCalibration(s.candidate, s, ctx, false);
  const savedObservation = settings.returnPose ?? s.candidate.observationPose;
  const observation = savedObservation && atTravelHeight(savedObservation, ctx);
  if (!observation)
    throw new RobotArmError(
      'SAFE_POSITION_REQUIRED',
      'Record the safe position before running boundary verification',
      409,
    );
  const options = {
    speed: ctx.screen.actionSpeed,
    acceleration: ctx.screen.actionAcceleration,
  };
  const hoverHoldMs = settings.fast
    ? BOUNDARY_HOVER_HOLD_MS_FAST
    : BOUNDARY_HOVER_HOLD_MS;
  const constraints =
    host.adapter.resolver.descriptor('motion.linear')?.constraints;
  if (!constraints)
    throw new RobotArmError(
      'UNSUPPORTED_CAPABILITY',
      'Linear motion constraints are required',
      422,
    );
  validateMotionOptions(
    options,
    constraints,
    host.adapter.capabilities.jointCount,
  );
  function assertScreenPhysicalSize<T extends ScreenProfile>(
    screen: T,
  ): asserts screen is T & {
    physicalWidthMm: number;
    physicalHeightMm: number;
  } {
    if (
      typeof screen.physicalWidthMm !== 'number' ||
      typeof screen.physicalHeightMm !== 'number' ||
      !Number.isFinite(screen.physicalWidthMm) ||
      !Number.isFinite(screen.physicalHeightMm) ||
      screen.physicalWidthMm <= 0 ||
      screen.physicalHeightMm <= 0
    )
      throw new RobotArmError(
        'SCREEN_PHYSICAL_SIZE_REQUIRED',
        'Measure the screen with automatic exploration, or enter both physical dimensions before manual calibration',
        409,
      );
  }
  assertScreenPhysicalSize(ctx.screen);
  const { physicalWidthMm, physicalHeightMm } = ctx.screen;
  const corners = [
    { x: 0, y: 0 },
    { x: ctx.screen.physicalWidthMm, y: 0 },
    { x: ctx.screen.physicalWidthMm, y: ctx.screen.physicalHeightMm },
    { x: 0, y: ctx.screen.physicalHeightMm },
  ];
  const hover = corners.map((p) =>
    atTravelHeight(
      screenPoseMm(s.candidate!, ctx.tool, p, -ctx.screen.safeHeightMm),
      ctx,
    ),
  );
  const contactDepthMm = Math.min(
    ctx.screen.pressDepthMm,
    BOUNDARY_CONTACT_DEPTH_MM,
  );
  // All contacts, including taps, stay inside the display. Apply the margin
  // per axis so the long edges of a phone also clear system gesture regions.
  // The quarter-size cap preserves a usable rectangle on small displays.
  const inset = (size: number) =>
    Math.min(
      size / 4,
      Math.max(
        BOUNDARY_CONTACT_MIN_INSET_MM,
        size * BOUNDARY_CONTACT_INSET_FRACTION,
      ),
    );
  const insetX = inset(ctx.screen.physicalWidthMm);
  const insetY = inset(ctx.screen.physicalHeightMm);
  const innerCorners = corners.map((p) => ({
    x: p.x === 0 ? insetX : p.x - insetX,
    y: p.y === 0 ? insetY : p.y - insetY,
  }));
  // Publish the exact planned coordinates, normalized in the physical screen
  // frame. The phone service projects them through its page mapping, rather
  // than assuming CSS pixels have the same origin, scale or orientation.
  const guide = (group === 'contact' ? innerCorners : corners).map((p) => ({
    x: p.x / physicalWidthMm,
    y: p.y / physicalHeightMm,
  }));
  const contourContact = innerCorners.map((p) =>
    screenPoseMm(s.candidate!, ctx.tool, p, contactDepthMm),
  );
  const contourHover = innerCorners.map((p) =>
    atTravelHeight(
      screenPoseMm(s.candidate!, ctx.tool, p, -ctx.screen.safeHeightMm),
      ctx,
    ),
  );
  type Step = MotionTarget & {
    holdMs?: number;
    progress?: CalibrationSession['progress'];
  };
  const steps: Step[] = [];
  const add = (
    name: string,
    pose: CartesianPose,
    holdMs?: number,
    task?: 'corners' | 'edges' | 'return',
    index = 0,
  ) =>
    steps.push({
      name,
      pose,
      options,
      holdMs,
      progress: {
        group,
        task: task ?? 'edges',
        index,
        total: task === 'return' ? 1 : 4,
        guide,
      },
    });
  const initialPose = await host.adapter.getPose();
  add('Initial lift', host.safeLift(initialPose, s.candidate, ctx, false));
  if (group === 'contact') {
    for (let i = 0; i < 4; i++) {
      add(
        `Corner ${i + 1} hover`,
        contourHover[i],
        undefined,
        'corners',
        i + 1,
      );
      add(
        `Corner ${i + 1} contact`,
        contourContact[i],
        ctx.screen.contactMs,
        'corners',
        i + 1,
      );
      add(`Corner ${i + 1} lift`, contourHover[i], undefined, 'corners', i + 1);
    }
  }
  if (group === 'hover') {
    add('Boundary start hover', hover[0], undefined, 'edges', 0);
    for (let i = 1; i <= 4; i++)
      add(`Boundary edge ${i}`, hover[i % 4], hoverHoldMs, 'edges', i);
  } else {
    // Demonstrate each inner edge separately. Lift between segments so a lost
    // contact cannot become a new gesture that continues around the next turn.
    const startIndex = settings.fast ? 3 : 0;
    for (let i = 1; i <= 4; i++) {
      const from = (startIndex + i - 1) % 4;
      const to = (startIndex + i) % 4;
      add(
        `Boundary segment ${i} hover`,
        contourHover[from],
        undefined,
        'edges',
        i,
      );
      add(
        `Boundary segment ${i} contact`,
        contourContact[from],
        undefined,
        'edges',
        i,
      );
      add(`Boundary edge ${i}`, contourContact[to], undefined, 'edges', i);
      add(
        `Boundary segment ${i} lift`,
        contourHover[to],
        undefined,
        'edges',
        i,
      );
    }
  }
  // The contour ends at a hover pose, so there is no separate return lift.
  // Move at safe height to above the observation pose, then settle.
  if (
    !(
      settings.fast &&
      settings.allowUnacceptedHover &&
      settings.continueAtBoundary &&
      group === 'hover'
    )
  ) {
    add(
      'Return over observation',
      host.safeLift(observation, s.candidate, ctx, false),
      undefined,
      'return',
      1,
    );
    add('Return observation', observation, undefined, 'return', 1);
  }
  // Preflight every actual target before movement, including the inner contour.
  await host.preflight(steps, ctx);
  const record: NonNullable<CalibrationSession['verificationRuns']>[number] = {
    group,
    startedAt: new Date().toISOString(),
    outcome: 'running',
    targets: steps.map((step) => ({
      name: step.name,
      positionMm: step.pose.positionMm,
    })),
    speed: options.speed,
    acceleration: options.acceleration,
  };
  s.verificationRuns = [...(s.verificationRuns ?? []), record].slice(-10);
  await host.profileStore.saveSession(s, false, () => host.check());
  // Exact equality only: no new positioning tolerance or rounded coordinates.
  const samePose = (a: CartesianPose, b: CartesianPose) =>
    a.frame === b.frame &&
    a.positionMm.x === b.positionMm.x &&
    a.positionMm.y === b.positionMm.y &&
    a.positionMm.z === b.positionMm.z &&
    a.orientation.x === b.orientation.x &&
    a.orientation.y === b.orientation.y &&
    a.orientation.z === b.orientation.z &&
    a.orientation.w === b.orientation.w;
  let reached = initialPose;
  try {
    for (const step of steps) {
      host.check();
      s.progress = step.progress;
      host.progress?.(s);
      if (!settings.fast || !samePose(reached, step.pose))
        await host.move(step.pose, ctx, options.speed, options.acceleration);
      // Retain arrival checks and dwell even when no motion command is needed.
      await host.stable(step.pose, ctx);
      reached = step.pose;
      if (step.holdMs) await host.hold(step.holdMs);
    }
    record.outcome = 'completed';
  } catch (error) {
    record.outcome = host.interrupted() ? 'interrupted' : 'failed';
    throw error;
  } finally {
    record.finishedAt = new Date().toISOString();
    host.progress?.(s);
  }
  s.progress = undefined;
  if (!s.boundary)
    throw new RobotArmError(
      'INVALID_SESSION',
      'Boundary verification evidence is missing',
    );
  if (group === 'hover') {
    s.boundary.hoverCorners = true;
    s.boundary.hoverEdges = true;
  } else {
    s.boundary.contactCorners = true;
    s.boundary.contactEdges = true;
  }
}
