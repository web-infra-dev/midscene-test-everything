// Keeps the assigned calibration page awake.
//
// Plain-HTTP LAN pages use a muted, visible white video as the calibration
// background. It can autoplay without activation and occupies enough of the
// viewport to qualify for Chromium's video wake lock.
(() => {
  const VIDEO_SOURCE = document.body.dataset.wakeVideo;
  let wanted = false;
  let lock = null;
  let video = null;
  let acquiring = null;
  let generation = 0;
  let playbackError = null;
  let nativeFailed = false;
  let suspended = false;

  const visible = () =>
    typeof document.visibilityState === 'string'
      ? document.visibilityState === 'visible'
      : !document.hidden;

  // Some Android browsers open their own player for any video element, even an
  // inline, muted one. On the calibration page that replaces the document with
  // a player surface and forces landscape, so Android only gets the Screen Wake
  // Lock API (secure contexts) and no video fallback. HarmonyOS browsers report
  // "Android" for compatibility but keep inline playback, so they are exempt.
  const userAgent = `${navigator?.userAgent ?? ''}`;
  const videoFallback =
    !/Android/i.test(userAgent) ||
    /HarmonyOS|OpenHarmony|ArkWeb/i.test(userAgent);

  function pauseVideo() {
    try {
      video?.pause?.();
    } catch {
      /* Media may not be ready yet. */
    }
  }

  async function acquireLock() {
    if (lock) return true;
    if (!navigator.wakeLock?.request) return false;
    if (acquiring) return acquiring;
    const requestedGeneration = generation;
    acquiring = (async () => {
      try {
        const held = await navigator.wakeLock.request('screen');
        if (!wanted || !visible() || requestedGeneration !== generation) {
          await held.release();
          return false;
        }
        lock = held;
        document.body.dataset.wakeBlocked = 'false';
        held.addEventListener?.('release', () => {
          if (lock !== held) return;
          lock = null;
          if (wanted && visible()) void ensure();
        });
        return true;
      } catch {
        nativeFailed = true;
        return false;
      } finally {
        acquiring = null;
      }
    })();
    return acquiring;
  }

  function playVideo() {
    if (!videoFallback) return;
    if (!video) {
      video = document.createElement('video');
      video.src = VIDEO_SOURCE;
      video.loop = true;
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.controls = false;
      video.disablePictureInPicture = true;
      video.setAttribute?.('playsinline', '');
      // Older Android and X5-based browsers only stay inline with these.
      video.setAttribute?.('webkit-playsinline', '');
      video.setAttribute?.('x5-playsinline', '');
      video.setAttribute?.('x5-video-player-type', 'h5');
      video.setAttribute?.('aria-hidden', 'true');
      Object.assign(video.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        objectFit: 'fill',
        background: 'white',
        zIndex: '-1',
        pointerEvents: 'none',
      });
      document.body?.appendChild?.(video);
    }
    try {
      const requestedGeneration = generation;
      const playing = video.play();
      return Promise.resolve(playing).then(
        () => {
          playbackError = null;
          document.body.dataset.wakeBlocked = 'false';
          if (
            !wanted ||
            suspended ||
            !visible() ||
            requestedGeneration !== generation
          )
            pauseVideo();
        },
        (error) => {
          playbackError = error?.message || String(error);
          document.body.dataset.wakeBlocked = String(
            wanted && !suspended && visible(),
          );
        },
      );
    } catch (error) {
      playbackError = error?.message || String(error);
      document.body.dataset.wakeBlocked = String(
        wanted && !suspended && visible(),
      );
    }
  }

  function ensure() {
    if (!wanted || suspended || !visible()) return;
    // Do not cross an await before play(): mobile playback permission belongs
    // to the original gesture's call stack, including on plain-HTTP pages.
    if (!navigator.wakeLock?.request || nativeFailed) return playVideo();
    return acquireLock().then((held) => {
      if (!wanted || suspended || !visible()) return;
      if (held) pauseVideo();
      else return playVideo();
    });
  }

  async function start() {
    wanted = true;
    await ensure();
  }

  async function stop() {
    wanted = false;
    document.body.dataset.wakeBlocked = 'false';
    suspended = false;
    generation++;
    const held = lock;
    lock = null;
    try {
      await held?.release?.();
    } catch {
      /* The browser may already have released it. */
    }
    pauseVideo();
  }

  document.addEventListener('visibilitychange', () => {
    if (!visible()) {
      pauseVideo();
      return;
    }
    void ensure();
  });
  window.addEventListener('pagehide', () => {
    void stop();
  });
  // Pausing must be synchronous: Android browsers decide which media element to
  // promote at the moment fullscreen is requested, so an async stop() that awaits
  // a lock release loses that race and the wake video takes over the screen.
  function pause() {
    // Heartbeats call start() repeatedly. They must not restart media during
    // the fullscreen transition after the gesture has detached it.
    suspended = true;
    pauseVideo();
  }

  // Detaching goes one step further than pause(): while the page transitions to
  // fullscreen the element is not in the document at all, so a browser cannot
  // promote it even if it decides to ignore the paused state.
  function detach() {
    pause();
    try {
      video?.remove?.();
    } catch {
      /* The element may not be in the document yet. */
    }
  }

  function resume() {
    suspended = false;
    if (!wanted || !visible()) return Promise.resolve();
    if (video && video.isConnected === false) {
      try {
        document.body?.appendChild?.(video);
      } catch {
        /* A blocked re-attach just skips the wake lock. */
      }
    }
    return ensure();
  }

  // Some browsers promote a video that is playing when the page requests
  // fullscreen. The fullscreen controls pause playback on the gesture itself and
  // are marked so the gesture never starts playback; the page resumes it after
  // the transition settles.
  function skipsGesture(event) {
    const target = event?.target;
    return Boolean(target?.closest?.('[data-fullscreen-control]'));
  }
  // Some browsers only grant a wake lock, or allow playback, after a gesture.
  for (const type of ['pointerdown', 'keydown', 'touchstart'])
    window.addEventListener(
      type,
      (event) => {
        if (skipsGesture(event)) {
          // Only detach()/pause() suspend heartbeats until resume(). A manual
          // fullscreen confirmation may not request any fullscreen transition.
          pauseVideo();
          return;
        }
        void ensure();
      },
      { passive: true },
    );
  globalThis.RobotScreenCalibAwake = {
    start,
    stop,
    pause,
    detach,
    resume,
    status: () => ({
      wanted,
      locked: Boolean(lock),
      videoPlaying: Boolean(video && !video.paused && video.readyState >= 2),
      playbackError,
    }),
  };
})();
