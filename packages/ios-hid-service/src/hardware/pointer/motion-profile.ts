import { createHash } from 'node:crypto';
import type { DeviceConfig, Point } from '../types.js';
import type { AbsolutePointerCorrection, PointerTurn } from './mapping.js';
import type { PointerMotionModel } from './motion-model.js';

// Measured report tables replace two-point quadratic curves.
export const MOTION_VERSION = 3;
export const REPORT_INTERVAL_MS = 16;
export const DRAG_REPORT_LIMIT = 8;
export const MEASURED_REPORT_LIMIT = 8;
export const CALIBRATION_REPORTS = [
  ...[8, 6, 4, 2].flatMap((units) =>
    ['x', 'y'].map((axis) => ({
      delta: { x: axis === 'x' ? units : 0, y: axis === 'y' ? units : 0 },
      reports: units === 8 ? 12 : units === 6 ? 16 : units === 4 ? 32 : 64,
    })),
  ),
  ...[4, 2].map((units) => ({
    delta: { x: units, y: units },
    reports: units === 4 ? 24 : 48,
  })),
];

export interface MotionSample {
  delta: Point;
  reports: number;
  displacement: Point;
  elapsedMs: number;
  repetitions?: { displacement: Point; elapsedMs: number }[];
}
export interface MotionValidation {
  samples: MotionSample[];
  maxErrorPx: number;
  maxRelativeError: number;
  checkedAt: string;
}
export interface PointerMotionProfile {
  version: number;
  absoluteCorrection?: AbsolutePointerCorrection;
  binding: string;
  width: number;
  height: number;
  turn: PointerTurn;
  reportIntervalMs: number;
  measuredReportLimit: number;
  dragReportLimit: number;
  model: PointerMotionModel;
  samples: MotionSample[];
  validation: MotionValidation;
  measuredAt: string;
}

// Object key order must not invalidate otherwise identical camera geometry.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export function motionBinding(
  config: DeviceConfig,
  geometry: { width: number; height: number; turn: PointerTurn },
): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonical({
          peer: config.bluetoothPeerId,
          screen: config.screen,
          camera: config.screen.source === 'camera' ? config.camera : undefined,
          ...geometry,
        }),
      ),
    )
    .digest('hex');
}

/** Only reuse a measured profile that matches the current hardware binding. */
export function compatibleMotionProfile(
  profile: PointerMotionProfile | undefined,
  binding: string,
): profile is PointerMotionProfile {
  if (
    !profile ||
    profile.version !== MOTION_VERSION ||
    profile.binding !== binding
  )
    return false;
  const validPoint = (p: Point) => p && [p.x, p.y].every(Number.isFinite);
  const validSamples = (samples: MotionSample[]) =>
    Array.isArray(samples) &&
    samples.length > 0 &&
    samples.length <= 32 &&
    samples.every(
      (s) =>
        s &&
        validPoint(s.delta) &&
        validPoint(s.displacement) &&
        Number.isInteger(s.reports) &&
        s.reports > 0 &&
        s.reports <= 100 &&
        Number.isFinite(s.elapsedMs) &&
        s.elapsedMs >= 0 &&
        Math.hypot(s.delta.x, s.delta.y) > 0 &&
        Math.hypot(s.delta.x, s.delta.y) <= MEASURED_REPORT_LIMIT,
    );
  return (
    profile.reportIntervalMs === REPORT_INTERVAL_MS &&
    profile.measuredReportLimit === MEASURED_REPORT_LIMIT &&
    profile.dragReportLimit === DRAG_REPORT_LIMIT &&
    [profile.width, profile.height].every(
      (n) => Number.isInteger(n) && n > 0,
    ) &&
    [0, 1, 2, 3].includes(profile.turn) &&
    Array.isArray(profile.model?.reports) &&
    profile.model.reports.length === CALIBRATION_REPORTS.length &&
    CALIBRATION_REPORTS.every(({ delta }) => {
      const reports = profile.model.reports.filter(
        (point) => point.delta?.x === delta.x && point.delta?.y === delta.y,
      );
      if (reports.length !== 1) return false;
      const d = reports[0].displacement;
      return (
        validPoint(d) &&
        (delta.x ? d.x > 0 : d.x === 0) &&
        (delta.y ? d.y > 0 : d.y === 0)
      );
    }) &&
    validSamples(profile.samples) &&
    profile.samples.length === CALIBRATION_REPORTS.length &&
    Boolean(profile.validation) &&
    validSamples(profile.validation.samples) &&
    profile.validation.samples.length === 3 &&
    Number.isFinite(profile.validation.maxErrorPx) &&
    profile.validation.maxErrorPx >= 0 &&
    Number.isFinite(profile.validation.maxRelativeError) &&
    profile.validation.maxRelativeError >= 0 &&
    (profile.validation.maxErrorPx <= 4 ||
      profile.validation.maxRelativeError <= 0.08) &&
    Number.isFinite(Date.parse(profile.validation.checkedAt)) &&
    Number.isFinite(Date.parse(profile.measuredAt))
  );
}
