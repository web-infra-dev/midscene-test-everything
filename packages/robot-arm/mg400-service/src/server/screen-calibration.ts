import { randomInt, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type CameraCorrection, RobotArmError } from '@midscene/arm-kit';
import type { CalibrationHost } from '@midscene/arm-kit/internal/calibration-server/host';
import { PhoneSocketServer } from '@midscene/arm-kit/internal/calibration-server/phone-socket';
import {
  calibrationPhonePage,
  phoneMarkerElements,
} from '@midscene/arm-kit/internal/calibration/phone/page';
import {
  CalibrationPhoneSession,
  sameLayout,
} from '@midscene/arm-kit/internal/calibration/phone/session';
import { recognizeScreenMarkers } from '@midscene/arm-kit/internal/camera/calibration-markers';
import { MarkerCalibrationDetector } from '@midscene/arm-kit/internal/camera/screen-marker-detector';
import { controllerRuntime } from '@midscene/arm-kit/internal/controller-runtime';
import {
  CALIBRATION_PHONE_POLICY,
  type CalibrationPageReply,
  type CalibrationPageUpdate,
} from '@midscene/robotics-shared/assisted-contracts';
import {
  MARKER_CALIBRATION_PROTOCOL,
  MAX_MARKER_CALIBRATION_TARGETS,
  type MarkerCalibrationCreateResult,
  type MarkerCalibrationDetectionResponse,
  type MarkerCalibrationTarget,
  type ScreenDeviceSummary,
  type TargetDisplaySession,
} from '@midscene/robotics-shared/marker-contracts';
import { nextScreenName } from '../screen-naming.js';
import type { PlaygroundDevices } from './devices.js';
import { phoneFingerprint } from './preview-perspectives.js';
export { nextScreenName } from '../screen-naming.js';

type SavedPage = {
  id: string;
  pageKey: string;
  token: string;
  name: string;
  cameraId?: string;
  targetId?: string;
};
interface MarkerSession extends MarkerCalibrationCreateResult {
  cameraId: string;
  requests: Map<string, string>;
  frames: MarkerCalibrationDetectionResponse['frames'];
  corrections: Map<string, CameraCorrection>;
  observations: Map<string, CalibrationPageUpdate>;
  detecting: boolean;
  applied: Map<string, string | undefined>;
}
function screenPageLabel(id: string) {
  return id.replaceAll('-', '').slice(0, 6).toUpperCase();
}

function defaultScreenName(ua: string, id: string, browserPlatform?: string) {
  if (
    /HarmonyOS|OpenHarmony|ArkWeb/i.test(ua) ||
    (typeof browserPlatform === 'string' &&
      /^(HarmonyOS|OpenHarmony)$/i.test(browserPlatform))
  )
    return `HarmonyOS · ${screenPageLabel(id)}`;
  const model = /Android[^;)]*;\s*(?:[a-z]{2}[-_][A-Z]{2};\s*)?([^;)]+)/i
    .exec(ua)?.[1]
    .replace(/\s+Build\/.*$/i, '')
    .trim();
  const platforms = [
    [/iPhone/i, 'iPhone'],
    [/iPad/i, 'iPad'],
    [/Android/i, 'Android'],
  ] as const;
  const platform = platforms.find(([pattern]) => pattern.test(ua))?.[1];
  const hint =
    (model && !/^(K|wv|Mobile|Tablet)$/i.test(model) ? model : platform) ??
    'Screen';
  return `${hint.slice(0, 31)} · ${screenPageLabel(id)}`;
}

/** A phone credential stays stable while its role moves between home, markers and mapping. */
class ScreenPage {
  readonly phoneSocket: PhoneSocketServer;
  private readonly home = new CalibrationPhoneSession();
  host?: CalibrationHost;
  mode: 'waiting' | 'markers' | 'mapping' = 'waiting';
  targetDisplayId?: string;
  last?: CalibrationPageUpdate;
  private listeners = new Set<() => void>();
  private selectionTimer?: ReturnType<typeof setTimeout>;
  private unsubscribe?: () => void;
  private operatorReleased = false;
  private browserInstance?: { id: string; visible: boolean; lastSeen: number };
  constructor(
    readonly saved: SavedPage,
    private readonly codes: (id: string) => number[],
  ) {
    this.phoneSocket = new PhoneSocketServer({
      receivePhone: (update) => {
        const previous = this.browserInstance;
        const id = update.browserInstanceId ?? update.pageId;
        if (
          previous &&
          id !== previous.id &&
          !(
            update.visible &&
            (update.claimBrowserInstance === true ||
              update.resumeBrowserInstanceId === previous.id ||
              !previous.visible ||
              Date.now() - previous.lastSeen >=
                CALIBRATION_PHONE_POLICY.displayFreshMs)
          )
        )
          throw new RobotArmError(
            'PHONE_PAGE_REPLACED',
            'This screen is open on another page. Select Use This Page to continue.',
            410,
          );
        if (this.host) this.host.service.receivePhone(update);
        else this.home.receive(update);
        this.last = update;
        this.browserInstance = {
          id,
          visible: update.visible,
          lastSeen: Date.now(),
        };
      },
      phoneHeartbeat: () => {
        if (this.browserInstance) this.browserInstance.lastSeen = Date.now();
        if (this.host) this.host.service.phoneHeartbeat();
        else this.home.lastSeen = Date.now();
      },
      disconnectPhone: (transportLost) => {
        if (this.host) this.host.service.disconnectPhone(transportLost);
        else this.home.lastSeen = 0;
      },
      phoneView: () => this.view(),
      subscribe: (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
    });
  }
  private view(): CalibrationPageReply {
    const view: CalibrationPageReply =
      this.mode !== 'waiting' && this.host
        ? this.host.service.phoneView()
        : { view: 'waiting', anchors: [] };
    return this.selectionTimer &&
      !view.visibilityProbe &&
      !view.boundaryGuide &&
      [
        'waiting',
        'markers',
        'touch-preview',
        'positioning',
        'reference-required',
        'completed',
        'review',
        'interrupted',
      ].includes(view.view)
      ? { ...view, selectionHint: true }
      : view;
  }
  identify(selected: boolean) {
    if (!selected && !this.selectionTimer) return;
    clearTimeout(this.selectionTimer);
    this.selectionTimer = selected
      ? setTimeout(() => this.identify(false), 1600)
      : undefined;
    this.changed();
  }
  markOperatorReleased() {
    this.operatorReleased = true;
  }
  wasReleasedByOperator() {
    return this.operatorReleased;
  }
  assign(
    host: CalibrationHost | undefined,
    mode: ScreenPage['mode'],
    displayId?: string,
  ) {
    const previous = this.host;
    if (previous !== host) {
      previous?.service.disconnectPhone(false);
      this.last = undefined;
      this.home.lastSeen = 0;
      this.phoneSocket.renew();
    }
    this.unsubscribe?.();
    if (host) this.operatorReleased = false;
    this.host = host;
    this.mode = mode;
    this.targetDisplayId = displayId;
    this.unsubscribe = host?.service.subscribe(() => this.changed());
    this.changed();
  }
  changed() {
    for (const listener of this.listeners) listener();
  }
  /** Short identity shared by the host dialog and the page itself. */
  private label() {
    return screenPageLabel(this.saved.id);
  }
  summary(): ScreenDeviceSummary {
    const status = this.host?.service.phoneStatus();
    const connected = this.host
      ? status?.state === 'connected'
      : this.home.presence() === 'connected';
    const layout =
      this.host?.service.setup().layout ?? this.home.update?.layout;
    const view = this.host?.service.phoneView();
    const update = this.last ?? this.host?.service.phoneObservation();
    return {
      id: this.saved.id,
      pageKey: this.saved.pageKey,
      name: this.saved.name,
      label: this.label(),
      cameraId: this.saved.cameraId,
      screenId: this.saved.targetId,
      mode: this.mode,
      language: 'zh',
      width: layout?.width ?? 0,
      height: layout?.height ?? 0,
      visible: Boolean(connected && update?.visible),
      fullscreen: Boolean(
        connected &&
          !status?.displayRequirement &&
          (update?.displayMode === 'fullscreen' ||
            update?.displayMode === 'standalone'),
      ),
      awaitingOriginTap:
        update?.layout.insetDiagnostics?.reason === 'awaiting-origin-tap',
      markersReady: Boolean(
        connected &&
          update?.markersPainted &&
          update.markerRequest === view?.markerRequest,
      ),
      pageInstanceId: update?.pageId,
      targetDisplayId: this.targetDisplayId,
    };
  }
  async handlePhone(req: IncomingMessage, res: ServerResponse) {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (
      req.method !== 'GET' ||
      !['/phone-calibration', '/phone-calibration/'].includes(path)
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    const pageId = this.host
      ? this.host.service.openPhonePage()
      : this.home.openPage();
    // The waiting session validates the default layout. A screen's marker
    // set is only used while the page is attached to that screen's host.
    const codes =
      this.host && this.saved.targetId
        ? this.codes(this.saved.targetId)
        : undefined;
    if (req.headers.accept === 'application/json') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(
        JSON.stringify({
          pageId,
          pageKey: this.saved.pageKey,
          label: this.label(),
          markers: phoneMarkerElements(codes),
        }),
      );
    } else {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      });
      const identity = `<script>try{localStorage.setItem('midscene-screen-page-key',${JSON.stringify(this.saved.pageKey)});localStorage.setItem('midscene-screen-page-token',${JSON.stringify(this.saved.token)})}catch{}</script>`;
      res.end(
        calibrationPhonePage(pageId, codes, this.label()).replace(
          '<head>',
          `<head>${identity}`,
        ),
      );
    }
  }
  close() {
    clearTimeout(this.selectionTimer);
    this.unsubscribe?.();
    this.phoneSocket.close();
  }
}

/** Port of the original camera/target/page workflow, without another Vision service. */
export class ScreenCalibration {
  private sessions = new Map<string, MarkerSession>();
  private displays = new Map<string, TargetDisplaySession>();
  private pages = new Map<string, ScreenPage>();
  private pageHosts = new Set<string>();
  private tickets = new Map<
    string,
    { sessionId: string; targetIds: string[]; expiresAt: number }
  >();
  private connectionTickets = new Map<
    string,
    { cameraId: string; code: string; expiresAt: number }
  >();
  private serial: Promise<unknown> = Promise.resolve();
  private clearSerial: Promise<unknown> = Promise.resolve();
  constructor(private readonly devices: PlaygroundDevices) {}
  addScreen(cameraId: string, name?: string) {
    return this.serialize(() => this.devices.addScreen(cameraId, name));
  }
  private get store() {
    return controllerRuntime(this.devices.arm).profileStore;
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const task = this.serial.then(work);
    this.serial = task.catch(() => undefined);
    return task;
  }
  private serializeClear<T>(work: () => Promise<T>): Promise<T> {
    const task = this.clearSerial.then(work);
    this.clearSerial = task.catch(() => undefined);
    return task;
  }
  private screen(id: string) {
    const target =
      this.devices.screenTarget(id) ??
      this.devices.screens().find((t) => t.id === id);
    if (!target)
      throw new RobotArmError('INVALID_ARGUMENT', 'Screen not found');
    return target;
  }
  private async adoptExistingPages() {
    for (const [id, entry] of this.devices.entries) {
      if (
        !entry.host ||
        this.pageHosts.has(id) ||
        entry.host.service.phoneStatus().state !== 'connected' ||
        this.store.list().screenPages?.some((p) => p.targetId === id)
      )
        continue;
      const target = this.devices.screens().find((screen) => screen.id === id);
      if (!target) continue;
      const url = entry.host.service.phoneStatus().links[0]?.url;
      const token = url && new URL(url).searchParams.get('token');
      if (!token) continue;
      await this.ensureTarget(id);
      const page: SavedPage = {
        id: randomUUID(),
        token,
        pageKey: randomUUID(),
        name: target.name,
        cameraId: target.cameraId,
        targetId: id,
      };
      await this.persistPage(page);
      await this.page(page);
      entry.host.phoneSocket.renew();
    }
  }
  /** A returning phone keeps its exact screen. A new phone can only take an unclaimed default. */
  previewTarget(cameraId: string, phones: string[]) {
    const profiles = this.store.list();
    const pages = profiles.screenPages ?? [];
    const known = pages.find((p) => phones.includes(phoneFingerprint(p.token)));
    if (known?.cameraId && known.cameraId !== cameraId) return undefined;
    const savedScreen =
      known &&
      profiles.screenTargets?.find(
        (s) => !s.archived && s.pageKey === known.pageKey,
      );
    if (savedScreen && known?.targetId && savedScreen.id !== known.targetId)
      return undefined;
    const id = known?.targetId ?? savedScreen?.id ?? cameraId;
    if (!known && this.store.deviceBinding(id)) return undefined;
    const target = this.devices
      .screens()
      .find((s) => s.id === id && s.cameraId === cameraId);
    const key = profiles.screenTargets?.find((s) => s.id === id)?.pageKey;
    const owner = pages.find(
      (p) => p.targetId === id || (key && p.pageKey === key),
    );
    return target &&
      (!owner || owner === known) &&
      (!key || key === known?.pageKey)
      ? id
      : undefined;
  }
  /** Opening a saved screen reconnects its own phone after a service restart. */
  resumeBoundPage(host: CalibrationHost) {
    return this.serialize(async () => {
      const profiles = this.store.list();
      const target = profiles.screenTargets?.find(
        (t) =>
          !t.archived && t.id === host.deviceId && t.cameraId === host.cameraId,
      );
      if (!target?.pageKey) return;
      const saved = profiles.screenPages?.find(
        (p) =>
          p.targetId === target.id &&
          p.cameraId === target.cameraId &&
          p.pageKey === target.pageKey,
      );
      if (!saved) return;
      const page = await this.page(saved);
      const stage = host.service.status()?.stage;
      if (
        page.wasReleasedByOperator() ||
        page.host ||
        page.mode !== 'waiting' ||
        (stage &&
          ![
            'ready',
            'completed',
            'cancelled',
            'interrupted',
            'capture-failed',
          ].includes(stage))
      )
        return;
      host.service.resumePhonePage();
      page.assign(host, 'mapping');
    });
  }
  adoptPreview(
    cameraId: string,
    screenId: string,
    identity: { savedToken?: string; newToken: string },
  ) {
    return this.serialize(async () => {
      await this.adoptExistingPages();
      const tokens = [
        identity.newToken,
        ...(identity.savedToken ? [identity.savedToken] : []),
      ];
      if (
        this.previewTarget(cameraId, tokens.map(phoneFingerprint)) !== screenId
      )
        return undefined;
      const target = this.screen(screenId);
      const known = this.store
        .list()
        .screenPages?.find((p) => tokens.includes(p.token));
      const record = {
        id: known?.id ?? randomUUID(),
        pageKey: known?.pageKey ?? randomUUID(),
        token: known?.token ?? identity.newToken,
        name: known?.name ?? target.name,
        cameraId,
        targetId: target.id,
      };
      const host = await this.devices.ensureHost(target.id);
      this.assertPageIdle(known ? await this.page(known) : undefined, host);
      await this.persistPage(record);
      const page = await this.page(record);
      Object.assign(page.saved, record);
      await this.connectPage(page);
      return record.token;
    });
  }
  private pairing(cameraId: string) {
    for (const [token, value] of this.connectionTickets) {
      if (value.expiresAt <= Date.now()) this.connectionTickets.delete(token);
      else if (value.cameraId === cameraId)
        return {
          path: `/phone-calibration/connect#bind=${token}`,
          code: value.code,
          expiresAt: value.expiresAt,
        };
    }
    const token = randomUUID();
    const value = {
      cameraId,
      code: this.pairingCode(),
      expiresAt: Date.now() + 5 * 60_000,
    };
    this.connectionTickets.set(token, value);
    return {
      path: `/phone-calibration/connect#bind=${token}`,
      code: value.code,
      expiresAt: value.expiresAt,
    };
  }
  private pairingCode() {
    let code: string;
    do {
      code = String(randomInt(100000, 1000000));
    } while (
      [...this.displays.values()].some(
        (display) => display.code === code && display.state !== 'closed',
      ) ||
      [...this.connectionTickets.values()].some(
        (ticket) => ticket.code === code && ticket.expiresAt > Date.now(),
      )
    );
    return code;
  }
  /**
   * The page that claims a screen: by target id, or by the page key the target
   * records. A page keeps its screen while it sits at its home view, so the
   * screen must not look free to the next phone that pairs.
   */
  private screenOwner(screenId: string) {
    const target = (this.store.list().screenTargets ?? []).find(
      (entry) => entry.id === screenId,
    );
    if (!target) return undefined;
    return [...this.pages.values()].find(
      (page) =>
        page.saved.targetId === screenId ||
        (target.pageKey !== undefined && page.saved.pageKey === target.pageKey),
    );
  }
  /** Keeps the screen label and the device label on one name. */
  private async renameBoundScreen(targetId: string, name: string) {
    for (const session of this.sessions.values()) {
      const target = session.targets.find((t) => t.id === targetId);
      if (target) target.name = name;
    }
    await this.store.updateScreenTarget(targetId, { name });
  }
  /** A screen a paired page already shows, so a target never duplicates it. */
  private boundScreen(cameraId: string, taken: readonly string[]) {
    return this.devices
      .screens()
      .find(
        (screen) =>
          screen.cameraId === cameraId &&
          !taken.includes(screen.id) &&
          this.screenOwner(screen.id) !== undefined,
      );
  }
  /**
   * Picks the screen a calibration target covers: the one already named that
   * way, the camera's own target, or the screen a paired page is showing. A new
   * screen is only created when the bench has nothing to reuse, so pairing a
   * device and adding its target cannot leave a duplicate screen behind.
   */
  private async allocateScreen(
    cameraId: string,
    name?: string,
    taken: readonly string[] = [],
  ) {
    const wanted = name?.trim();
    const screens = this.devices
      .screens()
      .filter((screen) => screen.cameraId === cameraId);
    const named = screens.find(
      (screen) =>
        !taken.includes(screen.id) &&
        wanted !== undefined &&
        screen.name.trim().toLocaleLowerCase() === wanted.toLocaleLowerCase(),
    );
    if (named) return named.id;
    const root = screens.find(
      (screen) =>
        screen.id === cameraId &&
        !this.store.list().screenTargets?.some((s) => s.id === screen.id),
    );
    if (root) {
      if (wanted) await this.store.saveScreenTarget({ ...root, name: wanted });
      return root.id;
    }
    const bound = this.boundScreen(cameraId, taken);
    if (bound) {
      // The camera's own target never had an operator-given name, so the step
      // can name it here. A screen a device already carries keeps its name: the
      // phone shows it, and renaming it would relabel a screen the operator
      // just paired.
      const duplicate =
        wanted !== undefined &&
        screens.some(
          (screen) =>
            screen.id !== bound.id &&
            screen.name.trim().toLocaleLowerCase() ===
              wanted.toLocaleLowerCase(),
        );
      if (wanted && bound.id === cameraId && !duplicate)
        await this.store.updateScreenTarget(bound.id, { name: wanted });
      return bound.id;
    }
    return (
      await this.devices.addScreen(cameraId, wanted || nextScreenName(screens))
    ).id;
  }
  private async syncDefaultScreenName(
    page: ScreenPage,
    previousName = page.saved.name,
  ) {
    const target = this.devices
      .screens()
      .find((screen) => screen.id === page.saved.targetId);
    if (
      target &&
      target.name !== page.saved.name &&
      (target.name === previousName || /^Screen \d+$/i.test(target.name))
    )
      await this.renameBoundScreen(target.id, page.saved.name);
  }
  private async connectPage(page: ScreenPage) {
    this.assertPageIdle(page);
    const { cameraId, pageKey, name } = page.saved;
    if (!cameraId)
      throw new RobotArmError('INVALID_ARGUMENT', 'Assign a camera first');
    let targetId = page.saved.targetId;
    if (!targetId) {
      const targets = this.store.list().screenTargets ?? [];
      const previous = targets.find(
        (target) =>
          !target.archived &&
          target.cameraId === cameraId &&
          target.pageKey === pageKey,
      );
      const available = this.devices
        .screens()
        .find(
          (screen) =>
            screen.cameraId === cameraId &&
            /^Screen \d+$/i.test(screen.name) &&
            !screen.hasSavedPerspective &&
            !this.store.deviceBinding(screen.id) &&
            !this.screenOwner(screen.id) &&
            !targets.some(
              (target) => target.id === screen.id && target.pageKey,
            ),
        );
      if (previous) targetId = previous.id;
      else if (available) {
        targetId = available.id;
        await this.renameBoundScreen(targetId, name);
      } else {
        const root = this.devices
          .screens()
          .find((screen) => screen.id === cameraId);
        if (
          root &&
          !root.hasSavedPerspective &&
          !targets.some((target) => target.id === cameraId) &&
          !this.store.deviceBinding(cameraId)
        ) {
          await this.store.saveScreenTarget({ id: cameraId, cameraId, name });
          targetId = cameraId;
        } else {
          targetId = (await this.devices.addScreen(cameraId, name)).id;
        }
      }
    }
    const host = await this.devices.ensureHost(targetId);
    this.assertPageIdle(page, host);
    await this.ensureTarget(targetId);
    if (page.saved.targetId !== targetId) {
      const saved = { ...page.saved, targetId };
      await this.persistPage(saved);
      Object.assign(page.saved, saved);
    }
    await this.store.updateScreenTarget(targetId, { pageKey });
    await this.devices.commitAddedScreen(targetId);
    await this.syncDefaultScreenName(page);
    this.pageHosts.add(targetId);
    host.service.resumePhonePage();
    const display = page.targetDisplayId
      ? this.displays.get(page.targetDisplayId)
      : undefined;
    if (
      page.mode === 'markers' &&
      page.host === host &&
      display?.visionTargetId === targetId &&
      display.state !== 'closed' &&
      display.expiresAt > Date.now()
    )
      return;
    page.assign(host, 'mapping');
  }
  private assertPageIdle(page?: ScreenPage, host = page?.host) {
    const stage = host?.service.status()?.stage;
    if (
      stage &&
      !['ready', 'completed', 'cancelled', 'interrupted'].includes(stage)
    )
      throw new RobotArmError(
        'BUSY',
        'Finish calibration before changing the screen page',
        409,
      );
  }
  private async assignCamera(page: ScreenPage, cameraId: string) {
    if (
      this.devices.entries.get(cameraId)?.cameraId !== cameraId &&
      !this.devices.screens().some((screen) => screen.cameraId === cameraId)
    )
      throw new RobotArmError('INVALID_ARGUMENT', 'Camera not found');
    if (page.saved.cameraId === cameraId) return;
    this.assertPageIdle(page);
    const saved = { ...page.saved, cameraId, targetId: undefined };
    await this.persistPage(saved);
    Object.assign(page.saved, saved);
    page.assign(undefined, 'waiting');
  }
  private async registerPage(
    input: {
      pageKey: string;
      name?: string;
      token?: string;
      browserPlatform?: string;
    },
    userAgent: string,
    cameraId?: string,
  ) {
    const existing = this.store
      .list()
      .screenPages?.find((page) => page.pageKey === input.pageKey);
    if (!cameraId && existing && existing.token !== input.token)
      throw new RobotArmError(
        'INVALID_TOKEN',
        'This page lost its connection credentials. Forget the offline page on the computer, then reload here.',
        403,
      );
    if (cameraId && existing?.cameraId && existing.cameraId !== cameraId)
      throw new RobotArmError(
        'PAGE_ALREADY_BOUND',
        'This phone is bound to another camera. Assign it from the computer.',
        409,
      );
    const saved =
      existing ??
      this.newPage(
        input.pageKey,
        input.name,
        userAgent,
        cameraId,
        input.browserPlatform,
      );
    if (!existing) await this.persistPage(saved);
    const page = await this.page(saved);
    const legacyName = `Screen · ${screenPageLabel(saved.pageKey)}`;
    const detectedName = defaultScreenName(
      userAgent,
      saved.id,
      input.browserPlatform,
    );
    const previousName = page.saved.name;
    if (
      [legacyName, `Screen · ${screenPageLabel(saved.id)}`].includes(
        previousName,
      ) &&
      !detectedName.startsWith('Screen · ')
    ) {
      const updated = { ...page.saved, name: detectedName };
      await this.persistPage(updated);
      Object.assign(page.saved, updated);
    }
    await this.syncDefaultScreenName(page, previousName);
    if (cameraId) {
      await this.assignCamera(page, cameraId);
      await this.connectPage(page);
    }
    return {
      url: `/phone-calibration?token=${encodeURIComponent(saved.token)}`,
    };
  }
  private newPage(
    pageKey: string,
    name: string | undefined,
    userAgent: string,
    cameraId?: string,
    browserPlatform?: string,
  ): SavedPage {
    const id = randomUUID();
    return {
      id,
      token: randomUUID(),
      pageKey,
      name:
        name?.trim().slice(0, 40) ||
        defaultScreenName(userAgent, id, browserPlatform),
      cameraId,
    };
  }
  private async persistPage(page: SavedPage) {
    await this.store.saveScreenPage(page);
  }
  private async ensureTarget(id: string) {
    const target = this.screen(id);
    if (!this.store.list().screenTargets?.some((t) => t.id === id))
      await this.store.saveScreenTarget(target);
    const saved = this.store.list().screenTargets?.find((t) => t.id === id)!;
    if (saved.markerSlot === undefined) {
      const slot = this.devices.markerSlot(id);
      if (slot >= MAX_MARKER_CALIBRATION_TARGETS)
        throw new RobotArmError(
          'INVALID_ARGUMENT',
          'Too many screens for this camera',
        );
      await this.store.updateScreenTarget(id, { markerSlot: slot });
    }
    return target;
  }
  private async page(saved: SavedPage) {
    let page = this.pages.get(saved.id);
    if (!page) {
      page = new ScreenPage({ ...saved }, (id) => this.devices.markerCodes(id));
      this.pages.set(saved.id, page);
      if (saved.targetId) {
        this.pageHosts.add(saved.targetId);
        await this.ensureTarget(saved.targetId);
        await this.store.updateScreenTarget(saved.targetId, {
          pageKey: saved.pageKey,
        });
      }
      // Pages start at home. Opening their saved screen restores the mapping role.
    }
    return page;
  }
  async phoneHost(token: string | null) {
    if (!token) return undefined;
    const saved = this.store.list().screenPages?.find((p) => p.token === token);
    return saved ? this.page(saved) : undefined;
  }
  private publicInfo() {
    const token = 'screen-page';
    const links = this.devices.pairingLinks(token);
    if (!links.length)
      throw new RobotArmError(
        'PHONE_NETWORK_UNAVAILABLE',
        'Connect the computer to Wi-Fi before pairing a phone',
        409,
      );
    const addresses = links.map((link, index) => ({
      address: new URL(link.url).hostname,
      name: link.name,
      recommended: index === 0,
    }));
    const url = new URL(links[0].url);
    url.pathname = '/s';
    url.search = '';
    url.hash = '';
    return { publicUrl: url.href, addresses };
  }
  private session(id: string, token?: string) {
    const session = this.sessions.get(id);
    if (!session || (token !== undefined && token !== session.token))
      throw new RobotArmError(
        'MARKER_CALIBRATION_NOT_FOUND',
        'Marker calibration not found',
        404,
      );
    if (session.state === 'cancelled' || session.expiresAt < Date.now())
      throw new RobotArmError(
        'MARKER_CALIBRATION_EXPIRED',
        'Marker calibration expired',
        410,
      );
    return session;
  }
  private snapshot(session: MarkerSession): MarkerCalibrationCreateResult {
    for (const target of session.targets) {
      const page = [...this.pages.values()].find(
        (p) =>
          p.saved.targetId === target.id &&
          p.mode === 'markers' &&
          this.displays.get(p.targetDisplayId ?? '')?.visionSessionId ===
            session.id,
      );
      const info = page?.summary();
      if (!['detecting', 'succeeded', 'failed'].includes(target.state))
        target.state =
          info?.visible && info.fullscreen && info.markersReady
            ? 'display-ready'
            : 'created';
      if (page?.last) {
        const layout = page.last.layout;
        target.display = {
          widthPx: layout.screen.width,
          heightPx: layout.screen.height,
          cssWidthPx: layout.width,
          cssHeightPx: layout.height,
          devicePixelRatio: layout.screen.devicePixelRatio,
          rotation: 0,
          fullscreen: info?.fullscreen === true,
        };
      }
    }
    const {
      requests: _,
      frames: _f,
      corrections: _c,
      observations: _o,
      detecting: _d,
      applied: _a,
      cameraId: _camera,
      ...value
    } = session;
    return structuredClone(value);
  }
  async create(cameraId: string, names?: string[], screenIds?: string[]) {
    await this.devices.open(cameraId);
    if (screenIds?.some((id) => this.screen(id).cameraId !== cameraId))
      throw new RobotArmError(
        'INVALID_ARGUMENT',
        'Screens must belong to this camera',
      );
    const ids: string[] = [];
    if (screenIds?.length) ids.push(...screenIds);
    else {
      for (const name of names?.length ? names : ['Screen 1'])
        ids.push(await this.allocateScreen(cameraId, name, ids));
    }
    if (ids.length > MAX_MARKER_CALIBRATION_TARGETS)
      throw new RobotArmError('INVALID_ARGUMENT', 'Too many screens');
    const session: MarkerSession = {
      cameraId,
      id: randomUUID(),
      token: randomUUID(),
      state: 'created',
      streamId: cameraId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 60_000,
      targets: [],
      requests: new Map(),
      frames: {},
      corrections: new Map(),
      observations: new Map(),
      detecting: false,
      applied: new Map(),
    };
    for (const id of ids) {
      const target = await this.ensureTarget(id);
      session.targets.push({
        id,
        name: target.name,
        state: 'created',
        token: randomUUID(),
      });
    }
    this.sessions.set(session.id, session);
    return this.snapshot(session);
  }
  async markerAction(input: {
    action: string;
    cameraId: string;
    id?: string;
    token?: string;
    names?: string[];
    screenIds?: string[];
    targetId?: string;
    name?: string;
    targetIds?: string[];
    allowMismatch?: boolean;
  }) {
    if (input.action === 'create')
      return this.serialize(() =>
        this.create(input.cameraId, input.names, input.screenIds),
      );
    const currentSession = () => {
      const session = this.session(input.id!, input.token);
      if (session.cameraId !== input.cameraId)
        throw new RobotArmError(
          'PROFILE_MISMATCH',
          'Marker session belongs to another camera',
          409,
        );
      return session;
    };
    if (input.action === 'status') {
      const session = currentSession();
      if (session.detecting) return this.snapshot(session);
    }
    return this.serialize(async () => {
      const session = currentSession();
      if (input.action === 'status') {
        await this.attachConnectedScreens(session);
        return this.snapshot(session);
      }
      return this.updateMarkerSession(session, input);
    });
  }
  private async attachConnectedScreens(session: MarkerSession) {
    if (session.state === 'cancelled' || session.expiresAt <= Date.now())
      return;
    for (const target of session.targets) {
      if (target.state === 'succeeded') continue;
      const display = [...this.displays.values()]
        .reverse()
        .find(
          (candidate) =>
            candidate.visionTargetId === target.id &&
            candidate.state !== 'closed' &&
            candidate.expiresAt > Date.now(),
        );
      if (!display || display.visionSessionId !== session.id) continue;
      const page = [...this.pages.values()].find(
        (candidate) =>
          candidate.saved.cameraId === session.cameraId &&
          candidate.saved.targetId === target.id &&
          candidate.mode === 'mapping' &&
          !candidate.targetDisplayId &&
          candidate.summary().visible,
      );
      if (page) await this.assign(page, display, 'markers');
    }
  }
  private async updateMarkerSession(
    session: MarkerSession,
    input: Parameters<ScreenCalibration['markerAction']>[0],
  ) {
    if (session.detecting)
      throw new RobotArmError(
        'BUSY',
        'Screen detection is already running',
        409,
      );
    if (input.action === 'add') {
      if (session.targets.length >= MAX_MARKER_CALIBRATION_TARGETS)
        throw new RobotArmError('INVALID_ARGUMENT', 'Too many screens');
      const id = await this.allocateScreen(
        session.cameraId,
        input.name,
        session.targets.map((target) => target.id),
      );
      await this.ensureTarget(id);
      const target = {
        id,
        name: this.screen(id).name,
        state: 'created' as const,
        token: randomUUID(),
      };
      session.targets.push(target);
      return { session: this.snapshot(session), target };
    }
    if (input.action === 'remove') {
      // Older clients exposed target removal inside Add Screen. Keep that
      // request harmless: a duplicate is idempotent and image calibration is
      // camera-wide, so dropping a pending target must not release it.
      const target = session.targets.find((item) => item.id === input.targetId);
      if (!target) return this.snapshot(session);
      await this.removeScreen(this.screen(target.id), { discard: true });
      return this.snapshot(session);
    }
    if (input.action === 'cancel') {
      for (const display of this.displays.values())
        if (
          display.visionSessionId === session.id &&
          display.state !== 'closed'
        )
          await this.updatePage({ action: 'close-display', id: display.id });
      session.state = 'cancelled';
      return {};
    }
    if (input.action === 'detect') return this.detect(session, input.targetIds);
    if (input.action === 'apply')
      return this.apply(session, input.allowMismatch === true);
    throw new RobotArmError('INVALID_COMMAND', 'Unknown marker command');
  }
  private async refinePaddedTopEdge(
    camera: Awaited<ReturnType<PlaygroundDevices['open']>>['camera'],
    correction: CameraCorrection,
    jpeg: Buffer,
    layout: CalibrationPageUpdate['layout'],
  ) {
    const inset = layout.topInset ?? 0;
    if (inset <= 3) return correction;
    const validity = await camera.checkCorrection(
      correction,
      jpeg,
      true,
      layout,
    );
    if (!validity) return correction;
    const top = validity.edges.find((edge) => edge.side === 'top');
    if (
      validity.state !== 'invalid' ||
      validity.reasonCode !== 'SHIFTED' ||
      top?.class !== 'off-edge' ||
      validity.edges.filter((edge) => edge.class === 'on-edge').length !== 3
    )
      return correction;

    const { topLeft, topRight, bottomLeft, bottomRight } = correction.points;
    const dx = topRight.x - topLeft.x;
    const dy = topRight.y - topLeft.y;
    const topWidth = Math.hypot(dx, dy);
    const sourceWidth =
      (topWidth +
        Math.hypot(
          bottomRight.x - bottomLeft.x,
          bottomRight.y - bottomLeft.y,
        )) /
      2;
    const offset = (top.offsetPx * sourceWidth) / validity.screenWidthPx;
    const limit = Math.min(0.025, inset / (2 * layout.screen.height));
    // Move the padded edge along the existing side lines. The opposite edge
    // and both fitted side lines stay fixed.
    const adjust = (from: typeof topLeft, to: typeof topLeft) => {
      const x = to.x - from.x;
      const y = to.y - from.y;
      const depth = Math.abs((dx * y - dy * x) / topWidth);
      const fraction = -offset / depth;
      return Math.abs(fraction) <= limit
        ? { x: from.x + x * fraction, y: from.y + y * fraction }
        : undefined;
    };
    const left = adjust(topLeft, bottomLeft);
    const right = adjust(topRight, bottomRight);
    if (!left || !right) return correction;
    const refined = {
      ...correction,
      points: { ...correction.points, topLeft: left, topRight: right },
    };
    const verified = await camera.checkCorrection(refined, jpeg, true, layout);
    return verified?.state === 'valid' &&
      verified.edges.length === 4 &&
      verified.edges.every((edge) => edge.class === 'on-edge')
      ? refined
      : correction;
  }
  private async detect(
    session: MarkerSession,
    ids?: string[],
  ): Promise<MarkerCalibrationDetectionResponse> {
    const selected =
      ids ??
      session.targets.filter((t) => t.state !== 'succeeded').map((t) => t.id);
    if (
      !selected.length ||
      selected.some((id) => !session.targets.some((t) => t.id === id))
    )
      throw new RobotArmError('INVALID_ARGUMENT', 'Select calibration screens');
    session.detecting = true;
    try {
      // Every target sees the same fresh eight-frame batch. One bad phone cannot
      // invalidate another target's passing evidence or make it retry needlessly.
      const camera = (await this.devices.open(session.cameraId)).camera;
      const observations = new Map<string, CalibrationPageUpdate>();
      for (const id of selected) {
        const host = await this.devices.ensureHost(id);
        const request = session.requests.get(id);
        const observed = request && host.service.markerObservation(request);
        if (observed) observations.set(id, structuredClone(observed));
      }
      const frames = await camera.withMarkerImaging(async () => {
        const batch: Buffer[] = [];
        for (let index = 0; index < 8; index++)
          batch.push(await camera.rawFrame());
        return batch;
      });
      const detector = new MarkerCalibrationDetector();
      const groups = [...observations.values()].map(
        ({ layout }) => new Set(layout.markers.map((marker) => marker.code)),
      );
      const expectedIds = new Set(groups.flatMap((ids) => [...ids]));
      const decoded = [];
      if (groups.length)
        for (const frame of frames) {
          const result = await detector
            .decodeFrame(frame, expectedIds, groups)
            .catch(() => undefined);
          decoded.push(result);
        }
      for (const id of selected) {
        const target = session.targets.find((t) => t.id === id)!;
        session.applied.delete(id);
        target.state = 'detecting';
        target.error = undefined;
        target.result = undefined;
        delete session.frames[id];
        session.corrections.delete(id);
        session.observations.delete(id);
        try {
          const host = await this.devices.ensureHost(id);
          const request = session.requests.get(id);
          const observed = observations.get(id);
          if (!observed)
            throw new RobotArmError(
              'PAGE_CHANGED',
              'Keep the device page visible and in fullscreen.',
              409,
            );
          const before = structuredClone(observed);
          let index = 0;
          const result = await recognizeScreenMarkers(
            async () => {
              const current = host.service.markerObservation(request!);
              if (
                !current ||
                current.pageId !== before.pageId ||
                !sameLayout(current.layout, before.layout)
              )
                throw new RobotArmError(
                  'PAGE_CHANGED',
                  'The phone display changed during marker detection',
                  409,
                );
              return frames[index++];
            },
            before.layout,
            { detector, frames: decoded },
          );
          const correction = await this.refinePaddedTopEdge(
            camera,
            result.correction,
            Buffer.from(result.jpeg, 'base64'),
            before.layout,
          );
          const output = {
            width: Math.max(
              180,
              Math.min(4096, Math.round(before.layout.screen.width)),
            ),
            height: Math.max(
              180,
              Math.min(4096, Math.round(before.layout.screen.height)),
            ),
          };
          const after = host.service.markerObservation(request!);
          if (
            !after ||
            after.pageId !== before.pageId ||
            !sameLayout(after.layout, before.layout)
          )
            throw new RobotArmError(
              'PAGE_CHANGED',
              'The phone display changed during marker detection',
              409,
            );
          target.result = {
            protocol: MARKER_CALIBRATION_PROTOCOL,
            points: correction.points,
            screenWidthPx: output.width,
            screenHeightPx: output.height,
            rotation: 0,
            imageWidth: result.correction.sourceWidth,
            imageHeight: result.correction.sourceHeight,
            frameCount: result.frameCount,
            validFrames: result.validFrames,
            cornerJitterPx: result.jitterPx,
            reprojectionRmsePx: result.errorPx,
            markerIds: result.markerIds,
            durationMs: 0,
          };
          session.corrections.set(id, correction);
          session.observations.set(id, before);
          session.frames[id] = {
            id: 0,
            capturedAt: Date.now(),
            jpegBase64: result.jpeg,
          };
          target.state = 'succeeded';
        } catch (error) {
          target.state = 'failed';
          target.error = error instanceof Error ? error.message : String(error);
          session.requests.set(
            id,
            (await this.devices.ensureHost(id)).service.requestMarkerDisplay(
              true,
            ),
          );
        }
      }
      session.state = session.targets.every((t) => t.state === 'succeeded')
        ? 'succeeded'
        : session.targets.some((t) => t.state === 'succeeded')
          ? 'partially-succeeded'
          : 'failed';
      return { session: this.snapshot(session), frames: { ...session.frames } };
    } finally {
      session.detecting = false;
    }
  }
  private async apply(session: MarkerSession, allowMismatch: boolean) {
    const targets = session.targets.filter(
      (t) =>
        t.state === 'succeeded' &&
        t.result &&
        (!session.applied.has(t.id) || session.applied.get(t.id) !== undefined),
    );
    const response = () => ({
      screenIds: [...session.applied.keys()],
      mappingErrors: Object.fromEntries(
        [...session.applied].filter(([, error]) => error !== undefined),
      ),
    });
    if (!targets.length && session.applied.size) return response();
    if (!targets.length)
      throw new RobotArmError(
        'NOT_VERIFIED',
        'No screen produced a usable calibration result',
        409,
      );
    // Refuse duplicate glass before writing any screen correction.
    const outlines = targets.map((t) => ({
      id: t.id,
      name: t.name,
      points: Object.values(t.result!.points),
    }));
    for (const screen of this.devices.screens()) {
      if (
        screen.cameraId !== session.cameraId ||
        targets.some((t) => t.id === screen.id)
      )
        continue;
      const correction = this.devices.entries
        .get(screen.id)
        ?.camera.getCorrection();
      if (correction)
        outlines.push({
          id: screen.id,
          name: screen.name,
          points: Object.values(correction.points),
        });
    }
    for (let i = 0; i < outlines.length; i++)
      for (const other of outlines.slice(i + 1)) {
        const distance =
          outlines[i].points.reduce(
            (sum, p, j) =>
              sum +
              Math.hypot(p.x - other.points[j].x, p.y - other.points[j].y),
            0,
          ) / 4;
        if (distance < 10)
          throw new RobotArmError(
            'DUPLICATE_SCREEN',
            'Each screen needs its own screen page; open one page per screen, then detect again.',
            409,
          );
      }
    const assertObservation = (id: string) => {
      const before = session.observations.get(id);
      const host = this.devices.entries.get(id)?.host;
      const current =
        host?.service.phoneStatus()?.state === 'connected'
          ? host.service.phoneObservation()
          : undefined;
      if (
        !before ||
        !current ||
        current.pageId !== before.pageId ||
        !sameLayout(current.layout, before.layout)
      )
        throw new RobotArmError(
          'PAGE_CHANGED',
          'The screen page changed before applying. Detect again.',
          409,
        );
    };
    for (const target of targets) assertObservation(target.id);
    const root = await (
      await this.devices.ensureHost(session.cameraId)
    ).configuration();
    const frame = await this.devices.entries
      .get(session.cameraId)!
      .camera.rawFrame();
    for (const target of targets) {
      const validity = await this.devices.entries
        .get(target.id)!
        .camera.checkCorrection(
          session.corrections.get(target.id)!,
          frame,
          true,
          session.observations.get(target.id)!.layout,
        );
      if (!allowMismatch && validity?.state === 'invalid') {
        const sides = validity.edges
          .filter((edge) => edge.class === 'off-edge')
          .map((edge) => edge.side)
          .join(', ');
        throw new RobotArmError(
          'CALIBRATION_MISMATCH',
          `${target.name}: ${validity.reasonCode}${sides ? ` (${sides})` : ''}`,
          409,
        );
      }
    }
    for (const target of targets) assertObservation(target.id);
    for (const target of targets) {
      const host = await this.devices.ensureHost(target.id);
      if (!host.service.setup().prepared) {
        if (root.measuredSetup)
          await host.configure(
            { tool: root.measuredSetup.tool, motion: root.input?.motion },
            false,
          );
      }
      const mappingError = await host.applyMarkerCorrection(
        session.corrections.get(target.id)!,
        allowMismatch,
        {
          width: target.result!.screenWidthPx,
          height: target.result!.screenHeightPx,
        },
        () => assertObservation(target.id),
      );
      session.applied.set(target.id, mappingError);
      if (mappingError === undefined)
        await this.devices.commitAddedScreen(target.id);
      host.service.finishMarkerDisplay(
        session.requests.get(target.id)!,
        mappingError === undefined,
      );
      const page = [...this.pages.values()].find(
        (p) => p.saved.targetId === target.id,
      );
      if (page) {
        page.mode = 'mapping';
        page.changed();
      }
    }
    if (
      targets.every((target) => session.applied.get(target.id) === undefined)
    ) {
      // Imaging can run longer than the marker request budget. The workbench
      // polls setup.imaging until it reaches ready or error.
      void this.devices
        .calibrateCameraImaging(
          session.cameraId,
          targets.map((target) => target.id),
        )
        .catch(() => undefined);
    }
    return response();
  }
  async pageAction(input: {
    action: string;
    cameraId?: string;
    id?: string;
    name?: string;
    visionSessionId?: string;
    targetId?: string;
    visionToken?: string;
    targetDisplayId?: string;
    role?: 'markers' | 'mapping';
    keepBinding?: boolean;
    onlyIfEmpty?: boolean;
    screenIds?: string[];
    targets?: { id: string; token: string }[];
  }) {
    if (input.action === 'list') return this.listPages(input.cameraId);
    if (input.action === 'clear-perspectives')
      return this.serializeClear(() => this.updatePage(input));
    if (input.action === 'displays') return [...this.displays.values()];
    if (input.action === 'identify') {
      const screen = this.screen(input.targetId!);
      if (screen.cameraId !== input.cameraId)
        throw new RobotArmError(
          'PROFILE_MISMATCH',
          'Screen belongs to another camera',
          409,
        );
      for (const page of this.pages.values()) {
        if (page.saved.cameraId === screen.cameraId)
          page.identify(
            page.saved.targetId === screen.id &&
              page.saved.pageKey === screen.pageKey,
          );
      }
      return {};
    }
    return this.serialize(() => this.updatePage(input));
  }
  private async listPages(cameraId?: string) {
    await this.devices.pruneUnusedScreenTargets(cameraId);
    await this.adoptExistingPages();
    for (const saved of this.store.list().screenPages ?? [])
      await this.page(saved);
    return {
      ...this.publicInfo(),
      devices: [...this.pages.values()].map((page) => page.summary()),
      pairing: cameraId ? this.pairing(cameraId) : undefined,
    };
  }
  private async updatePage(
    input: Parameters<ScreenCalibration['pageAction']>[0],
  ) {
    if (input.action === 'create-display') {
      const session = this.session(input.visionSessionId!);
      const target = session.targets.find((t) => t.id === input.targetId);
      if (
        !target ||
        (input.visionToken !== target.token &&
          input.visionToken !== session.token)
      )
        throw new RobotArmError(
          'INVALID_ARGUMENT',
          'Screen not in marker session',
        );
      const existing = [...this.displays.values()].find(
        (d) =>
          d.visionSessionId === session.id &&
          d.visionTargetId === input.targetId &&
          d.state !== 'closed',
      );
      if (existing) return existing;
      const display: TargetDisplaySession = {
        ...this.publicInfo(),
        id: randomUUID(),
        code: this.pairingCode(),
        language: 'zh',
        state: 'pending',
        visionSessionId: session.id,
        visionTargetId: input.targetId!,
        expiresAt: session.expiresAt,
      };
      this.displays.set(display.id, display);
      const saved = this.store
        .list()
        .screenPages?.find((p) => p.targetId === input.targetId);
      if (saved) {
        const page = await this.page(saved);
        if (page.summary().visible) await this.assign(page, display, 'markers');
      }
      return display;
    }
    if (input.action === 'close-display') {
      const display = this.displays.get(input.id!);
      if (display) {
        const page = [...this.pages.values()].find(
          (candidate) => candidate.targetDisplayId === display.id,
        );
        if (page?.mode === 'markers') await this.release(page, true);
        display.state = 'closed';
      }
      return {};
    }
    if (input.action === 'bind-link') {
      const session = this.session(input.visionSessionId!);
      if (
        !input.targets?.every((t) =>
          session.targets.some((s) => s.id === t.id && s.token === t.token),
        )
      )
        throw new RobotArmError(
          'INVALID_ARGUMENT',
          'Invalid screen bind ticket',
        );
      const token = randomUUID();
      const expiresAt = Date.now() + 5 * 60_000;
      this.tickets.set(token, {
        sessionId: session.id,
        targetIds: input.targets!.map((t) => t.id),
        expiresAt,
      });
      return { path: `/#bind=${token}`, expiresAt };
    }
    if (input.action === 'discard-added-screen') {
      const target = this.devices.screenTarget(input.id!, true);
      if (!target)
        throw new RobotArmError('INVALID_ARGUMENT', 'Screen not found');
      if (target.cameraId !== input.cameraId)
        throw new RobotArmError(
          'PROFILE_MISMATCH',
          'Screen belongs to another camera',
          409,
        );
      if (target.archived) {
        this.devices.discardAddedScreen(target.id);
        return {};
      }
      await this.removeScreen(target, { discard: true });
      return {};
    }
    if (input.action === 'delete-screen') {
      if (
        input.onlyIfEmpty &&
        !this.devices.screens().some((s) => s.id === input.id)
      )
        return {};
      const target = this.screen(input.id!);
      if (target.cameraId !== input.cameraId)
        throw new RobotArmError(
          'PROFILE_MISMATCH',
          'Screen belongs to another camera',
          409,
        );
      // Deleting a screen also deletes the profile its calibration produced,
      // with that screen's calibrations and sessions. Otherwise every
      // recalibration leaves a screen profile behind forever.
      const screenProfiles = this.screenProfilesForTarget(target.id);
      const removed = await this.removeScreen(target, {
        onlyIfEmpty: input.onlyIfEmpty,
      });
      if (removed)
        for (const screenId of screenProfiles)
          await this.store.deleteScreenProfile(screenId, { release: true });
      return {};
    }
    if (input.action === 'delete-perspective') {
      const target = this.screen(input.id!);
      if (target.cameraId !== input.cameraId)
        throw new RobotArmError(
          'PROFILE_MISMATCH',
          'Screen belongs to another camera',
          409,
        );
      await (
        await this.devices.open(target.id)
      ).camera.deleteSavedPerspective();
      return {};
    }
    if (input.action === 'clear-perspectives') {
      const cameraId = input.cameraId;
      if (!cameraId)
        throw new RobotArmError(
          'INVALID_ARGUMENT',
          'Camera is required to clear perspectives',
        );
      const cameraScreens = this.devices
        .screens()
        .filter((screen) => screen.cameraId === cameraId);
      const requested = input.screenIds ? new Set(input.screenIds) : undefined;
      const targets = requested
        ? cameraScreens.filter((screen) => requested.has(screen.id))
        : cameraScreens;
      if (requested?.size && !targets.length)
        throw new RobotArmError(
          'INVALID_ARGUMENT',
          'None of the selected screens belong to this camera',
        );
      if (!requested) await this.devices.cameras.clearPerspective(cameraId);
      for (const target of targets) {
        const entry = this.devices.entries.get(target.id);
        const host = entry?.host ?? (await entry?.hostOpening);
        if (host) await host.service.clearMapping();
        else await this.store.saveCalibrationMapping(target.id);
        await entry?.camera.clearPerspective();
        await this.devices.cameras.clearPerspective(cameraId, target.id);
      }
      return {};
    }
    if (input.action === 'rename-screen') {
      const name = input.name!.trim();
      const target = this.screen(input.id!);
      if (target.cameraId !== input.cameraId)
        throw new RobotArmError(
          'PROFILE_MISMATCH',
          'Screen belongs to another camera',
          409,
        );
      await this.store.updateScreenTarget(input.id!, { name });
      for (const session of this.sessions.values()) {
        const target = session.targets.find((t) => t.id === input.id);
        if (target) target.name = name;
      }
      // Every page bound to this screen follows the screen name, including
      // pages that are only persisted: an offline page must not come back
      // with the name it had before the operator renamed the screen.
      const openPages = [...this.pages.values()];
      const openIds = new Set(openPages.map((page) => page.saved.id));
      for (const page of this.store.list().screenPages ?? []) {
        if (
          page.targetId !== input.id ||
          page.name === name ||
          openIds.has(page.id)
        )
          continue;
        await this.store.saveScreenPage({ ...page, name });
      }
      for (const page of openPages) {
        if (page.saved.targetId !== input.id || page.saved.name === name)
          continue;
        page.saved.name = name;
        await this.persistPage(page.saved);
      }
      return {};
    }
    const page = this.pages.get(input.id!);
    if (!page)
      throw new RobotArmError('INVALID_ARGUMENT', 'Screen page not found');
    if (input.action === 'wake') {
      /*
       * A page that stopped reporting (screen locked, browser suspended) still
       * shows its last frame. Closing its transport makes the page reconnect and
       * report again as soon as the browser runs it.
       */
      page.phoneSocket.renew();
      return {};
    }
    if (input.action === 'delete-screen-page') {
      this.assertPageIdle(page);
      const target = this.devices
        .screens()
        .find(
          (screen) =>
            screen.id === page.saved.targetId ||
            screen.pageKey === page.saved.pageKey,
        );
      if (target) await this.removeScreen(target, { deletePerspective: true });
      await this.store.removeScreenPage(page.saved.id);
      this.pages.delete(page.saved.id);
      page.close();
      return {};
    }
    if (input.action === 'forget') {
      if (page.summary().visible)
        throw new RobotArmError(
          'INVALID_ARGUMENT',
          'The page is still connected. Restore it home instead.',
          409,
        );
      this.assertPageIdle(page);
      const target = this.devices
        .screens()
        .find(
          (screen) =>
            screen.id === page.saved.targetId ||
            screen.pageKey === page.saved.pageKey,
        );
      if (target) await this.removeScreen(target, { deletePerspective: true });
      await this.store.removeScreenPage(page.saved.id);
      this.pages.delete(page.saved.id);
      page.close();
      return {};
    }
    if (input.action === 'assign-camera') {
      await this.assignCamera(page, input.cameraId!);
      return { device: page.summary() };
    }
    if (input.action === 'release') {
      await this.release(page, input.keepBinding);
      if (input.keepBinding) page.markOperatorReleased();
      return {};
    }
    if (input.action === 'rename') {
      const name = input.name?.trim();
      if (
        !name ||
        name.length > 40 ||
        [...this.pages.values()].some(
          (p) =>
            p !== page &&
            p.saved.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        )
      )
        throw new RobotArmError(
          'INVALID_ARGUMENT',
          'Screen names must be unique.',
        );
      for (const session of this.sessions.values()) {
        const target = session.targets.find(
          (t) => t.id === page.saved.targetId,
        );
        if (target) target.name = name;
      }
      page.saved.name = name;
      await this.persistPage(page.saved);
      // The device owns the name: its screen follows, so the stage label and
      // the pairing dialog never drift apart.
      if (page.saved.targetId)
        await this.renameBoundScreen(page.saved.targetId, name);
      return {};
    }
    if (input.action === 'assign') {
      if (input.role === 'mapping' && !input.targetDisplayId) {
        if (
          input.cameraId &&
          page.saved.cameraId &&
          input.cameraId !== page.saved.cameraId
        )
          throw new RobotArmError(
            'PROFILE_MISMATCH',
            'The page is assigned to another camera',
            409,
          );
        if (input.cameraId) await this.assignCamera(page, input.cameraId);
        await this.connectPage(page);
        return { device: page.summary() };
      }
      const display = this.displays.get(input.targetDisplayId!);
      if (
        !display ||
        display.state === 'closed' ||
        display.expiresAt <= Date.now()
      )
        throw new RobotArmError('INVALID_ARGUMENT', 'Marker display not found');
      await this.assign(page, display, input.role ?? 'markers');
      return { device: page.summary() };
    }
    throw new RobotArmError('INVALID_COMMAND', 'Unknown screen page command');
  }
  private async removeScreen(
    {
      id,
      cameraId,
      pageKey,
    }: { id: string; cameraId: string; pageKey?: string },
    options: {
      onlyIfEmpty?: boolean;
      discard?: boolean;
      deletePerspective?: boolean;
    } = {},
  ): Promise<boolean> {
    // Forgetting an offline phone must also work with its camera unplugged.
    const entry =
      options.onlyIfEmpty || options.discard
        ? this.devices.entries.get(id)
        : options.deletePerspective
          ? (this.devices.entries.get(id) ??
            (await this.devices.opening.get(id)))
          : await this.devices.open(id);
    if (
      options.onlyIfEmpty &&
      !options.discard &&
      (entry?.camera.getCorrection() ||
        entry?.camera.hasSavedPerspective() ||
        this.store.deviceBinding(id))
    )
      return false;
    const savedPage = this.store
      .list()
      .screenPages?.find(
        (candidate) =>
          candidate.targetId === id || candidate.pageKey === pageKey,
      );
    const page = savedPage && this.pages.get(savedPage.id);
    if (page) await this.release(page, true);
    await this.ensureTarget(id);
    if (options.onlyIfEmpty || options.discard) {
      // Discarding a never-calibrated Add Screen target must not release
      // camera-level imaging shared by the camera's existing screens.
      await this.store.saveCalibrationMapping(id);
    } else {
      const host = entry?.host ?? (await entry?.hostOpening);
      if (host) await host.service.clearMapping();
      else await this.store.saveCalibrationMapping(id);
      if (options.deletePerspective)
        await this.devices.cameras.clearPerspective(
          cameraId,
          id === cameraId ? undefined : id,
        );
      else await entry?.camera.clearCorrection();
    }
    await this.store.archiveScreenTarget(id);
    this.devices.discardAddedScreen(id);
    if (page) page.saved.targetId = undefined;
    this.pageHosts.delete(id);
    for (const session of this.sessions.values()) {
      if (!session.targets.some((target) => target.id === id)) continue;
      session.targets = session.targets.filter((target) => target.id !== id);
      if (savedPage && !session.excludedPageIds?.includes(savedPage.id))
        session.excludedPageIds = [
          ...(session.excludedPageIds ?? []),
          savedPage.id,
        ];
      if (!session.targets.length) session.state = 'cancelled';
      session.requests.delete(id);
      session.corrections.delete(id);
      session.applied.delete(id);
      session.observations.delete(id);
      delete session.frames[id];
    }
    for (const display of this.displays.values())
      if (display.visionTargetId === id) display.state = 'closed';
    if (id !== cameraId) await this.devices.stop(id);
    return true;
  }
  /**
   * Screen profiles that belong to one console screen. The accepted device
   * binding names it explicitly; a camera-level target can also be the
   * workstation's screen before a device binding exists.
   */
  private screenProfilesForTarget(targetId: string): string[] {
    const profiles = this.store.list();
    const ids = new Set<string>();
    const binding = profiles.devices?.find(
      (device) => device.deviceId === targetId,
    );
    if (binding) ids.add(binding.screenProfileId);
    const workstation = profiles.workstation;
    if (
      workstation &&
      targetId === workstation.cameraId &&
      !profiles.devices?.some(
        (device) =>
          device.deviceId !== targetId &&
          device.screenProfileId === workstation.screenProfileId,
      )
    )
      ids.add(workstation.screenProfileId);
    return [...ids];
  }
  private async assign(
    page: ScreenPage,
    display: TargetDisplaySession,
    mode: ScreenPage['mode'],
  ) {
    const session = this.session(display.visionSessionId);
    if (
      mode === 'markers' &&
      page.mode === 'markers' &&
      page.targetDisplayId === display.id &&
      session.requests.has(display.visionTargetId)
    )
      return;
    const target = this.screen(display.visionTargetId);
    if (page.saved.targetId && page.saved.targetId !== target.id)
      throw new RobotArmError(
        'PAGE_ALREADY_BOUND',
        'This page belongs to another screen. Release it before pairing it here.',
        409,
      );
    const pageKey = this.store
      .list()
      .screenTargets?.find((screen) => screen.id === target.id)?.pageKey;
    if (
      pageKey &&
      pageKey !== page.saved.pageKey &&
      (this.devices.screens().find((screen) => screen.id === target.id)
        ?.hasSavedPerspective ||
        this.store.deviceBinding(target.id))
    )
      throw new RobotArmError(
        'PAGE_ALREADY_BOUND',
        'Delete the old screen binding and add a screen before pairing a different page.',
        409,
      );
    if (page.saved.cameraId && page.saved.cameraId !== session.cameraId)
      throw new RobotArmError(
        'PROFILE_MISMATCH',
        'The page is assigned to another camera',
        409,
      );
    if (
      [...this.pages.values()].some(
        (p) => p !== page && p.saved.targetId === display.visionTargetId,
      )
    )
      throw new RobotArmError(
        'PAGE_ALREADY_BOUND',
        'This screen already has a bound page. Release it before assigning another.',
        409,
      );
    const host = await this.devices.ensureHost(display.visionTargetId);
    this.pageHosts.add(display.visionTargetId);
    if (
      host.service.status() &&
      !['ready', 'completed', 'cancelled', 'interrupted'].includes(
        host.service.status()!.stage,
      )
    )
      throw new RobotArmError(
        'BUSY',
        'Finish calibration before assigning the page',
        409,
      );
    this.assertPageIdle(page);
    const saved = {
      ...page.saved,
      cameraId: session.cameraId,
      targetId: display.visionTargetId,
    };
    await this.persistPage(saved);
    Object.assign(page.saved, saved);
    await this.ensureTarget(saved.targetId);
    await this.store.updateScreenTarget(saved.targetId, {
      pageKey: page.saved.pageKey,
    });
    await this.devices.commitAddedScreen(saved.targetId);
    await this.syncDefaultScreenName(page);
    host.service.resumePhonePage();
    page.assign(host, mode, display.id);
    if (mode === 'markers')
      session.requests.set(
        display.visionTargetId,
        host.service.requestMarkerDisplay(),
      );
  }
  private async release(page: ScreenPage, keepBinding = false) {
    if (
      page.host?.service.status() &&
      !['ready', 'completed', 'cancelled', 'interrupted'].includes(
        page.host.service.status()!.stage,
      )
    )
      throw new RobotArmError(
        'BUSY',
        'Finish calibration before restoring the page home',
        409,
      );
    page.host?.service.restorePhoneHome();
    if (!keepBinding) {
      page.saved.targetId = undefined;
      await this.persistPage(page.saved);
    }
    page.assign(undefined, 'waiting');
  }
  async register(
    input: {
      ticket?: string;
      code?: string;
      pageKey?: string;
      name?: string;
      token?: string;
      browserPlatform?: string;
    },
    userAgent = '',
  ) {
    return this.serialize(async () => {
      this.devices.assertBatchIdle();
      if (
        typeof input.pageKey !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(input.pageKey)
      )
        throw new RobotArmError(
          'INVALID_ARGUMENT',
          'A stable browser identity is required',
        );
      if (!input.ticket && !input.code)
        return this.registerPage(
          {
            pageKey: input.pageKey,
            name: input.name,
            token: input.token,
            browserPlatform: input.browserPlatform,
          },
          userAgent,
        );
      const connection = input.ticket
        ? this.connectionTickets.get(input.ticket)
        : [...this.connectionTickets.values()].find(
            (ticket) => ticket.code === input.code,
          );
      if (connection && connection.expiresAt > Date.now())
        return this.registerPage(
          {
            pageKey: input.pageKey,
            name: input.name,
            browserPlatform: input.browserPlatform,
          },
          userAgent,
          connection.cameraId,
        );

      const ticket = input.ticket ? this.tickets.get(input.ticket) : undefined;
      const display = input.code
        ? [...this.displays.values()].find(
            (d) => d.code === input.code && d.state !== 'closed',
          )
        : undefined;
      if ((!ticket || ticket.expiresAt < Date.now()) && !display)
        throw new RobotArmError(
          'INVALID_TOKEN',
          'The pairing code expired. Scan the current QR code.',
          403,
        );
      const session = this.session(
        ticket ? ticket.sessionId : display!.visionSessionId,
      );
      let saved = this.store
        .list()
        .screenPages?.find((p) => p.pageKey === input.pageKey);
      if (saved?.cameraId && saved.cameraId !== session.cameraId)
        throw new RobotArmError(
          'PAGE_ALREADY_BOUND',
          'This phone is bound to another camera. Release its binding first.',
          409,
        );
      saved ??= this.newPage(
        input.pageKey,
        input.name,
        userAgent,
        session.cameraId,
        input.browserPlatform,
      );
      const page = await this.page(saved);
      const allowed = display
        ? session.targets.filter((t) => t.id === display.visionTargetId)
        : session.targets.filter((t) => ticket!.targetIds.includes(t.id));
      let target = allowed.find((t) => t.id === saved!.targetId);
      if (!target && !saved.targetId)
        target = allowed.find(
          (t) =>
            !this.store
              .list()
              .screenPages?.some(
                (p) => p.targetId === t.id && p.pageKey !== input.pageKey,
              ),
        );
      if (!target && saved.targetId)
        throw new RobotArmError(
          'PAGE_ALREADY_BOUND',
          'This page belongs to another screen. Select its saved screen to reconnect.',
          409,
        );
      if (!target) {
        await this.persistPage(page.saved);
        return {
          url: `/phone-calibration?token=${encodeURIComponent(saved.token)}`,
        };
      }
      const created = (await this.updatePage({
        action: 'create-display',
        visionSessionId: session.id,
        targetId: target.id,
        visionToken: session.token,
      })) as TargetDisplaySession;
      await this.assign(page, created, 'markers');
      return {
        url: `/phone-calibration?token=${encodeURIComponent(saved.token)}`,
      };
    });
  }
  async close() {
    for (const page of this.pages.values()) page.close();
    this.pages.clear();
  }
}
