import { runInNewContext } from 'node:vm';
import { expect, test } from '@rstest/core';
import {
  type CalibrationPageUpdate,
  calibrationPageMarkers,
} from '../src/assisted-contracts.js';
import { calibrationPhonePage } from '../src/calibration/phone/page.js';

// Execute the actual serialized phone page with no Fullscreen API available.
function openPhone(
  height: number,
  top: number,
  bottom: number,
  ios = true,
  fullscreenApi = false,
  rejectPrimaryLock = false,
  orientationApi: 'standard' | 'legacy' | 'none' = 'standard',
) {
  const updates: CalibrationPageUpdate[] = [];
  const listeners = new Map<string, (event?: unknown) => void>();
  let socket!: Socket;
  let reloaded = false;
  let fullscreenExits = 0;
  const orientationLocks: string[] = [];
  let fullscreenElement: object | null = null;
  const root: { requestFullscreen?: () => Promise<void> } = {
    requestFullscreen: fullscreenApi
      ? async () => {
          fullscreenElement = root;
        }
      : undefined,
  };
  if (!ios && !fullscreenApi) fullscreenElement = root;
  const timers = new Map<number, () => unknown>();
  let nextTimer = 0;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    onopen = () => {};
    onclose = (_event: { code: number }) => {};
    onmessage = (_event: { data: string }) => {};
    constructor() {
      socket = this;
    }
    send(data: string) {
      updates.push(JSON.parse(data));
    }
  }
  const documentListeners = new Map<
    string,
    { callback: (event: unknown) => void; options: unknown }
  >();
  const microtasks: Array<() => void> = [];
  const surfaceListeners = new Map<string, (event: unknown) => void>();
  const element = () => ({
    textContent: '',
    className: '',
    children: [] as unknown[],
    hidden: false,
    append(...children: unknown[]) {
      this.children.push(...children);
    },
    get childElementCount() {
      return this.children.length;
    },
    replaceChildren(...children: unknown[]) {
      this.children = children;
    },
    attributes: {} as Record<string, string>,
    setAttribute(name: string, value: string) {
      this.attributes[name] = value;
    },
    onclick: undefined as (() => void | Promise<void>) | undefined,
    style: {},
    dataset: {},
    classList: { add() {}, remove() {} },
    addEventListener(name: string, callback: (event: unknown) => void) {
      surfaceListeners.set(name, callback);
    },
    play: async () => {},
    pause() {},
    setPointerCapture() {},
    remove() {},
  });
  const elements = new Map<string, ReturnType<typeof element>>();
  const elementById = (id: string) => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id)!;
  };
  const viewport = { scale: 1, offsetTop: 0, addEventListener() {} };
  const scope = {
    URL,
    URLSearchParams,
    AbortSignal,
    fetch: async (_url: string, _options: unknown) => ({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ pageId: 'next-page', markers: Array(6).fill('') }),
    }),
    setTimeout(callback: () => unknown) {
      timers.set(++nextTimer, callback);
      return nextTimer;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
    clearInterval() {},
    WebSocket: Socket,
    crypto: { randomUUID: () => 'test' },
    performance,
    requestAnimationFrame() {},
    queueMicrotask(callback: () => void) {
      microtasks.push(callback);
    },
    location: {
      search: '',
      href: 'http://localhost/phone?token=saved',
      protocol: 'http:',
      reload() {
        reloaded = true;
      },
    },
    navigator: { language: 'en', userAgent: ios ? 'iPhone' : 'Android' },
    innerWidth: 390,
    innerHeight: height,
    visualViewport: viewport,
    setInterval() {},
    getComputedStyle: () => ({
      paddingTop: `${top}px`,
      paddingBottom: `${bottom}px`,
    }),
    document: {
      hidden: false,
      documentElement: root,
      get fullscreenElement() {
        return fullscreenElement;
      },
      exitFullscreen: () => {
        fullscreenExits++;
      },
      body: {
        dataset: {},
        style: {
          values: {} as Record<string, string>,
          setProperty(name: string, value: string) {
            this.values[name] = value;
          },
        },
        appendChild() {},
      },
      createElement: element,
      querySelector: (selector: string) =>
        selector.startsWith('meta')
          ? {
              getAttribute: () => 'width=device-width,viewport-fit=cover',
            }
          : selector === 'button#marker-fullscreen'
            ? elementById('marker-fullscreen')
            : selector === 'small#fullscreen-help'
              ? elementById('fullscreen-help')
              : null,
      getElementById: elementById,
      addEventListener(
        name: string,
        callback: (event: unknown) => void,
        options: unknown,
      ) {
        documentListeners.set(name, { callback, options });
      },
      querySelectorAll: () =>
        calibrationPageMarkers(390, scope.innerHeight).map((m) => ({
          dataset: { code: String(m.code), purpose: m.purpose },
          getBoundingClientRect: () => ({
            x: m.x - m.size / 2,
            y: m.y - m.size / 2,
            width: m.size,
            height: m.size,
          }),
        })),
    },
    window: {
      visualViewport: viewport,
      devicePixelRatio: 3,
      screen: {
        width: 390,
        height: 844,
        orientation:
          orientationApi === 'standard'
            ? {
                type: 'portrait-primary',
                lock: async (value: string) => {
                  orientationLocks.push(value);
                  if (rejectPrimaryLock && value === 'portrait-primary')
                    throw new Error('Unsupported portrait alias');
                },
              }
            : { type: 'portrait-primary' },
        ...(orientationApi === 'legacy'
          ? {
              lockOrientation: (value: string) => {
                orientationLocks.push(value);
                return true;
              },
            }
          : {}),
      },
      addEventListener: (type: string, listener: (event?: unknown) => void) => {
        listeners.set(type, listener);
      },
    },
  };
  const html = calibrationPhonePage('test-page');
  runInNewContext(html.split('<script>')[1].split('</script>')[0], scope);
  socket.onopen();
  return {
    scope,
    disconnect: (code: number) => socket.onclose({ code }),
    timers,
    reloaded: () => reloaded,
    openSocket: () => socket.onopen(),
    fullscreenExits: () => fullscreenExits,
    orientationLocks,
    windowListeners: listeners,
    surfaceListeners,
    documentListeners,
    flushEvents: () => {
      while (microtasks.length) microtasks.shift()!();
    },
    elements,
    receive: (value: unknown) =>
      socket.onmessage({ data: JSON.stringify(value) }),
    last: () => updates[updates.length - 1],
    resize: () => listeners.get('resize')!(),
    tap: (y: number) => {
      listeners.get('pointerdown')!({
        screenX: 100,
        clientX: 100,
        screenY: 100 + y,
        clientY: 100,
      });
      listeners.get('pageshow')!();
    },
  };
}

test('iPhone helper uses cover and reports split system bars without Fullscreen API', () => {
  expect(calibrationPhonePage('test')).toContain('viewport-fit=cover');
  expect(calibrationPhonePage('test')).toContain(
    '<meta name="x5-orientation" content="portrait">',
  );
  expect(calibrationPhonePage('test')).toContain(
    '<meta name="x5-fullscreen" content="true">',
  );
  const phone = openPhone(700, 47, 34);
  expect(phone.last()).toMatchObject({
    visible: true,
    layout: { width: 390, height: 700, topInset: 47, screen: { height: 844 } },
  });
});

test('a viewport covering the safe areas puts the remaining toolbar below the page', () => {
  const phone = openPhone(800, 47, 34);
  expect(phone.last().layout.topInset).toBe(0);
});

test('touch measurements only refine plausible iOS offsets and expire on resize', () => {
  const phone = openPhone(700, 47, 34);
  phone.tap(49);
  expect(phone.last().layout.topInset).toBe(49);
  phone.tap(120);
  expect(phone.last().layout.topInset).toBe(47);
  phone.tap(49);
  const revision = phone.last().layout.revision;
  phone.scope.innerHeight = 800;
  phone.resize();
  expect(phone.last().layout.topInset).toBe(0);
  expect(phone.last().layout.revision).toBeGreaterThan(revision);
});

test('unknown safe areas and Android retain the existing single-edge fallback', () => {
  expect(openPhone(700, 0, 0).last().layout.topInset).toBeUndefined();
  const phone = openPhone(700, 47, 34, false);
  phone.tap(47);
  expect(phone.last().layout.topInset).toBeUndefined();
});

test('Android fullscreen requests the primary portrait orientation lock', async () => {
  const phone = openPhone(800, 0, 0, false, true);
  await phone.elements.get('marker-fullscreen')?.onclick?.();
  expect(phone.orientationLocks).toEqual(['portrait-primary']);
});

test('Android falls back to the generic portrait lock alias', async () => {
  const phone = openPhone(800, 0, 0, false, true, true);
  await phone.elements.get('marker-fullscreen')?.onclick?.();
  expect(phone.orientationLocks).toEqual(['portrait-primary', 'portrait']);
});

test('Android falls back to the legacy screen orientation API', async () => {
  const phone = openPhone(800, 0, 0, false, true, false, 'legacy');
  await phone.elements.get('marker-fullscreen')?.onclick?.();
  expect(phone.orientationLocks).toEqual(['portrait-primary']);
});

test('Android re-locks portrait if fullscreen orientation turns landscape', async () => {
  const phone = openPhone(800, 0, 0, false, true);
  await phone.elements.get('marker-fullscreen')?.onclick?.();
  phone.orientationLocks.length = 0;
  phone.scope.window.screen.orientation.type = 'landscape-primary';
  phone.windowListeners.get('orientationchange')?.();
  await Promise.resolve();
  expect(phone.orientationLocks).toEqual(['portrait-primary']);
});

test('Android renders a portrait surface when every orientation API is ignored', async () => {
  const phone = openPhone(800, 0, 0, false, true, false, 'none');
  phone.scope.innerWidth = 844;
  phone.scope.innerHeight = 390;
  phone.scope.window.screen.width = 844;
  phone.scope.window.screen.height = 390;
  phone.scope.window.screen.orientation.type = 'landscape-primary';
  phone.scope.window.screen.orientation.angle = 90;
  await phone.elements.get('marker-fullscreen')?.onclick?.();
  expect(phone.scope.document.body.dataset.portraitFallback).toBe('true');
  expect(phone.scope.document.body.style.values).toMatchObject({
    '--portrait-width': '390px',
    '--portrait-height': '844px',
    '--portrait-rotation': '-90deg',
  });
  expect(phone.last().layout).toMatchObject({ width: 390, height: 844 });
  phone.surfaceListeners.get('pointerdown')?.({
    pointerId: 7,
    pointerType: 'touch',
    clientX: 100,
    clientY: 200,
    preventDefault() {},
  });
  expect(phone.last().contact).toMatchObject({ point: { x: 190, y: 100 } });
});

test('portrait fallback maps the opposite landscape rotation back to page coordinates', async () => {
  const phone = openPhone(800, 0, 0, false, true, false, 'none');
  phone.scope.innerWidth = 844;
  phone.scope.innerHeight = 390;
  phone.scope.window.screen.width = 844;
  phone.scope.window.screen.height = 390;
  phone.scope.window.screen.orientation.type = 'landscape-secondary';
  phone.scope.window.screen.orientation.angle = 270;
  await phone.elements.get('marker-fullscreen')?.onclick?.();
  expect(phone.scope.document.body.style.values).toMatchObject({
    '--portrait-width': '390px',
    '--portrait-height': '844px',
    '--portrait-rotation': '90deg',
  });
  phone.surfaceListeners.get('pointerdown')?.({
    pointerId: 8,
    pointerType: 'touch',
    clientX: 100,
    clientY: 200,
    preventDefault() {},
  });
  expect(phone.last().contact).toMatchObject({ point: { x: 200, y: 744 } });
});

test('reports actual missing-inset evidence without changing geometry revisions', () => {
  const phone = openPhone(699, 0, 0);
  const revision = phone.last().layout.revision;
  expect(phone.last().layout.insetDiagnostics).toMatchObject({
    version: 1,
    reason: 'no-safe-area-or-positive-touch-origin',
    safeArea: { top: 0, bottom: 0, paddingTop: '0px', paddingBottom: '0px' },
    measurementMatchesViewport: false,
  });
  phone.tap(0);
  expect(phone.last().layout.insetDiagnostics).toMatchObject({
    touch: { screenY: 100, clientY: 100 },
    measuredOrigin: 0,
    measurementMatchesViewport: true,
    reason: 'no-safe-area-or-positive-touch-origin',
  });
  expect(phone.last().layout.topInset).toBeUndefined();
  expect(phone.last().layout.revision).toBe(revision);
});

test('phone follows six-point sliding progress and preserves the failed endpoint', () => {
  const phone = openPhone(700, 47, 34);
  const targets = [
    { x: 30, y: 60 },
    { x: 360, y: 60 },
    { x: 360, y: 350 },
    { x: 30, y: 350 },
    { x: 30, y: 640 },
    { x: 360, y: 640 },
  ];
  const capture = {
    mode: 'slide',
    index: 5,
    total: 6,
    phase: 'waiting',
    operation: 'slide',
    progress: 0,
    readings: 0,
    target: { id: 'endpoint', point: targets[4] },
    targets,
  };
  phone.receive({
    view: 'collect',
    automaticPhase: 'grid',
    anchors: [],
    capture,
  });
  expect(phone.elements.get('capture-grid')?.children).toHaveLength(6);
  expect(phone.elements.get('message')?.textContent).toContain('Sliding');
  expect(phone.elements.get('connection')?.textContent).toContain('5 / 6');
  phone.receive({
    view: 'interrupted',
    automaticPhase: 'grid',
    anchors: [],
    capture,
    error: 'No touch within the fast local recovery range',
  });
  expect(phone.elements.get('message')?.textContent).toContain(
    'Touch recovery failed',
  );
  expect(phone.elements.get('target')?.dataset).toMatchObject({
    phase: 'failed',
  });
});

test('shows local touch feedback after calibration stops without requiring a capture target', () => {
  const phone = openPhone(699, 0, 0);
  phone.receive({ view: 'interrupted', error: 'stopped' });
  phone.surfaceListeners.get('pointerdown')!({
    pointerId: 1,
    clientX: 123,
    clientY: 234,
    preventDefault() {},
  });
  expect(phone.elements.get('touch-status')!.textContent).toContain(
    '123.0, 234.0',
  );
  expect(phone.elements.get('mapping-hit')!.style).toMatchObject({
    left: '123px',
    top: '234px',
  });
});

test('retains ordered touch events after release and bounds history without creating a sample', () => {
  const phone = openPhone(699, 0, 0);
  phone.receive({ view: 'interrupted', error: 'stopped' });
  const event = {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 123,
    clientY: 234,
    preventDefault() {},
  };
  for (let i = 0; i < 25; i++) {
    phone.surfaceListeners.get('pointerdown')!(event);
    phone.surfaceListeners.get('pointerup')!(event);
  }
  const update = phone.last();
  expect(update.touchEvents).toHaveLength(40);
  expect(update.touchEvents!.slice(-2).map((e) => e.kind)).toEqual([
    'pointerdown',
    'pointerup',
  ]);
  expect(update.touchEvents!.at(-1)!.sequence).toBeGreaterThan(
    update.touchEvents![0].sequence,
  );
  expect(update.contact).toBeUndefined();
  expect(update.contactStart).toBeUndefined();
  expect(update.touches).toEqual([]);
  phone.surfaceListeners.get('pointerdown')!(event);
  phone.surfaceListeners.get('pointercancel')!(event);
  expect(phone.last().touchEvents!.at(-1)!.kind).toBe('pointercancel');
  expect(phone.last().contact).toBeUndefined();
});

test('captures Touch events outside the surface without inventing a Pointer contact', () => {
  const phone = openPhone(699, 0, 0);
  phone.receive({ view: 'interrupted' });
  const listener = phone.documentListeners.get('touchstart')!;
  expect(listener.options).toEqual({ capture: true, passive: true });
  expect(phone.last().touchDiagnosticsVersion).toBe(2);
  const event = {
    changedTouches: [{ clientX: 15, clientY: 25 }],
    target: { tagName: 'DIV', id: 'outside' },
    defaultPrevented: false,
  };
  listener.callback(event);
  event.defaultPrevented = true;
  phone.flushEvents();
  expect(phone.last().touchEvents!.at(-1)).toMatchObject({
    kind: 'touchstart',
    source: 'document',
    targetElement: 'DIV#outside',
    point: { x: 15, y: 25 },
    defaultPrevented: false,
    defaultPreventedAfterDispatch: true,
  });
  expect(phone.last().contact).toBeUndefined();
  expect(phone.last().contactStart).toBeUndefined();
});
test('retains document and surface Pointer events separately across target reset', () => {
  const phone = openPhone(699, 0, 0);
  phone.receive({ view: 'interrupted' });
  const event = {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 123,
    clientY: 234,
    target: { tagName: 'MAIN', id: 'surface' },
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  phone.documentListeners.get('pointerdown')!.callback(event);
  phone.surfaceListeners.get('pointerdown')!(event);
  phone.flushEvents();
  const events = phone
    .last()
    .touchEvents!.filter((e) => e.kind === 'pointerdown');
  expect(events.map((e) => e.source)).toEqual(['document', 'surface']);
  expect(events[0].defaultPreventedAfterDispatch).toBe(true);
  phone.receive({ view: 'markers' });
  phone.documentListeners.get('pointerup')!.callback(event);
  phone.surfaceListeners.get('pointerup')!(event);
  phone.flushEvents();
  expect(
    phone.last().touchEvents!.filter((e) => e.kind === 'pointerdown'),
  ).toHaveLength(2);
  expect(phone.last().contact).toBeUndefined();
});

test('completion and transport renewal preserve the fullscreen phone document for the next run', async () => {
  const phone = openPhone(844, 0, 0, false);
  phone.receive({ view: 'completed', anchors: [] });
  expect(phone.fullscreenExits()).toBe(0);
  const urls: string[] = [];
  let ready = false;
  phone.scope.fetch = async (url: string) => {
    urls.push(url);
    return {
      ok: ready,
      headers: new Headers(),
      json: async () => ({ pageId: 'next-page', markers: Array(6).fill('') }),
    };
  };
  phone.disconnect(1006);
  expect(phone.timers.size).toBe(1);
  const retry = async () => {
    const [id, callback] = [...phone.timers][0];
    phone.timers.delete(id);
    await callback();
  };
  await retry();
  expect(phone.reloaded()).toBe(false);
  ready = true;
  await retry();
  expect(phone.reloaded()).toBe(false);
  phone.openSocket();
  phone.receive({ view: 'markers', anchors: [] });
  expect(phone.last()).toMatchObject({
    pageId: 'next-page',
    displayMode: 'fullscreen',
  });
  phone.disconnect(4410);
  expect(phone.fullscreenExits()).toBe(0);
  expect(urls).toEqual([
    'http://localhost/phone?token=saved',
    'http://localhost/phone?token=saved',
  ]);
});

test('a replaced phone page does not reconnect and steal the new page session', () => {
  const phone = openPhone(700, 47, 34);
  phone.disconnect(4410);
  expect(phone.timers.size).toBe(0);
  expect(phone.reloaded()).toBe(false);
});

test('document diagnostics distinguish native event time from handler time', () => {
  const phone = openPhone(700, 47, 34);
  phone.scope.performance = Object.assign(Object.create(performance), {
    now: () => 1000,
  });
  const timestamp = 850;
  phone.documentListeners.get('pointerdown')!.callback({
    timeStamp: timestamp,
    pointerType: 'touch',
    clientX: 100,
    clientY: 100,
    defaultPrevented: false,
    target: { tagName: 'MAIN', id: 'surface' },
  });
  phone.flushEvents();
  const event = phone.last().touchEvents!.at(-1)!;
  expect(event.nativeTimestampMs).toBe(timestamp);
  expect(event.dispatchDelayMs).toBeGreaterThanOrEqual(150);
});

test('shows mapped boundary guides and hides collection target markers', () => {
  const phone = openPhone(700, 47, 34);
  phone.receive({
    view: 'collect',
    anchors: [],
    automaticPhase: 'grid',
    capture: {
      mode: 'fast',
      index: 1,
      total: 6,
      phase: 'waiting',
      progress: 0,
      readings: 0,
      target: { id: 'sample', point: { x: 39, y: 70 } },
    },
  });
  expect(phone.elements.get('target')!.style).toMatchObject({
    display: 'none',
  });
  phone.receive({
    view: 'safety',
    anchors: [],
    boundaryGuide: {
      group: 'contact',
      corners: [
        { x: 10, y: 20 },
        { x: 300, y: 20 },
        { x: 300, y: 600 },
        { x: 10, y: 600 },
      ],
    },
  });
  const guide = phone.elements.get('verification-guide')!;
  expect(guide.hidden).toBe(false);
  expect(guide.children).toHaveLength(9);
  expect(guide.children[0]).toMatchObject({
    className: 'verification-edge',
    style: { left: '10px', top: '20px', width: '290px' },
  });
  expect(guide.children[1]).toMatchObject({
    className: 'verification-target',
    children: [{ textContent: '1' }],
  });
  const pointer = {
    pointerId: 1,
    clientX: 24,
    clientY: 36,
    preventDefault() {},
  };
  phone.surfaceListeners.get('pointerdown')!(pointer);
  phone.surfaceListeners.get('pointermove')!({ ...pointer, clientX: 27 });
  expect(phone.elements.get('mapping-hit')!.style).toMatchObject({
    left: '27px',
    top: '36px',
  });
  phone.surfaceListeners.get('pointerup')!({ ...pointer, clientX: 28 });
  expect(phone.elements.get('mapping-hit')!.style).toMatchObject({
    left: '28px',
  });
  expect(phone.elements.get('mapping-trail')!.children.length).toBeGreaterThan(
    0,
  );
  expect(phone.last().touches).toEqual([]);
  phone.receive({ view: 'return-ready', anchors: [] });
  expect(guide.hidden).toBe(true);
  expect(phone.elements.get('mapping-trail')!.children).toHaveLength(0);
});
