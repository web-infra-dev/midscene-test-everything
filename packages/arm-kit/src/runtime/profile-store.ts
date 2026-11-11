import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { assertSurface } from '../calibration/surface.js';
import { assertSafeObservation } from '../calibration/verification/safe-position.js';
import {
  calibrationSessionStatus,
  verificationContextKey,
} from '../calibration/verification/session-state.js';
import {
  type CalibrationProfile,
  type CalibrationSession,
  type CartesianPose,
  type DeviceBinding,
  type ProfileBinding,
  type ProfileData,
  type ProfileInput,
  RobotArmError,
  type RobotArmProfile,
  type ScreenProfile,
  type SharedParkingEvidence,
  type ToolProfile,
  type VersionedProfile,
  type VisionBinding,
  type WorkstationBinding,
  assertToolPayload,
  calibrationAccepted,
  hasScreenMapping,
  semanticJson,
} from '../contracts.js';
import {
  assertPose,
  assertVector,
  assertWorkspace,
  contactPoint,
  cross,
  dot,
  length,
  unit,
} from '../domain.js';
import { invertMapping } from '../domain/homography.js';
import { validateScreenMotionSettings } from '../screen-interaction/motion-policy.js';
import { backupPreviousFile, robotDataRoot } from '../storage/layout.js';

export function sharedCalibrationTool(
  profiles: Pick<ProfileData, 'calibrationSetups' | 'robots' | 'screenTargets'>,
  cameraId: string,
  adapterId: string,
  connectionIdentity: string,
): Pick<ProfileBinding, 'robotProfileId' | 'toolProfileId'> | undefined {
  const candidates = profiles.calibrationSetups?.filter(
    (setup) =>
      setup.cameraId === cameraId &&
      !profiles.screenTargets?.some(
        (target) => target.id === setup.deviceId && target.archived,
      ) &&
      profiles.robots.some(
        (robot) =>
          robot.id === setup.robotProfileId &&
          robot.adapterId === adapterId &&
          robot.connectionIdentity === connectionIdentity,
      ),
  );
  const first = candidates?.[0];
  if (
    first &&
    candidates?.every(
      (setup) =>
        setup.robotProfileId === first.robotProfileId &&
        setup.toolProfileId === first.toolProfileId,
    )
  )
    return {
      robotProfileId: first.robotProfileId,
      toolProfileId: first.toolProfileId,
    };
}

export function validateScreen(s: ProfileInput<ScreenProfile>): void {
  if (!s.id || !s.name || !s.direction)
    throw new RobotArmError(
      'INVALID_PROFILE',
      'Screen identity and direction are required',
    );
  for (const k of ['physicalWidthMm', 'physicalHeightMm'] as const)
    if (!Number.isFinite(s[k]) || s[k] <= 0)
      throw new RobotArmError('INVALID_PROFILE', `Invalid ${k}`);
  if (
    (s.pixelWidth !== undefined || s.pixelHeight !== undefined) &&
    !hasScreenMapping(s)
  )
    throw new RobotArmError(
      'INVALID_PROFILE',
      'Omit both pixel dimensions, or supply two positive integers',
    );
  if (s.phoneMapping) {
    if (
      ![s.phoneMapping.width, s.phoneMapping.height].every(
        (n) => Number.isFinite(n) && n > 1,
      ) ||
      !s.phoneMapping.visionFingerprint
    )
      throw new RobotArmError(
        'INVALID_PROFILE',
        'Invalid camera-to-phone mapping',
      );
    invertMapping(s.phoneMapping.imageToPhone);
  }
  validateScreenMotionSettings(s);
}

function validateRobot(r: ProfileInput<RobotArmProfile>): void {
  if (
    !r.id ||
    !r.name ||
    !r.adapterId ||
    !r.connectionIdentity ||
    !r.installation
  )
    throw new RobotArmError(
      'INVALID_PROFILE',
      'Robot identity, installation and connection identity are required',
    );
  if (r.workspace) assertWorkspace(r.workspace);
  if (
    r.jointBounds &&
    (!Array.isArray(r.jointBounds) ||
      !r.jointBounds.length ||
      r.jointBounds.some(
        (b) =>
          !Number.isFinite(b.min) || !Number.isFinite(b.max) || b.min >= b.max,
      ))
  )
    throw new RobotArmError(
      'INVALID_PROFILE',
      'Invalid explicit joint operation bounds',
    );
}
function validateTool(t: ProfileInput<ToolProfile>): void {
  if (t.payload !== undefined) assertToolPayload(t.payload);
  if (!t.id || !t.name)
    throw new RobotArmError('INVALID_PROFILE', 'Tool identity is required');
  assertVector(t.offsetMm);
  unit(t.contactDirection);
  if (Math.abs(length(t.contactDirection) - 1) > 1e-5)
    throw new RobotArmError(
      'INVALID_PROFILE',
      'Tool contactDirection must be a unit vector',
    );
}
function geometry(value: VersionedProfile): string {
  const { id, name, revision, geometryRevision, updatedAt, ...rest } = value;
  if ('physicalWidthMm' in rest) {
    const s = rest as unknown as ScreenProfile;
    return semanticJson([s.physicalWidthMm, s.physicalHeightMm]);
  }
  if ('offsetMm' in rest) {
    const t = rest as unknown as ToolProfile;
    return semanticJson([t.offsetMm, t.contactDirection]);
  }
  const r = rest as unknown as RobotArmProfile;
  return semanticJson([r.adapterId, r.connectionIdentity, r.installation]);
}
export class ProfileStore {
  private data: ProfileData = {
    format: 'midscene.robot-arm.profiles',
    schemaVersion: 1,
    robots: [],
    tools: [],
    screens: [],
    calibrations: [],
    sessions: [],
  };
  private serial: Promise<unknown> = Promise.resolve();
  constructor(
    private location = path.join(
      robotDataRoot(),
      'installations',
      'standalone',
      'profiles.json',
    ),
  ) {}
  get filePath(): string {
    return this.location;
  }
  /** Keep writes queued until an installation directory move has committed. */
  relocate<T>(filePath: string, move: () => Promise<T>): Promise<T> {
    const operation = this.serial.then(async () => {
      const result = await move();
      this.location = filePath;
      return result;
    });
    this.serial = operation.catch(() => undefined);
    return operation;
  }
  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new RobotArmError(
        'INVALID_PROFILE_FILE',
        'Expected Profile storage object',
        500,
      );
    if (
      parsed.format !== 'midscene.robot-arm.profiles' ||
      parsed.schemaVersion !== 1
    ) {
      const backup = `${this.filePath}.incompatible-${createHash('sha256')
        .update(raw)
        .digest('hex')}.bak`;
      await copyFile(this.filePath, backup);
      throw new RobotArmError(
        'PROFILE_FORMAT_MISMATCH',
        'Profile format does not match this service. Use a new storage path and establish measured configuration and calibration. Original file preserved.',
        409,
        {
          backup,
          original: this.filePath,
          suggestedPath: `${this.filePath.replace(/\.json$/, '')}.fresh.json`,
        },
      );
    }
    if (
      !['robots', 'tools', 'screens', 'calibrations'].every((k) =>
        Array.isArray(parsed[k]),
      )
    )
      throw new RobotArmError(
        'INVALID_PROFILE_FILE',
        'Malformed Profile storage',
        500,
      );
    parsed.robots.forEach(validateRobot);
    parsed.tools.forEach(validateTool);
    parsed.screens.forEach(validateScreen);
    if (
      parsed.screenTargets !== undefined &&
      (!Array.isArray(parsed.screenTargets) ||
        new Set(parsed.screenTargets.map((t: { id: string }) => t.id)).size !==
          parsed.screenTargets.length ||
        parsed.screenTargets.some(
          (t: { id: string; cameraId: string; name: string }) =>
            !t ||
            typeof t.id !== 'string' ||
            !t.id ||
            typeof t.cameraId !== 'string' ||
            !t.cameraId ||
            typeof t.name !== 'string' ||
            !t.name.trim(),
        ))
    )
      throw new RobotArmError('INVALID_PROFILE_FILE', 'Invalid screen targets');
    if (
      parsed.installationTeachings !== undefined &&
      !Array.isArray(parsed.installationTeachings)
    )
      throw new RobotArmError(
        'INVALID_PROFILE_FILE',
        'Invalid installation teaching list',
      );
    for (const t of parsed.installationTeachings ?? []) {
      assertPose(t.referencePose);
      assertPose(t.poses?.reference);
      assertPose(t.poses?.cameraBoundary);
      const n = t.cameraBoundary?.normal;
      const p = t.cameraBoundary?.point;
      if (
        !t.id ||
        !t.cameraId ||
        t.corridorConfirmed !== true ||
        !n ||
        !p ||
        ![n.x, n.y, p.x, p.y].every(Number.isFinite) ||
        Math.abs(Math.hypot(n.x, n.y) - 1) > 1e-6
      )
        throw new RobotArmError(
          'INVALID_PROFILE_FILE',
          'Invalid installation teaching',
        );
    }
    for (const p of [...parsed.robots, ...parsed.tools, ...parsed.screens])
      if (!Number.isInteger(p.geometryRevision) || p.geometryRevision < 1)
        throw new RobotArmError(
          'INVALID_PROFILE_FILE',
          'Invalid geometryRevision',
          500,
        );
    for (const items of [
      parsed.robots,
      parsed.tools,
      parsed.screens,
      parsed.calibrations,
    ]) {
      if (new Set(items.map((p: { id: string }) => p.id)).size !== items.length)
        throw new RobotArmError(
          'INVALID_PROFILE_FILE',
          'Duplicate Profile IDs',
          500,
        );
      for (const p of items)
        if (!Number.isInteger(p.revision) || p.revision < 1)
          throw new RobotArmError(
            'INVALID_PROFILE_FILE',
            'Invalid revision',
            500,
          );
    }
    for (const c of parsed.calibrations) {
      if (
        c.acceptanceStatus === 'accepted' &&
        !calibrationAccepted(
          { ...c, geometryStatus: 'valid' },
          c.pendingParkingBatchId,
        )
      )
        throw new RobotArmError(
          'INVALID_PROFILE_FILE',
          'Active calibration requires motion results and explicit human confirmations',
          500,
        );
      if (
        (c.geometryFrame !== undefined && c.geometryFrame !== 'screen') ||
        !c.phoneFrame ||
        ![c.phoneFrame.width, c.phoneFrame.height].every(
          (n) => Number.isFinite(n) && n > 1,
        )
      )
        throw new RobotArmError(
          'INVALID_PROFILE_FILE',
          'Invalid phone calibration frame',
        );
      assertVector(c.origin);
      unit(c.xAxis);
      unit(c.yAxis);
      unit(c.inward);
      assertPose(c.observationPose);
      assertPose({
        frame: 'base',
        positionMm: c.origin,
        orientation: c.orientation,
      });
      if (
        !['restrictedPlane', 'spatialPlane'].includes(c.kind) ||
        ![
          c.robotGeometryRevision,
          c.toolGeometryRevision,
          c.screenGeometryRevision,
          c.screenRevision,
        ].every((v) => Number.isInteger(v) && v > 0) ||
        !c.robotProfileId ||
        !c.toolProfileId ||
        !c.screenProfileId
      )
        throw new RobotArmError(
          'INVALID_PROFILE_FILE',
          'Calibration binding or strategy is invalid',
          500,
        );
      if (
        !c.plane ||
        !Number.isFinite(c.plane.offset) ||
        !['valid', 'invalid'].includes(c.geometryStatus) ||
        !['pending', 'accepted'].includes(c.acceptanceStatus)
      )
        throw new RobotArmError(
          'INVALID_PROFILE_FILE',
          'Invalid calibration structure. Use a new storage path and complete phone-assisted setup again.',
          500,
        );
      assertSurface(c.surface);
      unit(c.plane.normal);
      if (
        [c.xAxis, c.yAxis, c.inward, c.plane.normal].some(
          (v) => Math.abs(length(v) - 1) > 1e-5,
        ) ||
        Math.abs(dot(c.xAxis, c.yAxis)) > 1e-5 ||
        dot(cross(c.xAxis, c.yAxis), c.plane.normal) < 1 - 1e-5 ||
        Math.abs(dot(c.xAxis, c.plane.normal)) > 1e-5 ||
        Math.abs(dot(c.yAxis, c.plane.normal)) > 1e-5 ||
        Math.abs(dot(c.plane.normal, c.origin) - c.plane.offset) > 1e-5 ||
        dot(c.plane.normal, c.inward) < 0.9
      )
        throw new RobotArmError(
          'INVALID_PROFILE_FILE',
          'Invalid screen coordinate basis. Use a new storage path and complete phone-assisted setup again.',
          500,
        );
    }
    if (
      parsed.devices !== undefined &&
      (!Array.isArray(parsed.devices) ||
        parsed.devices.some(
          (entry: DeviceBinding) =>
            !entry ||
            typeof entry.deviceId !== 'string' ||
            !entry.deviceId ||
            !entry.vision,
        ) ||
        new Set(parsed.devices.map((entry: DeviceBinding) => entry.deviceId))
          .size !== parsed.devices.length)
    )
      throw new RobotArmError(
        'INVALID_PROFILE_FILE',
        'Invalid device bindings',
        500,
      );
    for (const workstation of [
      parsed.workstation,
      ...(parsed.devices ?? []),
    ].filter(Boolean) as WorkstationBinding[]) {
      if (
        !Number.isInteger(workstation.revision) ||
        workstation.revision < 1 ||
        ![
          'robotProfileId',
          'toolProfileId',
          'screenProfileId',
          'calibrationProfileId',
          'cameraId',
        ].every(
          (key) =>
            typeof workstation[key as keyof WorkstationBinding] === 'string',
        )
      )
        throw new RobotArmError(
          'INVALID_PROFILE_FILE',
          'Invalid persisted workstation binding',
          500,
        );
      if (
        workstation.vision &&
        (workstation.vision.cameraId !== workstation.cameraId ||
          typeof workstation.vision.fingerprint !== 'string' ||
          !workstation.vision.fingerprint ||
          !Number.isFinite(Date.parse(workstation.vision.confirmedAt)) ||
          !hasScreenMapping({
            pixelWidth: workstation.vision.width,
            pixelHeight: workstation.vision.height,
          }))
      )
        throw new RobotArmError(
          'INVALID_PROFILE_FILE',
          'Invalid persisted visual confirmation',
          500,
        );
    }
    if (parsed.calibrationSetups !== undefined) {
      if (
        !Array.isArray(parsed.calibrationSetups) ||
        parsed.calibrationSetups.some(
          (setup: NonNullable<ProfileData['calibrationSetups']>[number]) =>
            !setup ||
            typeof setup.deviceId !== 'string' ||
            !setup.deviceId ||
            typeof setup.cameraId !== 'string' ||
            !setup.cameraId ||
            !parsed.robots.some(
              (robot: RobotArmProfile) => robot.id === setup.robotProfileId,
            ) ||
            !parsed.tools.some(
              (tool: ToolProfile) => tool.id === setup.toolProfileId,
            ) ||
            ![setup.width, setup.height].every(
              (value) =>
                Number.isInteger(value) && value >= 180 && value <= 4096,
            ) ||
            typeof setup.autoOutput !== 'boolean',
        ) ||
        new Set(
          parsed.calibrationSetups.map(
            (setup: { deviceId: string }) => setup.deviceId,
          ),
        ).size !== parsed.calibrationSetups.length
      )
        throw new RobotArmError(
          'INVALID_PROFILE_FILE',
          'Invalid measured calibration setup',
          500,
        );
    }
    for (const setup of parsed.calibrationSetups ?? []) {
      if (setup.motion) validateScreenMotionSettings(setup.motion);
    }
    this.data = parsed;
    await this.transaction((d) => {
      for (const s of d.sessions ?? []) {
        if (calibrationSessionStatus(s) === 'active') {
          s.status = 'interrupted';
          s.interruptionReason =
            'Service restarted. Confirm the installation and complete recovery before continuing.';
          s.recoveryAcknowledged = false;
          s.revision++;
          for (const run of s.verificationRuns ?? [])
            if (run.outcome === 'running') run.outcome = 'interrupted';
        }
      }
    });
  }
  setSoftwarePaused(paused: boolean): Promise<void> {
    return this.transaction((d) => {
      d.softwarePaused = paused;
    });
  }
  markOperation(requestId: string, kind: string): Promise<void> {
    return this.transaction((d) => {
      d.pendingOperation = {
        requestId,
        kind,
        startedAt: new Date().toISOString(),
      };
    });
  }
  clearOperation(requestId?: string): Promise<void> {
    return this.transaction((d) => {
      if (!requestId)
        for (const session of d.sessions ?? [])
          if (calibrationSessionStatus(session) === 'interrupted')
            session.recoveryAcknowledged = true;
      if (!requestId || d.pendingOperation?.requestId === requestId)
        d.pendingOperation = undefined;
    });
  }
  list(): ProfileData {
    return structuredClone(this.data);
  }
  contextKey(
    binding: ProfileBinding,
    calibrationProfileId: string,
    deviceVision?: VisionBinding,
  ): string {
    const robot = this.getRobot(binding.robotProfileId);
    const tool = this.getTool(binding.toolProfileId);
    const screen = this.getScreen(binding.screenProfileId);
    const calibration = this.getCalibration(calibrationProfileId);
    const workstation = this.data.workstation;
    const vision =
      deviceVision ??
      (workstation?.screenProfileId === screen.id &&
      workstation.robotProfileId === robot.id &&
      workstation.toolProfileId === tool.id &&
      workstation.calibrationProfileId === calibration.id
        ? workstation.vision
        : undefined);
    return createHash('sha256')
      .update(
        semanticJson([
          robot.id,
          robot.geometryRevision,
          tool.id,
          tool.geometryRevision,
          screen.id,
          screen.geometryRevision,
          screen.pixelWidth,
          screen.pixelHeight,
          screen.phoneMapping,
          calibration.phoneFrame,
          calibration.geometryFrame,
          calibration.id,
          calibration.geometryStatus,
          calibration.acceptanceStatus,
          calibration.origin,
          calibration.xAxis,
          calibration.yAxis,
          calibration.inward,
          calibration.orientation,
          calibration.plane,
          calibration.surface,
          calibration.observationPose,
          calibrationAccepted(calibration),
          deviceVision?.cameraId ?? workstation?.cameraId,
          vision?.fingerprint,
        ]),
      )
      .digest('hex');
  }
  saveScreenPage(page: NonNullable<ProfileData['screenPages']>[number]) {
    return this.transaction((draft) => {
      if (
        draft.screenPages?.some(
          (p) =>
            p.id !== page.id &&
            (p.pageKey === page.pageKey ||
              p.token === page.token ||
              (page.targetId && p.targetId === page.targetId)),
        )
      )
        throw new RobotArmError(
          'PAGE_ALREADY_BOUND',
          'One page can only belong to one screen',
          409,
        );
      for (const target of draft.screenTargets ?? [])
        if (target.pageKey === page.pageKey && target.id !== page.targetId)
          target.pageKey = undefined;
      draft.screenPages = [
        ...(draft.screenPages ?? []).filter((p) => p.id !== page.id),
        structuredClone(page),
      ];
    });
  }
  /**
   * Forgets a saved page. Used for a browser identity that is gone for good —
   * clearing site data or switching browsers leaves a page record that no phone
   * can ever come back as, and it would keep showing up as an offline device.
   */
  removeScreenPage(id: string) {
    return this.transaction((draft) => {
      const page = draft.screenPages?.find((p) => p.id === id);
      if (page)
        for (const target of draft.screenTargets ?? [])
          if (target.pageKey === page.pageKey) target.pageKey = undefined;
      draft.screenPages = (draft.screenPages ?? []).filter((p) => p.id !== id);
    });
  }
  archiveScreenTarget(id: string) {
    return this.transaction((draft) => {
      const target = draft.screenTargets?.find((screen) => screen.id === id);
      if (!target)
        throw new RobotArmError('INVALID_ARGUMENT', 'Screen not found');
      target.archived = true;
      target.pageKey = undefined;
      for (const page of draft.screenPages ?? [])
        if (page.targetId === id) page.targetId = undefined;
    });
  }
  saveInstallationTeachingDraft(
    input: import('../contracts.js').InstallationTeachingDraft,
    guard?: () => void,
  ) {
    return this.transaction((draft) => {
      draft.installationTeachingDrafts = [
        ...(draft.installationTeachingDrafts ?? []).filter(
          (t) =>
            t.cameraId !== input.cameraId ||
            t.robotProfileId !== input.robotProfileId ||
            t.toolProfileId !== input.toolProfileId,
        ),
        structuredClone(input),
      ];
    }, guard);
  }
  updateScreenTarget(
    id: string,
    input: {
      name?: string;
      pageKey?: string;
      markerSlot?: number;
      archived?: boolean;
    },
  ) {
    return this.transaction((draft) => {
      const target = draft.screenTargets?.find((t) => t.id === id);
      if (!target)
        throw new RobotArmError('INVALID_ARGUMENT', 'Screen not found');
      if (
        input.name !== undefined &&
        (!input.name.trim() ||
          input.name.length > 40 ||
          draft.screenTargets?.some(
            (t) =>
              !t.archived &&
              t.id !== id &&
              t.cameraId === target.cameraId &&
              t.name.toLocaleLowerCase() ===
                input.name!.trim().toLocaleLowerCase(),
          ))
      )
        throw new RobotArmError(
          'INVALID_ARGUMENT',
          'Screen names must be unique.',
        );
      Object.assign(
        target,
        input,
        input.name ? { name: input.name.trim() } : {},
      );
      if (input.pageKey)
        for (const other of draft.screenTargets ?? []) {
          if (other.id !== id && other.pageKey === input.pageKey)
            other.pageKey = undefined;
        }
    });
  }
  clearCalibrationBatch() {
    return this.transaction((draft) => {
      draft.calibrationBatch = undefined;
    });
  }
  retireCalibration(id: string) {
    return this.transaction((draft) => {
      const c = draft.calibrations.find((c) => c.id === id);
      if (!c)
        throw new RobotArmError('INVALID_ARGUMENT', 'Calibration not found');
      c.acceptanceStatus = 'pending';
      draft.devices = draft.devices?.filter(
        (d) => d.calibrationProfileId !== id,
      );
    });
  }
  saveCalibrationBatch(
    state: import('../assisted-contracts.js').CalibrationBatchState,
  ) {
    return this.transaction((draft) => {
      draft.calibrationBatch = structuredClone(state);
    });
  }
  saveScreenTarget(input: { id: string; cameraId: string; name: string }) {
    if (
      !input.id ||
      !input.cameraId ||
      !input.name.trim() ||
      input.name.trim().length > 40
    )
      throw new RobotArmError(
        'INVALID_ARGUMENT',
        'Screen name and camera are required',
      );
    return this.transaction((draft) => {
      if (draft.screenTargets?.some((t) => t.id === input.id))
        throw new RobotArmError('INVALID_ARGUMENT', 'Screen already exists');
      if (
        draft.screenTargets?.some(
          (t) =>
            !t.archived &&
            t.cameraId === input.cameraId &&
            t.name.toLocaleLowerCase() ===
              input.name.trim().toLocaleLowerCase(),
        )
      )
        throw new RobotArmError(
          'INVALID_ARGUMENT',
          'Screen names must be unique.',
        );
      draft.screenTargets = [
        ...(draft.screenTargets ?? []),
        // Persist identity only. Callers may pass a full screen DTO (with a
        // live correction snapshot); that snapshot must never outlive the
        // camera's applied perspective.
        { id: input.id, cameraId: input.cameraId, name: input.name.trim() },
      ];
    });
  }
  installationTeaching(input: {
    robotProfileId: string;
    toolProfileId: string;
    cameraId: string;
  }) {
    const robot = this.getRobot(input.robotProfileId);
    const tool = this.getTool(input.toolProfileId);
    return this.list().installationTeachings?.find(
      (t) =>
        t.robotProfileId === robot.id &&
        t.toolProfileId === tool.id &&
        t.cameraId === input.cameraId &&
        t.robotGeometryRevision === robot.geometryRevision &&
        t.toolGeometryRevision === tool.geometryRevision &&
        t.corridorConfirmed === true,
    );
  }
  saveInstallationTeaching(
    teaching: import('../contracts.js').InstallationTeaching,
  ) {
    assertPose(teaching.referencePose);
    assertPose(teaching.poses.cameraBoundary);
    return this.transaction((draft) => {
      if (
        this.getRobot(teaching.robotProfileId).geometryRevision !==
          teaching.robotGeometryRevision ||
        this.getTool(teaching.toolProfileId).geometryRevision !==
          teaching.toolGeometryRevision
      )
        throw new RobotArmError(
          'CALIBRATION_INVALID',
          'Teaching geometry changed',
          409,
        );
      draft.installationTeachings = [
        ...(draft.installationTeachings ?? []).filter(
          (t) =>
            t.robotProfileId !== teaching.robotProfileId ||
            t.toolProfileId !== teaching.toolProfileId ||
            t.cameraId !== teaching.cameraId,
        ),
        structuredClone(teaching),
      ];
    });
  }
  calibrationSetup(deviceId: string) {
    const setup = this.data.calibrationSetups?.find(
      (entry) => entry.deviceId === deviceId,
    );
    return setup && structuredClone(setup);
  }
  saveCalibrationSetup(
    input: NonNullable<ProfileData['calibrationSetups']>[number],
  ) {
    const setup = structuredClone(input);
    if (setup.motion) validateScreenMotionSettings(setup.motion);
    return this.transaction((draft) => {
      if (
        !setup.deviceId ||
        !setup.cameraId ||
        !draft.robots.some((robot) => robot.id === setup.robotProfileId) ||
        !draft.tools.some((tool) => tool.id === setup.toolProfileId) ||
        ![setup.width, setup.height].every(
          (value) => Number.isInteger(value) && value >= 180 && value <= 4096,
        ) ||
        typeof setup.autoOutput !== 'boolean'
      )
        throw new RobotArmError(
          'INVALID_PROFILE',
          'Invalid measured calibration setup',
        );
      draft.calibrationSetups = [
        ...(draft.calibrationSetups ?? []).filter(
          (entry) => entry.deviceId !== setup.deviceId,
        ),
        setup,
      ];
    });
  }
  calibrationMapping(deviceId: string) {
    const entry = this.data.calibrationMappings?.[deviceId];
    return entry && structuredClone(entry);
  }
  saveCalibrationMapping(
    deviceId: string,
    entry?: NonNullable<ProfileData['calibrationMappings']>[string],
  ) {
    if (!entry && !this.calibrationMapping(deviceId)) return Promise.resolve();
    return this.transaction((draft) => {
      draft.calibrationMappings ??= {};
      if (entry) draft.calibrationMappings[deviceId] = structuredClone(entry);
      else
        draft.calibrationMappings = Object.fromEntries(
          Object.entries(draft.calibrationMappings).filter(
            ([id]) => id !== deviceId,
          ),
        );
    });
  }
  deviceBinding(deviceId: string): DeviceBinding | undefined {
    const binding = this.data.devices?.find(
      (entry) => entry.deviceId === deviceId,
    );
    return binding && structuredClone(binding);
  }
  /** Publish only an accepted candidate; pending/failed calibration never replaces a Device. */
  acceptDeviceBinding(input: DeviceBinding): Promise<DeviceBinding> {
    const candidate = structuredClone(input);
    return this.transaction((draft) =>
      this.bindAcceptedDevice(draft, candidate),
    );
  }
  private bindAcceptedDevice(
    draft: ProfileData,
    candidate: DeviceBinding,
    parkingBatchId?: string,
  ) {
    if (!candidate.deviceId?.trim())
      throw new RobotArmError('INVALID_DEVICE', 'Device ID is required');
    const current = draft.devices?.find(
      (entry) => entry.deviceId === candidate.deviceId,
    );
    if (candidate.revision !== (current?.revision ?? 0))
      throw new RobotArmError(
        'STALE_DEVICE',
        'Device calibration changed before saving',
        409,
      );
    const calibration = draft.calibrations.find(
      (entry) => entry.id === candidate.calibrationProfileId,
    );
    const robot = draft.robots.find(
      (entry) => entry.id === candidate.robotProfileId,
    );
    const tool = draft.tools.find(
      (entry) => entry.id === candidate.toolProfileId,
    );
    const screen = draft.screens.find(
      (entry) => entry.id === candidate.screenProfileId,
    );
    if (
      !calibration ||
      !calibrationAccepted(calibration, parkingBatchId) ||
      !robot ||
      !tool ||
      !screen ||
      calibration.robotProfileId !== robot.id ||
      calibration.toolProfileId !== tool.id ||
      calibration.screenProfileId !== screen.id ||
      calibration.robotGeometryRevision !== robot.geometryRevision ||
      calibration.toolGeometryRevision !== tool.geometryRevision ||
      calibration.screenGeometryRevision !== screen.geometryRevision
    )
      throw new RobotArmError(
        'CALIBRATION_INVALID',
        'Only an accepted calibration matching current geometry can be saved for a Device',
      );
    if (
      !candidate.vision ||
      candidate.cameraId !== candidate.vision.cameraId ||
      !candidate.cameraId ||
      !Number.isFinite(Date.parse(candidate.vision.confirmedAt)) ||
      candidate.vision.width !== screen.pixelWidth ||
      candidate.vision.height !== screen.pixelHeight ||
      candidate.vision.fingerprint !== screen.phoneMapping?.visionFingerprint
    )
      throw new RobotArmError(
        'VISION_BINDING_CHANGED',
        'Camera confirmation does not match the calibrated screen',
      );
    const value = { ...candidate, revision: (current?.revision ?? 0) + 1 };
    draft.devices ??= [];
    const index = draft.devices.findIndex(
      (entry) => entry.deviceId === candidate.deviceId,
    );
    if (index < 0) draft.devices.push(value);
    else draft.devices[index] = value;
    return structuredClone(value);
  }
  putWorkstation(input: WorkstationBinding): Promise<WorkstationBinding> {
    return this.transaction((draft) => {
      const current = draft.workstation;
      if (input.revision !== (current?.revision ?? 0))
        throw new RobotArmError(
          'STALE_WORKSTATION',
          'Reload the current workstation before saving',
          409,
        );
      for (const [key, id] of [
        ['robots', input.robotProfileId],
        ['tools', input.toolProfileId],
        ['screens', input.screenProfileId],
      ] as const)
        if (!draft[key].some((profile) => profile.id === id))
          throw new RobotArmError(
            'PROFILE_NOT_FOUND',
            `Unknown workstation ${key} binding`,
            404,
          );
      if (
        typeof input.cameraId !== 'string' ||
        typeof input.calibrationProfileId !== 'string'
      )
        throw new RobotArmError(
          'INVALID_WORKSTATION',
          'Camera and calibration IDs must be strings',
        );
      if (
        input.calibrationProfileId &&
        !draft.calibrations.some(
          (calibration) =>
            calibration.id === input.calibrationProfileId &&
            calibration.robotProfileId === input.robotProfileId &&
            calibration.toolProfileId === input.toolProfileId &&
            calibration.screenProfileId === input.screenProfileId,
        )
      )
        throw new RobotArmError(
          'CALIBRATION_BINDING_MISMATCH',
          'Calibration belongs to different profiles',
          409,
        );
      const sameScreen = current?.screenProfileId === input.screenProfileId;
      const vision =
        sameScreen && current?.cameraId === input.cameraId
          ? current.vision
          : undefined;
      const value: WorkstationBinding = {
        robotProfileId: input.robotProfileId,
        toolProfileId: input.toolProfileId,
        screenProfileId: input.screenProfileId,
        calibrationProfileId: input.calibrationProfileId,
        cameraId: input.cameraId,
        vision,
        revision: (current?.revision ?? 0) + 1,
      };
      if (
        current &&
        semanticJson({ ...current, revision: 0 }) ===
          semanticJson({ ...value, revision: 0 })
      )
        return current;
      draft.workstation = value;
      return value;
    });
  }
  confirmVision(
    vision: NonNullable<WorkstationBinding['vision']>,
    expectedRevision: number,
  ): Promise<void> {
    return this.transaction((draft) => {
      const binding = draft.workstation;
      if (
        !binding ||
        binding.revision !== expectedRevision ||
        binding.cameraId !== vision.cameraId
      )
        throw new RobotArmError(
          'STALE_WORKSTATION',
          'Workstation changed while confirming the preview',
          409,
        );
      const screen = draft.screens.find(
        (s) => s.id === binding.screenProfileId,
      )!;
      const calibration = draft.calibrations.find(
        (c) => c.id === binding.calibrationProfileId,
      );
      if (
        calibration?.phoneFrame &&
        (!screen.phoneMapping ||
          screen.phoneMapping.visionFingerprint !== vision.fingerprint)
      )
        throw new RobotArmError(
          'MAPPING_REQUIRED',
          'Detect phone markers again before confirming the changed camera mapping',
        );
      binding.vision = vision;
      binding.revision++;
    });
  }
  positionChanged(target: 'camera' | 'robot' | 'screen'): Promise<void> {
    return this.transaction((draft) => {
      const binding = draft.workstation;
      if (!binding)
        throw new RobotArmError(
          'WORKSTATION_REQUIRED',
          'Configure the workstation first',
          409,
        );
      if (target !== 'robot') binding.vision = undefined;
      if (target !== 'camera') {
        const profile =
          target === 'robot'
            ? draft.robots.find((item) => item.id === binding.robotProfileId)
            : draft.screens.find((item) => item.id === binding.screenProfileId);
        if (!profile)
          throw new RobotArmError(
            'PROFILE_NOT_FOUND',
            'Moved installation profile is missing',
            404,
          );
        profile.geometryRevision++;
        profile.revision++;
        profile.updatedAt = new Date().toISOString();
        for (const calibration of draft.calibrations) {
          if (
            target === 'robot'
              ? calibration.robotProfileId !== profile.id
              : calibration.screenProfileId !== profile.id
          )
            continue;
          calibration.geometryStatus = 'invalid';
          calibration.invalidReason = `${target} physically moved`;
          calibration.revision++;
        }
      }
      binding.revision++;
    });
  }
  private get<T extends { id: string }>(items: T[], id: string): T {
    const p = items.find((p) => p.id === id);
    if (!p)
      throw new RobotArmError(
        'PROFILE_NOT_FOUND',
        `Profile '${id}' not found`,
        404,
      );
    return structuredClone(p);
  }
  getRobot(id: string): RobotArmProfile {
    return this.get(this.data.robots, id);
  }
  getTool(id: string): ToolProfile {
    return this.get(this.data.tools, id);
  }
  getScreen(id: string): ScreenProfile {
    return this.get(this.data.screens, id);
  }
  getCalibration(id: string): CalibrationProfile {
    return this.get(this.data.calibrations, id);
  }
  private transaction<T>(
    mutate: (draft: ProfileData) => T,
    guard?: () => void,
  ): Promise<T> {
    const operation = this.serial.then(async () => {
      const draft = structuredClone(this.data);
      guard?.();
      const result = mutate(draft);
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, JSON.stringify(draft, null, 2), 'utf8');
        guard?.();
        const configuration = (data: ProfileData) =>
          JSON.stringify([
            data.robots,
            data.tools,
            data.screens,
            data.calibrations,
            data.workstation,
          ]);
        if (configuration(draft) !== configuration(this.data))
          await backupPreviousFile(this.filePath);
        guard?.();
        await rename(temp, this.filePath);
      } catch (e) {
        await unlink(temp).catch(() => undefined);
        throw e;
      }
      this.data = draft;
      return structuredClone(result);
    });
    this.serial = operation.catch(() => undefined);
    return operation;
  }
  private put<T extends VersionedProfile>(
    key: 'robots' | 'tools' | 'screens',
    input: ProfileInput<T>,
    validate: (v: ProfileInput<T>) => void,
  ): Promise<T> {
    validate(input);
    return this.transaction((d) => {
      const items = d[key] as unknown as T[];
      const index = items.findIndex((p) => p.id === input.id);
      const current = items[index];
      if (current && input.revision !== current.revision)
        throw new RobotArmError(
          'STALE_PROFILE',
          'Expected current Profile revision',
          409,
        );
      if (current) {
        const {
          revision: _currentRevision,
          geometryRevision: _currentGeometry,
          updatedAt: _currentTime,
          ...before
        } = current;
        const {
          revision: _inputRevision,
          geometryRevision: _inputGeometry,
          updatedAt: _inputTime,
          ...after
        } = input as T;
        if (semanticJson(before) === semanticJson(after)) return current;
      }
      const value = {
        ...input,
        revision: (current?.revision ?? 0) + 1,
        geometryRevision: current?.geometryRevision ?? 1,
        updatedAt: new Date().toISOString(),
      } as T;
      const changed = current && geometry(current) !== geometry(value);
      if (changed) value.geometryRevision++;
      if (index >= 0) items[index] = value;
      else items.push(value);
      for (const c of d.calibrations) {
        const matches =
          key === 'robots'
            ? c.robotProfileId === input.id
            : key === 'tools'
              ? c.toolProfileId === input.id
              : c.screenProfileId === input.id;
        if (!matches) continue;
        if (changed) {
          c.geometryStatus = 'invalid';
          c.invalidReason = 'Geometry or connection changed';
          c.revision++;
        }
      }
      return value;
    });
  }
  putRobot(input: ProfileInput<RobotArmProfile>): Promise<RobotArmProfile> {
    return this.put<RobotArmProfile>('robots', input, validateRobot);
  }
  putTool(input: ProfileInput<ToolProfile>): Promise<ToolProfile> {
    return this.put<ToolProfile>('tools', input, validateTool);
  }
  putScreen(input: ProfileInput<ScreenProfile>): Promise<ScreenProfile> {
    return this.put<ScreenProfile>('screens', input, validateScreen);
  }
  saveCalibration(
    c: CalibrationProfile,
    guard?: () => void,
  ): Promise<CalibrationProfile> {
    if (
      c.acceptanceStatus === 'accepted' &&
      !calibrationAccepted({ ...c, geometryStatus: 'valid' })
    )
      throw new RobotArmError(
        'NOT_VERIFIED',
        'Activation requires motion verification and explicit human acceptance',
        409,
      );
    assertSurface(c.surface);
    return this.transaction((d) => {
      const i = d.calibrations.findIndex((p) => p.id === c.id);
      if (i < 0) d.calibrations.push(c);
      else d.calibrations[i] = c;
      return c;
    }, guard);
  }
  saveBatchParking(
    batchId: string,
    profiles: ReadonlyArray<{ id: string; revision: number }>,
    pose: CartesianPose,
    evidence: SharedParkingEvidence,
    guard: () => void,
  ) {
    assertPose(pose);
    return this.transaction((data) => {
      const batch = data.calibrationBatch;
      const manual = 'operatorConfirmedAt' in evidence;
      if (
        !batch ||
        batch.id !== batchId ||
        !profiles.length ||
        (!manual &&
          (!evidence.clear ||
            batch.items.some(
              (item) =>
                !evidence.screens.some((screen) => screen.id === item.deviceId),
            )))
      )
        throw new RobotArmError(
          'STALE_CONTEXT',
          'The batch changed before the shared Safe Position was saved.',
          409,
        );
      const now = new Date().toISOString();
      for (const expected of profiles) {
        const calibration = data.calibrations.find(
          (profile) => profile.id === expected.id,
        );
        if (
          !calibration ||
          calibration.revision !== expected.revision ||
          !calibrationAccepted(calibration, batchId) ||
          calibration.robotProfileId !== batch.robotProfileId ||
          calibration.toolProfileId !== batch.toolProfileId
        )
          throw new RobotArmError(
            'STALE_CONTEXT',
            'A screen calibration changed before the shared Safe Position was saved.',
            409,
          );
        const screen = data.screens.find(
          (profile) => profile.id === calibration.screenProfileId,
        )!;
        const tool = data.tools.find(
          (profile) => profile.id === calibration.toolProfileId,
        )!;
        assertSafeObservation(
          calibration,
          pose,
          tool.offsetMm,
          screen.safeHeightMm,
        );
        if (
          calibration.pendingParkingBatchId ||
          semanticJson(calibration.observationPose) !== semanticJson(pose)
        ) {
          calibration.observationPose = structuredClone(pose);
          calibration.pendingParkingBatchId = undefined;
          calibration.revision++;
          calibration.updatedAt = now;
        }
      }
      batch.sharedSafePosition = structuredClone(pose);
      batch.sharedVisibility = manual ? undefined : structuredClone(evidence);
      batch.sharedParkingOperatorConfirmedAt = manual
        ? evidence.operatorConfirmedAt
        : undefined;
      batch.sharedSafePositionVerified = true;
    }, guard);
  }

  saveSession(
    s: CalibrationSession,
    releaseOperation = false,
    guard?: () => void,
  ): Promise<void> {
    return this.transaction((d) => {
      d.sessions ??= [];
      const i = d.sessions.findIndex((p) => p.id === s.id);
      if (i < 0) d.sessions.push(structuredClone(s));
      else d.sessions[i] = structuredClone(s);
      if (releaseOperation && d.pendingOperation?.requestId === s.id)
        d.pendingOperation = undefined;
    }, guard);
  }
  createCalibrationSession(
    s: CalibrationSession,
    guard: () => void,
  ): Promise<void> {
    return this.transaction((d) => {
      d.sessions ??= [];
      for (const previous of d.sessions) {
        if (
          previous.robotProfileId === s.robotProfileId &&
          previous.toolProfileId === s.toolProfileId &&
          previous.screenProfileId === s.screenProfileId &&
          calibrationSessionStatus(previous) === 'interrupted'
        ) {
          previous.status = 'cancelled';
          previous.stage = 'cancelled';
          previous.revision++;
        }
      }
      d.sessions.push(structuredClone(s));
    }, guard);
  }
  commitCalibration(
    s: CalibrationSession,
    guard?: () => void,
    binding?: DeviceBinding,
  ): Promise<void> {
    const c = s.candidate;
    const context = s.context;
    if (
      !c ||
      !context ||
      !calibrationAccepted(c, s.auto?.deferParkingBatchId) ||
      s.status !== 'completed'
    )
      throw new RobotArmError(
        'NOT_VERIFIED',
        'Complete both verification groups and human confirmations first',
        409,
      );
    return this.transaction((d) => {
      if (
        c.pendingParkingBatchId &&
        d.calibrationBatch?.id !== c.pendingParkingBatchId
      )
        throw new RobotArmError(
          'STALE_CONTEXT',
          'The calibration batch changed before saving this screen.',
          409,
        );
      const current = d.workstation;
      if (
        (current?.revision ?? 0) !== s.context?.workstationRevision ||
        (current &&
          (current.robotProfileId !== s.robotProfileId ||
            current.toolProfileId !== s.toolProfileId ||
            current.screenProfileId !== s.screenProfileId))
      )
        throw new RobotArmError(
          'STALE_WORKSTATION',
          'The selected installation changed before saving calibration',
          409,
        );
      for (const [items, id, revision] of [
        [d.robots, s.robotProfileId, c.robotGeometryRevision],
        [d.tools, s.toolProfileId, c.toolGeometryRevision],
        [d.screens, s.screenProfileId, c.screenGeometryRevision],
      ] as const) {
        if (items.find((p) => p.id === id)?.geometryRevision !== revision)
          throw new RobotArmError(
            'CALIBRATION_INVALID',
            'Geometry changed before saving calibration',
            409,
          );
      }
      const teaching =
        current?.cameraId &&
        d.installationTeachings?.find(
          (t) =>
            t.cameraId === current.cameraId &&
            t.robotProfileId === s.robotProfileId &&
            t.toolProfileId === s.toolProfileId &&
            t.robotGeometryRevision === c.robotGeometryRevision &&
            t.toolGeometryRevision === c.toolGeometryRevision,
        );
      if (
        verificationContextKey({
          installationTeaching: teaching || undefined,
          minimumTravelTipZMm: teaching
            ? contactPoint(
                teaching.referencePose,
                d.tools.find((p) => p.id === s.toolProfileId)!.offsetMm,
              ).z
            : undefined,
          robot: d.robots.find((p) => p.id === s.robotProfileId)!,
          tool: d.tools.find((p) => p.id === s.toolProfileId)!,
          screen: d.screens.find((p) => p.id === s.screenProfileId)!,
        }) !== context.verificationKey
      )
        throw new RobotArmError(
          'VERIFICATION_CONTEXT_CHANGED',
          'Verification settings changed before saving',
          409,
        );
      const i = d.calibrations.findIndex((p) => p.id === c.id);
      if (i < 0) d.calibrations.push(structuredClone(c));
      else d.calibrations[i] = structuredClone(c);
      d.workstation = {
        ...current,
        robotProfileId: s.robotProfileId,
        toolProfileId: s.toolProfileId,
        screenProfileId: s.screenProfileId,
        cameraId: current?.cameraId ?? '',
        calibrationProfileId: c.id,
        revision: (current?.revision ?? 0) + 1,
      };
      if (binding) {
        if (
          binding.calibrationProfileId !== c.id ||
          binding.cameraId !== current?.cameraId
        )
          throw new RobotArmError(
            'PROFILE_MISMATCH',
            'Device does not match this calibration',
            409,
          );
        this.bindAcceptedDevice(d, binding, s.auto?.deferParkingBatchId);
      }
      d.sessions ??= [];
      const j = d.sessions.findIndex((p) => p.id === s.id);
      if (j < 0) d.sessions.push(structuredClone(s));
      else d.sessions[j] = structuredClone(s);
      if (d.pendingOperation?.requestId === s.id)
        d.pendingOperation = undefined;
    }, guard);
  }
  invalidate(id: string, reason = 'Screen physically moved'): Promise<void> {
    return this.transaction((d) => {
      const c = d.calibrations.find((p) => p.id === id);
      if (!c)
        throw new RobotArmError(
          'PROFILE_NOT_FOUND',
          'Calibration not found',
          404,
        );
      c.geometryStatus = 'invalid';
      c.invalidReason = reason;
      c.revision++;
    });
  }
}
