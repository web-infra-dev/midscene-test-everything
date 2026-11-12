import { randomUUID } from 'node:crypto';
import {
  CALIBRATION_MARKERS,
  CALIBRATION_MARKER_CODES,
  type CalibrationPageLayout,
  type CalibrationPageUpdate,
  type CalibrationPhoneStatus,
  type WebPoint,
  CALIBRATION_PHONE_POLICY as policy,
} from '@midscene/robotics-shared/assisted-contracts';
import { RobotArmError } from '@midscene/robotics-shared/contracts';

export function validateLayout(layout: CalibrationPageLayout): void {
  if (
    !layout ||
    !Number.isInteger(layout.revision) ||
    layout.revision < 1 ||
    ![layout.width, layout.height].every(
      (n) => Number.isInteger(n) && n >= 180 && n <= 4096,
    ) ||
    !layout.screen ||
    ![layout.screen.width, layout.screen.height].every(
      (n) => Number.isInteger(n) && n >= 180 && n <= 4096,
    ) ||
    !Number.isFinite(layout.screen.devicePixelRatio) ||
    layout.screen.devicePixelRatio <= 0 ||
    (layout.topInset !== undefined &&
      (!Number.isFinite(layout.topInset) ||
        layout.topInset < 0 ||
        layout.topInset > Math.max(0, layout.screen.height - layout.height))) ||
    !Array.isArray(layout.markers) ||
    layout.markers.length !== CALIBRATION_MARKER_CODES.length
  )
    throw new RobotArmError(
      'INVALID_PAGE_LAYOUT',
      'Reload the phone calibration page to report valid viewport and full-screen dimensions',
    );
  layout.markers.forEach((m, i) => {
    if (
      m.code !== CALIBRATION_MARKER_CODES[i] ||
      m.purpose !== CALIBRATION_MARKERS[i].purpose ||
      ![m.x, m.y, m.size].every(Number.isFinite) ||
      m.size < 20 ||
      m.size > 100 ||
      m.x < m.size / 2 ||
      m.y < m.size / 2 ||
      m.x > layout.width - m.size / 2 ||
      m.y > layout.height - m.size / 2
    )
      throw new RobotArmError(
        'INVALID_PAGE_LAYOUT',
        'Keep all six calibration markers visible; reload the phone page',
      );
  });
}
export function sameLayout(
  a: CalibrationPageLayout,
  b: CalibrationPageLayout,
): boolean {
  return a.revision === b.revision && sameLayoutGeometry(a, b);
}
/** Page revisions are local to a page lifetime, not persisted geometry. */
export function sameLayoutGeometry(
  a: CalibrationPageLayout,
  b: CalibrationPageLayout,
): boolean {
  return (
    a.topInset === b.topInset &&
    a.width === b.width &&
    a.height === b.height &&
    a.screen.width === b.screen.width &&
    a.screen.height === b.screen.height &&
    a.screen.devicePixelRatio === b.screen.devicePixelRatio &&
    a.markers.length === b.markers.length &&
    a.markers.every((marker, i) => {
      const other = b.markers[i];
      return (
        marker.code === other.code &&
        marker.purpose === other.purpose &&
        marker.x === other.x &&
        marker.y === other.y &&
        marker.size === other.size
      );
    })
  );
}
/** The phone can report touches; it cannot initiate motion or provide fit results. */
export class CalibrationPhoneSession {
  private newestPageId?: string;
  private pageId?: string;
  openPage(): string {
    this.newestPageId = randomUUID();
    return this.newestPageId;
  }
  private sequence = -1;
  private pageLayoutRevision = 0;
  lastSeen = 0;
  update?: CalibrationPageUpdate;
  receive(input: CalibrationPageUpdate, now = Date.now()): boolean {
    if (
      !input ||
      typeof input.pageId !== 'string' ||
      !input.pageId ||
      input.pageId.length > 100 ||
      !Number.isSafeInteger(input.sequence) ||
      input.sequence < 1 ||
      typeof input.visible !== 'boolean'
    )
      throw new RobotArmError(
        'STALE_PHONE_UPDATE',
        'Reload the calibration page',
        409,
      );
    if (input.pageId !== this.pageId && input.pageId !== this.newestPageId)
      throw new RobotArmError(
        'PHONE_PAGE_REPLACED',
        'Another calibration page is active.',
        410,
      );
    if (input.pageId === this.pageId && input.sequence <= this.sequence)
      throw new RobotArmError(
        'STALE_PHONE_UPDATE',
        'An outdated phone update was ignored',
        409,
      );
    if (
      input.touchEvents !== undefined &&
      (!Array.isArray(input.touchEvents) ||
        input.touchEvents.length > 40 ||
        input.touchEvents.some(
          (e) =>
            !e ||
            !Number.isSafeInteger(e.sequence) ||
            e.sequence < 1 ||
            !Number.isFinite(e.elapsedMs) ||
            e.elapsedMs < 0 ||
            ![
              'touchstart',
              'touchend',
              'touchcancel',
              'pointerdown',
              'pointerup',
              'pointercancel',
              'lostpointercapture',
              'target-reset',
              'step-feedback',
            ].includes(e.kind) ||
            [e.targetId, e.stepId, e.detail, e.targetElement].some(
              (v) =>
                v !== undefined && (typeof v !== 'string' || v.length > 100),
            ) ||
            (e.source !== undefined &&
              !['document', 'surface'].includes(e.source)) ||
            [e.defaultPrevented, e.defaultPreventedAfterDispatch].some(
              (v) => v !== undefined && typeof v !== 'boolean',
            ) ||
            [e.nativeTimestampMs, e.dispatchDelayMs].some(
              (v) => v !== undefined && (!Number.isFinite(v) || v < 0),
            ) ||
            (e.point !== undefined &&
              (!e.point ||
                !Number.isFinite(e.point.x) ||
                !Number.isFinite(e.point.y))),
        ))
    )
      throw new RobotArmError(
        'INVALID_PHONE_TOUCH',
        'Invalid touch diagnostics',
      );
    if (
      input.touchDiagnosticsVersion !== undefined &&
      input.touchDiagnosticsVersion !== 2
    )
      throw new RobotArmError(
        'INVALID_PHONE_TOUCH',
        'Invalid touch diagnostics version',
      );
    validateLayout(input.layout);
    const validPoint = (p: WebPoint) =>
      p &&
      [p.x, p.y].every(Number.isFinite) &&
      p.x >= 0 &&
      p.y >= 0 &&
      p.x < input.layout.width &&
      p.y < input.layout.height;
    if (input.stepFeedback) {
      const r = input.stepFeedback;
      if (
        typeof r.id !== 'string' ||
        !r.id ||
        r.id.length > 100 ||
        !['prepare', 'result'].includes(r.phase) ||
        !['ready', 'no_touch', 'touched', 'unknown'].includes(r.outcome) ||
        (r.contactMode !== undefined && r.contactMode !== 'current') ||
        (r.outcome === 'unknown'
          ? r.reason !== 'multiple_contacts'
          : r.reason !== undefined) ||
        (r.outcome === 'ready' && r.phase !== 'prepare') ||
        (r.outcome === 'no_touch' && r.phase !== 'result') ||
        (r.outcome === 'touched'
          ? !validPoint(r.point!)
          : r.point !== undefined)
      )
        throw new RobotArmError(
          'INVALID_PHONE_TOUCH',
          'Invalid probe step result',
        );
    }
    if (
      input.contactStart &&
      (!validPoint(input.contactStart.point) ||
        [input.contactStart.id, input.contactStart.targetId].some(
          (id) => typeof id !== 'string' || !id || id.length > 100,
        ))
    )
      throw new RobotArmError('INVALID_PHONE_TOUCH', 'Invalid initial contact');
    if (
      input.contact &&
      (!validPoint(input.contact.point) ||
        typeof input.contact.id !== 'string' ||
        !input.contact.id ||
        input.contact.id.length > 100 ||
        !Number.isSafeInteger(input.contact.motionRevision) ||
        input.contact.motionRevision < 0)
    )
      throw new RobotArmError('INVALID_PHONE_TOUCH', 'Invalid phone contact');
    if (
      input.touches &&
      (!Array.isArray(input.touches) ||
        input.touches.length > 8 ||
        input.touches.some(
          (t) =>
            !validPoint(t.point) ||
            typeof t.targetId !== 'string' ||
            t.targetId.length > 100 ||
            !Number.isFinite(t.durationMs) ||
            t.durationMs <= 0 ||
            !Number.isFinite(t.travelPx) ||
            t.travelPx < 0,
        ))
    )
      throw new RobotArmError(
        'INVALID_PHONE_TOUCH',
        'Invalid phone touch measurements',
      );
    if (
      input.captureAck !== undefined &&
      (typeof input.captureAck !== 'string' || input.captureAck.length > 100)
    )
      throw new RobotArmError(
        'INVALID_PHONE_TOUCH',
        'Invalid point confirmation',
      );
    const reloaded = this.pageId !== undefined && this.pageId !== input.pageId;
    // Browser revisions start over on each load. Keep the mapping revision
    // stable across a handoff only when the measured geometry still matches.
    const previousLayout = this.update?.layout;
    const changed =
      previousLayout &&
      (!sameLayoutGeometry(previousLayout, input.layout) ||
        (!reloaded && this.pageLayoutRevision !== input.layout.revision));
    this.pageLayoutRevision = input.layout.revision;
    this.pageId = input.pageId;
    this.sequence = input.sequence;
    this.lastSeen = now;
    this.update = structuredClone(input);
    if (previousLayout)
      this.update.layout.revision = previousLayout.revision + (changed ? 1 : 0);
    return reloaded;
  }
  connected(now = Date.now()): boolean {
    return (
      now - this.lastSeen < policy.measurementFreshMs &&
      this.update?.visible === true
    );
  }
  presence(now = Date.now()): CalibrationPhoneStatus['state'] {
    if (!this.update) return 'waiting';
    if (now - this.lastSeen >= policy.displayFreshMs) return 'reconnecting';
    return this.update.visible ? 'connected' : 'paused';
  }
  available(now = Date.now()): boolean {
    return (
      this.update?.visible === true &&
      now - this.lastSeen < policy.displayFreshMs
    );
  }
  assertAvailable(): CalibrationPageUpdate {
    if (!this.available())
      throw new RobotArmError(
        'PHONE_UNAVAILABLE',
        'Open the phone page and retry this step',
        409,
      );
    return this.update!;
  }
  assertConnected(): CalibrationPageUpdate {
    if (!this.connected())
      throw new RobotArmError(
        'PHONE_DISCONNECTED',
        'Keep the phone calibration page visible and connected',
        409,
      );
    return this.update!;
  }
}
