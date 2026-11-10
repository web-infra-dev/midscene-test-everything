import { createHash } from 'node:crypto';
import type { DeviceConfig, Point } from '../types.js';
import type { PointerTurn } from './mapping.js';
import type { PointerMotionModel } from './motion-model.js';

export const MOTION_VERSION = 1;
export const REPORT_INTERVAL_MS = 16;
export const DRAG_REPORT_LIMIT = 8;
export const MEASURED_REPORT_LIMIT = 14;

export interface MotionSample {
  delta: Point;
  reports: number;
  displacement: Point;
  elapsedMs: number;
}
export interface MotionValidation {
  samples: MotionSample[];
  maxErrorPx: number;
  maxRelativeError: number;
  checkedAt: string;
}
export interface PointerMotionProfile {
  version: number;
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

/** Disk data is a cache, never permission to skip runtime measurement. */
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
    ['x', 'y'].every((axis) => {
      const curve = profile.model?.[axis as 'x' | 'y'];
      return (
        curve &&
        Number.isFinite(curve.a) &&
        curve.a > 0 &&
        Number.isFinite(curve.b) &&
        curve.b >= 0
      );
    }) &&
    validSamples(profile.samples) &&
    profile.samples.length >= 4 &&
    Boolean(profile.validation) &&
    validSamples(profile.validation.samples) &&
    Number.isFinite(profile.validation.maxErrorPx) &&
    profile.validation.maxErrorPx >= 0 &&
    Number.isFinite(profile.validation.maxRelativeError) &&
    profile.validation.maxRelativeError >= 0 &&
    Number.isFinite(Date.parse(profile.measuredAt))
  );
}
