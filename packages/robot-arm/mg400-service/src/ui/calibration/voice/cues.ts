export type CueName = 'scan' | 'fit' | 'shutter' | 'click' | 'found';
export interface CueTone {
  frequency: number;
  durationMs: number;
  gapMs?: number;
  gain?: number;
  type?: OscillatorType;
}
/**
 * Short non-speech cues for routine phases. Keep them sparse: these replace
 * speech, not the safety-critical prompts that still need words.
 */
export const cuePatterns: Record<CueName, readonly CueTone[]> = {
  scan: [
    { frequency: 520, durationMs: 70, gapMs: 40, gain: 0.06 },
    { frequency: 700, durationMs: 90, gain: 0.06 },
  ],
  fit: [
    { frequency: 440, durationMs: 50, gapMs: 60, gain: 0.05 },
    { frequency: 440, durationMs: 50, gain: 0.05 },
  ],
  // Short mechanical clicks: camera capture, screen touch and a confirmed target.
  shutter: [
    {
      frequency: 1500,
      durationMs: 28,
      gapMs: 20,
      gain: 0.1,
      type: 'square',
    },
    { frequency: 900, durationMs: 45, gain: 0.07, type: 'square' },
  ],
  click: [{ frequency: 1050, durationMs: 50, gain: 0.08, type: 'square' }],
  found: [
    { frequency: 660, durationMs: 50, gapMs: 25, gain: 0.06 },
    { frequency: 990, durationMs: 70, gain: 0.06 },
  ],
};
type CueContext = Pick<
  AudioContext,
  'currentTime' | 'createOscillator' | 'createGain' | 'destination' | 'resume'
>;
function browserContext(): AudioContext {
  const Ctor =
    globalThis.AudioContext ??
    (
      globalThis as typeof globalThis & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext;
  if (!Ctor) throw new Error('Audio cues are unavailable');
  return new Ctor();
}
/**
 * Optional tone playback. It shares the existing voice mute/visibility gate and
 * never throws into a control path; a browser without Web Audio simply stays
 * silent while speech and visual feedback continue.
 */
export class CuePlayer {
  enabled = true;
  active = false;
  private context?: CueContext;
  private scheduled = new Set<OscillatorNode>();
  constructor(
    private readonly createContext: () => CueContext = browserContext,
  ) {}
  configure(enabled: boolean, active: boolean) {
    this.enabled = enabled;
    this.active = active;
    if (!enabled || !active) this.cancel();
  }
  /** Create or resume the context inside a user gesture for stricter browsers. */
  prime() {
    try {
      this.context ??= this.createContext();
      void this.context.resume().catch(() => undefined);
    } catch {
      // Speech and visual feedback remain available without Web Audio.
    }
  }
  play(name: CueName): boolean {
    if (!this.enabled || !this.active) return false;
    const pattern = cuePatterns[name];
    if (!pattern) return false;
    try {
      this.context ??= this.createContext();
      const context = this.context;
      void context.resume().catch(() => undefined);
      let at = context.currentTime + 0.01;
      for (const tone of pattern) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const duration = tone.durationMs / 1000;
        oscillator.type = tone.type ?? 'sine';
        oscillator.frequency.setValueAtTime(tone.frequency, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(tone.gain ?? 0.05, at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.onended = () => {
          this.scheduled.delete(oscillator);
          oscillator.disconnect();
          gain.disconnect();
        };
        this.scheduled.add(oscillator);
        oscillator.start(at);
        oscillator.stop(at + duration);
        at += duration + (tone.gapMs ?? 0) / 1000;
      }
      return true;
    } catch {
      return false;
    }
  }
  cancel() {
    for (const oscillator of this.scheduled) {
      try {
        oscillator.stop();
      } catch {
        // It may already have ended.
      }
      oscillator.disconnect();
    }
    this.scheduled.clear();
  }
}
