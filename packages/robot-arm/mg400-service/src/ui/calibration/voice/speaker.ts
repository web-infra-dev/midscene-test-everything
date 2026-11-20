import { type VoiceEvent, voiceMessages } from './messages';

export interface SpeechPort {
  speak(
    text: string,
    language: 'en' | 'zh',
    done: (error?: string) => void,
  ): void;
  cancel(): void;
}
interface Pending {
  event: VoiceEvent;
  text: string;
  priority: number;
  at: number;
  scope?: string;
}
/** Independent of React and robot APIs. Speech must never gate a control command. */
export class VoiceSpeaker {
  enabled = true;
  active = false;
  language: 'en' | 'zh' = 'en';
  error?: string;
  private queue: Pending[] = [];
  private current?: Pending;
  private recent = new Map<VoiceEvent, number>();
  private epoch = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private port: SpeechPort,
    private changed = () => {},
  ) {}
  configure(enabled: boolean, language: 'en' | 'zh', active: boolean) {
    if (this.enabled !== enabled || this.language !== language) {
      this.error = undefined;
      this.cancel();
    } else if (!active) this.cancel();
    this.enabled = enabled;
    this.language = language;
    this.active = active;
    this.changed();
  }
  cancel() {
    this.epoch++;
    clearTimeout(this.timer);
    this.queue = [];
    this.current = undefined;
    this.recent.clear();
    try {
      this.port.cancel();
    } catch {
      /* Browser speech can disappear during teardown. */
    }
  }
  notify(event: VoiceEvent, priority = 0, scope?: string) {
    const message = voiceMessages[event];
    if (!message || !this.enabled || !this.active) return;
    const at = Date.now();
    const last = this.recent.get(event);
    if (last !== undefined && at - last < 2500) return;
    // Replace superseded guidance while retaining higher-priority warnings.
    if (scope)
      this.queue = this.queue.filter(
        (item) => item.scope !== scope || item.priority > priority,
      );
    if (
      this.current &&
      (priority > this.current.priority ||
        (scope &&
          scope === this.current.scope &&
          priority >= 2 &&
          priority === this.current.priority))
    ) {
      this.cancel();
    }
    this.recent.set(event, at);
    this.queue.push({
      event,
      text: message[this.language === 'zh' ? 1 : 0],
      priority,
      at,
      scope,
    });
    this.queue.sort((a, b) => b.priority - a.priority);
    this.queue = this.queue.slice(0, 3);
    this.flush();
  }
  private flush() {
    if (this.current) return;
    this.queue = this.queue.filter((item) => Date.now() - item.at < 4000);
    const next = this.queue.shift();
    if (!next) return;
    this.current = next;
    const epoch = ++this.epoch;
    const done = (error?: string) => {
      if (epoch !== this.epoch) return;
      this.epoch++;
      clearTimeout(this.timer);
      this.error = error;
      this.current = undefined;
      this.changed();
      this.flush();
    };
    this.timer = setTimeout(() => {
      try {
        this.port.cancel();
      } catch {
        /* Timeout still settles. */
      }
      done('Speech timed out');
    }, 10000);
    try {
      this.port.speak(next.text, this.language, done);
    } catch (error) {
      done(String(error));
    }
  }
}
