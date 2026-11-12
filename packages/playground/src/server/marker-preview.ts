import { randomUUID } from 'node:crypto';
import type { CameraSessionManager } from '@midscene/arm-kit';
import { PhoneSocketServer } from '@midscene/arm-kit/internal/calibration-server/phone-socket';
import {
  calibrationPhonePage,
  phoneMarkerElements,
} from '@midscene/arm-kit/internal/calibration/phone/page';
import { CalibrationPhoneSession } from '@midscene/arm-kit/internal/calibration/phone/session';
import {
  captureScreenMarkers,
  screenBoundsProblem,
} from '@midscene/arm-kit/internal/camera/calibration-markers';
import { CALIBRATION_MARKER_CODES } from '@midscene/robotics-shared/assisted-contracts';

/** One bound phone page and one observing camera; capture never changes the camera correction. */
export class MarkerPreview {
  readonly token = randomUUID();
  lastViewed = Date.now();
  readonly phoneSocket;
  private readonly phone;
  private readonly codes;
  private mappedPageKey?: string;
  private request = randomUUID();
  private pairing?: {
    pageId: string;
    savedToken?: string;
    newToken: string;
    handoffToken?: string;
  };
  get lastPairing() {
    return this.pairing;
  }
  get activePairing() {
    return !this.closed && this.phone.presence() === 'connected'
      ? this.pairing
      : undefined;
  }
  cancelHandoff() {
    if (this.pairing) this.pairing.handoffToken = undefined;
  }
  private closed = false;
  private capturing = false;
  constructor(
    readonly cameraId: string,
    readonly slot: number,
  ) {
    // Reserve 10–15 for the SDK calibration page; use the old workstation's distinct ID sets.
    this.codes = CALIBRATION_MARKER_CODES.map((code) => code + slot * 10);
    const phone = new CalibrationPhoneSession(this.codes);
    this.phone = phone;
    this.phoneSocket = new PhoneSocketServer({
      receivePhone: (update) => {
        const { savedScreenToken, ...observation } = update as typeof update & {
          savedScreenToken?: unknown;
        };
        phone.receive(observation);
        if (this.pairing?.pageId !== update.pageId)
          this.pairing = {
            pageId: update.pageId,
            savedToken:
              typeof savedScreenToken === 'string'
                ? savedScreenToken
                : undefined,
            newToken: randomUUID(),
          };
        // The session normalizes layout revisions across phone reloads.
        if (this.mappedPageKey && this.mappedPageKey !== this.status().pageKey)
          this.mappedPageKey = undefined;
      },
      phoneView: () => ({
        view: this.mappedPageKey ? 'touch-preview' : 'markers',
        markerRequest: this.request,
        pairingToken: this.pairing?.handoffToken,
        anchors: [],
      }),
      phoneHeartbeat: () => {
        phone.lastSeen = Date.now();
        this.lastViewed = phone.lastSeen;
      },
      disconnectPhone: () => {
        phone.lastSeen = 0;
        this.cancelHandoff();
        this.mappedPageKey = undefined;
      },
    });
  }
  renewPage() {
    return {
      pageId: this.phone.openPage(),
      markers: phoneMarkerElements(this.codes),
    };
  }
  page() {
    return calibrationPhonePage(
      this.phone.openPage(),
      this.codes,
      undefined,
      true,
    );
  }
  status() {
    const update = this.phone.update;
    const visible = this.phone.presence() === 'connected';
    const requirement = this.phone.displayRequirement();
    const geometryIssue = update && screenBoundsProblem(update.layout);
    const ready =
      this.phone.connected() &&
      update &&
      !geometryIssue &&
      ((update.markersPainted && update.markerRequest === this.request) ||
        this.mappedPageKey);
    return {
      state: ready
        ? 'ready'
        : visible
          ? (requirement ?? (geometryIssue ? 'bounds' : 'preparing'))
          : this.phone.presence(),
      pageKey: ready
        ? `${update.pageId}/${update.layout.revision}/${this.request}`
        : undefined,
    };
  }
  showMarkers() {
    this.cancelHandoff();
    this.request = randomUUID();
    this.lastViewed = Date.now();
    this.mappedPageKey = undefined;
  }
  assertCaptured(pageKey: unknown) {
    if (
      this.closed ||
      typeof pageKey !== 'string' ||
      this.mappedPageKey !== pageKey ||
      this.status().pageKey !== pageKey
    )
      throw Object.assign(
        new Error(
          'The phone page or layout changed. Detect the markers again.',
        ),
        { status: 409 },
      );
    return this.phone.assertConnected().layout;
  }
  async capture(
    cameras: CameraSessionManager,
    pageKey: string | null,
    signal: AbortSignal,
  ) {
    const check = () => {
      signal.throwIfAborted();
      if (
        this.closed ||
        !this.phone.update?.markersPainted ||
        !pageKey ||
        this.status().pageKey !== pageKey
      )
        throw Object.assign(
          new Error('The marker page changed. Keep it visible in full screen.'),
          { status: 409 },
        );
    };
    check();
    if (this.capturing)
      throw Object.assign(new Error('Marker capture in progress'), {
        status: 409,
      });
    this.capturing = true;
    try {
      const layout = this.phone.assertConnected().layout;
      const camera = await cameras.acquire(this.cameraId, this.token);
      try {
        const result = await captureScreenMarkers(() => {
          check();
          return camera.rawFrame();
        }, layout);
        check();
        this.mappedPageKey = this.status().pageKey;
        return {
          ...result,
          evidence: { token: this.token, pageKey: this.mappedPageKey },
          screenWidthPx: Math.round(
            layout.screen.width * layout.screen.devicePixelRatio,
          ),
          screenHeightPx: Math.round(
            layout.screen.height * layout.screen.devicePixelRatio,
          ),
          rotation: 0 as const,
        };
      } finally {
        await cameras.release(this.cameraId, this.token);
      }
    } finally {
      this.capturing = false;
    }
  }
  close(ended = false) {
    this.closed = true;
    this.phoneSocket.close(ended ? 'Preview ended' : undefined);
  }
}
