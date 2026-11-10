import {
  type CameraStreamInfo,
  MAX_MARKER_CALIBRATION_TARGETS,
  type MarkerCalibrationCreateResult,
  type MarkerCalibrationDetectionResponse,
  type MarkerCalibrationSession,
  type MarkerCalibrationTarget,
} from '@midscene/arm-kit-shared/marker-contracts';
import {
  Alert,
  App,
  Button,
  Card,
  Drawer,
  Input,
  Modal,
  QRCode,
  Select,
  Space,
  Steps,
  Tag,
  Typography,
} from 'antd';
import { Copy, ExternalLink, Plus, ScanLine, Trash2 } from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { t, useLanguage } from '../i18n';
import { RobotVisionApiError, type RobotVisionClient } from '../marker-client';
import {
  type LanAddress,
  ScreenCalibClient,
  type ScreenDeviceSummary,
  type TargetDisplaySession,
  screenDeviceUrl,
} from '../marker-client';
import { detectMarkersWithRetry } from '../utils/detect-markers';
import {
  prepareMarkerPagesForDetection,
  restoreMarkerPages,
} from '../utils/restore-marker-pages';
import { robotCue, robotVoice } from '../voice/browser';
import { SetupNotice, selectSetupNotice } from './robot-arm/SetupNotice';

const POLL_INTERVAL_MS = 800;

interface TargetView extends MarkerCalibrationTarget {
  token?: string;
}

interface SessionView extends Omit<MarkerCalibrationSession, 'targets'> {
  token?: string;
  targets: TargetView[];
}

/** One calibration display on the screen calibration service per target. */
interface DisplayView {
  id: string;
  code: string;
  error?: string;
}

function mergeSession(
  current: SessionView | undefined,
  next: MarkerCalibrationSession,
): SessionView {
  return {
    ...(current ?? {}),
    ...next,
    targets: next.targets.map((target) => {
      const previous = current?.targets.find((item) => item.id === target.id);
      return { ...previous, ...target };
    }),
  };
}

function nextScreenName(targets: readonly { name: string }[]): string {
  const usedNames = new Set(
    targets.map((target) => target.name.trim().toLocaleLowerCase('en-US')),
  );
  for (let index = 1; ; index += 1) {
    const name = `Screen ${index}`;
    if (!usedNames.has(name.toLocaleLowerCase('en-US'))) return name;
  }
}

export function MarkerCalibrationDialog({
  variant = 'drawer',
  footerContainer,
  simplified = false,
  autoCreateScreen = false,
  api,
  screenCalib: providedScreenCalib,
  stream,
  displayName,
  existingScreenNames = [],
  resumeSession,
  autoAddTarget = false,
  firstScreenCalibration = false,
  includeSucceededTargets = false,
  keepSessionOnClose = false,
  onAdjustManually,
  onClose,
  onDetected,
  onSessionCreated,
  onSessionCancelled,
  onTargetDisplay,
  focusTargetId,
  existingScreen,
  existingScreens: providedExistingScreens,
}: {
  footerContainer?: HTMLElement | null;
  existingScreen?: { id: string; name: string };
  /** Recalibrate every saved screen of this camera in one marker pass. */
  existingScreens?: readonly {
    id: string;
    name: string;
    pageKey?: string;
  }[];
  focusTargetId?: string;
  /**
   * Where the panel lives. `drawer` keeps the camera visible beside it during
   * robot Setup, `modal` is a centred dialog wide enough for the three
   * calibration steps, and `inline` fills whatever container renders it.
   */
  variant?: 'drawer' | 'inline' | 'modal';
  /** QR-first first run: auto-create the screen and hide setup chrome. */
  simplified?: boolean;
  /**
   * Create the first screen without asking, but keep the full dialog: the
   * camera card and the correction dialog use this so a camera with no saved
   * screen starts at the QR code instead of a create-screen form.
   */
  autoCreateScreen?: boolean;
  api: RobotVisionClient;
  screenCalib?: ScreenCalibClient;
  stream?: CameraStreamInfo;
  displayName?: string;
  existingScreenNames?: readonly string[];
  resumeSession?: MarkerCalibrationCreateResult;
  /** Creates the next numbered target as soon as a completed session opens. */
  autoAddTarget?: boolean;
  /**
   * The camera has no saved screens yet, so every open screen page is a screen
   * of its own: add a target for each page and detect all of them in one pass.
   */
  firstScreenCalibration?: boolean;
  /** Reopens succeeded targets instead of treating them as already finished. */
  includeSucceededTargets?: boolean;
  keepSessionOnClose?: boolean;
  /**
   * The markers could not be read, so the caller can place the four corners by
   * hand instead. The dialog closes itself first: only one editor at a time.
   */
  onAdjustManually?: () => void;
  onClose: () => void;
  onDetected: (
    session: MarkerCalibrationSession,
    response: MarkerCalibrationDetectionResponse,
    detectedTargetIds: string[],
  ) => void | Promise<void>;
  onSessionCreated?: (session: MarkerCalibrationCreateResult) => void;
  onSessionCancelled?: (sessionId: string) => void;
  /** Reports the calibration display bound to each target (for the hand-off). */
  onTargetDisplay?: (targetId: string, displayId: string) => void;
}) {
  const language = useLanguage();
  const { message } = App.useApp();
  const [screenCalib] = useState(
    () => providedScreenCalib ?? new ScreenCalibClient(),
  );
  /*
   * A saved-screen recalibration keeps the existing ids so the applied result
   * updates those bindings. The camera-level Perspective Correction action may
   * pass every saved screen at once, while a single-screen action still passes
   * one.
   */
  const initialScreens: readonly {
    id: string;
    name: string;
    pageKey?: string;
  }[] = providedExistingScreens?.length
    ? providedExistingScreens
    : existingScreen
      ? [existingScreen]
      : [];
  const firstExistingScreen = initialScreens[0];
  const existingScreensKey = initialScreens
    .map((screen) => screen.id)
    .join('|');
  const initialScreensRef = useRef(initialScreens);
  initialScreensRef.current = initialScreens;
  const [screenName, setScreenName] = useState('');
  const reservedNames = useRef(existingScreenNames);
  reservedNames.current = existingScreenNames;
  const createGeneration = useRef(0);
  const autoScreenCreated = useRef(false);
  const [session, setSession] = useState<SessionView>();
  const [displays, setDisplays] = useState<Record<string, DisplayView>>({});
  const [devices, setDevices] = useState<ScreenDeviceSummary[]>([]);
  /** Calibration displays of every camera, used to spot pages that are taken. */
  const [targetDisplays, setTargetDisplays] = useState<TargetDisplaySession[]>(
    [],
  );
  const [screenAddresses, setScreenAddresses] = useState<LanAddress[]>([]);
  const [screenPublicUrl, setScreenPublicUrl] = useState<string>();
  const [screenPublicUrlConfigured, setScreenPublicUrlConfigured] =
    useState(false);
  const [bindAddress, setBindAddress] = useState<string>();
  const [bindLink, setBindLink] = useState<{
    path: string;
    expiresAt: number;
  }>();
  const [assignTarget, setAssignTarget] = useState<Record<string, string>>({});
  const [deviceError, setDeviceError] = useState<string>();
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [detecting, setDetecting] = useState(false);
  const [countdown, setCountdown] = useState<{
    seconds: number;
    retry: boolean;
  }>();
  const detectionController = useRef<AbortController>();
  const activeToken = useRef<string>();
  const activeSessionId = useRef<string>();
  const autoDetectFor = useRef<string>();
  const displaysRef = useRef<Record<string, DisplayView>>({});
  const ensuring = useRef(new Set<string>());
  const generation = useRef(0);

  const clearDisplays = useCallback(
    (closeServer: boolean) => {
      generation.current += 1;
      for (const display of Object.values(displaysRef.current))
        if (closeServer && display.id)
          void screenCalib
            .closeTargetDisplay(display.id)
            .catch(() => undefined);
      displaysRef.current = {};
      ensuring.current.clear();
      setDisplays({});
    },
    [screenCalib],
  );

  const ensureDisplays = useCallback(
    async (current: SessionView, targets: readonly TargetView[]) => {
      if (!targets.length) return;
      const start = generation.current;
      let listed: TargetDisplaySession[] = [];
      try {
        listed = await screenCalib.listTargetDisplays();
      } catch {
        listed = [];
      }
      for (const target of targets) {
        if (displaysRef.current[target.id] || ensuring.current.has(target.id))
          continue;
        const visionToken = target.token ?? current.token;
        if (!visionToken) continue;
        ensuring.current.add(target.id);
        try {
          const existing = listed.find(
            (candidate) =>
              candidate.visionSessionId === current.id &&
              candidate.visionTargetId === target.id &&
              (candidate.state === 'pending' || candidate.state === 'ready'),
          );
          const display =
            existing ??
            (await screenCalib.createTargetDisplay({
              visionSessionId: current.id,
              targetId: target.id,
              visionToken,
              language,
            }));
          // The dialog closed or moved to another session while awaiting.
          if (generation.current !== start) {
            if (display.id)
              void screenCalib
                .closeTargetDisplay(display.id)
                .catch(() => undefined);
            continue;
          }
          displaysRef.current = {
            ...displaysRef.current,
            [target.id]: { id: display.id, code: display.code },
          };
          onTargetDisplay?.(target.id, display.id);
        } catch (cause) {
          if (generation.current !== start) continue;
          displaysRef.current = {
            ...displaysRef.current,
            [target.id]: {
              id: '',
              code: '',
              error: cause instanceof Error ? cause.message : String(cause),
            },
          };
        } finally {
          ensuring.current.delete(target.id);
          if (generation.current === start)
            setDisplays({ ...displaysRef.current });
        }
      }
      if (generation.current === start) {
        try {
          await restoreMarkerPages(
            screenCalib,
            targets.map((target) => target.id),
            stream?.deviceId,
          );
        } catch (cause) {
          if (generation.current === start)
            setDeviceError(
              cause instanceof Error ? cause.message : String(cause),
            );
        }
      }
    },
    [language, onTargetDisplay, screenCalib],
  );

  const announcedDevices = useRef(new Set<string>());
  const restoringDevices = useRef(new Set<string>());
  const devicesActive = useRef(false);
  const handingOff = useRef(false);
  const refreshDevices = useCallback(async () => {
    try {
      // The display list is what tells an idle page apart from one that is
      // already serving another screen, so both lists travel together.
      const [result, listedDisplays] = await Promise.all([
        screenCalib.listScreenDevices(),
        screenCalib
          .listTargetDisplays()
          .catch(() => [] as TargetDisplaySession[]),
      ]);
      if (!devicesActive.current) return;
      setTargetDisplays(listedDisplays);
      let restoreError: string | undefined;
      for (const device of result.devices) {
        const desired =
          device.targetDisplayId &&
          Object.entries(displaysRef.current).some(
            ([targetId, display]) =>
              (!focusTargetId || targetId === focusTargetId) &&
              display.id === device.targetDisplayId,
          );
        if (
          desired &&
          !handingOff.current &&
          !detectionController.current &&
          device.mode !== 'markers' &&
          !restoringDevices.current.has(device.id)
        ) {
          restoringDevices.current.add(device.id);
          try {
            const assigned = await screenCalib.assignScreenDevice(device.id, {
              role: 'markers',
              targetDisplayId: device.targetDisplayId!,
              ...(stream?.deviceId ? { cameraId: stream.deviceId } : {}),
            });
            if (assigned.device) Object.assign(device, assigned.device);
          } catch (cause) {
            restoreError =
              cause instanceof Error ? cause.message : String(cause);
          } finally {
            restoringDevices.current.delete(device.id);
          }
        }
      }
      if (!devicesActive.current) return;
      for (const device of result.devices) {
        if (
          !device.targetDisplayId ||
          announcedDevices.current.has(device.targetDisplayId)
        )
          continue;
        announcedDevices.current.add(device.targetDisplayId);
        robotVoice.notify('deviceBound');
      }
      setDevices(result.devices);
      setScreenAddresses(result.addresses);
      setScreenPublicUrl(result.publicUrl);
      setScreenPublicUrlConfigured(result.publicUrlConfigured === true);
      setBindAddress((current) =>
        current && result.addresses.some((entry) => entry.address === current)
          ? current
          : result.addresses.find((entry) => entry.recommended)?.address,
      );
      setDeviceError(restoreError);
    } catch (cause) {
      if (devicesActive.current)
        setDeviceError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [screenCalib, focusTargetId, stream?.deviceId]);

  const resumeKey = existingScreensKey ? undefined : resumeSession?.id;
  useEffect(() => {
    if (!stream) return;
    devicesActive.current = true;
    void refreshDevices();
    const timer = window.setInterval(() => void refreshDevices(), 2000);
    return () => {
      devicesActive.current = false;
      window.clearInterval(timer);
    };
  }, [refreshDevices, stream?.id]);

  /** Screens this dialog is calibrating; their own pages may be handed back. */
  const ownTargetIds = new Set(
    (session?.targets ?? []).map((target) => target.id),
  );
  /**
   * A page bound to another screen's display is already showing that screen.
   * Handing it to this target would calibrate the same glass twice, so those
   * pages stay with the screen that owns them instead of being taken over.
   */
  const pageServesAnotherScreen = (device: ScreenDeviceSummary) => {
    const displayId = device.targetDisplayId;
    if (!displayId) return false;
    const display = targetDisplays.find((item) => item.id === displayId);
    if (!display || !['pending', 'ready'].includes(display.state)) return false;
    return !ownTargetIds.has(display.visionTargetId);
  };
  /**
   * A page may show this screen's markers when it is not bound to a live marker
   * display: a fresh page, or one connected for page mapping by the installation
   * dialog. A page already showing a marker display is left to the restore path,
   * a page bound to another camera stays with that camera, and a page whose
   * display cannot be identified is never taken over.
   */
  const pageCanBeClaimed = (device: ScreenDeviceSummary) => {
    if (device.cameraId && device.cameraId !== stream?.deviceId) return false;
    const displayId = device.targetDisplayId;
    if (!displayId) return true;
    const display = targetDisplays.find((item) => item.id === displayId);
    if (!display) return false;
    return !['pending', 'ready'].includes(display.state);
  };
  const availableDevices = devices.filter(
    (device) =>
      !pageServesAnotherScreen(device) &&
      !Object.values(displays).some(
        (display) => display.id === device.targetDisplayId,
      ),
  );
  const pagesServingOtherScreens = devices.filter(pageServesAnotherScreen);
  const calibrationTargets = (session?.targets ?? []).filter(
    (target) =>
      target.state !== 'succeeded' ||
      includeSucceededTargets ||
      target.id === focusTargetId,
  );
  const assignedTargetIds = new Set<string>();
  for (const device of devices) {
    if (!device.targetDisplayId) continue;
    for (const [targetId, display] of Object.entries(displays))
      if (display.id === device.targetDisplayId)
        assignedTargetIds.add(targetId);
  }
  const unassignedTargets = calibrationTargets.filter(
    (target) => !assignedTargetIds.has(target.id),
  );
  const nextTargetId = unassignedTargets[0]?.id;
  const bindTargetsKey = unassignedTargets
    .map((target) => `${target.id}:${target.token ?? ''}`)
    .join('|');
  /**
   * Pages that belong to this calibration: visible free ones plus the ones
   * already bound to a display of this session. A background page is not
   * counted, because its markers cannot be detected yet.
   */
  const pagesInSession = devices.filter(
    (device) =>
      (device.visible && pageCanBeClaimed(device)) ||
      (device.targetDisplayId !== undefined &&
        Object.values(displays).some(
          (display) => display.id === device.targetDisplayId,
        )),
  ).length;
  /** Pages and targets this dialog already asked the service to bind. */
  const claimedDevices = useRef(new Set<string>());
  const claimedTargets = useRef(new Set<string>());
  useEffect(() => {
    claimedDevices.current.clear();
    claimedTargets.current.clear();
  }, [session?.id]);

  /**
   * A page that is already on the phone is what makes the marker page appear:
   * without this assignment it stays a page-mapping surface and reports that
   * its screen coordinates are unavailable. Claim one visible page per
   * unassigned target, so the first calibration can show markers on every
   * screen at once; a manual choice below still wins later, and a page that
   * belongs to another screen is left alone. The page asks for full screen
   * itself once it is switched to markers.
   */
  useEffect(() => {
    if (!session) return;
    for (const device of devices) {
      if (!device.targetDisplayId) continue;
      const target = session.targets.find(
        (item) => displays[item.id]?.id === device.targetDisplayId,
      );
      if (!target) continue;
      claimedDevices.current.delete(device.id);
      claimedTargets.current.delete(target.id);
    }
    const used = new Set(claimedDevices.current);
    const savedPageKeys = new Map(
      initialScreensRef.current.flatMap((screen) =>
        screen.pageKey ? [[screen.id, screen.pageKey] as const] : [],
      ),
    );
    const reservedPageKeys = new Set(savedPageKeys.values());
    const claims: Array<{
      targetId: string;
      deviceId: string;
      displayId: string;
    }> = [];
    for (const target of unassignedTargets) {
      // One attempt per target: a target whose claim was rejected must not turn
      // every poll into another request.
      if (claimedTargets.current.has(target.id)) continue;
      const display = displays[target.id];
      if (!display?.id) continue;
      const savedPageKey = savedPageKeys.get(target.id);
      /*
       * A saved screen owns the page with its stable page key. Do not hand it a
       * different phone just because that phone is visible: a multi-screen
       * recalibration must map each target to its own page.
       */
      const available = devices.filter(
        (device) =>
          device.visible && !used.has(device.id) && pageCanBeClaimed(device),
      );
      const candidate =
        available.find((device) => device.screenId === target.id) ??
        available.find(
          (device) =>
            !device.screenId &&
            (savedPageKey
              ? device.pageKey === savedPageKey
              : !device.pageKey || !reservedPageKeys.has(device.pageKey)),
        );
      if (!candidate) continue;
      used.add(candidate.id);
      claims.push({
        targetId: target.id,
        deviceId: candidate.id,
        displayId: display.id,
      });
    }
    if (!claims.length) return;
    for (const claim of claims) {
      claimedDevices.current.add(claim.deviceId);
      claimedTargets.current.add(claim.targetId);
    }
    void Promise.all(
      claims.map((claim) =>
        screenCalib.assignScreenDevice(claim.deviceId, {
          role: 'markers',
          targetDisplayId: claim.displayId,
          ...(stream?.deviceId ? { cameraId: stream.deviceId } : {}),
        }),
      ),
    )
      .then(() => refreshDevices())
      .catch(() => {
        for (const claim of claims) {
          claimedDevices.current.delete(claim.deviceId);
          claimedTargets.current.delete(claim.targetId);
        }
      });
  }, [
    devices,
    displays,
    existingScreensKey,
    refreshDevices,
    screenCalib,
    session,
    targetDisplays,
    unassignedTargets,
  ]);

  useEffect(() => {
    if (!session || !bindTargetsKey || !screenPublicUrl) {
      setBindLink(undefined);
      return;
    }
    let cancelled = false;
    void screenCalib
      .createScreenBindLink({
        visionSessionId: session.id,
        targets: unassignedTargets.map((target) => ({
          id: target.id,
          token: target.token ?? '',
        })),
        language,
      })
      .then((link) => {
        if (!cancelled) setBindLink(link);
      })
      .catch(() => {
        if (!cancelled) setBindLink(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [bindTargetsKey, language, screenCalib, screenPublicUrl, session?.id]);

  const assignDevice = async (deviceId: string) => {
    const targetId = assignTarget[deviceId] ?? nextTargetId;
    const display = targetId ? displays[targetId] : undefined;
    if (!targetId || !display?.id) {
      setDeviceError(t('That screen page is still being created.'));
      return;
    }
    setDeviceError(undefined);
    try {
      await screenCalib.assignScreenDevice(deviceId, {
        role: 'markers',
        targetDisplayId: display.id,
        ...(stream?.deviceId ? { cameraId: stream.deviceId } : {}),
      });
      await refreshDevices();
    } catch (cause) {
      setDeviceError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const releaseDevice = async (deviceId: string) => {
    setDeviceError(undefined);
    try {
      await screenCalib.releaseScreenDevice(deviceId);
      await refreshDevices();
    } catch (cause) {
      setDeviceError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  // The screen-calib server serves the same page at `/`. Use the root plus
  // the bind fragment so a QR still opens when a deployment lacks the
  // `/screen.html` alias or sits behind a static/proxy layer that only maps `/`.
  const pageUrl = screenPublicUrl
    ? screenDeviceUrl(
        screenPublicUrl,
        screenPublicUrlConfigured ? undefined : bindAddress,
      )
    : undefined;
  const bindFragment = bindLink?.path.includes('#')
    ? bindLink.path.slice(bindLink.path.indexOf('#'))
    : undefined;
  const bindUrl =
    pageUrl && bindFragment ? `${pageUrl}${bindFragment}` : undefined;
  const qrValue = bindUrl ?? pageUrl;

  const close = useCallback(() => {
    detectionController.current?.abort();
    createGeneration.current++;
    const id = activeSessionId.current;
    const token = activeToken.current;
    if (id && token && !keepSessionOnClose) {
      void api.cancelMarkerCalibration(id, token).catch(() => undefined);
      onSessionCancelled?.(id);
    }
    if (!keepSessionOnClose) clearDisplays(true);
    activeSessionId.current = undefined;
    activeToken.current = undefined;
    onClose();
  }, [api, clearDisplays, keepSessionOnClose, onClose, onSessionCancelled]);

  useEffect(() => {
    if (!stream) return;
    if (existingScreensKey) {
      clearDisplays(true);
      activeToken.current = undefined;
      activeSessionId.current = undefined;
      setSession(undefined);
      setError(undefined);
      setCreating(true);
      const requestGeneration = ++createGeneration.current;
      const ids = initialScreensRef.current.map((screen) => screen.id);
      const createdRequest =
        ids.length === 1
          ? api.createMarkerCalibration(stream.id, undefined, ids[0])
          : api.createMarkerCalibration(stream.id, undefined, undefined, ids);
      void createdRequest
        .then((created) => {
          if (requestGeneration !== createGeneration.current) {
            void api
              .cancelMarkerCalibration(created.id, created.token)
              .catch(() => undefined);
            return;
          }
          activeToken.current = created.token;
          activeSessionId.current = created.id;
          setSession(created);
          onSessionCreated?.(created);
        })
        .catch((cause) => {
          if (requestGeneration === createGeneration.current)
            setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (requestGeneration === createGeneration.current)
            setCreating(false);
        });
      return () => {
        createGeneration.current++;
      };
    }
    if (resumeSession && resumeSession.streamId === stream.id) {
      activeToken.current = resumeSession.token;
      activeSessionId.current = resumeSession.id;
      setSession(
        mergeSession(undefined, {
          ...resumeSession,
          targets: resumeSession.targets.filter(
            (target) => !focusTargetId || target.id === focusTargetId,
          ),
        }),
      );
      setCreating(false);
      setError(undefined);
      return;
    }
    clearDisplays(true);
    activeToken.current = undefined;
    activeSessionId.current = undefined;
    setSession(undefined);
    setScreenName(
      nextScreenName(reservedNames.current.map((name) => ({ name }))),
    );
    setError(undefined);
    setCreating(false);
    return () => {
      createGeneration.current++;
    };
  }, [
    api,
    clearDisplays,
    resumeKey,
    stream?.id,
    focusTargetId,
    existingScreensKey,
    reconnectAttempt,
  ]);

  const createScreen = async (nameOverride?: string) => {
    if (!stream || creating) return;
    const name = (nameOverride ?? screenName).trim();
    if (
      !name ||
      reservedNames.current.some(
        (item) =>
          item.trim().toLocaleLowerCase('en-US') ===
          name.toLocaleLowerCase('en-US'),
      )
    ) {
      setError(t('Choose a screen name that is not already in use.'));
      return;
    }
    const generation = ++createGeneration.current;
    setCreating(true);
    setError(undefined);
    try {
      const created = await api.createMarkerCalibration(stream.id, [name]);
      if (generation !== createGeneration.current) {
        void api
          .cancelMarkerCalibration(created.id, created.token)
          .catch(() => undefined);
        return;
      }
      activeToken.current = created.token;
      activeSessionId.current = created.id;
      setSession(created);
      setScreenName('');
      onSessionCreated?.(created);
    } catch (cause) {
      if (generation === createGeneration.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (generation === createGeneration.current) setCreating(false);
    }
  };

  useEffect(() => {
    autoScreenCreated.current = false;
  }, [stream?.id]);

  useEffect(() => {
    if (
      !(simplified || autoCreateScreen) ||
      !stream ||
      resumeSession?.streamId === stream.id ||
      session ||
      existingScreensKey ||
      focusTargetId ||
      creating ||
      autoScreenCreated.current
    )
      return;
    autoScreenCreated.current = true;
    void createScreen(
      nextScreenName(reservedNames.current.map((name) => ({ name }))),
    );
  }, [
    simplified,
    autoCreateScreen,
    resumeKey,
    stream?.id,
    session?.id,
    existingScreensKey,
    focusTargetId,
    creating,
  ]);

  useEffect(() => {
    if (!session) return;
    const missing = calibrationTargets.filter(
      (target) => !displaysRef.current[target.id],
    );
    if (missing.length) void ensureDisplays(session, missing);
  }, [
    ensureDisplays,
    session?.id,
    calibrationTargets.map((target) => target.id).join('|'),
  ]);

  useEffect(() => {
    const id = session?.id;
    const token = session?.token ?? activeToken.current;
    if (!id || !token) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await api.markerCalibrationStatus(id, token);
        if (!next) throw new Error('Calibration status response is empty');
        if (!cancelled)
          setSession((current) =>
            mergeSession(current, {
              ...next,
              targets: next.targets.filter(
                (target) => !focusTargetId || target.id === focusTargetId,
              ),
            }),
          );
      } catch (cause) {
        if (!cancelled) {
          if (
            cause instanceof RobotVisionApiError &&
            [
              'MARKER_CALIBRATION_EXPIRED',
              'MARKER_CALIBRATION_NOT_FOUND',
            ].includes(cause.code ?? '')
          )
            onSessionCancelled?.(id);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    };
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, session?.id, session?.state, focusTargetId]);

  const active =
    session?.targets.some((target) => target.state === 'detecting') ||
    detecting;

  const readyPages = calibrationTargets.map((target) => {
    const device = devices.find(
      (candidate) =>
        candidate.targetDisplayId === displays[target.id]?.id &&
        candidate.mode === 'markers',
    );
    return device?.visible &&
      device.fullscreen &&
      device.markersReady &&
      (!target.display ||
        (Math.abs(device.width - target.display.cssWidthPx) <= 2 &&
          Math.abs(device.height - target.display.cssHeightPx) <= 2))
      ? device
      : undefined;
  });
  const pagesReady = readyPages.length > 0 && readyPages.every(Boolean);
  /**
   * The page is bound and showing markers but the phone is not fullscreen yet.
   * The browser only grants fullscreen from a tap on the phone, so name that
   * action instead of telling the operator to "keep it in fullscreen".
   */
  const fullscreenPending = calibrationTargets.some((target) => {
    const device = devices.find(
      (candidate) =>
        candidate.targetDisplayId === displays[target.id]?.id &&
        candidate.mode === 'markers',
    );
    return Boolean(device?.visible && !device.fullscreen);
  });
  const pageKey = (session?.targets ?? [])
    .map((target) => {
      const device = devices.find(
        (candidate) =>
          candidate.targetDisplayId === displays[target.id]?.id &&
          candidate.mode === 'markers',
      );
      return device
        ? `${device.id}:${device.pageInstanceId}:${device.width}:${device.height}:${device.visible}:${device.fullscreen}:${device.markersReady}`
        : '';
    })
    .join('|');

  useEffect(() => {
    return () => {
      detectionController.current?.abort();
      autoDetectFor.current = undefined;
    };
  }, [session?.id, pageKey]);

  const detect = useCallback(
    async (targetIds?: string[]) => {
      const token = session?.token ?? activeToken.current;
      if (
        !session ||
        !token ||
        !pagesReady ||
        detectionController.current ||
        session.targets.some((target) => target.state === 'detecting')
      )
        return;
      setDetecting(true);
      setError(undefined);
      const controller = new AbortController();
      detectionController.current = controller;
      handingOff.current = false;
      if (controller.signal.aborted) return;
      try {
        const failedTargetIds = calibrationTargets
          .filter((target) => target.state === 'failed')
          .map((target) => target.id);
        const unresolvedTargetIds = calibrationTargets.map(
          (target) => target.id,
        );
        const selectedTargetIds = targetIds?.length
          ? targetIds
          : focusTargetId
            ? [focusTargetId]
            : failedTargetIds.length
              ? unresolvedTargetIds
              : unresolvedTargetIds.length === session.targets.length
                ? undefined
                : unresolvedTargetIds;
        const detectionTargetIds =
          selectedTargetIds ?? session.targets.map((target) => target.id);
        if (!detectionTargetIds.length) return;
        await prepareMarkerPagesForDetection(screenCalib, detectionTargetIds, {
          ...(stream?.deviceId ? { cameraId: stream.deviceId } : {}),
        });
        if (controller.signal.aborted) return;
        const temporal = session.targets.some(
          (target) => target.layout?.method === 'temporal',
        );
        const response = await detectMarkersWithRetry(
          api,
          session.id,
          token,
          selectedTargetIds,
          {
            signal: controller.signal,
            temporal,
            countdown(seconds, retry) {
              setCountdown(seconds ? { seconds, retry } : undefined);
              if (seconds === 0) robotCue.play('shutter');
              if (seconds === 3)
                robotVoice.notify(
                  retry ? 'markersRetry' : 'markersCountdown',
                  1,
                );
            },
            response(response) {
              setSession((current) =>
                mergeSession(current, {
                  ...response.session,
                  targets: response.session.targets.filter(
                    (target) => !focusTargetId || target.id === focusTargetId,
                  ),
                }),
              );
            },
          },
        );
        const succeeded = response.session.targets.some(
          (target) =>
            detectionTargetIds.includes(target.id) &&
            target.state === 'succeeded',
        );
        robotCue.play(succeeded ? 'found' : 'click');
        setSession(
          mergeSession(session, {
            ...response.session,
            targets: response.session.targets.filter(
              (target) => !focusTargetId || target.id === focusTargetId,
            ),
          }),
        );
        // Keep the calibration displays after success: the console hands each
        // assigned page over to page mapping without a second scan.
        handingOff.current = true;
        await onDetected(response.session, response, detectionTargetIds);
        activeSessionId.current = undefined;
        activeToken.current = undefined;
        onClose();
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof RobotVisionApiError && cause.details?.targetErrors)
          setError(String(cause.details.targetErrors));
        else setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (detectionController.current === controller)
          detectionController.current = undefined;
        setCountdown(undefined);
        setDetecting(false);
      }
    },
    [
      api,
      calibrationTargets,
      clearDisplays,
      detecting,
      onClose,
      onDetected,
      session,
      focusTargetId,
      pagesReady,
      screenCalib,
    ],
  );

  const allDisplayReady = Boolean(
    calibrationTargets.length &&
      calibrationTargets.every(
        (target) =>
          target.state === 'display-ready' ||
          (includeSucceededTargets &&
            calibrationTargets.length > 1 &&
            target.state === 'succeeded'),
      ),
  );
  const retryingAfterFailure = Boolean(
    session?.targets.length &&
      session.targets.some((target) => target.state === 'failed'),
  );
  const canDetect = Boolean(
    calibrationTargets.length &&
      calibrationTargets.every((target) =>
        ['display-ready', 'failed', 'succeeded'].includes(target.state),
      ),
  );
  // The phone page for every screen must exist before detection runs, so a
  // quick camera result cannot leave an unclaimed display session behind.
  const displaysResolved = Boolean(
    calibrationTargets.length &&
      calibrationTargets.every((target) => Boolean(displays[target.id])),
  );

  useEffect(() => {
    if (
      !session ||
      !allDisplayReady ||
      !pagesReady ||
      !displaysResolved ||
      detecting ||
      // Wait for the first calibration to give every open page a target, so a
      // second screen that is still being added is not left out of the pass.
      (firstScreenCalibration && pagesInSession > session.targets.length) ||
      autoDetectFor.current === session.id
    )
      return;
    autoDetectFor.current = session.id;
    void detect();
  }, [
    allDisplayReady,
    firstScreenCalibration,
    pagesInSession,
    pagesReady,
    detect,
    displaysResolved,
    session?.id,
    session?.targets.length,
    detecting,
  ]);

  const addScreen = async (): Promise<boolean> => {
    const current = session;
    const token = current?.token ?? activeToken.current;
    if (
      !current ||
      !token ||
      current.targets.length >= MAX_MARKER_CALIBRATION_TARGETS ||
      creating ||
      active
    )
      return false;
    const wanted = screenName.trim();
    if (
      wanted &&
      [
        ...current.targets.map((target) => target.name),
        ...reservedNames.current,
      ].some(
        (name) =>
          name.trim().toLocaleLowerCase('en-US') ===
          wanted.toLocaleLowerCase('en-US'),
      )
    ) {
      setError(t('Choose a screen name that is not already in use.'));
      return false;
    }
    setCreating(true);
    setError(undefined);
    try {
      const added = await api.addMarkerCalibrationTarget(
        current.id,
        token,
        screenName.trim() ||
          nextScreenName([
            ...current.targets,
            ...reservedNames.current.map((name) => ({ name })),
          ]),
      );
      const merged = mergeSession(current, added.session);
      const targets = merged.targets.map((target) =>
        target.id === added.target.id ? { ...target, ...added.target } : target,
      );
      const next: SessionView = { ...merged, targets };
      setSession(next);
      setScreenName('');
      const addedTarget = targets.find(
        (target) => target.id === added.target.id,
      );
      if (addedTarget) void ensureDisplays(next, [addedTarget]);
      onSessionCreated?.({
        ...next,
        token,
        targets: targets.map((target) => ({
          ...target,
          token: target.token ?? '',
        })),
      });
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setCreating(false);
    }
  };

  const autoAddedTargetFor = useRef<string>();
  useEffect(() => {
    if (
      !autoAddTarget ||
      !session ||
      creating ||
      active ||
      calibrationTargets.length > 0 ||
      autoAddedTargetFor.current === session.id
    )
      return;
    autoAddedTargetFor.current = session.id;
    void addScreen();
  }, [active, autoAddTarget, calibrationTargets.length, creating, session?.id]);

  /**
   * A first calibration faces however many screens the operator opened pages
   * for, and the service detects all of them in one pass. Add a target for each
   * extra page instead of making the operator add screens one at a time; the
   * operator still adds screens by hand after the first calibration, where the
   * saved screens decide how many targets exist.
   */
  const autoTargetBlocked = useRef<string>();
  useEffect(() => {
    if (!firstScreenCalibration || !session || creating || active) return;
    if (autoTargetBlocked.current === session.id) return;
    if (session.targets.length >= MAX_MARKER_CALIBRATION_TARGETS) return;
    if (session.targets.length >= Math.max(1, pagesInSession)) return;
    void addScreen().then((added) => {
      if (!added) autoTargetBlocked.current = session.id;
    });
  }, [
    active,
    addScreen,
    creating,
    firstScreenCalibration,
    pagesInSession,
    session,
  ]);

  const removeScreen = async (targetId: string) => {
    const current = session;
    if (!current || creating || active) return;
    const token = current.token ?? activeToken.current;
    if (!token) return;
    setCreating(true);
    setError(undefined);
    try {
      if (current.targets.length === 1) {
        await api.cancelMarkerCalibration(current.id, token);
        const display = displaysRef.current[targetId];
        if (display?.id) await screenCalib.closeTargetDisplay(display.id);
        clearDisplays(false);
        activeSessionId.current = undefined;
        activeToken.current = undefined;
        setSession(undefined);
        setScreenName(current.targets[0].name);
        onSessionCancelled?.(current.id);
        return;
      }
      const updated = await api.removeMarkerCalibrationTarget(
        current.id,
        targetId,
        token,
      );
      const removed = displaysRef.current[targetId];
      if (removed?.id)
        void screenCalib.closeTargetDisplay(removed.id).catch(() => undefined);
      if (removed) {
        const remaining = { ...displaysRef.current };
        delete remaining[targetId];
        displaysRef.current = remaining;
        setDisplays(remaining);
      }
      const nextSession = mergeSession(current, updated);
      setSession(nextSession);
      onSessionCreated?.({
        ...nextSession,
        token,
        targets: nextSession.targets.map((target) => ({
          ...target,
          token: target.token ?? '',
        })),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  };

  const copyText = (value: string, success: string, failure: string) => {
    void navigator.clipboard
      .writeText(value)
      .then(() => message.success(success))
      .catch(() => message.error(failure));
  };

  const detectedCount =
    session?.targets.filter((target) => target.state === 'succeeded').length ??
    0;
  const currentStep =
    detectedCount === session?.targets.length && detectedCount > 0
      ? 2
      : (allDisplayReady && pagesReady) || active
        ? 1
        : 0;

  return (
    <MarkerCalibrationPanel
      variant={variant}
      footerContainer={footerContainer}
      open={Boolean(stream)}
      title={t('Marker Calibration · {0}', [displayName ?? ''])}
      onClose={close}
      footer={
        <Space wrap>
          <Button onClick={close}>{t('Cancel')}</Button>
          {/*
            Detection is the primary path, but the glass is sometimes visible
            when the markers are not (glare, focus, a cropped marker). Offer the
            manual corner editor exactly when a pass has failed, and close this
            panel first so the operator sees one editor at a time.
          */}
          {onAdjustManually && session && (error || retryingAfterFailure) && (
            <Button
              onClick={() => {
                close();
                onAdjustManually();
              }}
            >
              {t('Place the corners manually')}
            </Button>
          )}
          {existingScreensKey && error && !session && (
            <Button
              onClick={() => setReconnectAttempt((value) => value + 1)}
              disabled={creating}
            >
              {t('Retry')}
            </Button>
          )}
          {simplified && !session && error && (
            <Button
              onClick={() => {
                autoScreenCreated.current = false;
                void createScreen(
                  nextScreenName(
                    reservedNames.current.map((name) => ({ name })),
                  ),
                );
              }}
            >
              {t('Retry')}
            </Button>
          )}
          {(!simplified || retryingAfterFailure || error) && (
            <Button
              className="marker-calibration-submit"
              type="primary"
              icon={<ScanLine size={16} />}
              disabled={!canDetect || !pagesReady}
              loading={active || detecting}
              onClick={() => void detect()}
            >
              {t(
                retryingAfterFailure
                  ? 'Retry Screen Calibration'
                  : (session?.targets.length ?? 1) > 1
                    ? 'Detect Screens'
                    : 'Detect Markers',
              )}
            </Button>
          )}
        </Space>
      }
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert
          showIcon
          type="info"
          description={
            !simplified && existingScreensKey
              ? t('Keep the screen and camera in their calibrated positions.')
              : undefined
          }
          message={t(
            simplified
              ? session && unassignedTargets.length === 0
                ? 'Screen devices are already bound'
                : 'Scan the QR code with the phone'
              : existingScreensKey
                ? initialScreens.length > 1
                  ? 'Connect each phone page to its saved screen.'
                  : 'Connect the phone page to the saved screen {0}.'
                : focusTargetId
                  ? 'Recalibrate Screen'
                  : session && unassignedTargets.length === 0
                    ? 'Screen devices are already bound'
                    : 'Create a screen, then bind its device page',
            [firstExistingScreen?.name ?? ''],
          )}
        />
        {!simplified && !focusTargetId && !existingScreensKey && (
          <Space.Compact style={{ width: '100%' }}>
            <Input
              aria-label={t('Screen Name')}
              value={screenName}
              maxLength={120}
              placeholder={
                session
                  ? nextScreenName([
                      ...session.targets,
                      ...reservedNames.current.map((name) => ({ name })),
                    ])
                  : t('Screen Name')
              }
              disabled={creating || active}
              onChange={(event) => setScreenName(event.target.value)}
              onPressEnter={() => void (session ? addScreen() : createScreen())}
            />
            {session ? (
              <Button
                disabled={
                  !session ||
                  session.targets.length >= MAX_MARKER_CALIBRATION_TARGETS ||
                  creating ||
                  active
                }
                icon={<Plus size={16} />}
                onClick={() => void addScreen()}
              >
                {t('Add Screen')}
              </Button>
            ) : (
              <Button
                type="primary"
                loading={creating}
                disabled={!screenName.trim()}
                onClick={() => void createScreen()}
              >
                {t('Create Screen')}
              </Button>
            )}
          </Space.Compact>
        )}
        {!simplified && (
          <Steps
            size="small"
            current={currentStep}
            items={[
              {
                title: t('Pair Phone'),
                description: t(
                  'Open the screen page on the phone and keep it visible in fullscreen.',
                ),
              },
              {
                title: t('Detect Markers'),
                description: t(
                  'Detection starts automatically after the paired page is ready.',
                ),
              },
              {
                title: t('Review and Apply'),
                description: t(
                  'Check the screen outline and corrected image before using the result.',
                ),
              },
            ]}
          />
        )}

        {session && unassignedTargets.length > 0 && (
          <Card
            className={`marker-pairing-card${simplified ? ' marker-pairing-simple' : ''}`}
            size="small"
            title={t(
              simplified
                ? 'Scan to connect the phone'
                : 'Connect a screen page',
            )}
          >
            <div className="marker-pairing-layout">
              <div
                aria-label={t('Screen page QR code')}
                className="marker-pairing-qr"
                role="img"
              >
                {qrValue ? (
                  <QRCode
                    type="svg"
                    value={qrValue}
                    size={simplified ? 176 : 128}
                  />
                ) : null}
                <Typography.Text type="secondary">
                  {simplified
                    ? t(
                        'Scan with the phone. Keep the page visible and in fullscreen; detection starts by itself.',
                      )
                    : unassignedTargets.length
                      ? t('Scan this code on the next empty screen.')
                      : t('All screens are assigned to a screen page.')}
                </Typography.Text>
              </div>
              {(simplified || autoCreateScreen) && (
                <div className="marker-pairing-manual">
                  <Typography.Text strong>
                    {t('Screen page address')}
                  </Typography.Text>
                  {pageUrl ? (
                    <Typography.Paragraph
                      className="marker-pairing-manual-url"
                      copyable={{ text: pageUrl }}
                    >
                      {pageUrl}
                    </Typography.Paragraph>
                  ) : (
                    <Typography.Text type="secondary">
                      {t('Waiting for the screen page address…')}
                    </Typography.Text>
                  )}
                  <Typography.Text type="secondary">
                    {t(
                      'Open this address on the phone. The QR code binds it automatically.',
                    )}
                  </Typography.Text>
                </div>
              )}
              {!simplified && (
                <div className="marker-pairing-controls">
                  <Typography.Text strong>
                    {t('Screen page address')}
                  </Typography.Text>
                  <Space.Compact style={{ width: '100%' }}>
                    <Select
                      aria-label={t('Screen page address')}
                      value={bindAddress}
                      placeholder={
                        screenPublicUrl
                          ? new URL(screenPublicUrl).host
                          : undefined
                      }
                      disabled={screenAddresses.length < 2}
                      options={screenAddresses.map((entry) => ({
                        value: entry.address,
                        label: `${entry.address} · ${entry.name}`,
                      }))}
                      onChange={setBindAddress}
                      style={{ flex: 1 }}
                    />
                    <Button
                      aria-label={t('Copy screen page address')}
                      icon={<Copy size={16} />}
                      disabled={!bindUrl}
                      onClick={() => {
                        if (bindUrl)
                          copyText(
                            bindUrl,
                            t('Address copied'),
                            t('Unable to copy the address'),
                          );
                      }}
                    />
                    <Button
                      aria-label={t('Open screen page here')}
                      icon={<ExternalLink size={16} />}
                      disabled={!bindUrl}
                      onClick={() => {
                        if (bindUrl) window.open(bindUrl, '_blank', 'noopener');
                      }}
                    />
                  </Space.Compact>
                  <Typography.Text type="secondary">
                    {t(
                      'Each new page binds the next unassigned screen; opened pages appear below.',
                    )}
                  </Typography.Text>
                  <Typography.Text strong>
                    {t('Available screen pages')}
                  </Typography.Text>
                  {availableDevices.length ? (
                    <Space
                      direction="vertical"
                      size={6}
                      style={{ width: '100%' }}
                    >
                      {availableDevices.map((device) => (
                        <Space key={device.id} wrap>
                          <Tag>{device.label}</Tag>
                          <Typography.Text type="secondary">
                            {device.width} × {device.height}
                          </Typography.Text>
                          <Select
                            aria-label={t('Assign {0} to a screen', [
                              device.label,
                            ])}
                            value={assignTarget[device.id] ?? nextTargetId}
                            onChange={(value) =>
                              setAssignTarget((current) => ({
                                ...current,
                                [device.id]: value,
                              }))
                            }
                            options={calibrationTargets.map((target) => ({
                              value: target.id,
                              label: `${(session?.targets.indexOf(target) ?? 0) + 1}. ${target.name}`,
                            }))}
                            style={{ minWidth: 180 }}
                          />
                          <Button
                            size="small"
                            onClick={() => void assignDevice(device.id)}
                          >
                            {t('Assign')}
                          </Button>
                        </Space>
                      ))}
                    </Space>
                  ) : (
                    <Typography.Text type="secondary">
                      {t('Waiting for a screen page to open...')}
                    </Typography.Text>
                  )}
                </div>
              )}
            </div>
            {pagesServingOtherScreens.length ? (
              <Alert
                className="marker-pairing-notice"
                showIcon
                type="info"
                message={t(
                  '{0} is connected to another screen. Open the page on the screen you are calibrating.',
                  [
                    pagesServingOtherScreens
                      .map((device) => device.label)
                      .join(', '),
                  ],
                )}
              />
            ) : null}
          </Card>
        )}
        {deviceError ? (
          <Alert showIcon type="warning" message={deviceError} />
        ) : null}
        {!simplified && (
          <div className="marker-target-list">
            {(session?.targets ?? []).map((target, index) => {
              const display = displays[target.id];
              const assigned = display
                ? devices.find(
                    (device) =>
                      device.mode === 'markers' &&
                      device.targetDisplayId === display.id,
                  )
                : undefined;
              return (
                <Card
                  key={target.id}
                  size="small"
                  title={`${index + 1}. ${target.name}`}
                  extra={
                    <Space size={6}>
                      <Tag
                        color={
                          target.state === 'succeeded' &&
                          !includeSucceededTargets
                            ? 'green'
                            : assigned
                              ? 'blue'
                              : undefined
                        }
                      >
                        {target.state === 'succeeded' &&
                        !includeSucceededTargets
                          ? t('Calibrated')
                          : assigned
                            ? t('Assigned to {0}', [assigned.label])
                            : t('Unassigned')}
                      </Tag>
                      {!focusTargetId && (session?.targets.length ?? 0) > 0 ? (
                        <Button
                          danger
                          disabled={creating || active}
                          icon={<Trash2 size={14} />}
                          aria-label={t('Remove {0}', [target.name])}
                          title={t('Remove {0}', [target.name])}
                          onClick={() => void removeScreen(target.id)}
                          size="small"
                          type="text"
                        >
                          {t('Remove')}
                        </Button>
                      ) : null}
                    </Space>
                  }
                >
                  <Space
                    direction="vertical"
                    size={8}
                    style={{ width: '100%' }}
                  >
                    {assigned ? (
                      <Button
                        size="small"
                        onClick={() => void releaseDevice(assigned.id)}
                      >
                        {t('Release {0}', [assigned.label])}
                      </Button>
                    ) : null}
                    {target.error ? (
                      <Alert showIcon type="error" message={target.error} />
                    ) : null}
                    {display?.error ? (
                      <Alert showIcon type="warning" message={display.error} />
                    ) : null}
                  </Space>
                </Card>
              );
            })}
          </div>
        )}
        {creating ? (
          <Alert
            showIcon
            type="info"
            message={t('Creating calibration session...')}
          />
        ) : null}
        {countdown ? (
          <Alert
            showIcon
            type="info"
            message={t(
              countdown.retry
                ? 'Keep still. Retrying in {0}…'
                : 'Move your hand away. Detecting in {0}…',
              [countdown.seconds],
            )}
          />
        ) : calibrationTargets.length > 0 && !active ? (
          <Alert
            showIcon
            type={pagesReady ? 'success' : 'info'}
            message={t(
              pagesReady
                ? 'All screens are ready'
                : fullscreenPending
                  ? 'Tap Enter full screen on the phone; detection starts by itself.'
                  : 'Keep the device page visible and in fullscreen.',
            )}
          />
        ) : null}
        {active && !countdown ? (
          <Alert showIcon type="info" message={t('Detecting markers')} />
        ) : null}
        <SetupNotice
          notice={
            creating
              ? undefined
              : selectSetupNotice(
                  error
                    ? {
                        tone: 'error',
                        title: t('Marker detection failed'),
                        description: t(error),
                      }
                    : undefined,
                )
          }
        />
      </Space>
    </MarkerCalibrationPanel>
  );
}

export function MarkerCalibrationPanel({
  variant,
  footerContainer,
  open,
  title,
  onClose,
  footer,
  children,
}: {
  footerContainer?: HTMLElement | null;
  variant: 'drawer' | 'inline' | 'modal';
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  if (!open) return null;
  if (variant === 'modal')
    return (
      <Modal
        centered
        className="robot-dialog marker-calibration-modal marker-calibration-dialog"
        footer={footer}
        onCancel={onClose}
        open
        title={title}
        width="min(960px, 94vw)"
      >
        <div className="marker-calibration-dialog-body">{children}</div>
      </Modal>
    );
  if (variant === 'drawer')
    return (
      <Drawer
        rootClassName="robot-drawer marker-calibration-modal marker-calibration-sidebar"
        placement="right"
        mask={false}
        width={400}
        open
        title={title}
        onClose={onClose}
        footer={footer}
      >
        {children}
      </Drawer>
    );
  return (
    <section
      className="marker-calibration-modal marker-calibration-sidebar"
      aria-label={typeof title === 'string' ? title : undefined}
    >
      <header className="marker-calibration-sidebar-header">
        <Typography.Text strong>{title}</Typography.Text>
        <Button aria-label={t('Close')} onClick={onClose}>
          {t('Close')}
        </Button>
      </header>
      <div className="marker-calibration-sidebar-body">{children}</div>
      {footerContainer ? (
        createPortal(footer, footerContainer)
      ) : (
        <footer className="marker-calibration-sidebar-footer">{footer}</footer>
      )}
    </section>
  );
}
