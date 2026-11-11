// Ported from avatr-robot/midscene-private dev, commit
// 710f60809eac3dbe824f91a5cf8b3b0e72386282, calibration/auto-exploration.ts.
// Phone transport, persistence and motion ownership
// are supplied by the Arm Kit bridge; boundary verification remains in its workflow.
import { randomUUID } from 'node:crypto';
import { CALIBRATION_PHONE_POLICY } from '../../assisted-contracts.js';
import { RobotArmError } from '../../contracts.js';
import { contactPoint, flangePose } from '../../domain.js';
import {
  scaleAcceleration,
  scaleSpeed,
} from '../../screen-interaction/motion-policy.js';
import {
  type ScreenPoint2,
  affinePoint,
  fitAffine,
  screenFrame,
} from './geometry.js';
import {
  type ApplicationContext,
  type AutoCalibrationProgress,
  type AutoExplorationHost,
  type AutoExplorationOptions,
  type CalibrationSession,
  type ProbePurpose,
  type ScreenCalibTarget,
  assertSameScreenPage,
} from './types.js';
// Coarse travel is fast; refine only the final no-touch/touch bracket.
const SEARCH_STEP_MM = 1;
const FAST_SEARCH_STEP_MM = 2;
const SEARCH_WAIT_MS = 100;
const FAST_SEARCH_WAIT_MS = 30;
// Fast runs have a fixed recovery budget, never a hidden full-grid slow pass.
const FAST_LOCAL_STEP_MM = 0.25;
// Allow 1.5 mm of local recovery; the shared floor still reserves press depth.
const FAST_LOCAL_STEPS = 6;
const FIRST_GRID_RETRY_INSET_MM = 3;
const FAST_RUN_RECOVERY_STEPS = 12;
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
const PRESS_MM = 0.5;
const DWELL_MS = 250;
const ACK_POLL_MS = 25;
const STANDARD_MOTION_FACTOR = 0.1;
const FAST_MOTION_FACTOR = 0.25;
const STANDARD_PRESS_FACTOR = 0.25;
const STEP_TIMEOUT_MS = 10000;
interface TouchPoint {
  recovered?: boolean;
  pressedZ: number;
  contact: { x: number; y: number; z: number };
  screen: ScreenPoint2;
  /** Reduced when the point needed a retry or hit the safety floor. */
  weight?: number;
}
interface GridTouch extends TouchPoint {
  target: ScreenCalibTarget;
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
) {
  const fast = options.mode === 'fast-horizontal';
  let recoverySteps = 0;
  if (fast && session.auto)
    session.auto.fastAdaptation = {
      searchSteps: 0,
      maxSearchSteps: FAST_RUN_RECOVERY_STEPS,
    };
  if (
    (fast && options.horizontalConfirmed !== true) ||
    (options.collection === 'slide' && !fast)
  )
    throw new RobotArmError(
      'INVALID_ARGUMENT',
      'Fast exploration requires confirmation that the screen is horizontal and secured',
      400,
    );
  if (session.auto) {
    session.auto.mode = fast ? 'fast-horizontal' : 'standard';
    session.auto.collection = options.collection ?? 'tap';
    session.auto.horizontalConfirmed = options.horizontalConfirmed === true;
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
  const pressOptions = fast
    ? moveOptions
    : motionAtFactor(STANDARD_PRESS_FACTOR);
  const poseAt = (contact: { x: number; y: number; z: number }) =>
    flangePose(contact, start.orientation, tool.offsetMm);
  const preflight = async (
    contact: { x: number; y: number; z: number },
    name: string,
    motion = moveOptions,
  ) => host.preflight([{ name, pose: poseAt(contact), options: motion }], ctx);
  const moveTo = async (
    contact: { x: number; y: number; z: number },
    motion = moveOptions,
  ) => {
    const pose = poseAt(contact);
    await assertPage();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
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
        screen: { ...point.screen },
        role,
        method,
        weight: point.weight,
      });
      await save(host, session);
    }
  };
  const observe = async (purpose: ProbePurpose, settleMs = searchWaitMs) => {
    await assertPage();
    const sampleId = `auto-${randomUUID()}`;
    const started = performance.now();
    await host.screenCalib.setSample(page.id, sampleId, purpose, settleMs);
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
  const touchAt = async (
    x: number,
    y: number,
    zHigh: number,
    label: string,
    descentLimitMm = TOUCH_DESCENT_MM,
    skipApproach = false,
    safetyFloorZ?: number,
    directZ?: number,
  ): Promise<TouchPoint> => {
    const floor = Math.max(
      zHigh - descentLimitMm,
      safetyFloorZ ?? Number.NEGATIVE_INFINITY,
    );
    const checkDepth = (z: number) => {
      if (z < floor - 1e-6)
        throw new RobotArmError(
          'TOUCH_SAFETY_LIMIT',
          `Contact at Z ${z.toFixed(2)} mm exceeds the safety floor ${floor.toFixed(2)} mm`,
          409,
        );
    };
    if (directZ !== undefined) checkDepth(directZ);
    await assertPage();
    if (!skipApproach) {
      const current = contactPoint(await host.currentPose(), tool.offsetMm);
      const safeZ = Math.max(
        current.z + TRAVERSE_CLEARANCE_MM,
        zHigh,
        ctx.minimumTravelTipZMm ?? Number.NEGATIVE_INFINITY,
      );
      if (Math.hypot(current.x - x, current.y - y) > 0.2) {
        if (current.z < safeZ - 0.05)
          await moveTo({ x: current.x, y: current.y, z: safeZ });
        await moveTo({ x, y, z: safeZ });
      }
      // After a lost sliding endpoint, XY is already correct but the tip is
      // still down. Establish release before reacquiring this same point.
      if (
        directZ === undefined ||
        (Math.hypot(current.x - x, current.y - y) <= 0.2 && current.z < zHigh)
      ) {
        await preflight({ x, y, z: zHigh }, `${label} approach`);
        await moveTo({ x, y, z: zHigh });
      }
    }
    for (
      let attempt = 0;
      attempt <= (directZ === undefined ? TOUCH_RETRY_ATTEMPTS : 0);
      attempt++
    ) {
      if (attempt > 0) await moveTo({ x, y, z: zHigh });
      // A held pointer must release before another descent, even on retry.
      if ((await observe('release')).screen)
        throw new RobotArmError(
          'TOUCH_NOT_RELEASED',
          'The touch did not release at the approach height',
          409,
        );
      const heights: number[] = [];
      if (directZ !== undefined) {
        heights.push(directZ);
        for (let step = 1; step <= FAST_LOCAL_STEPS; step++) {
          const z = directZ - step * FAST_LOCAL_STEP_MM;
          // Leave room for the final light press; never expand the safety floor.
          if (z - PRESS_MM < floor - 1e-6) break;
          heights.push(z);
        }
      } else {
        for (let z = zHigh - searchStepMm; z > floor + 1e-6; z -= searchStepMm)
          heights.push(z);
        if (floor < zHigh - 1e-6) heights.push(floor);
      }
      let lastClearZ = zHigh;
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
      for (const z of heights) {
        if (directZ !== undefined && z < directZ) {
          if (recoverySteps >= FAST_RUN_RECOVERY_STEPS)
            throw new RobotArmError(
              'FAST_ADAPTATION_LIMIT',
              'Fast calibration exhausted its local height-search budget; check the installation before retrying',
              409,
            );
          recoverySteps++;
          if (session.auto?.fastAdaptation)
            session.auto.fastAdaptation.searchSteps = recoverySteps;
        }
        checkDepth(z);
        await preflight({ x, y, z }, `${label} search`);
        await moveTo({ x, y, z });
        const touched = await observe(
          z === heights.at(-1) ? 'search-limit' : 'search',
          directZ !== undefined ? dwellMs : searchWaitMs,
        );
        reportProbe('search', z, touched);
        if (!touched.screen) {
          lastClearZ = z;
          continue;
        }
        const weight = attempt
          ? 0.5
          : safetyFloorZ !== undefined && z <= safetyFloorZ + 1e-6
            ? 0.7
            : 1;
        if (directZ !== undefined) {
          if (z === directZ)
            return {
              contact: { x, y, z: directZ + PRESS_MM },
              pressedZ: z,
              screen: touched.screen,
              weight: 0.5, // Predicted height, not a newly measured activation.
            };
          const contactZ = (lastClearZ + z) / 2;
          const pressedZ = contactZ - PRESS_MM;
          checkDepth(pressedZ);
          await preflight({ x, y, z: zHigh }, `${label} adaptive release`);
          await moveTo({ x, y, z: zHigh });
          if ((await observe('release')).screen)
            throw new RobotArmError(
              'TOUCH_NOT_RELEASED',
              'Adaptive height probe did not release',
              409,
            );
          await preflight({ x, y, z: pressedZ }, `${label} adaptive press`);
          await moveTo({ x, y, z: pressedZ });
          const confirmed = await observe('press', dwellMs);
          if (!confirmed.screen)
            throw new RobotArmError(
              'TOUCH_CONTACT_LOST',
              'Adaptive light press did not confirm touch',
              409,
            );
          return {
            contact: { x, y, z: contactZ },
            pressedZ,
            screen: confirmed.screen,
            weight: 0.7,
            recovered: true,
          };
        }
        // A tool can keep reporting touch well above its downward activation
        // height. Reset that held pointer before testing a shallower depth.
        const release = async (touchZ: number) => {
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
        let touchingZ = z;
        let clearZ = lastClearZ;
        let pointerHeld = true;
        let heldZ = z;
        // All refinement targets stay inside the original coarse bracket. A
        // touching midpoint must release before the next trial; otherwise an
        // upward midpoint would measure hysteresis instead of activation.
        while (clearZ - touchingZ > CONTACT_BRACKET_MM + 1e-6) {
          if (pointerHeld) await release(heldZ);
          const midZ = (clearZ + touchingZ) / 2;
          checkDepth(midZ);
          await preflight({ x, y, z: midZ }, `${label} refine`);
          await moveTo({ x, y, z: midZ });
          const snapshot = await observe('refine');
          reportProbe('refine', midZ, snapshot);
          pointerHeld = Boolean(snapshot.screen);
          heldZ = midZ;
          if (pointerHeld) touchingZ = midZ;
          else clearZ = midZ;
        }
        // Even a short bracket needs one confirmed release; a coarse hit is
        // never accepted on the strength of a pointer that stayed held.
        if (pointerHeld) await release(heldZ);
        const contactZ = (clearZ + touchingZ) / 2;
        const pressedZ = contactZ - PRESS_MM;
        checkDepth(pressedZ);
        const pressTarget = { x, y, z: pressedZ };
        let pressed: Awaited<ReturnType<typeof observe>> | undefined;
        let pressRetried = false;
        for (
          let pressAttempt = 0;
          pressAttempt <= TOUCH_RETRY_ATTEMPTS;
          pressAttempt++
        ) {
          if (pressAttempt) {
            pressRetried = true;
            await release(pressedZ);
          }
          await preflight(pressTarget, `${label} press`, pressOptions);
          await moveTo(pressTarget, pressOptions);
          pressed = await observe('press', dwellMs);
          reportProbe('press', pressedZ, pressed);
          if (pressed.screen) break;
        }
        if (!pressed?.screen)
          throw new RobotArmError(
            'TOUCH_CONTACT_LOST',
            `The refined press at Z ${pressedZ.toFixed(2)} mm did not produce a confirmed touch after retry`,
            409,
          );
        return {
          contact: { x, y, z: contactZ },
          pressedZ,
          screen: pressed.screen,
          weight: pressRetried ? 0.5 : weight,
        };
      }
    }
    if (directZ !== undefined)
      throw new RobotArmError(
        'TOUCH_NOT_FOUND',
        'No page touch within the fast local height-search budget; check the screen placement before retrying',
        409,
      );
    const atSafetyFloor = safetyFloorZ !== undefined && floor === safetyFloorZ;
    throw new RobotArmError(
      atSafetyFloor ? 'TOUCH_SAFETY_LIMIT' : 'TOUCH_NOT_FOUND',
      atSafetyFloor
        ? `No page touch before the first-contact safety floor ${floor.toFixed(1)} mm`
        : `No screen touch at (${x.toFixed(1)}, ${y.toFixed(1)}) mm`,
      409,
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
  let first: TouchPoint | undefined;
  try {
    first = await touchAt(
      startContact.x,
      startContact.y,
      startContact.z,
      'Initial touch',
      INITIAL_DESCENT_MM,
      true,
      undefined,
      undefined,
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
            undefined,
            undefined,
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
  if (!first)
    throw new RobotArmError(
      'TOUCH_NOT_FOUND',
      'No screen touch was found within the search area; place the stylus closer to the centre and retry',
      409,
    );
  const heightAnchors = [first];
  // Use only measured activation heights. Successful predicted presses and
  // held-out validation points must not train the height predictor.
  const predictPressZ = (x: number, y: number) => {
    let total = 0;
    let weighted = 0;
    for (const anchor of heightAnchors) {
      const weight =
        1 / (100 + (x - anchor.contact.x) ** 2 + (y - anchor.contact.y) ** 2);
      total += weight;
      weighted += weight * anchor.contact.z;
    }
    return weighted / total - PRESS_MM;
  };
  // Bound later probes relative to the confirmed light press, and apply the
  // same floor to both search and final press targets.
  const safetyFloorZ = first.pressedZ - TOUCH_SAFETY_MARGIN_MM;

  setPhase(host, session, {
    phase: 'probe',
    operation: 'travel',
    index: 1,
    total: 3,
    message: 'Measuring touch direction',
  });
  const probeZ = first.contact.z + APPROACH_LIFT_MM;
  const probes: TouchPoint[] = [first];
  await recordSample(first, 'probe', 'stepped');
  for (const [dx, dy, label] of [
    [PROBE_MM, 0, 'Probe +X'],
    [0, PROBE_MM, 'Probe +Y'],
  ] as const) {
    const probe = await touchAt(
      first.contact.x + dx,
      first.contact.y + dy,
      probeZ,
      label,
      TOUCH_DESCENT_MM,
      false,
      safetyFloorZ,
      fast
        ? predictPressZ(first.contact.x + dx, first.contact.y + dy)
        : undefined,
    );
    probes.push(probe);
    if (probe.recovered) heightAnchors.push(probe);
    await recordSample(
      probe,
      'probe',
      fast && !probe.recovered ? 'direct' : 'stepped',
    );
  }
  const initialAffine = fitAffine(
    probes.map((probe) => ({ x: probe.contact.x, y: probe.contact.y })),
    probes.map((probe) => probe.screen),
  );
  const initialFrame = screenFrame(initialAffine, screen);
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
  const slideTo = async (x: number, y: number): Promise<TouchPoint> => {
    await assertPage();
    const contact = { x, y, z: predictPressZ(x, y) };
    await preflight(contact, 'Sliding grid endpoint');
    await moveTo(contact);
    // Change the sample ID only after stopping. The page snapshots the active
    // pointer under this new ID, so no moving coordinate is paired with an endpoint.
    const { screen: touched } = await observe('slide', dwellMs);
    if (!touched)
      throw new RobotArmError(
        'TOUCH_CONTACT_LOST',
        'Sliding contact was lost; lift and retry with tap collection',
        409,
      );
    return {
      contact: { x, y, z: contact.z + PRESS_MM },
      pressedZ: contact.z,
      screen: touched,
      weight: 0.5,
    };
  };
  setPhase(host, session, {
    phase: 'grid',
    index: 0,
    total: gridTargets.length,
    message: 'Sampling the screen',
  });
  const gridZ =
    Math.max(...probes.map((probe) => probe.contact.z)) + APPROACH_LIFT_MM;
  const grid: GridTouch[] = [];
  for (let index = 0; index < gridTargets.length; index++) {
    const target = gridTargets[index];
    let usedSlide = fast && options.collection === 'slide' && grid.length > 0;
    setPhase(host, session, {
      phase: 'grid',
      operation: usedSlide ? 'slide' : 'travel',
      index: index + 1,
      total: gridTargets.length,
      message: `Sampling ${index + 1}/${gridTargets.length}`,
    });
    const robot = affinePoint(initialFrame.inverse, target.screen);
    try {
      let touch: TouchPoint | undefined;
      if (usedSlide) {
        try {
          touch = await slideTo(robot.x, robot.y);
        } catch (error) {
          if (
            !(error instanceof RobotArmError) ||
            error.code !== 'TOUCH_CONTACT_LOST'
          )
            throw error;
          // Reacquire only this endpoint; subsequent segments remain fast.
          usedSlide = false;
        }
      }
      if (!touch) {
        const probeGrid = (point: ScreenPoint2, label: string) =>
          touchAt(
            point.x,
            point.y,
            gridZ,
            label,
            TOUCH_DESCENT_MM,
            false,
            safetyFloorZ,
            fast ? predictPressZ(point.x, point.y) : undefined,
          );
        try {
          touch = await probeGrid(robot, `Grid ${target.id}`);
        } catch (error) {
          if (
            !fast ||
            index !== 0 ||
            !(error instanceof RobotArmError) ||
            error.code !== 'TOUCH_NOT_FOUND'
          )
            throw error;
          // Three nearby touches estimate the remote corner. Correct a small
          // lateral miss without increasing the measured descent budget.
          const dx = first.contact.x - robot.x;
          const dy = first.contact.y - robot.y;
          const distance = Math.hypot(dx, dy);
          if (distance <= FIRST_GRID_RETRY_INSET_MM) throw error;
          const fraction = FIRST_GRID_RETRY_INSET_MM / distance;
          touch = await probeGrid(
            { x: robot.x + dx * fraction, y: robot.y + dy * fraction },
            `Grid ${target.id} inset retry`,
          );
        }
      }
      if (touch.recovered && target.role === 'fit') heightAnchors.push(touch);
      grid.push({ ...touch, target });
      await recordSample(
        touch,
        target.role,
        usedSlide ? 'slide' : fast && !touch.recovered ? 'direct' : 'stepped',
      );
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
