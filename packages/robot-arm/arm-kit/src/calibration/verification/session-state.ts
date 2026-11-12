import type { ApplicationContext } from '../../application/context.js';
import {
  type BoundaryVerification,
  type CalibrationSession,
  semanticJson,
} from '../../contracts.js';

export const emptyBoundaryVerification = (): BoundaryVerification => ({
  contactCorners: false,
  hoverCorners: false,
  hoverEdges: false,
  hoverHuman: false,
});

export function calibrationSessionStatus(s: CalibrationSession) {
  return s.status;
}

export function resetCalibrationVerification(s: CalibrationSession) {
  s.boundary ??= emptyBoundaryVerification();
  s.boundary.hoverCorners = false;
  s.boundary.hoverEdges = false;
  s.boundary.hoverHuman = false;
  s.boundary.contactEdges = false;
  s.boundary.contactCorners = false;
  if (s.auto) s.auto.observationRecorded = false;
  s.tapResult = undefined;
  s.progress = undefined;
  if (s.candidate) {
    s.candidate.acceptanceStatus = 'pending';
    s.candidate.verification = undefined;
  }
}

export function verificationContextKey(ctx: ApplicationContext) {
  const s = ctx.screen;
  return semanticJson([
    s.safeHeightMm,
    s.pressDepthMm,
    s.actionSpeed,
    s.actionAcceleration,
    s.contactMs,
    s.motionTimeoutMs,
    ctx.tool.payload,
    ctx.installationTeaching?.id,
    ctx.minimumTravelTipZMm,
  ]);
}

export function sameCalibrationGeometry(
  s: CalibrationSession,
  ctx: ApplicationContext,
  adapterId: string,
  connectionIdentity: string,
) {
  const c = s.context;
  return Boolean(
    c &&
      c.adapterId === adapterId &&
      c.connectionIdentity === connectionIdentity &&
      c.robotGeometryRevision === ctx.robot.geometryRevision &&
      c.toolGeometryRevision === ctx.tool.geometryRevision &&
      c.screenGeometryRevision === ctx.screen.geometryRevision,
  );
}
