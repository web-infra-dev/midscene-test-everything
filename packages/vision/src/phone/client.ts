import type {
  CALIBRATION_PHONE_POLICY,
  CALIBRATION_POINT_POLICY,
  CalibrationPageLayout,
  CalibrationPageReply,
  CalibrationPageUpdate,
  WebPoint,
} from '@midscene/robotics-shared/assisted-contracts';

/** Serialized into the phone HTML: keep runtime dependencies inside this function. */
export function mountCalibrationPhonePage(
  policy: Pick<
    typeof CALIBRATION_POINT_POLICY,
    'touchSpreadPx' | 'targetRadiusPx'
  > &
    typeof CALIBRATION_PHONE_POLICY & { verificationRadiusPx: number },
  pageId: string,
): void {
  const zh = (
    new URLSearchParams(location.search).get('lang') || navigator.language
  ).startsWith('zh');
  const text = {
    waiting: [
      '已连接，请在电脑端继续。',
      'Connected. Continue on your computer.',
    ],
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
  const connection = element('connection');
  const target = element('target');
  const number = element('target-number');
  const feedback = element('hit-feedback');
  const hideGuidance = () => {
    target.style.display = 'none';
    target.classList.remove('touched');
  };
  hideGuidance();
  message.textContent = label('connecting');
  const newId = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now();
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
  const contactFeedback = document.getElementById('contact-feedback')!;
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
    const landscape = display.orientation?.type.startsWith('landscape');
    const dimensions = [display.width, display.height];
    const screen = {
      ...(landscape === undefined
        ? { width: display.width, height: display.height }
        : {
            width: landscape
              ? Math.max(...dimensions)
              : Math.min(...dimensions),
            height: landscape
              ? Math.min(...dimensions)
              : Math.max(...dimensions),
          }),
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
  let lastGridKey: string | undefined;
  function paint(next: CalibrationPageReply) {
    document.body.dataset.stage = next.view;
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
      contactFeedback.classList.remove('active');
    }
    const previous = state;
    state = next;
    const stages = {
      waiting: 'waiting',
      'touch-preview': 'position',
      markers: 'waiting',
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
    const guide = element('boundary-guide');
    guide.style.display = next.boundaryGuide ? 'block' : 'none';
    if (next.boundaryGuide) {
      guide.dataset.group = next.boundaryGuide.group;
      element('boundary-contour').setAttribute(
        'points',
        next.boundaryGuide.corners.map((p) => `${p.x},${p.y}`).join(' '),
      );
    }
    const capture = ['collect', 'interrupted'].includes(next.view)
      ? next.capture
      : undefined;
    if (capture?.targets) {
      const key = JSON.stringify([
        capture.targets,
        capture.index,
        capture.phase,
      ]);
      if (key !== lastGridKey) {
        lastGridKey = key;
        const grid = element('capture-grid');
        grid.replaceChildren(
          ...capture.targets.map((point, index) => {
            const marker = document.createElement('span');
            marker.className = `capture-grid-point${index < capture.index - 1 || (index === capture.index - 1 && capture.phase === 'captured') ? ' is-complete' : ''}`;
            marker.style.left = `${point.x}px`;
            marker.style.top = `${point.y}px`;
            marker.textContent = String(index + 1);
            return marker;
          }),
        );
      }
    }
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
      ? `${capture.mode === 'slide' ? (zh ? '滑动采样' : 'Sliding') : capture.mode === 'fast' ? (zh ? '快速探测' : 'Fast probing') : (zh ? '标准探测' : 'Standard probing')} · ${next.automaticPhase === 'local' ? (zh ? '方向探点' : 'Direction probe') : zh ? '网格点' : 'Grid point'} ${capture.index} / ${capture.total}`
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
    if (previous?.target?.id !== next.target?.id)
      target.classList.remove('touched');
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
  function send() {
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
      touchEvents,
      touchDiagnosticsVersion: 2,
      sequence: ++sequence,
      model,
      visible: !document.hidden && (visualViewport?.scale || 1) === 1,
      layout: layout(),
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
    socket.send(JSON.stringify(body));
  }
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectDelay = 1000;
  let reconnectStopped = false;
  function reconnectPage() {
    if (reconnectStopped || reconnectTimer) return;
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = undefined;
      try {
        // Reload only when the authenticated helper page is ready. A restart
        // creates a new page identity; do not replay old touch evidence.
        const response = await fetch(location.href, {
          cache: 'no-store',
          signal: AbortSignal.timeout(3000),
        });
        if (
          response.ok &&
          response.headers.get('content-type')?.includes('text/html')
        ) {
          location.reload();
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
    socket = new WebSocket(url);
    let heartbeat: ReturnType<typeof setInterval>;
    let lastReply = performance.now();
    socket.onopen = () => {
      send();
      heartbeat = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (performance.now() - lastReply > policy.displayFreshMs) {
          socket.close();
          return;
        }
        socket.send('ping');
        if (state?.view === 'collect' || state?.view === 'verify') send();
      }, policy.heartbeatMs);
    };
    socket.onmessage = (event) => {
      lastReply = performance.now();
      if (event.data !== 'pong') paint(JSON.parse(event.data));
    };
    socket.onclose = (event) => {
      clearInterval(heartbeat);
      touches = [];
      contactStart = undefined;
      captureAck = undefined;
      readyTarget = undefined;
      phoneStep = undefined;
      state = undefined;
      hideGuidance();
      document.body.dataset.connectionError = 'true';
      const replaced = event.code === 4410;
      message.textContent = label(replaced ? 'replaced' : 'offline');
      connection.textContent = '';
      if (replaced) {
        reconnectStopped = true;
        if (reconnectTimer) clearTimeout(reconnectTimer);
      } else reconnectPage();
    };
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
        const entry = trace(
          kind,
          'pointerType' in e ? e.pointerType : 'touch',
          point ? { x: point.clientX, y: point.clientY } : undefined,
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
    trace(
      'pointerdown',
      e.pointerType,
      { x: e.clientX, y: e.clientY },
      { source: 'surface' },
    );
    e.preventDefault();
    pointers.set(e.pointerId, {
      id: newId(),
      point: { x: e.clientX, y: e.clientY },
    });
    surface.setPointerCapture(e.pointerId);
    if (pointers.size > 1) {
      ambiguousPointers = true;
      if (state?.view === 'collect') probeUnknown = 'multiple_contacts';
      downTarget = undefined;
      target.classList.remove('touched');
      void send();
      return;
    }
    activePointer = e.pointerId;
    contact = { x: e.clientX, y: e.clientY };
    contactId = pointers.get(e.pointerId)!.id;
    if (state?.view === 'collect' && state.capture) {
      contactStart ??= {
        targetId: state.capture.target.id,
        id: contactId,
        point: { ...contact },
      };
    }
    // Local feedback is available even after collection stops. It confirms a
    // browser event, not server acknowledgement or a calibration measurement.
    contactFeedback.style.left = `${contact.x}px`;
    contactFeedback.style.top = `${contact.y}px`;
    contactFeedback.classList.remove('active');
    void contactFeedback.offsetWidth;
    contactFeedback.classList.add('active');
    element('touch-status').textContent = zh
      ? `网页已检测到触摸：${Math.round(contact.x)}, ${Math.round(contact.y)}（最近一次）`
      : `Page detected touch: ${Math.round(contact.x)}, ${Math.round(contact.y)} (last touch)`;
    motionRevision = 0;
    stabilityOrigin = { ...contact };
    downPoint = { ...contact };
    travelPx = 0;
    downAt = performance.now();
    downTarget = state?.view === 'verify' ? state.target?.id : undefined;
    if (
      downTarget &&
      state?.target &&
      Math.hypot(
        contact.x - state.target.point.x,
        contact.y - state.target.point.y,
      ) <= policy.verificationRadiusPx
    )
      target.classList.add('touched');
    const currentTarget = state?.capture?.target.point;
    if (
      currentTarget &&
      Math.hypot(contact.x - currentTarget.x, contact.y - currentTarget.y) <=
        policy.targetRadiusPx
    )
      target.classList.add('touched');
    void send();
  });
  surface.addEventListener('pointermove', (e) => {
    const pointer = pointers.get(e.pointerId);
    if (pointer) pointer.point = { x: e.clientX, y: e.clientY };
    if (!contact || activePointer !== e.pointerId) return;
    e.preventDefault();
    contact = { x: e.clientX, y: e.clientY };
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
      target.classList.remove('touched');
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
    trace(
      'pointerup',
      e.pointerType,
      { x: e.clientX, y: e.clientY },
      { source: 'surface' },
    );
    pointers.delete(e.pointerId);
    if (activePointer !== e.pointerId) {
      void send();
      return;
    }
    e.preventDefault();
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
          e.clientX - state.target.point.x,
          e.clientY - state.target.point.y,
        ) <= policy.verificationRadiusPx)
    ) {
      if (
        Math.hypot(
          e.clientX - state.target.point.x,
          e.clientY - state.target.point.y,
        ) <= policy.verificationRadiusPx
      ) {
        feedback.style.left = `${state.target.point.x}px`;
        feedback.style.top = `${state.target.point.y}px`;
        feedback.classList.remove('active');
        void feedback.offsetWidth;
        feedback.classList.add('active');
      }
      touches.push({
        targetId: downTarget,
        point: downPoint,
        durationMs: performance.now() - downAt,
        travelPx: Math.max(
          travelPx,
          Math.hypot(e.clientX - downPoint.x, e.clientY - downPoint.y),
        ),
      });
    }
    retainRemainingPointer();
    downTarget = undefined;
    target.classList.remove('touched');
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
    target.classList.remove('touched');
    void send();
  };
  surface.addEventListener('pointercancel', (e) => {
    trace('pointercancel', e.pointerType, undefined, { source: 'surface' });
    cancelContact(e);
  });
  surface.addEventListener('lostpointercapture', (e) => {
    trace('lostpointercapture', undefined, undefined, { source: 'surface' });
    cancelContact(e);
  });
  document.addEventListener('visibilitychange', () => cancelContact());
  visualViewport?.addEventListener('resize', () => send());
  visualViewport?.addEventListener('scroll', () => send());
  window.addEventListener('resize', () => void send());
  window.addEventListener('pageshow', () => void send());
  connect();
}
