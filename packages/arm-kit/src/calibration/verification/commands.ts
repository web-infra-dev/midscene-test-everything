import type {
  ApplicationContext,
  MotionTarget,
} from '../../application/context.js';
import {
  type ActionResult,
  type CalibrationCommand,
  type CalibrationProfile,
  type CalibrationSession,
  type CartesianPose,
  type MotionAcceleration,
  type MotionResult,
  type MotionSpeed,
  RobotArmError,
} from '../../contracts.js';
import { assertPose, contactPoint, dot } from '../../domain.js';
import type { RobotDriverBoundary } from '../../kernel/driver-boundary.js';
import type { ProfileStore } from '../../runtime/profile-store.js';
import {
  releaseStageOptions,
  stageOptions,
  validateContactPolicy,
} from '../../screen-interaction/motion-policy.js';
import { explorationQualityWarnings } from '../exploration/quality.js';
import { phonePointMm, screenPoseMm } from '../geometry.js';
import { runBoundaryVerification } from './boundary.js';
import { avoidCamera } from './camera-avoidance.js';
import { returnToObservation } from './safe-position.js';
import { resetCalibrationVerification } from './session-state.js';

export interface CalibrationHost {
  progress?(s: CalibrationSession): void;
  adapter: RobotDriverBoundary;
  profileStore: ProfileStore;
  check(): void;
  interrupted(): boolean;
  ready(): Promise<void>;
  drag(enter: boolean): Promise<void>;
  target(p: CartesianPose, ctx: ApplicationContext): void;
  preflight(targets: MotionTarget[], ctx: ApplicationContext): Promise<void>;
  move(
    p: CartesianPose,
    ctx: ApplicationContext,
    speed?: MotionSpeed,
    acceleration?: MotionAcceleration,
  ): Promise<MotionResult>;
  stable(p: CartesianPose, ctx: ApplicationContext): Promise<void>;
  stationaryPose(ctx: ApplicationContext): Promise<CartesianPose>;
  hold(ms: number): Promise<void>;
  contactAction(
    contact: CartesianPose,
    hover: CartesianPose,
    calibration: CalibrationProfile,
    ctx: ApplicationContext,
  ): Promise<ActionResult>;
  safeLift(
    p: CartesianPose,
    c: CalibrationProfile,
    ctx: ApplicationContext,
    onScreen: boolean,
  ): CartesianPose;
  validateCalibration(
    c: CalibrationProfile,
    s: CalibrationSession,
    ctx: ApplicationContext,
    active: boolean,
  ): void;
  validateScreenTargets(c: CalibrationProfile, ctx: ApplicationContext): void;
}
/** Safe return, full-screen hover and phone-target contact verification. */
export async function applyCalibrationCommand(
  this: CalibrationHost,
  s: CalibrationSession,
  command: CalibrationCommand,
  ctx: ApplicationContext,
): Promise<void> {
  if (s.auto?.minimumTravelTipZMm !== undefined)
    ctx = {
      ...ctx,
      minimumTravelTipZMm: Math.max(
        ctx.minimumTravelTipZMm ?? Number.NEGATIVE_INFINITY,
        s.auto.minimumTravelTipZMm,
      ),
    };
  switch (command.type) {
    case 'verify-automatic-boundary': {
      if (!s.auto || !s.candidate || command.accepted !== true)
        throw new RobotArmError(
          'INVALID_STAGE',
          'Automatic exploration evidence is required',
          409,
        );
      const fast =
        s.auto.fast &&
        explorationQualityWarnings(
          ctx.screen,
          s.candidate.quality,
          s.auto.evidence,
          true,
        ).length === 0;
      await runBoundaryVerification(this, s, ctx, 'hover', {
        allowUnacceptedHover: true,
        returnPose: s.auto.startPose,
        fast,
        continueAtBoundary: fast,
      });
      await runBoundaryVerification(this, s, ctx, 'contact', {
        allowUnacceptedHover: true,
        returnPose: s.auto.startPose,
        fast,
      });
      if (!(await avoidCamera(this, s, ctx))) {
        s.stage = 'observation';
        s.auto.observationRecorded = false;
      }
      break;
    }
    case 'record-observation': {
      if (s.stage !== 'observation' || !s.candidate)
        throw new RobotArmError(
          'INVALID_STAGE',
          'Record the safe position during the observation stage',
          409,
        );
      if (s.dragMode) {
        await this.drag(false);
        s.dragMode = false;
      }
      await this.ready();
      const pose = await this.stationaryPose(ctx);
      assertPose(pose);
      this.target(pose, ctx);
      const contact = contactPoint(pose, ctx.tool.offsetMm);
      if (
        contact.z <
        (ctx.minimumTravelTipZMm ?? Number.NEGATIVE_INFINITY) - 1e-6
      )
        throw new RobotArmError(
          'UNSAFE_OBSERVATION',
          'Record the safe position at or above the taught reference height',
        );
      const height =
        (dot(s.candidate.plane.normal, contact) - s.candidate.plane.offset) /
        dot(s.candidate.plane.normal, s.candidate.inward);
      if (height > -ctx.screen.safeHeightMm)
        throw new RobotArmError(
          'UNSAFE_OBSERVATION',
          'Observation pose must be at least the safe clearance away from the screen',
        );
      s.candidate.observationPose = pose;
      if (s.auto) s.auto.observationRecorded = true;
      s.stage = 'verification';
      break;
    }
    case 'verify-contact-boundary':
      if (command.accepted !== true)
        throw new RobotArmError(
          'CONFIRMATION_REQUIRED',
          'Confirm contact verification',
          409,
        );
      await runBoundaryVerification(this, s, ctx, 'contact');
      break;
    case 'verify-hover-boundary':
      await runBoundaryVerification(this, s, ctx);
      break;
    case 'confirm-hover-boundary':
      if (
        s.stage !== 'verification' ||
        !s.boundary?.hoverCorners ||
        !s.boundary.hoverEdges ||
        typeof command.accepted !== 'boolean'
      )
        throw new RobotArmError(
          'NOT_VERIFIED',
          'Run the complete hover group before confirming',
          409,
        );
      if (!command.accepted) resetCalibrationVerification(s);
      else {
        s.boundary.hoverHuman = true;
      }
      break;
    case 'enter-drag':
      await this.drag(true);
      s.dragMode = true;
      break;
    case 'exit-drag':
      await this.drag(false);
      s.dragMode = false;
      break;
    case 'return-observation': {
      if (
        s.stage !== 'observation' ||
        !s.candidate ||
        command.accepted !== true ||
        s.dragMode
      )
        throw new RobotArmError(
          'INVALID_STAGE',
          'Confirm release and exit Drag Mode before returning to the saved safe position',
          409,
        );
      await returnToObservation(this, s, ctx);
      break;
    }
    case 'verify-web-target': {
      if (s.stage !== 'verification' || !s.candidate)
        throw new RobotArmError(
          'INVALID_STAGE',
          'Candidate must be ready for verification',
          409,
        );
      if (!s.boundary?.hoverHuman)
        throw new RobotArmError(
          'HOVER_NOT_VERIFIED',
          'Verify hover before contact',
          409,
        );
      await this.ready();
      this.validateCalibration(s.candidate, s, ctx, false);
      this.validateScreenTargets(s.candidate, ctx);
      const frame = s.candidate.phoneFrame;
      const width = frame.width;
      const height = frame.height;
      if (
        !command.point ||
        !Number.isFinite(command.point.x) ||
        !Number.isFinite(command.point.y) ||
        !width ||
        !height ||
        command.point.x < 0 ||
        command.point.y < 0 ||
        command.point.x >= width ||
        command.point.y >= height
      )
        throw new RobotArmError(
          'INVALID_SCREEN_POINT',
          'Verification target is outside the calibration coordinate frame',
        );
      const point = phonePointMm(s.candidate, ctx.screen, command.point);
      validateContactPolicy(
        ctx.screen,
        this.adapter.resolver.descriptor('motion.linear')!.constraints!,
        this.adapter.capabilities.jointCount,
      );
      const approachOptions = stageOptions(
        ctx.screen,
        'approach',
        this.adapter.resolver.descriptor('motion.linear')!.constraints!,
        this.adapter.capabilities.jointCount,
      );
      const recoveryOptions = stageOptions(
        ctx.screen,
        'recovery',
        this.adapter.resolver.descriptor('motion.linear')!.constraints!,
        this.adapter.capabilities.jointCount,
      );
      const contactOptions = stageOptions(
        ctx.screen,
        'entry',
        this.adapter.resolver.descriptor('motion.linear')!.constraints!,
        this.adapter.capabilities.jointCount,
      );
      const exitOptions = releaseStageOptions(
        ctx.screen,
        this.adapter.resolver.descriptor('motion.linear')!.constraints!,
        this.adapter.capabilities.jointCount,
      );
      const lifted = this.safeLift(
        await this.adapter.getPose(),
        s.candidate,
        ctx,
        false,
      );
      const hover = screenPoseMm(
        s.candidate,
        ctx.tool,
        point,
        -ctx.screen.safeHeightMm,
      );
      const contact = screenPoseMm(
        s.candidate,
        ctx.tool,
        point,
        ctx.screen.pressDepthMm,
      );
      const targets: MotionTarget[] = [
        { name: 'Initial lift', pose: lifted, options: recoveryOptions },
        { name: 'Center hover', pose: hover, options: approachOptions },
      ];
      targets.push(
        { name: 'Center contact', pose: contact, options: contactOptions },
        { name: 'Contact lift', pose: hover, options: exitOptions },
      );
      targets.push({
        name: 'Return observation',
        pose: s.candidate.observationPose,
        options: approachOptions,
      });
      await this.preflight(targets, ctx);
      await this.move(
        lifted,
        ctx,
        recoveryOptions.speed,
        recoveryOptions.acceleration,
      );
      await this.move(
        hover,
        ctx,
        approachOptions.speed,
        approachOptions.acceleration,
      );
      await this.stable(hover, ctx);
      if (!s.boundary?.hoverHuman)
        throw new RobotArmError(
          'HOVER_NOT_VERIFIED',
          'Verify hover before contact',
          409,
        );
      s.tapResult = await this.contactAction(contact, hover, s.candidate, ctx);
      await this.move(
        s.candidate.observationPose,
        ctx,
        approachOptions.speed,
        approachOptions.acceleration,
      );
      await this.stable(s.candidate.observationPose, ctx);
      break;
    }
    case 'cancel':
      if (s.dragMode) {
        await this.drag(false);
        s.dragMode = false;
      }
      s.stage = 'cancelled';
      break;
    default:
      throw new RobotArmError('INVALID_COMMAND', 'Unknown calibration command');
  }
}
