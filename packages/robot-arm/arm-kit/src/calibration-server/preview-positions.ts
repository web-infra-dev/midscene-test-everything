import { taughtCameraBoundary } from '../application/teaching-constraints.js';
import type {
  AssistedCalibrationInput,
  AssistedCalibrationState,
  CalibrationPreviewPositions,
} from '../assisted-contracts.js';
import { screenContact } from '../calibration/geometry.js';
import { savedCalibrationReference } from '../calibration/reference-position.js';
import type { CameraSession } from '../camera/session.js';
import {
  applyHomography,
  computeHomography,
  destinationCorners,
  quadToArray,
} from '../camera/vision-geometry.js';
import {
  type CalibrationProfile,
  type CameraCorrection,
  type CartesianPose,
  type InstallationTeaching,
  type ProfileData,
  type ScreenProfile,
  type Vector3,
  calibrationAccepted,
  hasScreenMapping,
} from '../contracts.js';
import { contactPoint } from '../domain.js';
import type { RobotArmRuntime } from '../runtime.js';

/** Project onto the horizontal bench at screen height. Height parallax is intentionally omitted. */
export function projectPreviewPositions(
  correction: CameraCorrection,
  poses: Partial<
    Record<
      'reference' | 'safe' | 'cameraBoundary' | 'cameraBoundaryEnd',
      CartesianPose
    >
  >,
  fit?: {
    calibration: CalibrationProfile;
    screen: ScreenProfile;
    offsetMm: Vector3;
  },
  boundary?: InstallationTeaching['cameraBoundary'],
): CalibrationPreviewPositions | undefined {
  if (!poses.reference && !poses.safe && !poses.cameraBoundary) return;
  try {
    const raw = quadToArray(correction.points);
    if (!fit) {
      if (!poses.reference) return;
      // Before sampling, the teaching prompt places the tip above the centre.
      const h = computeHomography(destinationCorners(2, 2, 0), raw);
      return { reference: applyHomography(h, { x: 0.5, y: 0.5 }) };
    }
    const { calibration, screen, offsetMm } = fit;
    if (!hasScreenMapping(screen)) return;
    const corners = destinationCorners(
      screen.pixelWidth,
      screen.pixelHeight,
      correction.rotation,
    );
    const flat = { ...calibration, surface: undefined };
    const bench = corners.map((p) => screenContact(flat, screen, p));
    const h = computeHomography(bench, raw);
    const denominator = (p: { x: number; y: number }) =>
      h[6] * p.x + h[7] * p.y + h[8];
    const projectTip = (tip: { x: number; y: number }) => {
      // An off-screen parking pose can lie beyond the perspective horizon.
      const w = denominator(tip);
      if (Math.abs(w) < 1e-12 || w * denominator(bench[0]) <= 0) return;
      const pixel = applyHomography(h, tip);
      if (Number.isFinite(pixel.x) && Number.isFinite(pixel.y)) return pixel;
    };
    const point = (pose?: CartesianPose) =>
      pose && projectTip(contactPoint(pose, offsetMm));
    const start = point(poses.cameraBoundary);
    const end = point(poses.cameraBoundaryEnd);
    const allowed =
      boundary &&
      projectTip({
        x: boundary.point.x - 20 * boundary.normal.x,
        y: boundary.point.y - 20 * boundary.normal.y,
      });
    return {
      reference: point(poses.reference),
      safe: point(poses.safe),
      cameraBoundary: start,
      cameraBoundaryEnd: end,
      cameraBoundaryLine:
        start && end && allowed ? { start, end, allowed } : undefined,
    };
  } catch {
    // Singular or incomplete geometry cannot locate a marker in this view.
    return undefined;
  }
}

export function calibrationPreviewPositions(
  runtime: RobotArmRuntime,
  camera: CameraSession,
  deviceId: string,
  options: {
    selection?: AssistedCalibrationInput;
    session?: AssistedCalibrationState | null;
    teachingView?: boolean;
    /** Already-read profile data, so a list of screens does not clone it per screen. */
    profiles?: ProfileData;
  } = {},
): CalibrationPreviewPositions | undefined {
  const correction = camera.getCorrection();
  if (!correction || camera.getPerspectiveValidity()?.state === 'invalid')
    return;
  const store = runtime.profileStore;
  const binding = store.deviceBinding(deviceId);
  const setup =
    options.selection ?? store.calibrationSetup(deviceId) ?? binding;
  if (!setup || setup.cameraId !== camera.camera.id) return;
  const robot = store.getRobot(setup.robotProfileId);
  if (
    robot.connectionIdentity !== runtime.connectionIdentity ||
    robot.adapterId !== runtime.id
  )
    return;
  const tool = store.getTool(setup.toolProfileId);
  const session = options.session;
  const active =
    !options.teachingView &&
    session?.mapping &&
    !['interrupted', 'cancelled', 'completed'].includes(session.stage) &&
    camera.isBindingCurrent(session.mapping.vision)
      ? session
      : undefined;
  const draftBoundary = (
    reference?: CartesianPose,
    start?: CartesianPose,
    end?: CartesianPose,
  ) => {
    if (!reference || !start || !end) return;
    try {
      return taughtCameraBoundary(reference, start, end, tool);
    } catch {
      // An incomplete or invalid draft cannot describe an allowed side.
      return undefined;
    }
  };
  const candidate = active?.calibration?.candidate;
  const saved =
    binding && camera.isBindingCurrent(binding.vision)
      ? store.getCalibration(binding.calibrationProfileId)
      : undefined;
  const calibration =
    candidate ?? (calibrationAccepted(saved) ? saved : undefined);
  const screen = calibration && store.getScreen(calibration.screenProfileId);
  const savedTeaching = store.installationTeaching(setup);
  const teaching = savedTeaching?.invalidatedReason ? undefined : savedTeaching;
  const fit =
    calibration &&
    screen &&
    calibration.geometryStatus === 'valid' &&
    calibration.robotProfileId === robot.id &&
    calibration.toolProfileId === tool.id &&
    calibration.robotGeometryRevision === robot.geometryRevision &&
    calibration.toolGeometryRevision === tool.geometryRevision &&
    screen.geometryRevision === calibration.screenGeometryRevision
      ? { calibration, screen, offsetMm: tool.offsetMm }
      : undefined;
  // A candidate can temporarily hold the starting pose as its observation pose.
  // Only safePosition confirms that a parking pose has actually been recorded.
  if (active) {
    return projectPreviewPositions(
      correction,
      {
        reference: active.referencePosition,
        safe: active.safePosition,
        cameraBoundary: active.cameraBoundaryPosition,
        cameraBoundaryEnd: active.cameraBoundaryEndPosition,
      },
      fit,
      teaching && active.teachingId === teaching.id
        ? teaching.cameraBoundary
        : draftBoundary(
            active.referencePosition,
            active.cameraBoundaryPosition,
            active.cameraBoundaryEndPosition,
          ),
    );
  }
  const draft = options.teachingView
    ? runtime.installationTeachingDraft({ ...setup, screenProfileId: deviceId })
    : undefined;
  const reference =
    draft?.poses.reference ??
    (fit || teaching
      ? savedCalibrationReference(
          () => options.profiles ?? store.list(),
          deviceId,
          setup.cameraId,
          fit?.calibration.id,
          teaching,
        )?.pose
      : undefined);
  const safe = fit?.calibration.observationPose;
  // A fresh teaching draft clears its previous boundary when the reference is re-recorded.
  const cameraBoundary = draft
    ? draft.poses.cameraBoundary
    : teaching?.poses.cameraBoundary;
  const cameraBoundaryEnd = draft
    ? draft.poses.cameraBoundaryEnd
    : teaching?.poses.cameraBoundaryEnd;
  return projectPreviewPositions(
    correction,
    { reference, safe, cameraBoundary, cameraBoundaryEnd },
    fit,
    draft
      ? draftBoundary(draft.poses.reference, cameraBoundary, cameraBoundaryEnd)
      : teaching?.cameraBoundary,
  );
}
