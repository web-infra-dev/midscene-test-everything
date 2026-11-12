import type {
  ApplicationContext,
  MotionTarget,
} from '../application/context.js';
import { atTravelHeight } from '../calibration/verification/travel-height.js';
import type {
  ActionRequest,
  ActionResult,
  CalibrationProfile,
  CartesianPose,
  ContactMoveOptions,
  MotionAcceleration,
  MotionResult,
  MotionSpeed,
} from '../contracts.js';
import type {
  LinearMotionSequence,
  LinearSequenceTarget,
} from '../kernel/contracts.js';
import type { RobotDriverBoundary } from '../kernel/driver-boundary.js';
import { executeContactPlan } from './contact-executor.js';
import {
  releaseStageOptions,
  stageOptions,
  validateContactPolicy,
} from './motion-policy.js';
import { planAction } from './planner.js';
export interface ScreenMotionHost {
  adapter: RobotDriverBoundary;
  target(p: CartesianPose, ctx: ApplicationContext): void;
  preflight(targets: MotionTarget[], ctx: ApplicationContext): Promise<void>;
  move(
    p: CartesianPose,
    ctx: ApplicationContext,
    speed?: MotionSpeed,
    acceleration?: MotionAcceleration,
    contact?: ContactMoveOptions,
  ): Promise<MotionResult>;
  beginSequence(
    targets: readonly LinearSequenceTarget[],
    ctx: ApplicationContext,
  ): Promise<LinearMotionSequence | undefined>;
  stable(p: CartesianPose, ctx: ApplicationContext): Promise<void>;
  hold(ms: number): Promise<void>;
  safeLift(
    p: CartesianPose,
    c: CalibrationProfile,
    ctx: ApplicationContext,
    onScreen: boolean,
  ): CartesianPose;
  /** Passive push-channel sample; undefined when the adapter has no channel. */
  latestToolVector(): { pose: CartesianPose; receivedAt: number } | undefined;
}
/** Atomic screen gesture expressed entirely as Base flange motion. */
export async function executeScreenAction(
  this: ScreenMotionHost,
  request: ActionRequest,
  c: CalibrationProfile,
  ctx: ApplicationContext,
  started: number,
): Promise<ActionResult> {
  const { plan, stage, releaseOptions, lifted } =
    await prepareScreenAction.call(this, request, c, ctx);
  const moveStage = (
    target: CartesianPose,
    name: import('./motion-policy.js').ContactStage,
    speed?: import('../contracts.js').MotionSpeed,
    contact?: ContactMoveOptions,
  ) => {
    const o = stage(name, speed);
    return this.move(target, ctx!, o.speed, o.acceleration, contact);
  };
  await moveStage(lifted, 'recovery');
  await moveStage(plan.approach, 'approach');
  const contact = await executeContactPlan(
    this,
    {
      contact: plan.contact,
      entryLift: plan.approach,
      endContact: plan.endContact,
      lift: plan.lift,
      entryOptions: stage('entry'),
      traverseOptions: stage(
        'traverse',
        plan.requestedDurationMs !== undefined &&
          plan.contactSpeed.kind === 'linear'
          ? plan.contactSpeed
          : undefined,
      ),
      releaseOptions,
      holdMs: plan.holdMs,
      holdMode: plan.holdMode,
    },
    c,
    ctx,
  );
  await moveStage(plan.observation, 'approach');
  await this.stable(plan.observation, ctx);
  return {
    ...contact,
    requestId: request.requestId,
    action: request.action.type,
    completedAt: new Date().toISOString(),
    requestedDurationMs: plan.requestedDurationMs,
    totalDurationMs: Date.now() - started,
    limitations: [...plan.limitations, ...contact.limitations],
  };
}

/** Validate the destination gesture before any cross-device transfer movement. */
export async function prepareScreenAction(
  this: ScreenMotionHost,
  request: ActionRequest,
  c: CalibrationProfile,
  ctx: ApplicationContext,
  startingPose?: CartesianPose,
) {
  const constraints =
    this.adapter.resolver.descriptor('motion.linear')!.constraints!;
  validateContactPolicy(
    ctx.screen,
    constraints,
    this.adapter.capabilities.jointCount,
  );
  const stage = (
    name: import('./motion-policy.js').ContactStage,
    speed?: import('../contracts.js').MotionSpeed,
  ) =>
    stageOptions(
      ctx!.screen,
      name,
      constraints,
      this.adapter.capabilities.jointCount,
      speed,
    );
  const plan = planAction(
    request.action,
    c,
    ctx.screen,
    ctx.tool,
    this.adapter.capabilities,
  );
  plan.approach = atTravelHeight(plan.approach, ctx);
  plan.lift = atTravelHeight(plan.lift, ctx);
  plan.observation = atTravelHeight(plan.observation, ctx);
  // The release segment uses the profile's release factors rather than the
  // stage table, because it is the segment that ends the press.
  const releaseOptions = releaseStageOptions(
    ctx.screen,
    constraints,
    this.adapter.capabilities.jointCount,
  );
  if (plan.endContact)
    stage(
      'traverse',
      plan.requestedDurationMs !== undefined &&
        plan.contactSpeed.kind === 'linear'
        ? plan.contactSpeed
        : undefined,
    );
  for (const p of [
    plan.approach,
    plan.contact,
    plan.endContact,
    plan.lift,
    plan.observation,
  ])
    if (p) this.target(p, ctx);
  // Start above the current screen projection before travelling laterally.
  const actual = startingPose ?? (await this.adapter.getPose());
  const lifted = this.safeLift(actual, c, ctx, false);
  const targets: MotionTarget[] = [
    { name: 'Initial lift', pose: lifted, options: stage('recovery') },
    { name: 'Approach', pose: plan.approach, options: stage('approach') },
    { name: 'Contact', pose: plan.contact, options: stage('entry') },
  ];
  if (plan.endContact) {
    targets.push({
      name: 'Entry recovery lift',
      pose: plan.approach,
      options: releaseOptions,
    });
    targets.push({
      name: 'Gesture endpoint',
      pose: plan.endContact,
      options: stage(
        'traverse',
        plan.requestedDurationMs !== undefined &&
          plan.contactSpeed.kind === 'linear'
          ? plan.contactSpeed
          : undefined,
      ),
    });
  }
  targets.push(
    { name: 'Final lift', pose: plan.lift, options: releaseOptions },
    {
      name: 'Return observation',
      pose: plan.observation,
      options: stage('approach'),
    },
  );
  await this.preflight(targets, ctx);
  return { plan, stage, releaseOptions, lifted };
}
