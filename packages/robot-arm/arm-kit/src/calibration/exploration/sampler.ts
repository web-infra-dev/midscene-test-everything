// Ported from avatr-robot/midscene-private dev, commit
// 710f60809eac3dbe824f91a5cf8b3b0e72386282, calibration/auto-exploration.ts.
// Phone transport, persistence and motion ownership
// are supplied by the Arm Kit bridge; boundary verification remains in its workflow.
import { randomUUID } from 'node:crypto';
import { CALIBRATION_PHONE_POLICY } from '../../assisted-contracts.js';
import { type CartesianPose, RobotArmError } from '../../contracts.js';
import { contactPoint, flangePose, rotate, unit } from '../../domain.js';
import {
  scaleAcceleration,
  scaleSpeed,
} from '../../screen-interaction/motion-policy.js';
import { insideTaughtTravelSpace } from '../taught-position.js';
import {
  type ScreenPoint2,
  affinePoint,
  fitAffine,
  screenFrame,
} from './geometry.js';
import { fitSamplePlane } from './plane.js';
import {
  type ApplicationContext,
  type AutoCalibrationProgress,
  type AutoExplorationHost,
  type AutoExplorationOptions,
  type CalibrationSession,
  type CollectedSample,
  type ProbePurpose,
  type ScreenCalibTarget,
  type SlideRecovery,
  assertSameScreenPage,
} from './types.js';
// Coarse travel is fast; refine only the final no-touch/touch bracket.
const SEARCH_STEP_MM = 1;
const FAST_SEARCH_STEP_MM = 2;
const FIRST_SLIDE_TOUCH_STEP_MM = 0.5;
const SEARCH_WAIT_MS = 100;
const FAST_SEARCH_WAIT_MS = 30;
// Local recovery has a fixed budget. A switch to vertical sampling is explicit.
const FAST_LOCAL_STEP_MM = 0.25;
const FAST_GRID_RECOVERY_COARSE_STEP_MM = 0.5;
// Allow up to 1.5 mm of local recovery within the shared floor.
const FAST_LOCAL_STEPS = 6;
const FAST_GRID_RETRY_INSET_MM = 3;
const FAST_SLIDE_AUDIT_INSET_FRACTION = 0.2;
const FAST_SLIDE_HEIGHT_SWEEP_MM = 10;
const FAST_SLIDE_HEIGHT_COARSE_STEP_MM = 0.5;
const FAST_RUN_RECOVERY_STEPS = 12;
const FAST_GRID_POINT_RECOVERY_STEPS = 12;
// Keep commands off the hard floor. Corner audit readbacks differed from
// commands by up to 0.000026 mm; this buffer is not an allowed overshoot.
const FLOOR_COMMAND_MARGIN_MM = 0.01;
const CONTACT_BRACKET_MM = 0.25;
// Release hysteresis can exceed 2 mm on compliant tools. Clearance is only a
// reset for a fresh downward probe, never a measurement of the screen surface.
const RELEASE_LIFT_MM = 4;
const RELEASE_RETRY_STEP_MM = 2;
const RELEASE_MAX_MM = 8;
const INITIAL_DESCENT_MM = 60;
const SEARCH_DESCENT_MM = 30;
const TOUCH_DESCENT_MM = 20;
/** Maximum depth below the first confirmed contact before a point is unsafe. */
const TOUCH_SAFETY_MARGIN_MM = 2;
const TOUCH_RETRY_ATTEMPTS = 1;
const SEARCH_PITCH_MM = 10;
const PROBE_MM = 10;
const APPROACH_LIFT_MM = 5;
const TRAVERSE_CLEARANCE_MM = 10;
// Exploration only needs a light press to keep page contact; pressing deeper
// deforms the screen and the stand and biases later validation samples.
const STANDARD_PRESS_MM = 0.5;
const DWELL_MS = 250;
const ACK_POLL_MS = 25;
const STANDARD_MOTION_FACTOR = 0.1;
const FAST_MOTION_FACTOR = 0.25;
// Travel legs carry no contact; keep their clearance and endpoint confirmation,
// but let them run faster than a probe step. Contact steps stay at the factor
// above.
const FAST_TRAVEL_FACTOR = 0.6;
// Fast mode measures two distributed heights. The approach starts
// above the lowest measured contact, and the first-touch floor caps descent.
const TILT_AUDIT_APPROACH_LIFT_MM = 8;
const TILT_AUDIT_MAX_DEVIATION_MM = 3;
const STANDARD_PRESS_FACTOR = 0.25;
const STEP_TIMEOUT_MS = 10000;
interface TouchPoint {
  recovered?: boolean;
  pressedZ: number;
  heightIntervalMm?: [number, number];
  contact: { x: number; y: number; z: number };
  screen: ScreenPoint2;
  /** Reduced when the point needed a retry or hit the safety floor. */
  weight?: number;
  /**
   * `predicted` when `contact.z` came from the height model instead of a
   * measured bracket. Geometry keeps those heights out of the plane fit.
   */
  zSource: 'measured' | 'predicted';
}
interface SampledTouch extends TouchPoint {
  /** Command that produced the confirmed press. Readback stays in pressedZ. */
  pressCommandZ: number;
  /** Keep the planned light press as the reference after a coarse-depth retry. */
  nominalPress?: { commandZ: number; measuredZ: number };
}
interface GridTouch extends TouchPoint {
  target: ScreenCalibTarget;
}

/** Confirmed samples and spent search budget for one fast calibration run. */
export interface FastSamplingCheckpoint {
  direction: SampledTouch[];
  heights: SampledTouch[];
  grid: (GridTouch & SampledTouch)[];
  samples: CollectedSample[];
  searchBudget?: { searchSteps: number; maxSearchSteps: number };
  gridBudgets: Map<string, { searchSteps: number; maxSearchSteps: number }>;
  retriedTargets: Set<string>;
  next?: {
    phase: 'reference' | 'direction' | 'height' | 'grid';
    targetId: string;
  };
  releaseBeforeResume?: boolean;
}
/** Four distributed fit corners and two held-out edge points, in serpentine order. */
export function fastExplorationTargets(
  targets: ScreenCalibTarget[],
): ScreenCalibTarget[] {
  const xs = targets.map((target) => target.css.x);
  const ys = targets.map((target) => target.css.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (!(width > 0 && height > 0))
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'Fast exploration requires distributed targets',
      409,
    );
  const fit = targets
    .filter((target) => target.role === 'fit')
    .sort(
      (a, b) =>
        ((b.css.x - cx) / width) ** 2 +
        ((b.css.y - cy) / height) ** 2 -
        ((a.css.x - cx) / width) ** 2 -
        ((a.css.y - cy) / height) ** 2,
    )
    .slice(0, 4);
  const validation = targets
    .filter((target) => target.role === 'validation')
    .slice(0, 2);
  if (fit.length !== 4 || validation.length !== 2)
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'Fast exploration requires four fit corners and two validation targets',
      409,
    );
  const rows = [
    ...new Set([...fit, ...validation].map((target) => target.css.y)),
  ].sort((a, b) => a - b);
  return [...fit, ...validation].sort(
    (a, b) =>
      a.css.y - b.css.y ||
      (rows.indexOf(a.css.y) % 2 ? b.css.x - a.css.x : a.css.x - b.css.x),
  );
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pick a pair that spans two directions with the first contact. Sliding audits
 * use the planned interior positions in robot XY and cover both screen halves.
 */
export function auditTargets(
  targets: ScreenCalibTarget[],
  sliding?: {
    firstContact: ScreenPoint2;
    auditPosition: (target: ScreenCalibTarget) => ScreenPoint2;
  },
): ScreenCalibTarget[] {
  const corners = targets.filter((target) => target.role === 'fit');
  if (!sliding && corners.length < 2) return corners;
  const xs = corners.map((target) => target.css.x);
  const ys = corners.map((target) => target.css.y);
  const middleY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const width = sliding ? 1 : Math.max(...xs) - Math.min(...xs) || 1;
  const height = sliding ? 1 : Math.max(...ys) - Math.min(...ys) || 1;
  const reference = sliding?.firstContact ?? {
    x: xs.reduce((total, value) => total + value, 0) / xs.length,
    y: ys.reduce((total, value) => total + value, 0) / ys.length,
  };
  const positions = corners.map((corner) =>
    sliding ? sliding.auditPosition(corner) : corner.css,
  );
  let best: [number, number] | undefined = sliding ? undefined : [0, 1];
  let bestArea = sliding ? 1e-6 : -1;
  for (let i = 0; i < corners.length; i++)
    for (let j = i + 1; j < corners.length; j++) {
      if (sliding && (ys[i] - middleY) * (ys[j] - middleY) >= 0) continue;
      const ax = (positions[i].x - reference.x) / width;
      const ay = (positions[i].y - reference.y) / height;
      const bx = (positions[j].x - reference.x) / width;
      const by = (positions[j].y - reference.y) / height;
      const area = Math.abs(ax * by - ay * bx);
      if (area > bestArea) {
        bestArea = area;
        best = [i, j];
      }
    }
  if (!best)
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'The first contact and upper and lower height audit positions must span two directions',
      409,
    );
  return [corners[best[0]], corners[best[1]]].sort(
    (a, b) => a.css.y - b.css.y || a.css.x - b.css.x,
  );
}

function isIntermittentContact(error: unknown): error is RobotArmError {
  return (
    error instanceof RobotArmError &&
    error.code === 'PHONE_TOUCH_UNSTABLE' &&
    error.details?.reason === 'intermittent_contact'
  );
}

function isGridContactMiss(error: unknown): error is RobotArmError {
  return (
    error instanceof RobotArmError &&
    (error.code === 'TOUCH_NOT_FOUND' ||
      error.code === 'TOUCH_CONTACT_LOST' ||
      (error.code === 'TOUCH_SAFETY_LIMIT' &&
        error.details?.confirmedNoTouch === true) ||
      isIntermittentContact(error))
  );
}

function setPhase(
  host: AutoExplorationHost,
  session: CalibrationSession,
  progress: AutoCalibrationProgress,
) {
  if (!session.auto) return;
  session.auto.progress = progress;
  host.progress?.(session);
}
async function save(host: AutoExplorationHost, session: CalibrationSession) {
  await host.profileStore.saveSession(session, false, () => host.check());
}

export async function runAutoExploration(
  host: AutoExplorationHost,
  session: CalibrationSession,
  ctx: ApplicationContext,
  options: AutoExplorationOptions,
  checkpoint?: FastSamplingCheckpoint,
) {
  const fast = options.mode === 'fast-horizontal';
  const timing = options.onTiming;
  let moveCount = 0;
  const runRecoveryBudget = checkpoint?.searchBudget ?? {
    searchSteps: 0,
    maxSearchSteps: FAST_RUN_RECOVERY_STEPS,
  };
  if (checkpoint) checkpoint.searchBudget = runRecoveryBudget;
  const gridBudget = (targetId: string | undefined) => {
    const existing = targetId && checkpoint?.gridBudgets.get(targetId);
    if (existing) return existing;
    const budget = {
      searchSteps: 0,
      maxSearchSteps: FAST_GRID_POINT_RECOVERY_STEPS,
    };
    if (targetId) checkpoint?.gridBudgets.set(targetId, budget);
    return budget;
  };
  const countRecoveryStep = (
    budget = runRecoveryBudget,
    probe?: {
      label: string;
      lastProbeZMm?: number;
      commandFloorZMm: number;
      searchScope: 'grid-point' | 'run';
    },
    steps = 1,
  ) => {
    if (budget.searchSteps + steps > budget.maxSearchSteps)
      throw new RobotArmError(
        'FAST_ADAPTATION_LIMIT',
        'Fast calibration exhausted its local height-search budget; check the installation before retrying',
        409,
        {
          ...probe,
          ...budget,
        },
      );
    budget.searchSteps += steps;
  };
  if (fast && session.auto) session.auto.fastAdaptation = runRecoveryBudget;
  if (
    (fast && options.horizontalConfirmed !== true) ||
    (options.collection === 'slide' && !fast)
  )
    throw new RobotArmError(
      'INVALID_ARGUMENT',
      'Fast exploration requires confirmation that the screen is horizontal and secured and the tool has elastic compliance',
      400,
    );
  if (session.auto) {
    session.auto.mode = fast ? 'fast-horizontal' : 'standard';
    session.auto.collection = options.collection ?? 'tap';
    session.auto.horizontalConfirmed = options.horizontalConfirmed === true;
    if (checkpoint) session.auto.collectedSamples = checkpoint.samples;
  }
  const start = options.startPose;
  const dwellMs = fast ? 100 : DWELL_MS;
  const searchStepMm = fast ? FAST_SEARCH_STEP_MM : SEARCH_STEP_MM;
  const searchWaitMs = fast ? FAST_SEARCH_WAIT_MS : SEARCH_WAIT_MS;
  ctx = { ...ctx, screen: { ...ctx.screen } };
  if (ctx.batchTransfer)
    ctx.minimumTravelTipZMm = Math.max(
      ctx.minimumTravelTipZMm ?? Number.NEGATIVE_INFINITY,
      ctx.batchTransfer.travelTipZMm,
    );
  const screen = ctx.screen;
  const tool = ctx.tool;
  const motionAtFactor = (factor: number) => ({
    speed: scaleSpeed(screen.actionSpeed, factor),
    acceleration: scaleAcceleration(screen.actionAcceleration, factor),
  });
  const moveOptions = motionAtFactor(
    fast ? FAST_MOTION_FACTOR : STANDARD_MOTION_FACTOR,
  );
  const travelOptions = fast ? motionAtFactor(FAST_TRAVEL_FACTOR) : moveOptions;
  const pressOptions = fast
    ? moveOptions
    : motionAtFactor(STANDARD_PRESS_FACTOR);
  const poseAt = (
    contact: { x: number; y: number; z: number },
    orientation = start.orientation,
  ) => flangePose(contact, orientation, tool.offsetMm);
  const preflight = async (
    contact: { x: number; y: number; z: number },
    name: string,
    motion = moveOptions,
    orientation = start.orientation,
  ) =>
    host.preflight(
      [{ name, pose: poseAt(contact, orientation), options: motion }],
      ctx,
    );
  const moveTo = async (
    contact: { x: number; y: number; z: number },
    motion = moveOptions,
    orientation = start.orientation,
  ) => {
    const pose = poseAt(contact, orientation);
    const started = performance.now();
    try {
      await assertPage();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let measured: CartesianPose | undefined;
      try {
        moveCount++;
        measured = await Promise.race([
          host.move(pose, ctx, motion.speed, motion.acceleration),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              Promise.resolve(host.stop?.()).catch(() => undefined);
              reject(
                new RobotArmError(
                  'AUTO_MOVE_TIMEOUT',
                  `The robot did not complete the step at Z ${contact.z.toFixed(1)} mm within ${STEP_TIMEOUT_MS / 1000} s; the automatic exploration was stopped`,
                  504,
                ),
              );
            }, STEP_TIMEOUT_MS);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      await host.stable(pose, ctx);
      // Always report the readback: a commanded contact height is not evidence,
      // and the safety floor must be checked against where the tool actually is.
      return contactPoint(
        measured ?? (await host.currentPose()),
        tool.offsetMm,
      );
    } finally {
      timing?.('movl', performance.now() - started);
    }
  };

  const page = structuredClone(
    options.page ??
      (await host.screenCalib.findMappedSession(ctx.screen.visionTarget)),
  );
  if (
    screen.visionTarget &&
    (page.config?.cameraId !== screen.visionTarget.cameraId ||
      page.config.screenId !== screen.visionTarget.screenId)
  )
    throw new RobotArmError(
      'SCREEN_PAGE_REQUIRED',
      'The page does not belong to the selected screen',
      409,
    );
  if (
    !page.config ||
    page.config.pixelWidth !== screen.pixelWidth ||
    page.config.pixelHeight !== screen.pixelHeight
  )
    throw new RobotArmError(
      'SCREEN_SIZE_MISMATCH',
      'Page mapping pixel size does not match the selected Screen Profile',
      409,
    );
  if (!page.mapping)
    throw new RobotArmError(
      'SCREEN_PAGE_REQUIRED',
      'Build the page mapping before automatic exploration',
      409,
    );
  const mappingVersion = page.mapping.version;
  if (session.auto) session.auto.screenSessionId = page.id;
  await save(host, session);

  const assertPage = async () => {
    host.check();
    const current = await host.screenCalib.session(page.id);
    assertSameScreenPage(current, page);
    return current;
  };

  const recordSample = async (
    point: TouchPoint,
    role: 'probe' | 'fit' | 'validation',
    method: 'stepped' | 'direct' | 'slide',
  ) => {
    if (session.auto) {
      session.auto.collectedSamples ??= [];
      session.auto.collectedSamples.push({
        robot: { ...point.contact },
        pressedZMm: point.pressedZ,
        heightIntervalMm: point.heightIntervalMm,
        screen: { ...point.screen },
        role,
        method,
        weight: point.weight,
        zSource: point.zSource,
      });
      await save(host, session);
    }
  };
  const observeOnce = async (
    purpose: ProbePurpose,
    settleMs = searchWaitMs,
    allowBriefContactGaps?: boolean,
  ) => {
    await assertPage();
    const sampleId = `auto-${randomUUID()}`;
    const started = performance.now();
    await host.screenCalib.setSample(
      page.id,
      sampleId,
      purpose,
      settleMs,
      allowBriefContactGaps,
    );
    for (;;) {
      host.check();
      const current = await assertPage();
      const snapshot = current.sampleSnapshot;
      if (
        current.sampleId === sampleId &&
        snapshot?.sampleId === sampleId &&
        snapshot.mappingVersion === mappingVersion
      ) {
        if (
          snapshot.pointerCount > 1 ||
          (snapshot.pointerCount === 1 && !snapshot.screen)
        )
          throw new RobotArmError(
            'TOUCH_AMBIGUOUS',
            'Expected zero or one mapped touch',
            409,
          );
        return { sampleId, screen: snapshot.screen };
      }
      if (
        performance.now() - started >=
        CALIBRATION_PHONE_POLICY.stepAcknowledgementMs
      )
        throw new RobotArmError(
          'PHONE_STEP_TIMEOUT',
          'Phone step acknowledgement timed out. Touch at this position is unknown.',
          409,
          {
            sampleId,
            purpose,
            elapsedMs: Math.round(performance.now() - started),
          },
        );
      await delay(ACK_POLL_MS);
    }
  };
  const observe = async (
    purpose: ProbePurpose,
    settleMs = searchWaitMs,
    allowBriefContactGaps?: boolean,
  ) => {
    const started = performance.now();
    try {
      try {
        return await observeOnce(purpose, settleMs, allowBriefContactGaps);
      } catch (error) {
        if (
          !(error instanceof RobotArmError) ||
          error.code !== 'PHONE_STEP_TIMEOUT'
        )
          throw error;
        host.check();
        return observeOnce(purpose, settleMs, allowBriefContactGaps);
      }
    } finally {
      timing?.('phone-confirmation', performance.now() - started);
    }
  };
  const touchAt = async (
    x: number,
    y: number,
    zHigh: number,
    label: string,
    descentLimitMm = TOUCH_DESCENT_MM,
    skipApproach = false,
    safetyFloorZ?: number,
    prediction?: { pressZ: number; surfaceZ: number },
    singleAttempt = false,
    localSearch?: {
      startZ: number;
      endZ?: number;
      phase: 'height' | 'grid';
      coarseStepMm?: number;
      targetId?: string;
    },
  ): Promise<SampledTouch> => {
    const retryAttempts = singleAttempt ? 0 : TOUCH_RETRY_ATTEMPTS;
    // Measure each fast probe after first contact with a fresh approach stroke.
    const useReferencePress = fast && safetyFloorZ !== undefined;
    const floor = Math.max(
      zHigh - descentLimitMm,
      safetyFloorZ ?? Number.NEGATIVE_INFINITY,
    );
    const commandFloor =
      safetyFloorZ === undefined ? floor : floor + FLOOR_COMMAND_MARGIN_MM;
    const checkDepth = (
      requestedTipZMm: number,
      probe: string,
      measuredTipZMm?: number,
    ) => {
      const z = measuredTipZMm ?? requestedTipZMm;
      const limit = measuredTipZMm === undefined ? commandFloor : floor;
      if (z < limit - 1e-6)
        throw new RobotArmError(
          'TOUCH_SAFETY_LIMIT',
          measuredTipZMm === undefined
            ? `Requested tip Z ${z.toFixed(6)} mm is below the command limit ${limit.toFixed(6)} mm (safety floor ${floor.toFixed(6)} mm)`
            : `Measured tip Z ${z.toFixed(6)} mm is below the safety floor ${floor.toFixed(6)} mm (requested ${requestedTipZMm.toFixed(6)} mm)`,
          409,
          {
            probe,
            stage: measuredTipZMm === undefined ? 'command' : 'readback',
            requestedTipZMm,
            measuredTipZMm,
            safetyFloorZMm: floor,
            commandFloorZMm: commandFloor,
            belowLimitMm: limit - z,
          },
        );
    };
    const probeAt = async (z: number, name: string, motion = moveOptions) => {
      checkDepth(z, name);
      await preflight({ x, y, z }, name, motion);
      timing?.('probe-move', 0);
      const measured = await moveTo({ x, y, z }, motion);
      checkDepth(z, name, measured.z);
      return measured;
    };
    const confirmRelease = async () => {
      if ((await observe('release')).screen)
        throw new RobotArmError(
          'TOUCH_NOT_RELEASED',
          'The touch did not release at the approach height',
          409,
        );
    };
    const releaseAtApproach = async () => {
      const released = await probeAt(zHigh, `${label} retry release`);
      await confirmRelease();
      return released;
    };
    const contactBetween = (
      clear: TouchPoint['contact'],
      touched: TouchPoint['contact'],
    ) => ({
      x: (clear.x + touched.x) / 2,
      y: (clear.y + touched.y) / 2,
      z: (clear.z + touched.z) / 2,
    });
    const assertInterval = (clearZ: number, touchedZ: number) => {
      if (clearZ <= touchedZ)
        throw new RobotArmError(
          'CALIBRATION_QUALITY',
          'Measured touch and no-touch heights do not define a contact interval',
          409,
          { label, clearZ, touchedZ },
        );
    };
    // The interval midpoint estimates the surface to within half its width.
    // Allow that uncertainty below the shallowest known touch to sustain a slide.
    const fastPressZ = (
      touchCommandZ: number,
      clearZ: number,
      touchZ: number,
    ) =>
      Math.max(
        commandFloor,
        touchCommandZ - Math.min(clearZ - touchZ, CONTACT_BRACKET_MM) / 2,
      );
    await assertPage();
    let approach = { x, y, z: zHigh };
    if (!skipApproach) {
      const travelStarted = performance.now();
      const current = contactPoint(await host.currentPose(), tool.offsetMm);
      const safeZ = Math.max(
        current.z + TRAVERSE_CLEARANCE_MM,
        zHigh,
        ctx.minimumTravelTipZMm ?? Number.NEGATIVE_INFINITY,
      );
      const lateral = Math.hypot(current.x - x, current.y - y) > 0.2;
      if (lateral) {
        const lifted =
          current.z < safeZ - 0.05
            ? await moveTo(
                { x: current.x, y: current.y, z: safeZ },
                travelOptions,
              )
            : current;
        const clearance = ctx.directTravel;
        const minimumTipZMm = Math.max(
          clearance?.minimumTipZMm ?? Number.NEGATIVE_INFINITY,
          ctx.minimumTravelTipZMm ?? Number.NEGATIVE_INFINITY,
        );
        // Keep the vertical release, then merge only the airborne legs.
        const direct =
          fast &&
          clearance?.teaching.corridorConfirmed &&
          insideTaughtTravelSpace(lifted, clearance.teaching, minimumTipZMm) &&
          insideTaughtTravelSpace(approach, clearance.teaching, minimumTipZMm);
        if (!direct) await moveTo({ x, y, z: safeZ }, travelOptions);
      }
      await preflight({ x, y, z: zHigh }, `${label} approach`);
      approach = await moveTo({ x, y, z: zHigh });
      timing?.('point-travel', performance.now() - travelStarted);
    } else if (fast) {
      approach = contactPoint(await host.currentPose(), tool.offsetMm);
    }
    if (prediction) {
      checkDepth(prediction.pressZ, label);
      await confirmRelease();
      let lastClear = approach;
      const localSteps = singleAttempt ? 0 : FAST_LOCAL_STEPS;
      for (let step = 0; step <= localSteps; step++) {
        const z = prediction.pressZ - step * FAST_LOCAL_STEP_MM;
        if (step > 0) {
          if (z < commandFloor - 1e-6) break;
          countRecoveryStep();
          await releaseAtApproach();
        }
        const measured = await probeAt(z, `${label} search`);
        const touched = await observe('press', dwellMs);
        if (!touched.screen) {
          lastClear = measured;
          continue;
        }
        if (step === 0)
          return {
            contact: { x: measured.x, y: measured.y, z: prediction.surfaceZ },
            pressCommandZ: z,
            pressedZ: measured.z,
            screen: touched.screen,
            weight: 0.5,
            zSource: 'predicted',
          };
        assertInterval(lastClear.z, measured.z);
        const contact = contactBetween(lastClear, measured);
        const pressZ = fastPressZ(z, lastClear.z, measured.z);
        await releaseAtApproach();
        const pressed = await probeAt(pressZ, `${label} adaptive press`);
        const confirmed = await observe('press', dwellMs);
        if (!confirmed.screen)
          throw new RobotArmError(
            'TOUCH_CONTACT_LOST',
            'Adaptive light press did not confirm touch',
            409,
          );
        return {
          contact,
          pressCommandZ: pressZ,
          pressedZ: pressed.z,
          screen: confirmed.screen,
          recovered: true,
          heightIntervalMm: [measured.z, lastClear.z],
          weight: 0.7,
          zSource: 'measured',
        };
      }
      throw new RobotArmError(
        'TOUCH_NOT_FOUND',
        'No page touch within the fast local height-search budget; check the screen placement before retrying',
        409,
      );
    }
    // A grid endpoint can still need a full local search after recovering an audit.
    const gridRecovery = localSearch?.phase === 'grid';
    const recoveryBudget = gridRecovery
      ? gridBudget(localSearch?.targetId)
      : runRecoveryBudget;
    const searchScope = gridRecovery ? 'grid-point' : 'run';
    const pressRetryAttempts = localSearch
      ? TOUCH_RETRY_ATTEMPTS
      : retryAttempts;
    const stepMm = localSearch
      ? (localSearch.coarseStepMm ?? FAST_LOCAL_STEP_MM)
      : searchStepMm;
    const searchFloorZ = Math.max(
      commandFloor,
      localSearch?.endZ ?? commandFloor,
    );
    const startZ = localSearch
      ? Math.min(zHigh - stepMm, Math.max(searchFloorZ, localSearch.startZ))
      : zHigh - stepMm;
    const heights: number[] = [];
    for (let z = startZ; z > searchFloorZ + 1e-6; z -= stepMm) heights.push(z);
    if (searchFloorZ < zHigh - 1e-6) heights.push(searchFloorZ);
    let lastProbeZMm: number | undefined;
    for (let attempt = 0; attempt <= retryAttempts; attempt++) {
      if (attempt > 0) approach = await moveTo({ x, y, z: zHigh });
      // A held pointer must release before another descent, even on retry.
      await confirmRelease();
      let lastClear = approach;
      const reportProbe = (
        kind: 'search' | 'release' | 'refine' | 'press',
        z: number,
        snapshot: Awaited<ReturnType<typeof observe>>,
      ) =>
        setPhase(host, session, {
          phase: 'search',
          index: kind === 'search' ? zHigh - z : 0,
          total: descentLimitMm,
          sampleId: snapshot.sampleId,
          probeZMm: z,
          touching: Boolean(snapshot.screen),
          message: `${label}${kind === 'search' ? '' : ` · ${kind}`}${attempt ? ' · retry' : ''}`,
        });
      for (const [index, z] of heights.entries()) {
        if (index > 0) {
          if (localSearch) {
            // Count distance in fine steps so the larger stride cannot extend the recovery budget.
            const steps = Math.ceil(
              (heights[index - 1] - z - 1e-6) / FAST_LOCAL_STEP_MM,
            );
            countRecoveryStep(
              recoveryBudget,
              {
                label,
                lastProbeZMm,
                commandFloorZMm: commandFloor,
                searchScope,
              },
              steps,
            );
          }
          if (useReferencePress) await releaseAtApproach();
        }
        const measured = await probeAt(z, `${label} search`);
        const purpose =
          index === heights.length - 1 && searchFloorZ === commandFloor
            ? 'search-limit'
            : fast
              ? 'coarse-search'
              : 'search';
        const touched = await observe(purpose, searchWaitMs);
        reportProbe('search', measured.z, touched);
        lastProbeZMm = measured.z;
        if (!touched.screen) {
          lastClear = measured;
          continue;
        }
        const weight = attempt
          ? 0.5
          : safetyFloorZ !== undefined && z <= safetyFloorZ + 1e-6
            ? 0.7
            : 1;
        if (
          fast &&
          options.collection === 'slide' &&
          skipApproach &&
          safetyFloorZ === undefined
        ) {
          // Reproduce the first touch with the full approach stroke.
          const pressFromReference = async (pressZ: number) => {
            const released = await releaseAtApproach();
            if (pressZ === zHigh) return { measured: released, screen: null };
            const pressed = await probeAt(pressZ, `${label} reference press`);
            const snapshot = await observe('press', dwellMs);
            reportProbe('press', pressed.z, snapshot);
            return { measured: pressed, screen: snapshot.screen };
          };

          let touchZ = z;
          let lastTouch = measured;
          let previousTouchZ: number | undefined;
          for (;;) {
            const nextZ = Math.min(zHigh, touchZ + FIRST_SLIDE_TOUCH_STEP_MM);
            const trial = await pressFromReference(nextZ);
            assertInterval(trial.measured.z, lastTouch.z);
            if (trial.screen) {
              previousTouchZ = touchZ;
              touchZ = nextZ;
              lastTouch = trial.measured;
              continue;
            }
            const lastTouchRecheck = await pressFromReference(touchZ);
            let confirmed = lastTouchRecheck;
            let clear = trial.measured;
            if (!lastTouchRecheck.screen && previousTouchZ !== undefined) {
              clear = lastTouchRecheck.measured;
              touchZ = previousTouchZ;
              confirmed = await pressFromReference(touchZ);
            }
            if (!confirmed.screen)
              throw new RobotArmError(
                'TOUCH_CONTACT_LOST',
                'The initial touch did not repeat from the calibration reference',
                409,
                {
                  probe: label,
                  firstTouchZMm: measured.z,
                  lastTouchZMm: lastTouch.z,
                  noTouchZMm: trial.measured.z,
                  lastTouchRecheckZMm: lastTouchRecheck.measured.z,
                  requestedTipZMm: touchZ,
                  measuredTipZMm: confirmed.measured.z,
                  commandFloorZMm: commandFloor,
                  safetyFloorZMm: floor,
                },
              );
            assertInterval(clear.z, confirmed.measured.z);
            return {
              contact: contactBetween(clear, confirmed.measured),
              pressCommandZ: touchZ,
              pressedZ: confirmed.measured.z,
              heightIntervalMm: [confirmed.measured.z, clear.z],
              screen: confirmed.screen,
              weight,
              zSource: 'measured',
            };
          }
        }
        // A tool can keep reporting touch well above its downward activation
        // height. Reset that held pointer before testing a shallower depth.
        const release = async (touchZ: number) => {
          if (useReferencePress) {
            await releaseAtApproach();
            return;
          }
          for (
            let upZ = touchZ + RELEASE_LIFT_MM;
            upZ <= touchZ + RELEASE_MAX_MM + 1e-6;
            upZ += RELEASE_RETRY_STEP_MM
          ) {
            await preflight({ x, y, z: upZ }, `${label} release`);
            await moveTo({ x, y, z: upZ });
            const snapshot = await observe('release');
            reportProbe('release', upZ, snapshot);
            if (!snapshot.screen) return;
          }
          throw new RobotArmError(
            'TOUCH_RELEASE_NOT_FOUND',
            'No confirmed release within the height probe; stopped instead of reusing a deep press',
            409,
          );
        };
        let touchingPoint = measured;
        let touchingCommandZ = z;
        let upperPoint = lastClear;
        if (fast) assertInterval(upperPoint.z, touchingPoint.z);
        let pointerHeld = true;
        let heldZ = measured.z;
        let unchangedSteps = 0;
        // All refinement targets stay inside the original coarse bracket. A
        // touching midpoint must release before the next trial; otherwise an
        // upward midpoint would measure hysteresis instead of activation.
        while (upperPoint.z - touchingPoint.z > CONTACT_BRACKET_MM + 1e-6) {
          if (useReferencePress || pointerHeld) await release(heldZ);
          const midZ = Math.max(
            commandFloor,
            (upperPoint.z + touchingPoint.z) / 2,
          );
          const midpoint = await probeAt(midZ, `${label} refine`);
          let snapshot: Awaited<ReturnType<typeof observe>> | undefined;
          try {
            snapshot = await observe('refine');
          } catch (error) {
            if (!fast || !isIntermittentContact(error)) throw error;
          }
          if (snapshot) reportProbe('refine', midpoint.z, snapshot);
          const stableTouch = Boolean(snapshot?.screen);
          // An intermittent midpoint bounds stable activation from above.
          // Confirm release before probing deeper toward the known touch.
          pointerHeld = stableTouch || !snapshot;
          heldZ = midpoint.z;
          if (fast) {
            if (stableTouch) assertInterval(upperPoint.z, midpoint.z);
            else assertInterval(midpoint.z, touchingPoint.z);
            if (
              midpoint.z <= touchingPoint.z + 1e-6 ||
              midpoint.z >= upperPoint.z - 1e-6
            ) {
              if (++unchangedSteps >= 2) {
                if (pointerHeld) await release(heldZ);
                throw new RobotArmError(
                  'CALIBRATION_QUALITY',
                  'Measured probe steps could not narrow the contact interval to 0.25 mm',
                  409,
                  {
                    label,
                    heightIntervalMm: [touchingPoint.z, upperPoint.z],
                  },
                );
              }
              continue;
            }
          }
          unchangedSteps = 0;
          if (snapshot?.screen) {
            touchingPoint = midpoint;
            touchingCommandZ = midZ;
          } else upperPoint = midpoint;
        }
        // Even a short bracket needs one confirmed release; a coarse hit is
        // never accepted on the strength of a pointer that stayed held.
        if (useReferencePress || pointerHeld) await release(heldZ);
        const contact = contactBetween(upperPoint, touchingPoint);
        const nominalPressZ = fast
          ? fastPressZ(touchingCommandZ, upperPoint.z, touchingPoint.z)
          : Math.max(commandFloor, contact.z - STANDARD_PRESS_MM);
        const retryAtCoarseTouch = fast && safetyFloorZ === undefined;
        let pressedZ = nominalPressZ;
        let pressed: Awaited<ReturnType<typeof observe>> | undefined;
        let measuredPressedZ = pressedZ;
        let nominalPress: SampledTouch['nominalPress'];
        let pressRetried = false;
        for (
          let pressAttempt = 0;
          pressAttempt <= pressRetryAttempts;
          pressAttempt++
        ) {
          if (pressAttempt) {
            await release(measuredPressedZ);
            pressRetried = true;
            if (retryAtCoarseTouch) {
              // Repeat the observed coarse contact depth only after release.
              nominalPress = {
                commandZ: nominalPressZ,
                measuredZ: measuredPressedZ,
              };
              pressedZ = Math.max(commandFloor, measured.z);
            } else if (fast && !localSearch)
              pressedZ = Math.max(
                commandFloor,
                Math.min(pressedZ, z),
                pressedZ - FAST_LOCAL_STEP_MM,
              );
          }
          const press = await probeAt(pressedZ, `${label} press`, pressOptions);
          measuredPressedZ = press.z;
          try {
            pressed = await observe('press', dwellMs);
          } catch (error) {
            if (
              !localSearch ||
              !isIntermittentContact(error) ||
              pressAttempt === pressRetryAttempts
            )
              throw error;
            continue;
          }
          reportProbe('press', measuredPressedZ, pressed);
          if (pressed.screen) break;
        }
        if (!pressed?.screen)
          throw new RobotArmError(
            'TOUCH_CONTACT_LOST',
            `The refined press at Z ${pressedZ.toFixed(2)} mm did not produce a confirmed touch within the available press depth`,
            409,
            {
              probe: label,
              requestedTipZMm: pressedZ,
              measuredTipZMm: measuredPressedZ,
              commandFloorZMm: commandFloor,
              safetyFloorZMm: floor,
            },
          );
        return {
          contact,
          ...(localSearch && { recovered: true }),
          pressCommandZ: pressedZ,
          pressedZ: measuredPressedZ,
          ...(nominalPress && { nominalPress }),
          heightIntervalMm: fast ? [touchingPoint.z, upperPoint.z] : undefined,
          screen: pressed.screen,
          weight: pressRetried ? 0.5 : weight,
          zSource: 'measured',
        };
      }
    }
    const atSafetyFloor =
      searchFloorZ === commandFloor &&
      (localSearch || floor === safetyFloorZ) &&
      lastProbeZMm !== undefined;
    throw new RobotArmError(
      atSafetyFloor ? 'TOUCH_SAFETY_LIMIT' : 'TOUCH_NOT_FOUND',
      atSafetyFloor
        ? `No page touch before the safety floor ${floor.toFixed(1)} mm`
        : `No screen touch at (${x.toFixed(1)}, ${y.toFixed(1)}) mm`,
      409,
      {
        confirmedNoTouch: true,
        ...((fast || atSafetyFloor) && { lastProbeZMm }),
        ...(localSearch && {
          label,
          searchScope,
          ...recoveryBudget,
        }),
        ...(atSafetyFloor && {
          safetyFloorZMm: floor,
          commandFloorZMm: commandFloor,
        }),
      },
    );
  };

  setPhase(host, session, {
    phase: 'preflight',
    index: 0,
    total: 1,
    message: 'Finding the screen',
  });
  // Require the current phone protocol before submitting the first motion.
  await observe('preflight', 0);
  const startContact = contactPoint(start, tool.offsetMm);
  if (checkpoint?.releaseBeforeResume) {
    const stopped = await host.currentPose();
    const current = contactPoint(stopped, tool.offsetMm);
    const lift = {
      ...current,
      z: Math.max(
        current.z + RELEASE_LIFT_MM,
        startContact.z,
        ctx.minimumTravelTipZMm ?? Number.NEGATIVE_INFINITY,
      ),
    };
    await preflight(lift, 'Resume release', travelOptions, stopped.orientation);
    await moveTo(lift, travelOptions, stopped.orientation);
    if ((await observe('release')).screen)
      throw new RobotArmError(
        'TOUCH_NOT_RELEASED',
        'The stylus did not release before resuming fast calibration.',
        409,
      );
    checkpoint.releaseBeforeResume = undefined;
  }
  const initialStarted = performance.now();
  const retainedDirection = checkpoint?.direction ?? [];
  const retryStationaryProbe = async (
    targetId: string,
    probe: (retry: boolean) => Promise<SampledTouch>,
  ) => {
    try {
      return await probe(false);
    } catch (error) {
      if (
        !checkpoint ||
        !isIntermittentContact(error) ||
        checkpoint.retriedTargets.has(targetId)
      )
        throw error;
      host.check();
      checkpoint.retriedTargets.add(targetId);
      return probe(true);
    }
  };
  const firstWasRetained = retainedDirection.length > 0;
  let first: SampledTouch | undefined = retainedDirection[0];
  if (!first) {
    if (checkpoint)
      checkpoint.next = { phase: 'reference', targetId: 'first-touch' };
    try {
      first = await retryStationaryProbe('first-touch', (retry) =>
        touchAt(
          startContact.x,
          startContact.y,
          startContact.z,
          'Initial touch',
          INITIAL_DESCENT_MM,
          !retry,
        ),
      );
    } catch (error) {
      if (!(error instanceof RobotArmError) || error.code !== 'TOUCH_NOT_FOUND')
        throw error;
      for (let row = -2; row <= 2 && !first; row++)
        for (let column = -2; column <= 2 && !first; column++) {
          if (row === 0 && column === 0) continue;
          try {
            first = await touchAt(
              startContact.x + column * SEARCH_PITCH_MM,
              startContact.y + row * SEARCH_PITCH_MM,
              startContact.z,
              'Search touch',
              SEARCH_DESCENT_MM,
              false,
            );
          } catch (searchError) {
            if (
              !(searchError instanceof RobotArmError) ||
              searchError.code !== 'TOUCH_NOT_FOUND'
            )
              throw searchError;
          }
        }
    }
    timing?.('initial-search', performance.now() - initialStarted);
    if (!first)
      throw new RobotArmError(
        'TOUCH_NOT_FOUND',
        'No screen touch was found within the search area; place the stylus closer to the centre and retry',
        409,
      );
  }
  const heightAnchors = [first];
  // Use only measured activation heights. Successful predicted presses and
  // held-out validation points must not train the height predictor.
  const predictHeights = (x: number, y: number) => {
    const base = heightAnchors[0];
    const basePressZ = base.nominalPress?.commandZ ?? base.pressCommandZ;
    let total = 0;
    let pressDelta = 0;
    let surfaceDelta = 0;
    for (const anchor of heightAnchors) {
      const weight =
        1 / (100 + (x - anchor.contact.x) ** 2 + (y - anchor.contact.y) ** 2);
      total += weight;
      const pressZ = anchor.nominalPress?.commandZ ?? anchor.pressCommandZ;
      pressDelta += weight * (pressZ - basePressZ);
      surfaceDelta += weight * (anchor.contact.z - base.contact.z);
    }
    return {
      pressZ: basePressZ + pressDelta / total,
      surfaceZ: base.contact.z + surfaceDelta / total,
    };
  };
  // A deeper first-touch retry must not lower the floor for later moves.
  const firstReferenceZ = first.nominalPress?.measuredZ ?? first.pressedZ;
  const safetyFloorZ =
    Math.max(first.pressedZ, firstReferenceZ) - TOUCH_SAFETY_MARGIN_MM;

  setPhase(host, session, {
    phase: 'probe',
    operation: 'travel',
    index: 1,
    total: 3,
    message: 'Measuring touch direction',
  });
  const probeZ = first.contact.z + APPROACH_LIFT_MM;
  const probes: TouchPoint[] = [first];
  if (!firstWasRetained) {
    if (checkpoint) retainedDirection.push(first);
    await recordSample(first, 'probe', 'stepped');
  }
  for (const [index, [dx, dy, label]] of (
    [
      [PROBE_MM, 0, 'Probe +X'],
      [0, PROBE_MM, 'Probe +Y'],
    ] as const
  ).entries()) {
    const retained = retainedDirection[index + 1];
    if (retained) {
      probes.push(retained);
      if (retained.recovered) heightAnchors.push(retained);
      continue;
    }
    if (checkpoint) checkpoint.next = { phase: 'direction', targetId: label };
    const probe = await retryStationaryProbe(label, () =>
      touchAt(
        first.contact.x + dx,
        first.contact.y + dy,
        probeZ,
        label,
        TOUCH_DESCENT_MM,
        false,
        safetyFloorZ,
        fast
          ? predictHeights(first.contact.x + dx, first.contact.y + dy)
          : undefined,
      ),
    );
    probes.push(probe);
    if (checkpoint) retainedDirection.push(probe);
    if (probe.recovered) heightAnchors.push(probe);
    await recordSample(
      probe,
      'probe',
      fast && !probe.recovered ? 'direct' : 'stepped',
    );
  }
  let initialFrame: ReturnType<typeof screenFrame>;
  try {
    initialFrame = screenFrame(
      fitAffine(
        probes.map((probe) => ({ x: probe.contact.x, y: probe.contact.y })),
        probes.map((probe) => probe.screen),
      ),
      screen,
    );
  } catch (error) {
    if (
      checkpoint &&
      error instanceof RobotArmError &&
      error.code === 'CALIBRATION_QUALITY'
    )
      throw new RobotArmError(error.code, error.message, error.status, {
        recoveryPhase: 'reference',
      });
    throw error;
  }
  const targets = await host.screenCalib.targets(page.id);
  if (targets.mappingVersion !== mappingVersion)
    throw new RobotArmError(
      'SCREEN_PAGE_REQUIRED',
      'Page mapping changed before sampling',
      409,
    );

  const gridTargets = fast
    ? fastExplorationTargets(targets.targets)
    : targets.targets;
  const slide = fast && options.collection === 'slide';
  let useSlide = false;
  const preferredDirection = unit(
    rotate(start.orientation, tool.contactDirection),
  );
  // The first measured samples define the plane the remaining presses use.
  // Before that (or if the fit is degenerate) the IDW anchors stay in charge.
  let measuredPlane: ReturnType<typeof fitSamplePlane> | undefined;
  let pressOffsetMm =
    first.contact.z - (first.nominalPress?.commandZ ?? first.pressCommandZ);
  const predictPoint = (x: number, y: number) => {
    if (!measuredPlane || Math.abs(measuredPlane.normal.z) < 1e-6)
      return predictHeights(x, y);
    const { normal, offset } = measuredPlane;
    const surfaceZ = (offset - normal.x * x - normal.y * y) / normal.z;
    return { surfaceZ, pressZ: surfaceZ - pressOffsetMm };
  };
  const grid: GridTouch[] = [];
  const refreshMeasuredPlane = () => {
    if (!fast) return;
    const planeGrid = slide
      ? grid.filter((point) => point.target.role === 'fit')
      : grid;
    const measured = [...probes, ...planeGrid].filter(
      (point) => point.zSource === 'measured',
    );
    if (measured.length < 3) return;
    try {
      const plane = fitSamplePlane(
        measured.map((point) => point.contact),
        preferredDirection,
      );
      // A plane this steep is a bad fit, not a tilted screen; the audit range
      // only supports a couple of millimetres over the whole panel.
      measuredPlane = Math.abs(plane.normal.z) > 0.9 ? plane : undefined;
    } catch {
      // A nearly collinear audit pair cannot define a plane; keep predicting
      // from the measured anchors instead of failing the run.
      measuredPlane = undefined;
    }
  };
  const slideCommandFloor = safetyFloorZ + FLOOR_COMMAND_MARGIN_MM;
  const moveAtSlideHeight = async (
    contact: TouchPoint['contact'],
    label: string,
  ) => {
    if (contact.z < slideCommandFloor)
      throw new RobotArmError(
        'TOUCH_SAFETY_LIMIT',
        `${label} exceeds the safety floor`,
        409,
      );
    await preflight(contact, label);
    const measured = await moveTo(contact);
    if (measured.z < safetyFloorZ - 1e-6)
      throw new RobotArmError(
        'TOUCH_SAFETY_LIMIT',
        `Measured ${label.toLowerCase()} exceeds the safety floor`,
        409,
      );
    return measured;
  };
  const slideTo = async (
    { x, y }: ScreenPoint2,
    { pressZ, surfaceZ }: ReturnType<typeof predictPoint>,
  ): Promise<SampledTouch> => {
    const afterRecovery = grid.at(-1)?.recovered === true;
    if (afterRecovery) timing?.('slide-after-recovery-attempt', 0);
    const measured = await moveAtSlideHeight(
      { x, y, z: pressZ },
      'Sliding grid endpoint',
    );
    // Change the sample ID only after stopping. The page snapshots the active
    // pointer under this new ID, so no moving coordinate is paired with an endpoint.
    const { screen: touched } = await observe('slide', dwellMs);
    if (!touched)
      throw new RobotArmError(
        'TOUCH_CONTACT_LOST',
        'The sliding endpoint did not sustain touch',
        409,
      );
    if (afterRecovery) timing?.('slide-after-recovery-success', 0);
    return {
      contact: { x: measured.x, y: measured.y, z: surfaceZ },
      pressCommandZ: pressZ,
      pressedZ: measured.z,
      screen: touched,
      weight: 0.5,
      zSource: 'predicted',
    };
  };
  const gridZ =
    Math.max(...probes.map((probe) => probe.contact.z)) + APPROACH_LIFT_MM;
  // Only measured contacts bound the audit envelope; predicted probes do not.
  const measuredContacts = probes.filter(
    (probe) => probe.zSource === 'measured',
  );
  const auditStart =
    Math.min(...measuredContacts.map((probe) => probe.contact.z)) +
    TILT_AUDIT_APPROACH_LIFT_MM;
  const inside = affinePoint(initialFrame.inverse, {
    x: (initialFrame.pixelWidth - 1) / 2,
    y: (initialFrame.pixelHeight - 1) / 2,
  });
  const inset = (point: ScreenPoint2, fraction: number) => ({
    x: point.x + (inside.x - point.x) * fraction,
    y: point.y + (inside.y - point.y) * fraction,
  });
  const auditPosition = (target: ScreenCalibTarget) =>
    inset(
      affinePoint(initialFrame.inverse, target.screen),
      FAST_SLIDE_AUDIT_INSET_FRACTION,
    );
  const auditPoints = fast
    ? auditTargets(
        gridTargets,
        slide ? { firstContact: first.contact, auditPosition } : undefined,
      )
    : [];
  const auditIds = new Set(auditPoints.map((target) => target.id));
  const orderedTargets =
    fast && !slide
      ? [
          ...auditPoints,
          ...gridTargets.filter((target) => !auditIds.has(target.id)),
        ]
      : gridTargets;
  const measureSlidingHeight = async (
    point: ScreenPoint2,
    seedZ: number,
    label: string,
  ): Promise<SampledTouch> => {
    const distance = Math.hypot(inside.x - point.x, inside.y - point.y);
    if (distance <= 0.4)
      throw new RobotArmError(
        'CALIBRATION_QUALITY',
        'The interior height sweep is too short to measure',
        409,
        { label },
      );
    const sweepStart = inset(
      point,
      Math.min(FAST_SLIDE_HEIGHT_SWEEP_MM / distance, 0.5),
    );
    const sweepAt = async (z: number) => {
      const current = contactPoint(await host.currentPose(), tool.offsetMm);
      const liftZ = Math.max(
        current.z + RELEASE_LIFT_MM,
        seedZ + APPROACH_LIFT_MM,
        ctx.minimumTravelTipZMm ?? Number.NEGATIVE_INFINITY,
      );
      const lift = { ...current, z: liftZ };
      const approach = { ...sweepStart, z: liftZ };
      await preflight(lift, `${label} lift`, travelOptions);
      await moveTo(lift, travelOptions);
      if ((await observe('release')).screen)
        throw new RobotArmError(
          'TOUCH_NOT_RELEASED',
          'The touch did not release before the height sweep',
          409,
        );
      await preflight(approach, `${label} travel`, travelOptions);
      await moveTo(approach, travelOptions);
      await moveAtSlideHeight({ ...sweepStart, z }, `${label} start`);
      const measured = await moveAtSlideHeight({ ...point, z }, label);
      return {
        commandZ: z,
        measured,
        screen: (await observe('slide', dwellMs)).screen,
      };
    };
    const ceilingZ = seedZ + TOUCH_SAFETY_MARGIN_MM;
    let candidateZ = Math.max(slideCommandFloor, seedZ);
    let descentStepMm = CONTACT_BRACKET_MM;
    type Sweep = Awaited<ReturnType<typeof sweepAt>>;
    let clear: Sweep | undefined;
    let touching: (Sweep & { screen: ScreenPoint2 }) | undefined;
    let previousTouchZ: number | undefined;
    for (;;) {
      let sample = await sweepAt(candidateZ);
      // Confirm a miss at the floor with a fresh pass at the same height.
      if (!sample.screen && !touching && candidateZ === slideCommandFloor)
        sample = await sweepAt(candidateZ);
      if (sample.screen) {
        previousTouchZ = touching?.commandZ;
        touching = { ...sample, screen: sample.screen };
      } else clear = sample;
      if (touching && clear) {
        const widthMm = clear.commandZ - touching.commandZ;
        // A lighter sweep without contact bounds the last stable height.
        // Only refine a wider bracket found while descending to first contact.
        if (!sample.screen || widthMm <= CONTACT_BRACKET_MM + 1e-6) break;
        candidateZ = touching.commandZ + widthMm / 2;
        continue;
      }
      const nextZ = sample.screen
        ? Math.min(ceilingZ, candidateZ + CONTACT_BRACKET_MM)
        : Math.max(slideCommandFloor, candidateZ - descentStepMm);
      if (Math.abs(nextZ - candidateZ) < 1e-6)
        throw new RobotArmError(
          sample.screen ? 'CALIBRATION_QUALITY' : 'TOUCH_CONTACT_LOST',
          sample.screen
            ? 'The height sweep could not find a released upper height'
            : 'No touch within the safe height sweep range',
          409,
          { label, seedZ, candidateZ },
        );
      candidateZ = nextZ;
      descentStepMm = FAST_SLIDE_HEIGHT_COARSE_STEP_MM;
    }
    // Restore the last successful height and verify fresh contact there.
    if (candidateZ !== touching.commandZ) {
      const confirm = async (z: number) => {
        try {
          return await sweepAt(z);
        } catch (error) {
          if (!isIntermittentContact(error)) throw error;
        }
      };
      const stableZ = touching.commandZ;
      let confirmed = await confirm(stableZ);
      if (!confirmed?.screen) {
        const firstMiss = confirmed;
        confirmed = await confirm(stableZ);
        if (!confirmed?.screen && previousTouchZ !== undefined) {
          // Prefer fresh no-touch evidence at the shallower height. An
          // intermittent reply alone cannot replace the measured upper bound.
          clear = confirmed ?? firstMiss ?? clear;
          confirmed = await confirm(previousTouchZ);
        }
      }
      if (!confirmed?.screen)
        throw new RobotArmError(
          'TOUCH_CONTACT_LOST',
          'The final height sweep did not sustain touch',
          409,
          { label, lastStableZMm: stableZ, previousTouchZMm: previousTouchZ },
        );
      touching = { ...confirmed, screen: confirmed.screen };
    }
    const { measured, commandZ, screen } = touching;
    const clearZ = clear.measured.z;
    if (clearZ <= measured.z)
      throw new RobotArmError(
        'CALIBRATION_QUALITY',
        'Measured height sweeps do not define a contact interval',
        409,
        { label, clearZ, touchedZ: measured.z },
      );
    return {
      contact: { ...measured, z: (measured.z + clearZ) / 2 },
      pressedZ: measured.z,
      pressCommandZ: commandZ,
      heightIntervalMm: [measured.z, clearZ],
      screen,
      zSource: 'measured',
    };
  };
  const probeGrid = (
    point: ScreenPoint2,
    label: string,
    audit: boolean,
    singleAttempt: boolean,
  ) =>
    touchAt(
      point.x,
      point.y,
      audit ? auditStart : gridZ,
      label,
      TOUCH_DESCENT_MM,
      false,
      safetyFloorZ,
      fast && !slide && !audit ? predictPoint(point.x, point.y) : undefined,
      singleAttempt,
    );
  const probeVerticalGrid = async (point: ScreenPoint2, label: string) => {
    const { surfaceZ } = predictPoint(point.x, point.y);
    const startZ = Math.min(
      gridZ - FAST_LOCAL_STEP_MM,
      surfaceZ + FAST_LOCAL_STEP_MM,
    );
    const endZ = surfaceZ - FAST_LOCAL_STEP_MM;
    if (endZ > slideCommandFloor && startZ > endZ) {
      const started = performance.now();
      try {
        return await touchAt(
          point.x,
          point.y,
          gridZ,
          label,
          TOUCH_DESCENT_MM,
          false,
          safetyFloorZ,
          undefined,
          true,
          { startZ, endZ, phase: 'grid' },
        );
      } catch (error) {
        if (
          !(error instanceof RobotArmError) ||
          error.code !== 'TOUCH_NOT_FOUND' ||
          error.details?.confirmedNoTouch !== true
        )
          throw error;
      } finally {
        timing?.('vertical-local-search', performance.now() - started);
      }
    }
    const started = performance.now();
    try {
      return await probeGrid(point, label, false, true);
    } finally {
      timing?.('vertical-full-search', performance.now() - started);
    }
  };
  const probeSlidePoint = async (
    point: ScreenPoint2,
    label: string,
    pressZ: number,
    recovery: {
      phase: SlideRecovery['phase'];
      targetId: string;
      cause?: RobotArmError;
      lastAuditWithoutSlidingContact?: boolean;
      predictedSurfaceZ?: number;
    },
  ) => {
    const { phase, targetId, cause, lastAuditWithoutSlidingContact } = recovery;
    // A missed sliding endpoint already established a clear height at this
    // point. Use it as the first vertical trial to preserve the search budget.
    const startAtMissedSlide =
      phase === 'grid' && cause?.code === 'TOUCH_CONTACT_LOST';
    const startZ =
      Math.max(pressZ, slideCommandFloor) +
      (startAtMissedSlide ? 0 : FAST_LOCAL_STEP_MM);
    const movesBefore = moveCount;
    const started = performance.now();
    const recovered = await touchAt(
      point.x,
      point.y,
      gridZ,
      label,
      TOUCH_DESCENT_MM,
      false,
      safetyFloorZ,
      undefined,
      true,
      {
        startZ,
        phase,
        coarseStepMm:
          phase === 'grid' ? FAST_GRID_RECOVERY_COARSE_STEP_MM : undefined,
        targetId,
      },
    );
    timing?.('slide-recovery', performance.now() - started);
    if (cause)
      options.onSlideRecovery?.({
        targetId,
        phase,
        cause: cause.code,
        predictedPressZMm: pressZ,
        predictedSurfaceZMm: recovery.predictedSurfaceZ,
        measuredContactZMm: recovered.contact.z,
        measuredHeightIntervalMm: recovered.heightIntervalMm,
        measuredPressZMm: recovered.pressedZ,
        moves: moveCount - movesBefore,
        switchedToVertical: lastAuditWithoutSlidingContact === true,
      });
    return recovered;
  };
  const withContactRetry = async (
    point: ScreenPoint2,
    target: ScreenCalibTarget,
    index: number,
    audit: boolean,
    sample: (
      point: ScreenPoint2,
      cause?: RobotArmError,
    ) => Promise<SampledTouch>,
    retryAtTarget = false,
  ) => {
    try {
      return await sample(point);
    } catch (error) {
      if (!fast || !isGridContactMiss(error)) throw error;
      if (checkpoint && error.code === 'TOUCH_SAFETY_LIMIT') throw error;
      const retryKey = `${audit ? 'height' : 'grid'}:${target.id}`;
      if (checkpoint?.retriedTargets.has(retryKey)) throw error;
      const distance = Math.hypot(inside.x - point.x, inside.y - point.y);
      if (!retryAtTarget && distance <= FAST_GRID_RETRY_INSET_MM) throw error;
      checkpoint?.retriedTargets.add(retryKey);
      try {
        return await sample(
          retryAtTarget
            ? point
            : inset(point, FAST_GRID_RETRY_INSET_MM / distance),
          error,
        );
      } catch (retryError) {
        if (!isGridContactMiss(retryError)) throw retryError;
        if (retryAtTarget && retryError.code === 'TOUCH_SAFETY_LIMIT')
          throw retryError;
        throw new RobotArmError(
          'TOUCH_CONTACT_LOST',
          `Fast calibration point ${index + 1} did not sustain touch within the safe depth`,
          409,
          {
            targetId: target.id,
            audit,
            ...(retryAtTarget
              ? { recovery: 'vertical-probe' }
              : { insetMm: FAST_GRID_RETRY_INSET_MM }),
            cause: error.code,
            retryCause: retryError.code,
            retryDetails: retryError.details,
            safetyFloorZMm: safetyFloorZ,
          },
        );
      }
    }
  };
  const auditSamples: SampledTouch[] = [];
  const checkAudit = () => {
    const deviationsMm = auditSamples.map(({ contact }) =>
      Math.abs(contact.z - predictHeights(contact.x, contact.y).surfaceZ),
    );
    if (useSlide) {
      if (!measuredPlane)
        throw new RobotArmError(
          'CALIBRATION_QUALITY',
          'The measured screen heights could not define a plane for sliding',
          409,
          { recoveryPhase: 'height' },
        );
      for (const target of gridTargets) {
        const { x, y } = affinePoint(initialFrame.inverse, target.screen);
        deviationsMm.push(
          Math.abs(predictPoint(x, y).surfaceZ - predictHeights(x, y).surfaceZ),
        );
      }
    }
    const maxDeviationMm = Math.max(...deviationsMm);
    if (!(maxDeviationMm <= TILT_AUDIT_MAX_DEVIATION_MM))
      throw new RobotArmError(
        'SCREEN_TILT_UNSUPPORTED',
        `Fast calibration measured ${maxDeviationMm.toFixed(2)} mm of screen height error at the audit points (limit ${TILT_AUDIT_MAX_DEVIATION_MM} mm). Check that the screen is level and secured.`,
        422,
        {
          deviationsMm,
          auditStartMm: auditStart,
          safetyFloorZMm: safetyFloorZ,
        },
      );
  };
  if (slide) {
    // Direction probes seed the search. Only sliding presses set the sliding offset.
    const slidingAudits: SampledTouch[] = [];
    const seedZ = probes
      .map((probe, index) => (index === 0 ? firstReferenceZ : probe.pressedZ))
      .sort((a, b) => a - b)[1];
    for (const [index, target] of [...auditPoints].reverse().entries()) {
      const retained = checkpoint?.heights[index];
      if (retained) {
        if (!retained.recovered) slidingAudits.push(retained);
        auditSamples.push(retained);
        probes.push(retained);
        continue;
      }
      if (checkpoint)
        checkpoint.next = { phase: 'height', targetId: target.id };
      const progress = {
        phase: 'height',
        operation: 'travel',
        index: index + 1,
        total: auditPoints.length,
      } as const;
      setPhase(host, session, progress);
      const label = `Interior height audit ${index + 1}`;
      const touch = await withContactRetry(
        auditPosition(target),
        target,
        index,
        true,
        (point, cause) => {
          if (!cause) return measureSlidingHeight(point, seedZ, label);
          setPhase(host, session, { ...progress, operation: 'recover' });
          return probeSlidePoint(point, `${label} vertical recovery`, seedZ, {
            phase: 'height',
            targetId: target.id,
            cause,
            lastAuditWithoutSlidingContact:
              index === auditPoints.length - 1 && slidingAudits.length === 0,
          });
        },
        true,
      );
      if (!touch.recovered) slidingAudits.push(touch);
      auditSamples.push(touch);
      probes.push(touch);
      checkpoint?.heights.push(touch);
      await recordSample(touch, 'probe', touch.recovered ? 'stepped' : 'slide');
    }
    refreshMeasuredPlane();
    useSlide = slidingAudits.length > 0;
    if (checkpoint && !useSlide)
      throw new RobotArmError(
        'TOUCH_CONTACT_LOST',
        'Fast calibration could not establish stable sliding contact. Check the screen and stylus.',
        409,
      );
    if (useSlide) {
      pressOffsetMm =
        slidingAudits.reduce(
          (sum, touch) => sum + touch.contact.z - touch.pressedZ,
          0,
        ) / slidingAudits.length;
      checkAudit();
    }
  }
  for (const touch of checkpoint?.grid ?? []) {
    grid.push(touch);
    if (touch.recovered && touch.target.role === 'fit')
      heightAnchors.push(touch);
  }
  if (
    grid.some(
      (touch) => touch.target.role === 'fit' && touch.zSource === 'measured',
    )
  )
    refreshMeasuredPlane();
  const firstPendingGrid = grid.length;
  const needsFreshContact = checkpoint?.next?.phase === 'grid';
  const reestablishAfterAudit = probes.at(-1)?.recovered === true;
  setPhase(host, session, {
    phase: 'grid',
    gridTargets: orderedTargets,
    index: 0,
    total: orderedTargets.length,
    message: 'Sampling the screen',
  });
  for (let index = firstPendingGrid; index < orderedTargets.length; index++) {
    const target = orderedTargets[index];
    const audit = !slide && auditIds.has(target.id);
    const reacquire = needsFreshContact && index === firstPendingGrid;
    const sliding =
      useSlide && !reacquire && (index !== 0 || !reestablishAfterAudit);
    if (checkpoint) checkpoint.next = { phase: 'grid', targetId: target.id };
    const progress = {
      phase: 'grid',
      operation: sliding ? 'slide' : 'travel',
      index: index + 1,
      total: orderedTargets.length,
      message: `Sampling ${index + 1}/${orderedTargets.length}`,
    } as const;
    setPhase(host, session, progress);
    const robot = affinePoint(initialFrame.inverse, target.screen);
    const prediction = useSlide ? predictPoint(robot.x, robot.y) : undefined;
    const label = `Grid ${target.id}`;
    const recoverSlide = (pressZ: number, cause?: RobotArmError) => {
      setPhase(host, session, { ...progress, operation: 'recover' });
      return probeSlidePoint(robot, `${label} vertical recovery`, pressZ, {
        phase: 'grid',
        targetId: target.id,
        cause,
        predictedSurfaceZ: prediction?.surfaceZ,
      });
    };
    try {
      let touch: SampledTouch;
      if (prediction && (reacquire || prediction.pressZ < slideCommandFloor)) {
        touch = await recoverSlide(prediction.pressZ);
      } else if (prediction) {
        touch = await withContactRetry(
          robot,
          target,
          index,
          false,
          (point, cause) => {
            if (cause) return recoverSlide(prediction.pressZ, cause);
            if (sliding) return slideTo(point, prediction);
            // When the last audit needed recovery, establish contact at the first grid target.
            return touchAt(
              point.x,
              point.y,
              gridZ,
              label,
              TOUCH_DESCENT_MM,
              false,
              safetyFloorZ,
              prediction,
              true,
            );
          },
          true,
        );
      } else if (slide) {
        touch = await probeVerticalGrid(robot, label);
      } else {
        touch = await withContactRetry(
          robot,
          target,
          index,
          audit,
          (point, cause) =>
            probeGrid(
              point,
              `${label}${cause ? ' inset retry' : ''}`,
              audit,
              audit || Boolean(cause),
            ),
        );
      }
      // A successful fallback confirms contact at this target. The next target
      // can slide from here using its own predicted height.
      if (touch.recovered && target.role === 'fit') heightAnchors.push(touch);
      const sample = { ...touch, target };
      grid.push(sample);
      checkpoint?.grid.push(sample);
      if (audit) auditSamples.push(touch);
      // Measured points (audit corners, local recoveries) keep improving the
      // plane that later predicted presses are derived from.
      if (
        fast &&
        touch.zSource === 'measured' &&
        (!slide || target.role === 'fit')
      )
        refreshMeasuredPlane();
      await recordSample(
        touch,
        target.role,
        touch.zSource === 'measured' ? 'stepped' : sliding ? 'slide' : 'direct',
      );
      if (audit && auditSamples.length === auditPoints.length) checkAudit();
    } catch (error) {
      if (
        fast ||
        !(error instanceof RobotArmError) ||
        error.code !== 'TOUCH_NOT_FOUND'
      )
        throw error;
      // A page that does not cover the full display can reject an edge target.
      if (target.role === 'validation') continue;
      throw error;
    }
    await save(host, session);
  }
  if (grid.length < 5)
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'Fewer than five grid touches were collected',
      409,
    );
  const validationGrid = grid.filter(
    (point) => point.target.role === 'validation',
  );
  if (validationGrid.length < 2)
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'Fewer than two validation touches were collected',
      409,
    );

  return { probes, grid, start, screen };
}
