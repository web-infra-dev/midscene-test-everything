import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, rstest } from '@rstest/core';

const source = readFileSync(
  new URL('../assets/phone/awake.js', import.meta.url),
  'utf8',
);
const media = readFileSync(
  new URL('../assets/phone/awake.mp4', import.meta.url),
);
const androidUa =
  'Mozilla/5.0 (Linux; Android 14; PJF110) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

function load(
  withWakeLock = true,
  userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
) {
  const documentListeners = new Map<string, () => void>();
  const windowListeners = new Map<string, () => void>();
  let visible = true;
  const video = {
    style: {} as Record<string, string>,
    src: '',
    loop: false,
    muted: false,
    playsInline: false,
    volume: 0,
    paused: true,
    isConnected: true,
    setAttribute: rstest.fn(),
    play: rstest.fn(async () => undefined),
    pause: rstest.fn(),
    remove: rstest.fn(() => {
      video.isConnected = false;
    }),
  };
  const document = {
    get visibilityState() {
      return visible ? 'visible' : 'hidden';
    },
    get hidden() {
      return !visible;
    },
    createElement: rstest.fn(() => video),
    body: {
      dataset: { wakeVideo: 'data:video/mp4;base64,test' },
      appendChild: rstest.fn(),
    },
    addEventListener(name: string, listener: () => void) {
      documentListeners.set(name, listener);
    },
  };
  let releaseListener: (() => void) | undefined;
  const lock = {
    addEventListener: rstest.fn((_name: string, listener: () => void) => {
      releaseListener = listener;
    }),
    release: rstest.fn(async () => undefined),
  };
  const request = rstest.fn(async () => lock);
  const navigator = withWakeLock
    ? { userAgent, wakeLock: { request } }
    : { userAgent };
  const window = {
    addEventListener(name: string, listener: () => void) {
      windowListeners.set(name, listener);
    },
  };
  const context: Record<string, unknown> = { document, navigator, window };
  runInNewContext(source, context);
  return {
    awake: context.RobotScreenCalibAwake as {
      start: () => Promise<void>;
      stop: () => Promise<void>;
      pause: () => void;
      detach: () => void;
      resume: () => Promise<void>;
      status: () => { playbackError: string | null; locked: boolean };
    },
    request,
    lock,
    video,
    createElement: document.createElement,
    appendChild: document.body.appendChild,
    documentListeners,
    windowListeners,
    setVisible(value: boolean) {
      visible = value;
    },
    releaseFromBrowser() {
      releaseListener?.();
    },
  };
}

describe('screen wake lock', () => {
  it('ships a video track for the automatic LAN background', () => {
    expect(media.includes(Buffer.from('vide'))).toBe(true);
  });
  it('holds a screen wake lock while the page is assigned and reclaims it after visibility returns', async () => {
    const page = load();
    await page.awake.start();
    expect(page.request).toHaveBeenCalledWith('screen');
    expect(page.createElement).not.toHaveBeenCalled();

    page.setVisible(false);
    page.documentListeners.get('visibilitychange')!();
    page.releaseFromBrowser();
    page.setVisible(true);
    page.documentListeners.get('visibilitychange')!();
    await rstest.waitFor(() => expect(page.request).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));

    await page.awake.stop();
    expect(page.lock.release).toHaveBeenCalled();
  });

  it('starts a visible, muted HTTP background without a gesture', async () => {
    const page = load(false);
    await page.awake.start();
    expect(page.request).not.toHaveBeenCalled();
    expect(page.createElement).toHaveBeenCalledWith('video');
    expect(page.appendChild).toHaveBeenCalledWith(page.video);
    expect(page.video.muted).toBe(true);
    expect(page.video.style).toMatchObject({ width: '100%', height: '100%' });
    expect(page.video.loop).toBe(true);
    expect(page.video.playsInline).toBe(true);
    expect(page.video.play).toHaveBeenCalled();

    page.setVisible(false);
    page.documentListeners.get('visibilitychange')!();
    expect(page.video.pause).toHaveBeenCalled();
    page.setVisible(true);
    page.documentListeners.get('visibilitychange')!();
    await rstest.waitFor(() =>
      expect(page.video.play).toHaveBeenCalledTimes(2),
    );

    await page.awake.stop();
    expect(page.video.pause).toHaveBeenCalled();
  });

  it('does not start playback from the gesture that enters fullscreen', async () => {
    const page = load(false);
    await page.awake.start();
    page.video.play.mockClear();
    const pointer = page.windowListeners.get('pointerdown') as unknown as (
      event: unknown,
    ) => void;

    pointer({
      target: {
        closest: (selector: string) =>
          selector === '[data-fullscreen-control]' ? {} : null,
      },
    });
    expect(page.video.play).not.toHaveBeenCalled();
    expect(page.video.pause).toHaveBeenCalled();

    pointer({ target: { closest: () => null } });
    expect(page.video.play).toHaveBeenCalled();
  });

  it('never creates the wake video on Android, so fullscreen stays page fullscreen', async () => {
    const page = load(false, androidUa);
    await page.awake.start();
    expect(page.createElement).not.toHaveBeenCalled();
    expect(page.video.play).not.toHaveBeenCalled();
  });

  it('holds the native wake lock on Android when the page has one', async () => {
    const page = load(true, androidUa);
    await page.awake.start();
    expect(page.request).toHaveBeenCalledWith('screen');
    expect(page.createElement).not.toHaveBeenCalled();
  });

  it('keeps the video fallback on HarmonyOS, which reports Android compatibility', async () => {
    const page = load(
      false,
      'Mozilla/5.0 (Linux; Android 12; HarmonyOS; NOH-AN00) AppleWebKit/537.36',
    );
    await page.awake.start();
    expect(page.createElement).toHaveBeenCalledWith('video');
    expect(page.video.play).toHaveBeenCalled();
  });

  it('detaches the wake video across the fullscreen transition', async () => {
    const page = load(false);
    await page.awake.start();
    page.video.pause.mockClear();

    page.awake.detach();
    expect(page.video.pause).toHaveBeenCalled();
    expect(page.video.remove).toHaveBeenCalled();

    page.video.play.mockClear();
    // Registration heartbeats and foreground events can race fullscreen entry.
    await page.awake.start();
    page.documentListeners.get('visibilitychange')!();
    page.windowListeners.get('pointerdown')!();
    expect(page.video.play).not.toHaveBeenCalled();
    await page.awake.resume();
    expect(page.appendChild).toHaveBeenCalledTimes(2);
    expect(page.video.play).toHaveBeenCalled();
  });

  it('retries blocked media synchronously in the user gesture', async () => {
    const page = load(false);
    page.video.play.mockRejectedValueOnce(new Error('Gesture required'));
    await page.awake.start();
    expect(page.awake.status().playbackError).toBe('Gesture required');
    page.video.play.mockClear();
    page.windowListeners.get('touchstart')!();
    // An await before play loses activation on some mobile browsers.
    expect(page.video.play).toHaveBeenCalledTimes(1);
    await rstest.waitFor(() =>
      expect(page.awake.status().playbackError).toBeNull(),
    );
  });

  it('retries media in the gesture after native permission was denied', async () => {
    const page = load();
    page.request.mockRejectedValueOnce(new Error('Denied'));
    page.video.play.mockRejectedValueOnce(new Error('Gesture required'));
    await page.awake.start();
    page.video.play.mockClear();
    page.windowListeners.get('pointerdown')!();
    expect(page.video.play).toHaveBeenCalledTimes(1);
  });

  it('releases a delayed lock granted after the page stopped', async () => {
    const page = load();
    let grant!: (value: typeof page.lock) => void;
    page.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    const starting = page.awake.start();
    await page.awake.stop();
    grant(page.lock);
    await starting;
    expect(page.lock.release).toHaveBeenCalledTimes(1);
    expect(page.awake.status().locked).toBe(false);
    expect(page.video.play).not.toHaveBeenCalled();
  });
});
