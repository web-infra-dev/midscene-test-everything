import { NativeHIDClient } from '../native/client.js';
import {
  type AbsolutePointerCorrection,
  type PointerTurn,
  correctedScreenToPointer,
  screenDeltaToPointer,
  validAbsoluteCorrection,
} from '../pointer/mapping.js';
import {
  MotionValidationError,
  type PointerMotionModel,
  type PointerTracking,
  correctMotionModel,
  measureMotionModel,
  planRelativeDrag,
  validateMotionModel,
  warmUpPointer,
} from '../pointer/motion-model.js';
import {
  DRAG_REPORT_LIMIT,
  MEASURED_REPORT_LIMIT,
  MOTION_VERSION,
  REPORT_INTERVAL_MS,
  compatibleMotionProfile,
  motionBinding,
} from '../pointer/motion-profile.js';
import {
  measureAbsoluteCorrection,
  measurePointerTurn,
} from '../pointer/setup.js';
import type { ScreenSession } from '../screen/source.js';
import type { DeviceConfig, InputAction, Point } from '../types.js';

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
export class HIDInputManager {
  private native = new NativeHIDClient();
  subscribe(listener: Parameters<NativeHIDClient['subscribe']>[0]) {
    return this.native.subscribe(listener);
  }
  async status() {
    return this.native.status();
  }
  async listPeers() {
    return (await this.status()).hosts;
  }
  async open(peerId: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const lifetime = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
      : AbortSignal.timeout(60000);
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        reject(lifetime.reason);
      };
      const unsubscribe = this.native.subscribe((status) => {
        if (lifetime.aborted) return;
        const peer = status.hosts.find((p) => p.id === peerId);
        if (
          peer &&
          [1, 2, 3].every((report) => peer.reports.includes(report))
        ) {
          cleanup();
          resolve();
        } else if (
          status.state === 'bluetooth off' ||
          /not allowed|failed|unavailable|exited/.test(status.state)
        ) {
          cleanup();
          reject(new Error(status.state));
        }
      });
      const cleanup = () => {
        unsubscribe();
        lifetime.removeEventListener('abort', onAbort);
      };
      lifetime.addEventListener('abort', onAbort, { once: true });
      if (lifetime.aborted) onAbort();
    });
    return new HIDInputSession(this.native, peerId);
  }

  close() {
    return this.native.close();
  }
}

export class HIDInputSession {
  private lifetime = new AbortController();
  private motion?: PointerMotionModel;
  private lastAbsolute?: Point;
  private absoluteCorrection?: AbsolutePointerCorrection;
  private mapping?: { turn: PointerTurn; width: number; height: number };
  private profileConfig?: DeviceConfig;
  private persistProfile?: () => Promise<void>;
  configureMotion(config: DeviceConfig, persist?: () => Promise<void>) {
    this.profileConfig = config;
    this.persistProfile = persist;
  }
  constructor(
    private native: NativeHIDClient,
    private peer: string,
  ) {}
  cancel() {
    this.lifetime.abort();
  }
  async absolute(point: Point, signal = this.lifetime.signal) {
    signal.throwIfAborted();
    const x = Math.round(point.x * 32767);
    const y = Math.round(point.y * 32767);
    if (![x, y].every((n) => Number.isInteger(n) && n >= 0 && n <= 32767))
      throw new Error('Pointer position outside screen');
    const send = (px: number, py: number) =>
      this.native.send(this.peer, 2, [0, px & 255, px >> 8, py & 255, py >> 8]);
    // iOS can ignore an absolute report identical to the previous one, even
    // after relative motion moved the pointer elsewhere. Change one raw unit
    // first so returning to a measurement anchor is an actual reposition.
    if (this.lastAbsolute?.x === x && this.lastAbsolute.y === y) {
      await send(x === 32767 ? x - 1 : x + 1, y);
      signal.throwIfAborted();
    }
    await send(x, y);
    this.lastAbsolute = { x, y };
  }
  async verify(screen: ScreenSession, cancellation?: AbortSignal) {
    const signal = cancellation
      ? AbortSignal.any([this.lifetime.signal, cancellation])
      : this.lifetime.signal;
    signal.throwIfAborted();
    const config = this.profileConfig;
    const cached = config?.pointerMotion;
    const isCamera = config?.screen.source === 'camera';
    const transport = {
      absolute: (point: Point) => this.absolute(point, signal),
    };
    this.mapping = undefined;
    this.motion = undefined;
    this.absoluteCorrection = undefined;
    if (config && cached) {
      const frame = await screen.getFrame({
        fresh: true,
        allowUnchanged: true,
        timeoutMs: 10000,
      });
      const geometry = {
        width: frame.width,
        height: frame.height,
        turn: cached.turn,
      };
      if (
        frame.width === cached.width &&
        frame.height === cached.height &&
        compatibleMotionProfile(cached, motionBinding(config, geometry))
      ) {
        if (isCamera) {
          if (validAbsoluteCorrection(cached.absoluteCorrection)) {
            this.absoluteCorrection = cached.absoluteCorrection;
          } else {
            // Existing profiles have no known cursor position on reconnect.
            await transport.absolute({ x: 0.5, y: 0.5 });
            await pause(400);
            const { correction } = await measureAbsoluteCorrection(
              screen,
              transport,
              geometry,
              signal,
            );
            config.pointerMotion = {
              ...cached,
              absoluteCorrection: correction,
            };
            try {
              await this.persistProfile?.();
            } catch (error) {
              config.pointerMotion = cached;
              throw error;
            }
            this.absoluteCorrection = correction;
          }
        }
        signal.throwIfAborted();
        this.mapping = geometry;
        this.motion = cached.model;
        return;
      }
    }
    // Warm up before the direction probes, so the last observed position
    // remains valid when the first motion probe starts.
    await this.absolute({ x: 0.2, y: 0.3 }, signal);
    await warmUpPointer({ relative: (delta) => this.relative(delta) }, signal);
    const { position, ...mapping } = await measurePointerTurn(
      screen,
      transport,
      signal,
    );
    const measured = isCamera
      ? await measureAbsoluteCorrection(screen, transport, mapping, signal)
      : undefined;
    this.absoluteCorrection = measured?.correction;
    this.mapping = mapping;
    try {
      await this.prepareMotion(screen, signal, {
        position: measured?.position ?? position,
      });
    } catch (error) {
      this.mapping = undefined;
      this.absoluteCorrection = undefined;
      throw error;
    }
  }
  private async prepareMotion(
    screen: ScreenSession,
    signal: AbortSignal,
    warmedTracking?: PointerTracking,
  ) {
    const tracking = warmedTracking ?? {};
    const config = this.profileConfig;
    const mapping = this.mapping!;
    const assertGeometry = async () => {
      const current = await screen.getFrame();
      if (current.width !== mapping.width || current.height !== mapping.height)
        throw new Error(
          'Screen geometry changed during pointer measurement; reconnect',
        );
    };
    await assertGeometry();
    const binding = config ? motionBinding(config, mapping) : '';
    const transport = {
      moveTo: (point: Point) => this.moveTo(point, signal),
      relative: (delta: Point) => {
        signal.throwIfAborted();
        return this.relative(screenDeltaToPointer(delta, mapping.turn));
      },
    };
    const cached = config?.pointerMotion;
    if (compatibleMotionProfile(cached, binding)) {
      let validation;
      try {
        validation = await validateMotionModel(
          screen,
          transport,
          cached.model,
          signal,
          tracking,
        );
      } catch {
        signal.throwIfAborted();
        // A cache is usable only after current-frame verification. Refit below.
      }
      if (validation) {
        signal.throwIfAborted();
        await assertGeometry();
        config!.pointerMotion = { ...cached, validation };
        await this.persistProfile?.();
        this.motion = cached.model;
        return;
      }
    }
    if (config?.pointerMotion) {
      config.pointerMotion = undefined;
      await this.persistProfile?.();
    }
    const measured = await measureMotionModel(
      screen,
      transport,
      signal,
      warmedTracking,
    );
    let validation;
    // Learn stable discrepancies, then test again with new moves. Never turn a
    // failed sample itself into a passing validation or save unchecked data.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        validation = await validateMotionModel(
          screen,
          transport,
          measured.model,
          signal,
          tracking,
        );
        break;
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof MotionValidationError) || attempt === 2)
          throw error;
        correctMotionModel(measured.model, error.sample);
        const index = measured.samples.findIndex(
          (sample) =>
            sample.delta.x === error.sample.delta.x &&
            sample.delta.y === error.sample.delta.y,
        );
        if (index >= 0) measured.samples[index] = error.sample;
      }
    }
    signal.throwIfAborted();
    await assertGeometry();
    if (config) {
      config.pointerMotion = {
        version: MOTION_VERSION,
        absoluteCorrection: this.absoluteCorrection,
        binding,
        ...mapping,
        reportIntervalMs: REPORT_INTERVAL_MS,
        measuredReportLimit: MEASURED_REPORT_LIMIT,
        dragReportLimit: DRAG_REPORT_LIMIT,
        model: measured.model,
        samples: measured.samples,
        validation: validation!,
        measuredAt: new Date().toISOString(),
      };
      await this.persistProfile?.();
    }
    signal.throwIfAborted();
    this.motion = measured.model;
  }
  async moveTo(point: Point, signal = this.lifetime.signal) {
    const m = this.mapping;
    if (!m) throw new Error('Pointer has not been verified');
    if (
      ![point.x, point.y].every(Number.isFinite) ||
      point.x < 0 ||
      point.y < 0 ||
      point.x >= m.width ||
      point.y >= m.height
    )
      throw new Error('Pointer target outside screen');
    await this.absolute(
      correctedScreenToPointer(
        { x: point.x / (m.width - 1), y: point.y / (m.height - 1) },
        m.turn,
        this.absoluteCorrection,
      ),
      signal,
    );
  }
  relative(delta: Point, buttons = 0) {
    if (
      ![delta.x, delta.y].every(
        (v) => Number.isInteger(v) && v >= -127 && v <= 127,
      )
    )
      throw new Error('Invalid relative report');
    return this.native
      .send(this.peer, 3, [buttons, delta.x & 255, delta.y & 255, 0])
      .then(() => undefined);
  }
  async execute(
    action: InputAction,
    screen: ScreenSession,
    cancellation?: AbortSignal,
  ) {
    const signal = cancellation
      ? AbortSignal.any([this.lifetime.signal, cancellation])
      : this.lifetime.signal;
    signal.throwIfAborted();
    if (!action || typeof action !== 'object')
      throw new Error('Invalid input action');
    if (action.type === 'home') {
      // Consumer AC Home is accepted but ignored on some iPhones. The external
      // keyboard system shortcut works on those devices as well.
      await this.sendKey(11, 8, signal); // Command + H
      signal.throwIfAborted();
      return;
    }
    if (action.type === 'back') {
      const frame = await screen.getFrame();
      if (frame.width < 4 || frame.height < 4)
        throw new Error('Screen too small for Back gesture');
      const edge = (value: number, size: number) =>
        Math.max(1, Math.min(size - 2, Math.round(value * size)));
      action = {
        type: 'swipe',
        from: { x: edge(0.005, frame.width), y: edge(0.45, frame.height) },
        to: { x: edge(0.6, frame.width), y: edge(0.45, frame.height) },
        durationMs: 700,
      };
    }
    if (action.type === 'tap') {
      if (!this.mapping) await this.verify(screen, signal);
      const frame = await screen.getFrame();
      const m = this.mapping!;
      if (frame.width !== m.width || frame.height !== m.height) {
        this.mapping = undefined;
        throw new Error(
          'Screen geometry changed. Reconnect to verify the pointer.',
        );
      }
      const p = action.point;
      if (
        !p ||
        ![p.x, p.y].every(Number.isFinite) ||
        p.x < 0 ||
        p.y < 0 ||
        p.x >= m.width ||
        p.y >= m.height
      )
        throw new Error('Tap outside screen');
      await this.moveTo(p, signal);
      await pause(120);
      signal.throwIfAborted();
      try {
        await this.native.send(this.peer, 3, [1, 0, 0, 0]);
        await pause(60);
      } finally {
        await this.native.send(this.peer, 3, [0, 0, 0, 0]);
      }
      return;
    }
    if (action.type === 'key') {
      await this.key(action.key, signal);
      return;
    }
    if (action.type === 'clearInput') {
      await this.sendKey(4, 8, signal);
      await this.sendKey(42, 0, signal);
      return;
    }
    if (action.type === 'typeText') {
      if (typeof action.text !== 'string' || action.text.length > 10000)
        throw new Error('Invalid text');
      // Validate before sending any character; avoid partial unsupported input.
      const keys = [...action.text].map(asciiKey);
      if (action.replace) {
        await this.sendKey(4, 8, signal);
        await this.sendKey(42, 0, signal);
      }
      for (const key of keys) {
        signal.throwIfAborted();
        await this.sendKey(key.code, key.shift ? 2 : 0, signal);
      }
      return;
    }
    if (action.type === 'swipe') {
      if (!this.mapping) await this.verify(screen, signal);
      const frame = await screen.getFrame();
      if (
        frame.width !== this.mapping!.width ||
        frame.height !== this.mapping!.height
      )
        throw new Error('Screen geometry changed; reconnect');
      const duration = action.durationMs ?? 350;
      if (!Number.isFinite(duration) || duration < 100 || duration > 5000)
        throw new Error('Swipe duration must be between 100 and 5000 ms');
      // Validate both endpoints before pressing any button.
      for (const p of [action.from, action.to]) {
        if (
          !p ||
          ![p.x, p.y].every(Number.isFinite) ||
          p.x < 1 ||
          p.y < 1 ||
          p.x >= frame.width - 1 ||
          p.y >= frame.height - 1
        )
          throw new Error('Swipe endpoint outside screen');
      }
      if (!this.motion) await this.prepareMotion(screen, signal);
      const plan = planRelativeDrag(
        action.from,
        action.to,
        duration,
        this.motion!,
        this.mapping!.turn,
      );
      await this.moveTo(action.from, signal);
      await pause(120);
      try {
        signal.throwIfAborted();
        await this.relative({ x: 0, y: 0 }, 1);
        let lastStart = 0;
        for (const report of plan.reports) {
          if (lastStart)
            await pause(
              Math.max(0, lastStart + plan.intervalMs - performance.now()),
            );
          signal.throwIfAborted();
          lastStart = performance.now();
          await this.relative(report, 1);
        }
      } finally {
        await this.relative({ x: 0, y: 0 }, 0);
      }
      await this.moveTo(action.to, signal);
      return;
    }
    throw new Error('Unknown input action');
  }
  private async sendKey(
    code: number,
    modifiers = 0,
    signal = this.lifetime.signal,
  ) {
    signal.throwIfAborted();
    try {
      await this.native.send(this.peer, 1, [modifiers, 0, code, 0, 0, 0, 0, 0]);
      await pause(25);
    } finally {
      await this.native.send(this.peer, 1, [0, 0, 0, 0, 0, 0, 0, 0]);
    }
  }
  private async key(chord: string, signal = this.lifetime.signal) {
    if (typeof chord !== 'string') throw new Error('Invalid key');
    if (chord === '+') {
      await this.sendKey(46, 2, signal);
      return;
    }
    const parts = chord.split('+');
    const key = parts.pop()!;
    let modifiers = 0;
    const masks: Record<string, number> = {
      control: 1,
      ctrl: 1,
      shift: 2,
      alt: 4,
      option: 4,
      meta: 8,
      cmd: 8,
      command: 8,
    };
    for (const part of parts) {
      const mask = masks[part.toLowerCase()];
      if (!mask) throw new Error('Unsupported keyboard modifier');
      modifiers |= mask;
    }
    const codes: Record<string, number> = {
      Enter: 40,
      Escape: 41,
      Backspace: 42,
      Tab: 43,
      Space: 44,
      ArrowRight: 79,
      ArrowLeft: 80,
      ArrowDown: 81,
      ArrowUp: 82,
    };
    if (key in codes) {
      await this.sendKey(codes[key], modifiers, signal);
      return;
    }
    if (key.length === 1) {
      const value = asciiKey(parts.length ? key.toLowerCase() : key);
      await this.sendKey(value.code, modifiers | (value.shift ? 2 : 0), signal);
      return;
    }
    throw new Error('Unsupported key');
  }
  async releaseAll() {
    await Promise.allSettled([
      this.native.send(this.peer, 1, [0, 0, 0, 0, 0, 0, 0, 0]),
      this.native.send(this.peer, 3, [0, 0, 0, 0]),
      this.native.send(this.peer, 4, [0, 0]),
    ]);
  }
  async close() {
    this.cancel();
    await this.releaseAll();
  }
}
function asciiKey(char: string): { code: number; shift: boolean } {
  if (/^[a-zA-Z]$/.test(char))
    return {
      code: char.toLowerCase().charCodeAt(0) - 97 + 4,
      shift: char !== char.toLowerCase(),
    };
  if (/^[1-9]$/.test(char)) return { code: Number(char) + 29, shift: false };
  if (char === '0') return { code: 39, shift: false };
  const normal = '\n\u001b\b\t -=[]\\;\u0027`,./';
  const codes = [
    40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 52, 53, 54, 55, 56,
  ];
  const index = normal.indexOf(char);
  if (index >= 0) return { code: codes[index], shift: false };
  const shifted: Record<string, number> = {
    '!': 30,
    '@': 31,
    '#': 32,
    $: 33,
    '%': 34,
    '^': 35,
    '&': 36,
    '*': 37,
    '(': 38,
    ')': 39,
    _: 45,
    '+': 46,
    '{': 47,
    '}': 48,
    '|': 49,
    ':': 51,
    '"': 52,
    '~': 53,
    '<': 54,
    '>': 55,
    '?': 56,
  };
  if (char in shifted) return { code: shifted[char], shift: true };
  throw new Error(
    `Input supports ASCII only; unsupported character: ${JSON.stringify(char)}. Do not retry Input with this text. Tap visible suggestions or use the on-screen keyboard, then verify the committed text.`,
  );
}
