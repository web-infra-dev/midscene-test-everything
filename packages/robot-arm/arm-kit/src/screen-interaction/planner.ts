import { screenPose } from '../calibration/geometry.js';
import { surfaceClearanceMm } from '../calibration/surface.js';
import {
  type CalibrationProfile,
  type CartesianPose,
  type EffectiveCapabilities,
  type MotionSpeed,
  type RobotArmCapabilities,
  RobotArmError,
  type ScreenAction,
  type ScreenProfile,
  type ToolProfile,
} from '../contracts.js';
import { assertSpeed, distance } from '../domain.js';

export function effectiveCapabilities(
  c: RobotArmCapabilities,
): Pick<
  EffectiveCapabilities,
  keyof RobotArmCapabilities | 'screenActions' | 'calibration'
> {
  const usable =
    c.measuredCartesian === true &&
    ['x', 'y', 'z'].every((axis) =>
      c.cartesianDof?.includes(axis as 'x' | 'y' | 'z'),
    ) &&
    c.linear &&
    c.stop &&
    c.speedModes.length > 0 &&
    c.speedModes.some((mode) => mode === 'ratio' || mode === 'linear') &&
    c.accelerationModes?.some(
      (mode) => mode === 'ratio' || mode === 'linear',
    ) === true;
  return {
    ...c,
    screenActions: usable ? ['tap', 'longPress', 'swipe', 'dragAndDrop'] : [],
    calibration: usable
      ? [c.orientation !== 'full' ? 'restrictedPlane' : 'spatialPlane']
      : [],
  };
}
export interface ActionPlan {
  approach: CartesianPose;
  contact: CartesianPose;
  endContact?: CartesianPose;
  lift: CartesianPose;
  observation: CartesianPose;
  holdMs: number;
  /**
   * `target` closes the hold on the requested window and may be shortened by the
   * successor lead; `minimum` is a long press, whose window must not be
   * shortened to compensate dispatch latency.
   */
  holdMode: 'target' | 'minimum';
  speed: MotionSpeed;
  contactSpeed: MotionSpeed;
  requestedDurationMs?: number;
  limitations: string[];
}
export function planAction(
  action: ScreenAction,
  c: CalibrationProfile,
  s: ScreenProfile,
  t: ToolProfile,
  caps: RobotArmCapabilities,
): ActionPlan {
  if (
    !action ||
    !effectiveCapabilities(caps).screenActions.includes(action.type)
  )
    throw new RobotArmError(
      'UNSUPPORTED_ACTION',
      'Unsupported screen action',
      422,
    );
  assertSpeed(s.actionSpeed);
  if (
    s.actionSpeed.kind === 'linear' &&
    caps.maxLinearSpeedMmPerSecond &&
    s.actionSpeed.mmPerSecond > caps.maxLinearSpeedMmPerSecond
  )
    throw new RobotArmError(
      'SPEED_LIMIT',
      'Profile speed exceeds Adapter linear-speed limit',
      422,
    );
  if (!caps.speedModes.includes(s.actionSpeed.kind))
    throw new RobotArmError(
      'UNSUPPORTED_SPEED',
      'Profile speed is unsupported',
      422,
    );
  const duration = 'durationMs' in action ? action.durationMs : undefined;
  if (
    duration !== undefined &&
    (!Number.isFinite(duration) || duration <= 0 || duration > 60000)
  )
    throw new RobotArmError(
      'INVALID_DURATION',
      'durationMs must be in (0,60000]',
    );
  const start =
    action.type === 'tap' || action.type === 'longPress'
      ? action.point
      : action.from;
  const end =
    action.type === 'swipe' || action.type === 'dragAndDrop'
      ? action.to
      : start;
  const contact = screenPose(c, s, t, start, s.pressDepthMm);
  const endContact =
    action.type === 'swipe' || action.type === 'dragAndDrop'
      ? screenPose(c, s, t, end, s.pressDepthMm)
      : undefined;
  const limitations: string[] = [];
  let contactSpeed = s.actionSpeed;
  if (endContact && duration !== undefined) {
    if (caps.speedModes.includes('linear')) {
      const requested =
        distance(contact.positionMm, endContact.positionMm) / (duration / 1000);
      const max = caps.maxLinearSpeedMmPerSecond;
      if (requested > 0) {
        contactSpeed = {
          kind: 'linear',
          mmPerSecond: Math.min(requested, max ?? requested),
        };
        if (max && requested > max)
          limitations.push(
            'Requested duration exceeds the configured maximum linear speed',
          );
      } else
        limitations.push('Zero-length gesture cannot match requested duration');
    } else
      limitations.push(
        'Adapter supports ratio speed only; duration is best effort',
      );
  }
  const hover = { ...c, surface: undefined };
  const clearance = s.safeHeightMm + surfaceClearanceMm(c.surface);
  return {
    approach: screenPose(hover, s, t, start, -clearance),
    contact,
    endContact,
    lift: screenPose(hover, s, t, end, -clearance),
    observation: c.observationPose,
    holdMs:
      action.type === 'longPress'
        ? (duration ?? s.longPressMs)
        : action.type === 'dragAndDrop'
          ? s.dragHoldMs
          : action.type === 'swipe'
            ? s.swipeEndpointHoldMs
            : s.contactMs,
    holdMode: action.type === 'longPress' ? 'minimum' : 'target',
    speed: s.actionSpeed,
    contactSpeed,
    requestedDurationMs: duration,
    limitations,
  };
}
