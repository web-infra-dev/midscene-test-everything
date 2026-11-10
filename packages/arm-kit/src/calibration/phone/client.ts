import type {
  CALIBRATION_PHONE_POLICY,
  CALIBRATION_POINT_POLICY,
  CalibrationPageLayout,
  CalibrationPageReply,
  CalibrationPageUpdate,
  WebPoint,
} from '../../assisted-contracts.js';

/** Serialized into the phone HTML: keep runtime dependencies inside this function. */
export function mountCalibrationPhonePage(
  policy: Pick<
    typeof CALIBRATION_POINT_POLICY,
    'touchSpreadPx' | 'targetRadiusPx'
  > &
    typeof CALIBRATION_PHONE_POLICY & { verificationRadiusPx: number },
  pageId: string,
  awake: {
    start(): Promise<void>;
    status(): {
      locked: boolean;
      videoPlaying: boolean;
      playbackError: string | null;
    };
    stop(): Promise<void>;
    detach(): void;
    resume(): void;
  },
): void {
  const zh = (
    new URLSearchParams(location.search).get('lang') || navigator.language
  ).startsWith('zh');
  const text = {
    keepOpen: [
      '保持本页打开，在电脑端选择此设备。',
      'Keep this page open and select this device on your computer.',
    ],
    waiting: [
      '已连接，请在电脑端继续。',
      'Connected. Continue on your computer.',
    ],
    preview: [
      '轻触或滑动可查看实际触点。',
      'Touch or slide to see the contact trace.',
    ],
    closed: ['标记预览已结束。', 'Marker preview closed.'],
    connecting: ['正在连接电脑…', 'Connecting to your computer…'],
    position: [
      '请先在电脑端记录屏幕上方的标定参考位。',
      'Record a calibration reference position above the screen on your computer.',
    ],
    slide: [
      '正在滑向下一个采样点，请勿触碰手机。',
      'Sliding to the next sample. Do not touch the phone.',
    ],
    recover: [
      '当前点触摸丢失，正在有限范围内重新探测。',
      'Touch lost at this point. Recovering within the bounded range.',
    ],
    release: ['正在抬笔确认触摸释放。', 'Lifting to confirm touch release.'],
    search: [
      '正在逐步寻找接触高度。',
      'Finding screen contact in bounded steps.',
    ],
    refine: ['正在细化接触高度。', 'Refining the contact height.'],
    press: ['正在确认稳定触摸。', 'Confirming stable touch.'],
    travel: ['正在屏幕上方移向下一个点。', 'Moving above the next point.'],
    recorded: [
      '此点已记录，继续采样。',
      'Point recorded. Continuing collection.',
    ],
    recoveryFailed: [
      '此点未恢复触摸，采样已停止。请查看电脑端失败位置。',
      'Touch recovery failed. Sampling stopped; review the endpoint on the computer.',
    ],
    collect: [
      '机械臂正在自动探测，请勿触碰手机或机械臂。',
      'Automatic probing is running. Do not touch the phone or robot.',
    ],
    retry: [
      '本轮采集未通过，拖动模式保持开启。请查看电脑端提示，选择重新采集。',
      'Collection needs retry. Drag Mode remains active. Check the computer and collect again.',
    ],
    hold: [
      '正在记录本步触点，请保持工作区清空…',
      'Recording this step’s touch. Keep the workspace clear…',
    ],
    movement: [
      '请稍微停一下，正在等待稳定读数。',
      'Pause briefly. Waiting for steady readings.',
    ],
    latency: [
      '读数延迟，正在继续采集。',
      'Readings delayed. Continuing collection.',
    ],
    lift: [
      '已记录，机械臂正在自动抬笔。',
      'Recorded. The robot is lifting automatically.',
    ],
    returnReady: [
      '请在电脑端确认安全位置，保持工作区清空。',
      'Check the safe position on the computer and keep the work area clear.',
    ],
    returning: [
      '正在回到安全位置，请保持工作区清空。',
      'Returning to the safe position. Keep the workspace clear.',
    ],
    safe: [
      '正在自动检查悬停与接触边界，请保持工作区清空。',
      'Automatically verifying hover and contact boundaries. Keep the workspace clear.',
    ],
    verify: [
      '正在验证点击，请勿触碰手机。',
      'Verifying touches. Do not touch the phone.',
    ],
    review: [
      '边界验证完成，请在电脑端查看结果。',
      'Boundary verification complete. Review the results on your computer.',
    ],
    done: [
      '标定已完成，可返回手机应用。',
      'Calibration complete. You can return to your app.',
    ],
    interrupted: [
      '标定已中断，请在电脑端重新开始。',
      'Calibration interrupted. Start again on your computer.',
    ],
    offline: [
      '与电脑的连接已断开，正在自动重连…',
      'Disconnected. Reconnecting automatically…',
    ],
    replaced: [
      '标定已切换到新页面，可以关闭此页。',
      'Calibration switched to a new page. You can close this one.',
    ],
  };
  const label = (key: keyof typeof text) => text[key][zh ? 0 : 1];
  const element = (id: string) => {
    const value = document.getElementById(id);
    if (!value) throw new Error(`Missing calibration element: ${id}`);
    return value;
  };
  const message = element('message');
  const pageTitle = element('page-title');
  const connection = element('connection');
  const target = element('target');
  const number = element('target-number');
  const hideGuidance = () => {
    target.style.display = 'none';
  };
  hideGuidance();
  message.textContent = label('connecting');
  const newId = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now();
  const browserInstanceId = pageId;
  let instanceKey = `midscene-screen-instance:${location.search}`;
  let resumeBrowserInstanceId: string | undefined;
  let claimBrowserInstance = false;
  try {
    const navigation = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (navigation?.type === 'reload')
      resumeBrowserInstanceId =
        sessionStorage.getItem(instanceKey) ?? undefined;
  } catch {
    // Storage restrictions only prevent automatic refresh recovery.
  }
  const pairing = { revision: 1, layoutKey: '' };
  let sequence = 0;
  let eventSequence = 0;
  const touchEvents: NonNullable<CalibrationPageUpdate['touchEvents']> = [];
  const trace = (
    kind: (typeof touchEvents)[number]['kind'],
    detail?: string,
    point?: WebPoint,
    metadata?: Partial<
      Pick<
        (typeof touchEvents)[number],
        | 'source'
        | 'targetElement'
        | 'defaultPrevented'
        | 'nativeTimestampMs'
        | 'dispatchDelayMs'
      >
    >,
  ) => {
    const entry: (typeof touchEvents)[number] = {
      sequence: ++eventSequence,
      elapsedMs: performance.now(),
      kind,
      targetId: state?.capture?.target.id,
      stepId: state?.capture?.step?.id,
      detail,
      point,
      ...metadata,
    };
    touchEvents.push(entry);
    if (touchEvents.length > 40) touchEvents.shift();
    return entry;
  };
  let reportedWake: CalibrationPageUpdate['wakeState'];
  const wakeState = (): CalibrationPageUpdate['wakeState'] => {
    const state = awake.status();
    if (state.locked) return 'system';
    if (state.videoPlaying) return 'video';
    return state.playbackError ? 'blocked' : 'pending';
  };
  let lastFeedbackKey = '';
  let activePointer: number | undefined;
  const pointers = new Map<number, { id: string; point: WebPoint }>();
  let ambiguousPointers = false;
  let probeUnknown: 'multiple_contacts' | undefined;
  let downAt = 0;
  let travelPx = 0;
  let contact: WebPoint | undefined;
  let contactId: string | undefined;
  let contactStart: CalibrationPageUpdate['contactStart'];
  let phoneStep: NonNullable<CalibrationPageReply['capture']>['step'];
  let motionRevision = 0;
  let stabilityOrigin: WebPoint;
  let downPoint: WebPoint;
  let downTarget: string | undefined;
  let readyTarget: string | undefined;
  let captureAck: string | undefined;
  let touches: NonNullable<CalibrationPageUpdate['touches']> = [];
  let state: CalibrationPageReply | undefined;
  let socket: WebSocket;
  const ua = navigator.userAgent || '';
  const androidModel = ua
    .match(/Android[^;()]*;[^()]*?;?\s*([^;()]+?)\s+Build\//i)?.[1]
    ?.trim();
  let model =
    ua.match(/iPhone|iPad/i)?.[0] ||
    (androidModel && androidModel !== 'K'
      ? androidModel
      : /Android/i.test(ua)
        ? 'Android'
        : undefined);
  const hints = (
    navigator as Navigator & {
      userAgentData?: {
        getHighEntropyValues(keys: string[]): Promise<{ model?: string }>;
      };
    }
  ).userAgentData;
  hints
    ?.getHighEntropyValues(['model'])
    .then((data) => {
      if (data.model?.trim()) {
        model = data.model.trim().slice(0, 80);
        send();
      }
    })
    .catch(() => {});

  // Match midscene-private/dev's screen page: read env() through actual CSS
  // lengths and keep measurements tied to the viewport that produced them.
  const viewportKey = () =>
    JSON.stringify([
      innerWidth,
      innerHeight,
      window.screen.width,
      window.screen.height,
      window.screen.orientation?.type,
      visualViewport?.scale,
      visualViewport?.offsetTop,
    ]);
  let safeArea:
    | ({ key: string } & NonNullable<
        NonNullable<CalibrationPageLayout['insetDiagnostics']>['safeArea']
      >)
    | undefined;
  let insetReason = 'not-evaluated';
  let lastInsetTouch: NonNullable<
    CalibrationPageLayout['insetDiagnostics']
  >['touch'];
  let screenOrigin: { key: string; y: number } | undefined;
  function iosTopInset(gap: number): number | undefined {
    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    if (!ios || gap <= 0) {
      insetReason = !ios ? 'not-ios' : 'no-viewport-gap';
      return undefined;
    }
    const key = viewportKey();
    if (safeArea?.key !== key) {
      const probe = document.createElement('div');
      probe.style.cssText =
        'position:fixed;left:-9999px;top:0;width:0;height:0;' +
        'padding-top:env(safe-area-inset-top);' +
        'padding-bottom:env(safe-area-inset-bottom);';
      document.body.appendChild(probe);
      const style = getComputedStyle(probe);
      safeArea = {
        key,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        top: Number.parseFloat(style.paddingTop) || 0,
        bottom: Number.parseFloat(style.paddingBottom) || 0,
      };
      probe.remove();
    }
    const measured =
      screenOrigin?.key === key && screenOrigin.y <= gap
        ? screenOrigin.y
        : undefined;
    const { top, bottom } = safeArea;
    if (top <= 0 && bottom <= 0 && !(measured !== undefined && measured > 0)) {
      insetReason = 'no-safe-area-or-positive-touch-origin';
      return undefined;
    }
    // If the viewport already includes the safe areas, only the bottom toolbar
    // remains outside it. Otherwise split off the status bar at the top.
    const inset = gap >= top + bottom ? top : 0;
    const corroborated =
      measured !== undefined && Math.abs(measured - inset) <= 3;
    insetReason = corroborated ? 'touch-corroborated' : 'safe-area-inference';
    return corroborated ? measured : inset;
  }
  for (const type of ['pointerdown', 'touchstart'] as const) {
    window.addEventListener(
      type,
      (event) => {
        // Do not revise the accepted mapping from automated calibration touches.
        if (state && state.view !== 'markers') return;
        const point =
          'changedTouches' in event ? event.changedTouches[0] : event;
        if (!point) return;
        const { screenX, screenY, clientX, clientY } = point;
        if (![screenX, screenY, clientX, clientY].every(Number.isFinite))
          return;
        lastInsetTouch = { screenX, screenY, clientX, clientY };
        if (screenX - clientX < -1 || screenY - clientY < -1) return;
        screenOrigin = {
          key: viewportKey(),
          y: Math.max(0, screenY - clientY),
        };
      },
      { passive: true, capture: true },
    );
  }

  function layout(): CalibrationPageLayout {
    const markers = Array.from(
      document.querySelectorAll<SVGElement>('.marker'),
    ).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        size: r.width,
        code: Number(el.dataset.code),
        purpose: el.dataset.purpose as 'fit' | 'check',
      };
    });
    const display = window.screen;
    // The viewport is the authoritative orientation. iOS standalone pages can
    // keep a stale `screen.orientation` value after launch, which must not swap
    // the reported physical screen and fail the bounds check.
    const portrait = innerHeight >= innerWidth;
    const dimensions = [display.width, display.height];
    const screen = {
      width: portrait ? Math.min(...dimensions) : Math.max(...dimensions),
      height: portrait ? Math.max(...dimensions) : Math.min(...dimensions),
      devicePixelRatio: window.devicePixelRatio,
    };
    const topInset = iosTopInset(screen.height - innerHeight);
    const value = {
      width: innerWidth,
      height: innerHeight,
      screen,
      markers,
      topInset,
    };
    const key = JSON.stringify([
      value,
      visualViewport?.scale || 1,
      visualViewport?.offsetTop || 0,
    ]);
    if (key !== pairing.layoutKey) {
      if (pairing.layoutKey) pairing.revision++;
      pairing.layoutKey = key;
      contact = undefined;
      contactId = undefined;
      readyTarget = undefined;
    }
    return {
      ...value,
      revision: pairing.revision,
      insetDiagnostics: {
        version: 1,
        userAgent: navigator.userAgent,
        viewportMeta:
          document
            .querySelector('meta[name="viewport"]')
            ?.getAttribute('content') ?? null,
        reason: insetReason,
        safeArea: safeArea && {
          top: safeArea.top,
          bottom: safeArea.bottom,
          paddingTop: safeArea.paddingTop,
          paddingBottom: safeArea.paddingBottom,
        },
        touch: lastInsetTouch,
        measuredOrigin: screenOrigin?.y,
        measurementMatchesViewport: screenOrigin?.key === viewportKey(),
        visualViewport: window.visualViewport
          ? {
              width: window.visualViewport.width,
              height: window.visualViewport.height,
              scale: window.visualViewport.scale,
              offsetTop: window.visualViewport.offsetTop,
              offsetLeft: window.visualViewport.offsetLeft,
            }
          : undefined,
      },
    };
  }
  let lastTrailAt = 0;

  function clearMappingTouch() {
    const hit = element('mapping-hit');
    hit.style.display = 'none';
    hit.classList.remove('pulse');
    element('mapping-trail').replaceChildren();
    element('touch-status').textContent = '';
    lastTrailAt = 0;
  }

  function showMappingTouch(
    css: WebPoint,
    phase: 'down' | 'move' | 'up' | 'cancel',
  ) {
    if (!state || state.view === 'markers' || state.view === 'waiting') return;
    element('touch-status').textContent =
      `${css.x.toFixed(1)}, ${css.y.toFixed(1)}`;
    const hit = element('mapping-hit');
    hit.style.display = 'block';
    hit.style.left = `${css.x}px`;
    hit.style.top = `${css.y}px`;
    if (phase === 'down') {
      hit.classList.remove('pulse');
      // Restart the pulse for a new contact; the reflow makes the animation run
      // again even when the same element is reused.
      void hit.offsetWidth;
      hit.classList.add('pulse');
    }
    const now = performance.now();
    if (phase === 'down' || now - lastTrailAt > 45) {
      lastTrailAt = now;
      const trail = element('mapping-trail');
      const dot = document.createElement('span');
      dot.className = 'mapping-touch-dot';
      dot.style.left = `${css.x}px`;
      dot.style.top = `${css.y}px`;
      trail.append(dot);
      const persistent = Boolean(guideKey);
      if (trail.childElementCount > (persistent ? 1500 : 40))
        trail.firstElementChild?.remove();
      // The CSS fade removes the dot in a browser; the cap above is the
      // fallback for reduced-motion or an animation that never ends.
      if (!persistent)
        dot.addEventListener('animationend', () => dot.remove(), {
          once: true,
        });
    }
  }

  let guideKey: string | undefined;
  function renderGuide(guide?: CalibrationPageReply['boundaryGuide']) {
    const key = JSON.stringify(guide);
    if (key === guideKey) return;
    guideKey = key;
    clearMappingTouch();
    const view = element('verification-guide');
    view.replaceChildren();
    view.hidden = !guide;
    document.body.dataset.verification = String(Boolean(guide));
    if (!guide) return;
    guide.corners.forEach((point, index) => {
      const next = guide.corners[(index + 1) % guide.corners.length];
      const edge = document.createElement('div');
      edge.className = 'verification-edge';
      edge.style.left = `${point.x}px`;
      edge.style.top = `${point.y}px`;
      edge.style.width = `${Math.hypot(next.x - point.x, next.y - point.y)}px`;
      edge.style.transform = `rotate(${Math.atan2(next.y - point.y, next.x - point.x)}rad)`;
      const target = document.createElement('div');
      target.className = 'verification-target';
      target.style.left = `${point.x}px`;
      target.style.top = `${point.y}px`;
      const label = document.createElement('span');
      label.textContent = String(index + 1);
      // Keep the label on-screen without moving the actual target centre.
      label.style.left = point.x > innerWidth / 2 ? '-28px' : '12px';
      label.style.top = point.y > innerHeight / 2 ? '-28px' : '12px';
      target.append(label);
      view.append(edge, target);
    });
    const legend = document.createElement('div');
    legend.className = 'verification-legend';
    legend.textContent =
      guide.group === 'hover'
        ? zh
          ? '悬停边界'
          : 'Hover boundary'
        : zh
          ? '轻触示意'
          : 'Light contact';
    legend.textContent += zh
      ? '\n橙色：计划路径 · 蓝色：实际触摸\n请对照笔尖、触摸轨迹与编号十字中心，保持屏幕不动。'
      : '\nOrange: planned path · Blue: actual touch\nCompare the tip and trace with the numbered crosshairs. Keep still.';
    view.append(legend);
  }
  let paintedKey: string | undefined;
  let paintingKey: string | undefined;
  let lastGridKey: string | undefined;
  function renderCaptureGrid(capture?: CalibrationPageReply['capture']) {
    const grid = element('capture-grid');
    if (capture?.mode !== 'standard' || !capture.targets?.length) {
      grid.hidden = true;
      lastGridKey = undefined;
      return;
    }
    grid.hidden = false;
    const { targets, index, measuredPoints = [] } = capture;
    const key = JSON.stringify([targets, index, measuredPoints]);
    if (key === lastGridKey) return;
    lastGridKey = key;
    element('capture-route').setAttribute(
      'points',
      targets.map(({ x, y }) => `${x},${y}`).join(' '),
    );
    const marker = (point: WebPoint, className: string) => {
      const dot = document.createElement('span');
      dot.className = className;
      dot.style.left = `${point.x}px`;
      dot.style.top = `${point.y}px`;
      return dot;
    };
    element('capture-points').replaceChildren(
      ...targets.map((point, i) => {
        const dot = marker(point, 'capture-grid-point');
        dot.textContent = String(i + 1);
        if (i + 1 === index) dot.className += ' is-current';
        return dot;
      }),
      ...measuredPoints.map((point) => marker(point, 'capture-measured-point')),
    );
  }
  function paint(next: CalibrationPageReply) {
    if (next.pairingToken && /^[a-f0-9-]{36}$/.test(next.pairingToken)) {
      history.replaceState(
        null,
        '',
        `/phone-calibration?token=${encodeURIComponent(next.pairingToken)}`,
      );
      instanceKey = `midscene-screen-instance:${location.search}`;
      delete document.body.dataset.cameraPreview;
      delete document.body.dataset.preview;
      socket.close();
      return;
    }
    if (next.insetMarkers !== undefined)
      document.body.dataset.insetMarkers = String(next.insetMarkers);
    document.body.dataset.stage = next.view;
    const title =
      next.view === 'waiting'
        ? zh
          ? '屏幕页面'
          : 'Screen page'
        : 'Midscene · Calibration';
    pageTitle.textContent = title;
    document.title = title;
    document.body.dataset.imageTrial = String(Boolean(next.imageTrial));
    document.body.dataset.connectionError = String(Boolean(next.error));
    document.body.dataset.probePhase = next.automaticPhase ?? 'grid';
    if (
      next.capture?.target.id !== state?.capture?.target.id ||
      next.view !== 'collect'
    ) {
      if (
        next.capture?.target.id !== state?.capture?.target.id ||
        next.view !== state?.view
      )
        trace('target-reset', next.view);
      contactStart = undefined;
      phoneStep = undefined;
      probeUnknown = ambiguousPointers ? 'multiple_contacts' : undefined;
    }
    const previous = state;
    state = next;
    if (
      previous?.view !== next.view ||
      previous?.markerRequest !== next.markerRequest
    ) {
      paintedKey = undefined;
      paintingKey = undefined;
      if (next.view === 'markers') {
        displayFinished = false;
        void enterFullscreen();
      }
      send();
    }
    const stages = {
      markers: 'waiting',
      waiting: 'keepOpen',
      'touch-preview': 'preview',
      positioning: 'position',
      collect: 'collect',
      'capture-failed': 'retry',
      'reference-required': 'position',
      'return-ready': 'returnReady',
      returning: 'returning',
      safety: 'safe',
      verify: 'verify',
      review: 'review',
      completed: 'done',
      interrupted: 'interrupted',
    } as const;
    if (
      previous?.view !== next.view ||
      (next.imageTrial && next.target?.id !== previous?.target?.id) ||
      next.imageTrial !== previous?.imageTrial
    )
      clearMappingTouch();
    renderGuide(next.boundaryGuide);
    const capture = ['collect', 'interrupted'].includes(next.view)
      ? next.capture
      : undefined;
    renderCaptureGrid(capture);
    message.textContent =
      (next.error ===
      'No touch before the safe descent limit; collected points are retained'
        ? zh
          ? '安全下探范围内仍未接触屏幕，采样已停止。'
          : next.error
        : next.error ===
            'Touch recovery budget exhausted; collected points are retained'
          ? zh
            ? '本轮补探次数已用完，采样已停止。'
            : next.error
          : next.error === 'No touch within the fast local recovery range'
            ? label('recoveryFailed')
            : next.error) ||
      label(
        capture?.phase === 'captured'
          ? 'recorded'
          : capture?.heightSearch?.precision
            ? 'refine'
            : capture?.operation
              ? capture.operation
              : capture?.waitingReason
                ? capture.waitingReason
                : capture?.phase === 'holding'
                  ? 'hold'
                  : stages[next.view],
      );
    connection.textContent = capture
      ? `${capture.mode === 'slide' ? (zh ? '快速' : 'Fast') : capture.mode === 'fast' ? (zh ? '快速探测' : 'Fast probing') : (zh ? '普通' : 'Regular')} · ${next.automaticPhase === 'local' ? (zh ? '方向探点' : 'Direction probe') : zh ? '网格点' : 'Grid point'} ${capture.index} / ${capture.total}`
      : next.view === 'capture-failed'
        ? (next.error ?? '')
        : '';
    if (next.view === 'capture-failed') message.textContent = label('retry');
    const visibleTarget =
      capture?.target ??
      (next.view === 'verify' && !next.error ? next.target : undefined);
    if (!visibleTarget) {
      hideGuidance();
      readyTarget = undefined;
      captureAck = undefined;
      return;
    }
    target.style.display = next.view === 'collect' ? 'none' : 'grid';
    target.style.left = `${visibleTarget.point.x}px`;
    target.style.top = `${visibleTarget.point.y}px`;
    target.dataset.phase =
      next.view === 'interrupted' ? 'failed' : (capture?.phase ?? 'verify');

    number.textContent = capture ? String(capture.index) : '+';
    if (next.view === 'interrupted') return;
    const requestedStep = capture?.step;
    const stepChanged =
      requestedStep?.id !== previous?.capture?.step?.id ||
      requestedStep?.phase !== previous?.capture?.step?.phase;
    const canConfirmStep =
      requestedStep?.phase === 'prepare' ||
      requestedStep?.contactMode === 'current' ||
      (requestedStep && phoneStep?.id === requestedStep.id);
    if (stepChanged || !requestedStep) phoneStep = undefined;
    const probe = capture?.probe?.id;
    if (
      stepChanged ||
      readyTarget !== visibleTarget.id ||
      previous?.capture?.probe?.id !== probe ||
      captureAck !== probe
    ) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const current =
            state?.view === 'collect' ? state.capture?.target : state?.target;
          if (
            current?.id !== visibleTarget.id ||
            state?.capture?.probe?.id !== probe ||
            state?.capture?.step?.id !== requestedStep?.id ||
            state?.capture?.step?.phase !== requestedStep?.phase
          )
            return;
          if (requestedStep && canConfirmStep) phoneStep = { ...requestedStep };
          readyTarget = visibleTarget.id;
          captureAck = probe;
          void send();
        }),
      );
    }
  }
  // The touch surface captures pointer events for calibration. Keep the fullscreen
  // control outside it so the browser receives the original user gesture.
  const fullscreenButton = document.querySelector<HTMLButtonElement>(
    'button#marker-fullscreen',
  );
  const fullscreenHelp = document.querySelector<HTMLElement>(
    'small#fullscreen-help',
  );
  const root = document.documentElement as Partial<HTMLElement> & {
    webkitRequestFullscreen?: () => void;
    webkitRequestFullScreen?: () => void;
  };
  const doc = document as Document & {
    webkitFullscreenElement?: Element;
  };
  const enter:
    | ((options?: FullscreenOptions) => void | Promise<void>)
    | undefined =
    root?.requestFullscreen ??
    root?.webkitRequestFullscreen ??
    root?.webkitRequestFullScreen;
  const nativeFullscreen = () =>
    doc.fullscreenElement ?? doc.webkitFullscreenElement;
  const platform = /HarmonyOS|OpenHarmony|ArkWeb/i.test(ua)
    ? 'harmonyos'
    : /iPhone|iPad|iPod/i.test(ua) ||
        (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
      ? 'ios'
      : /Android/i.test(ua)
        ? 'android'
        : 'other';
  const matchesMode = (mode: string) =>
    window.matchMedia?.(`(display-mode: ${mode})`).matches;
  const displayMode = (): NonNullable<CalibrationPageUpdate['displayMode']> => {
    if (
      platform === 'ios' &&
      ((navigator as Navigator & { standalone?: boolean }).standalone ||
        matchesMode('standalone'))
    )
      return 'standalone';
    if (
      (nativeFullscreen() && nativeFullscreen() === root) ||
      matchesMode('fullscreen')
    )
      return 'fullscreen';
    if (platform !== 'ios' && (window.visualViewport?.scale ?? 1) === 1) {
      const width = window.visualViewport?.width ?? window.innerWidth;
      const height = window.visualViewport?.height ?? window.innerHeight;
      const covers = (screenWidth: number, screenHeight: number) =>
        screenWidth > 0 &&
        screenHeight > 0 &&
        Math.max(
          Math.min(screenWidth, screenHeight) - Math.min(width, height),
          Math.max(screenWidth, screenHeight) - Math.max(width, height),
        ) *
          window.devicePixelRatio <=
          24;
      if (
        covers(window.screen.width, window.screen.height) ||
        covers(window.screen.availWidth, window.screen.availHeight)
      )
        return 'fullscreen';
    }
    return 'browser';
  };
  const fullscreenReady = () =>
    displayMode() === (platform === 'ios' ? 'standalone' : 'fullscreen');
  const orientationScreen = window.screen as Screen & {
    orientation?: ScreenOrientation & {
      lock?: (orientation: 'portrait-primary' | 'portrait') => Promise<void>;
    };
    lockOrientation?: (
      orientation: 'portrait-primary' | 'portrait',
    ) => boolean | string;
    mozLockOrientation?: (
      orientation: 'portrait-primary' | 'portrait',
    ) => boolean | string;
    webkitLockOrientation?: (
      orientation: 'portrait-primary' | 'portrait',
    ) => boolean | string;
  };
  /**
   * Keep the orientation the operator already had. Some Android browsers turn
   * the page landscape when it enters fullscreen; asking for portrait only in
   * that case preserves the starting view without forcing a landscape phone to
   * rotate. A browser that cannot lock simply keeps its own orientation, so the
   * page must lay out for the viewport it actually gets.
   */
  async function preserveStartingOrientation(startedPortrait: boolean) {
    if (!startedPortrait || platform === 'ios') return;
    for (const value of ['portrait-primary', 'portrait'] as const) {
      if (orientationScreen.orientation?.lock) {
        try {
          await orientationScreen.orientation.lock(value);
          return;
        } catch {
          // Try the next alias or a vendor-specific API.
        }
      }
      for (const method of [
        orientationScreen.lockOrientation,
        orientationScreen.mozLockOrientation,
        orientationScreen.webkitLockOrientation,
      ]) {
        if (!method) continue;
        try {
          if (method.call(orientationScreen, value) !== false) return;
        } catch {
          // Another legacy implementation may still be available.
        }
      }
    }
  }
  let switching = false;
  let displayFinished = false;
  function displayControls() {
    const ready = fullscreenReady();
    document.body.dataset.displayReady = String(ready);
    if (!fullscreenButton || !fullscreenHelp) return;
    const finished = displayFinished || state?.view === 'completed';
    fullscreenButton.hidden =
      finished || switching || ready || platform === 'ios' || !enter;
    fullscreenHelp.hidden = finished || ready || switching;
    fullscreenHelp.textContent =
      platform === 'ios'
        ? zh
          ? '请用 Safari 打开，选择「分享 → 添加到主屏幕」，再从主屏幕图标打开标定页。'
          : 'In Safari, choose Share → Add to Home Screen, then open the calibration page from its icon.'
        : zh
          ? enter
            ? '进入全屏后，标定会自动继续。'
            : '请通过浏览器菜单进入全屏以继续标定。'
          : enter
            ? 'Enter full screen to continue calibration automatically.'
            : 'Use the browser menu to enter full screen and continue calibration.';
  }
  async function enterFullscreen(fromGesture = false) {
    if (fullscreenReady()) return;
    if (
      !fullscreenButton ||
      switching ||
      displayFinished ||
      document.hidden ||
      platform === 'ios' ||
      (platform === 'android' && !fromGesture) ||
      (platform === 'harmonyos' && !fromGesture) ||
      (!fromGesture && state?.view !== 'markers') ||
      !enter
    )
      return;
    const startedPortrait = innerHeight >= innerWidth;
    switching = true;
    awake.detach();
    try {
      await enter.call(root, { navigationUI: 'hide' });
      await preserveStartingOrientation(startedPortrait);
    } catch {
      // Browsers requiring transient activation can retry from the phone button.
    } finally {
      switching = false;
      // Re-attach the wake video only after the fullscreen transition settles.
      // Resuming inside it makes some Android browsers hand the screen to the
      // media element, which opens their player surface instead of the page.
      setTimeout(() => {
        if (!displayFinished) void awake.resume();
      }, 1000);
      send();
    }
  }
  if (fullscreenButton) {
    fullscreenButton.textContent = zh ? '进入全屏' : 'Enter full screen';
    fullscreenButton.onclick = () => enterFullscreen(true);
    for (const event of ['fullscreenchange', 'webkitfullscreenchange'])
      document.addEventListener(event, send);
    for (const mode of ['fullscreen', 'standalone'])
      window
        .matchMedia?.(`(display-mode: ${mode})`)
        .addEventListener?.('change', send);
  }
  element('wake-gesture').textContent = zh
    ? '浏览器已阻止保持常亮'
    : 'Screen wake lock blocked by the browser';
  function startDisplay() {
    if (displayFinished) return;
    void awake.start();
    if (state?.view === 'markers') void enterFullscreen();
  }
  function send() {
    const current = layout();
    displayControls();
    const key =
      state?.view === 'markers' &&
      !switching &&
      !document.hidden &&
      fullscreenReady()
        ? JSON.stringify([state.markerRequest, current.revision])
        : undefined;
    if (!key) {
      paintedKey = undefined;
      paintingKey = undefined;
    } else if (paintingKey !== key) {
      paintingKey = key;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (paintingKey === key) {
            paintedKey = key;
            send();
          }
        }),
      );
    }
    const markersPainted = Boolean(key && paintedKey === key);
    if (socket?.readyState !== WebSocket.OPEN) return;
    const batch = touches;
    touches = [];
    const stepPoint =
      phoneStep?.contactMode === 'current'
        ? contact
        : contactStart?.targetId === state?.capture?.target.id
          ? contactStart?.point
          : undefined;
    const body: CalibrationPageUpdate = {
      pageId,
      browserInstanceId,
      resumeBrowserInstanceId,
      claimBrowserInstance,
      touchEvents,
      touchDiagnosticsVersion: 2,
      wakeState: wakeState(),
      sequence: ++sequence,
      model,
      platform,
      displayMode: displayMode(),
      fullscreen: fullscreenReady(),
      view: state?.view,
      markersPainted,
      markerRequest: markersPainted ? state?.markerRequest : undefined,
      visible: !document.hidden && (visualViewport?.scale || 1) === 1,
      layout: current,
      targetReady: readyTarget,
      captureAck,
      contactStart,
      stepFeedback:
        phoneStep && state?.capture?.step?.id === phoneStep.id
          ? {
              ...phoneStep,
              outcome: probeUnknown
                ? 'unknown'
                : stepPoint
                  ? 'touched'
                  : phoneStep.phase === 'prepare'
                    ? 'ready'
                    : 'no_touch',
              point: !probeUnknown ? stepPoint : undefined,
              reason: probeUnknown,
            }
          : undefined,
      touches: batch,
      contact:
        contact && contactId
          ? { id: contactId, motionRevision, point: contact }
          : undefined,
    };
    const feedbackKey = JSON.stringify(body.stepFeedback);
    if (feedbackKey !== lastFeedbackKey) {
      lastFeedbackKey = feedbackKey ?? '';
      if (body.stepFeedback)
        trace(
          'step-feedback',
          `${body.stepFeedback.phase}:${body.stepFeedback.outcome}`,
        );
    }
    reportedWake = body.wakeState;
    // Only the standalone preview may ask to resume this browser's saved screen.
    let savedScreenToken: string | null = null;
    if (document.body.dataset.cameraPreview === 'true') {
      try {
        savedScreenToken = localStorage.getItem('midscene-screen-page-token');
      } catch {
        /* First-time pairing also works without browser storage. */
      }
    }
    socket.send(
      JSON.stringify(savedScreenToken ? { ...body, savedScreenToken } : body),
    );
  }
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectDelay = 1000;
  let reconnectStopped = false;
  function reconnectPage() {
    if (reconnectStopped || reconnectTimer) return;
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = undefined;
      try {
        // Renew only the transport. Navigating would release browser fullscreen.
        const response = await fetch(location.href, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          const next = await response.json();
          const markers = document.querySelectorAll('.mapping-marker');
          if (
            typeof next.pageId !== 'string' ||
            !Array.isArray(next.markers) ||
            next.markers.length !== markers.length
          )
            throw new Error('Invalid phone session');
          markers.forEach((marker, i) => {
            marker.outerHTML = next.markers[i];
          });
          const token = new URL(location.href).searchParams.get('token');
          if (
            typeof next.pageKey === 'string' &&
            /^[a-f0-9-]{36}$/.test(next.pageKey) &&
            token
          ) {
            try {
              localStorage.setItem('midscene-screen-page-token', token);
              localStorage.setItem('midscene-screen-page-key', next.pageKey);
            } catch {
              /* Transport renewal does not require storage. */
            }
          }
          if (typeof next.label === 'string')
            element('page-label').textContent = next.label;
          pageId = next.pageId;
          reconnectDelay = 1000;
          connect();
          return;
        }
      } catch {
        // The server may still be starting or the network may be unavailable.
      }
      reconnectDelay = Math.min(reconnectDelay * 2, 5000);
      reconnectPage();
    }, reconnectDelay);
  }
  function connect() {
    const url = new URL('/phone-calibration/session', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = location.search;
    const transport = new WebSocket(url);
    socket = transport;
    let endedTransport = false;
    let heartbeat: ReturnType<typeof setInterval>;
    let lastReply = performance.now();
    const stalled = () => {
      if (endedTransport) return;
      disconnected(1006);
      transport.close();
    };
    const opening = setTimeout(stalled, policy.displayFreshMs);
    transport.onopen = () => {
      if (endedTransport) return;
      clearTimeout(opening);
      lastReply = performance.now();
      send();
      heartbeat = setInterval(() => {
        if (performance.now() - lastReply > policy.displayFreshMs) {
          stalled();
          return;
        }
        if (transport.readyState !== WebSocket.OPEN) return;
        transport.send('ping');
        if (
          reportedWake !== wakeState() ||
          state?.view === 'collect' ||
          state?.view === 'verify' ||
          (state && state.view !== 'waiting' && !document.hidden)
        )
          send();
      }, policy.heartbeatMs);
    };
    transport.onmessage = (event) => {
      if (endedTransport) return;
      lastReply = performance.now();
      if (event.data !== 'pong') {
        claimBrowserInstance = false;
        resumeBrowserInstanceId = undefined;
        try {
          sessionStorage.setItem(instanceKey, browserInstanceId);
        } catch {
          // The live connection is already active.
        }
        paint(JSON.parse(event.data));
      }
    };
    transport.onclose = (event) => disconnected(event.code, event.reason);
    function disconnected(code: number, reason?: string) {
      if (endedTransport) return;
      endedTransport = true;
      clearTimeout(opening);
      clearInterval(heartbeat);
      touches = [];
      touchEvents.length = 0;
      contact = undefined;
      contactId = undefined;
      activePointer = undefined;
      pointers.clear();
      ambiguousPointers = false;
      probeUnknown = undefined;
      downTarget = undefined;
      contactStart = undefined;
      captureAck = undefined;
      readyTarget = undefined;
      phoneStep = undefined;
      renderGuide();
      renderCaptureGrid();
      clearMappingTouch();
      state = undefined;
      hideGuidance();
      document.body.dataset.connectionError = 'true';
      const replaced = code === 4410;
      const ended = code === 1000 && reason === 'Preview ended';
      message.textContent = label(
        ended ? 'closed' : replaced ? 'replaced' : 'offline',
      );
      connection.textContent = '';
      if (replaced || ended) {
        document.body.dataset.stage = 'completed';
        displayFinished = true;
        void awake.stop();
        displayControls();
        reconnectStopped = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (replaced) {
          const claim = document.createElement('button');
          claim.type = 'button';
          claim.textContent = zh
            ? '\u4f7f\u7528\u6b64\u9875\u9762'
            : 'Use This Page';
          claim.onclick = () => {
            if (document.hidden) return;
            claim.remove();
            claimBrowserInstance = true;
            reconnectStopped = false;
            reconnectTimer = undefined;
            displayFinished = false;
            void awake.start();
            reconnectPage();
          };
          element('fullscreen-controls').append(claim);
        }
      } else reconnectPage();
    }
  }

  const surface = element('surface');
  // Observe before surface listeners without preventing or consuming input.
  // Flush after dispatch to compare default prevention before/after handlers.
  for (const kind of [
    'touchstart',
    'touchend',
    'touchcancel',
    'pointerdown',
    'pointerup',
    'pointercancel',
    'lostpointercapture',
  ] as const) {
    document.addEventListener(
      kind,
      (event) => {
        const e = event as TouchEvent | PointerEvent;
        const point = 'changedTouches' in e ? e.changedTouches[0] : e;
        const target = e.target as HTMLElement | null;
        const observedAt = performance.now();
        const nativeTimestamp =
          Number.isFinite(e.timeStamp) && e.timeStamp >= 0
            ? e.timeStamp
            : undefined;
        const logical = point
          ? { x: point.clientX, y: point.clientY }
          : undefined;
        const entry = trace(
          kind,
          'pointerType' in e ? e.pointerType : 'touch',
          logical,
          {
            source: 'document',
            nativeTimestampMs: nativeTimestamp,
            // Some old browsers use epoch-based event timestamps. Do not
            // subtract clocks with incompatible origins.
            dispatchDelayMs:
              nativeTimestamp !== undefined && nativeTimestamp <= observedAt
                ? observedAt - nativeTimestamp
                : undefined,
            targetElement:
              `${target?.tagName ?? 'unknown'}${target?.id ? `#${target.id}` : ''}`.slice(
                0,
                100,
              ),
            defaultPrevented: e.defaultPrevented,
          },
        );
        queueMicrotask(() => {
          entry.defaultPreventedAfterDispatch = e.defaultPrevented;
          send();
        });
      },
      { capture: true, passive: true },
    );
  }

  // The fixed surface owns the gesture. Cancel native touch gestures as well as
  // pointer defaults so long presses and multi-touch cannot take over capture.
  for (const event of [
    'touchstart',
    'touchmove',
    'touchend',
    'gesturestart',
    'gesturechange',
  ]) {
    surface.addEventListener(event, (e) => e.preventDefault(), {
      passive: false,
    });
  }
  surface.addEventListener('contextmenu', (e) => e.preventDefault());
  surface.addEventListener('pointerdown', (e) => {
    const point = { x: e.clientX, y: e.clientY };
    trace('pointerdown', e.pointerType, point, { source: 'surface' });
    e.preventDefault();
    pointers.set(e.pointerId, {
      id: newId(),
      point,
    });
    surface.setPointerCapture(e.pointerId);
    if (pointers.size > 1) {
      ambiguousPointers = true;
      if (state?.view === 'collect') probeUnknown = 'multiple_contacts';
      downTarget = undefined;
      void send();
      return;
    }
    activePointer = e.pointerId;
    contact = point;
    contactId = pointers.get(e.pointerId)!.id;
    if (state?.view === 'collect' && state.capture) {
      contactStart ??= {
        targetId: state.capture.target.id,
        id: contactId,
        point: { ...contact },
      };
    }
    showMappingTouch(contact, 'down');
    motionRevision = 0;
    stabilityOrigin = { ...contact };
    downPoint = { ...contact };
    travelPx = 0;
    downAt = performance.now();
    downTarget = state?.view === 'verify' ? state.target?.id : undefined;
    void send();
  });
  surface.addEventListener('pointermove', (e) => {
    const pointer = pointers.get(e.pointerId);
    const point = { x: e.clientX, y: e.clientY };
    if (pointer) pointer.point = point;
    if (!contact || activePointer !== e.pointerId) return;
    e.preventDefault();
    contact = point;
    showMappingTouch(contact, 'move');
    if (
      downTarget &&
      (!state?.target ||
        Math.hypot(
          contact.x - state.target.point.x,
          contact.y - state.target.point.y,
        ) > policy.verificationRadiusPx)
    ) {
      if (
        state?.target &&
        Math.hypot(
          downPoint.x - state.target.point.x,
          downPoint.y - state.target.point.y,
        ) <= policy.verificationRadiusPx
      )
        downTarget = undefined;
    }
    travelPx = Math.max(
      travelPx,
      Math.hypot(contact.x - downPoint.x, contact.y - downPoint.y),
    );
    if (
      Math.hypot(contact.x - stabilityOrigin.x, contact.y - stabilityOrigin.y) >
      policy.touchSpreadPx
    ) {
      motionRevision++;
      stabilityOrigin = { ...contact };
      send();
    }
  });
  const retainRemainingPointer = () => {
    const remaining = pointers.entries().next().value;
    activePointer = remaining?.[0];
    contact = remaining ? { ...remaining[1].point } : undefined;
    contactId = remaining?.[1].id;
    if (!remaining) ambiguousPointers = false;
  };
  surface.addEventListener('pointerup', (e) => {
    const point = { x: e.clientX, y: e.clientY };
    trace('pointerup', e.pointerType, point, { source: 'surface' });
    pointers.delete(e.pointerId);
    if (activePointer !== e.pointerId) {
      void send();
      return;
    }
    e.preventDefault();
    showMappingTouch(point, 'up');
    if (
      contact &&
      downTarget &&
      state?.view === 'verify' &&
      state.target?.id === downTarget &&
      (Math.hypot(
        downPoint.x - state.target.point.x,
        downPoint.y - state.target.point.y,
      ) > policy.verificationRadiusPx ||
        Math.hypot(
          point.x - state.target.point.x,
          point.y - state.target.point.y,
        ) <= policy.verificationRadiusPx)
    ) {
      touches.push({
        targetId: downTarget,
        point: downPoint,
        durationMs: performance.now() - downAt,
        travelPx: Math.max(
          travelPx,
          Math.hypot(point.x - downPoint.x, point.y - downPoint.y),
        ),
      });
    }
    retainRemainingPointer();
    downTarget = undefined;
    void send();
  });
  const cancelContact = (event?: { pointerId?: number }) => {
    if (event?.pointerId !== undefined) {
      pointers.delete(event.pointerId);
      // The implicit capture-loss event after pointerup must not erase another
      // pointer that is still held down.
      if (activePointer !== event.pointerId) {
        void send();
        return;
      }
    } else pointers.clear();
    retainRemainingPointer();
    downTarget = undefined;
    void send();
  };
  surface.addEventListener('pointercancel', (e) => {
    trace('pointercancel', e.pointerType, undefined, { source: 'surface' });
    if (activePointer === e.pointerId)
      showMappingTouch({ x: e.clientX, y: e.clientY }, 'cancel');
    cancelContact(e);
  });
  surface.addEventListener('lostpointercapture', (e) => {
    trace('lostpointercapture', undefined, undefined, { source: 'surface' });
    cancelContact(e);
  });
  document.addEventListener('visibilitychange', () => {
    cancelContact();
    if (!document.hidden) void enterFullscreen();
  });
  visualViewport?.addEventListener('resize', () => send());
  visualViewport?.addEventListener('scroll', () => send());
  window.addEventListener('resize', () => void send());
  window.addEventListener('pageshow', (event) => {
    if (event?.persisted) startDisplay();
    send();
  });
  startDisplay();
  connect();
}
