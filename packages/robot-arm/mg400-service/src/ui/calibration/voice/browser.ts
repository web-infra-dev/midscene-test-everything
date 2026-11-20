import { useEffect, useState, useSyncExternalStore } from 'react';
import { useCalibrationLanguage } from '../i18n';
const useLanguage = () => useCalibrationLanguage((state) => state.language);
import { CuePlayer } from './cues';
import { VoiceSpeaker } from './speaker';

const STORAGE_KEY = 'midscene-robot-voice-enabled';
const VOICE_KEY = 'midscene-robot-voice-name-';
function preferredVoice(language: 'en' | 'zh') {
  try {
    return localStorage.getItem(VOICE_KEY + language);
  } catch {
    return null;
  }
}
const selectedVoices = { en: preferredVoice('en'), zh: preferredVoice('zh') };
export function selectVoice(
  voices: SpeechSynthesisVoice[],
  language: 'en' | 'zh',
) {
  const matching = voices.filter(
    (voice) => voice.lang.toLowerCase().split(/[-_]/)[0] === language,
  );
  const preferred = matching.find(
    (voice) => voice.voiceURI === selectedVoices[language],
  );
  const locale = language === 'zh' ? 'zh-cn' : 'en-us';
  const exact = matching.filter(
    (voice) => voice.lang.toLowerCase().replace('_', '-') === locale,
  );
  const candidates = exact.length ? exact : matching;
  return (
    preferred ??
    candidates.find((voice) => voice.default) ??
    candidates.find((voice) =>
      /natural|neural|enhanced|premium/i.test(voice.name),
    ) ??
    candidates.find(
      (voice) =>
        language === 'en' &&
        /^(Samantha|Alex|Google US English)$/i.test(voice.name),
    ) ??
    candidates.find((voice) => voice.localService) ??
    candidates[0]
  );
}
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};
let enabled = true;
try {
  enabled = localStorage.getItem(STORAGE_KEY) !== 'false';
} catch {
  /* In-memory settings still work. */
}
let activated = false;
export const voiceSupported =
  typeof window !== 'undefined' &&
  'speechSynthesis' in window &&
  'SpeechSynthesisUtterance' in window;
let utterance: SpeechSynthesisUtterance | undefined;
let releaseLock: (() => void) | undefined;
let stopWaitingForVoices: (() => void) | undefined;
let playbackEpoch = 0;
export const robotVoice = new VoiceSpeaker(
  {
    speak(text, language, done) {
      if (!voiceSupported) {
        done('Speech unavailable');
        return;
      }
      const speech = window.speechSynthesis;
      const epoch = ++playbackEpoch;
      const speakWithVoices = (voices: SpeechSynthesisVoice[]) => {
        if (epoch !== playbackEpoch) return;
        const voice = selectVoice(voices, language);
        if (!voice) {
          done('Language voice unavailable');
          return;
        }
        const play = (release = () => {}) => {
          if (epoch !== playbackEpoch) {
            release();
            return;
          }
          releaseLock = release;
          const next = new SpeechSynthesisUtterance(text);
          utterance = next;
          next.lang = voice.lang;
          next.voice = voice;
          const finish = (error?: string) => {
            if (epoch !== playbackEpoch) return;
            utterance = undefined;
            releaseLock = undefined;
            release();
            done(error);
          };
          next.onend = () => finish();
          next.onerror = (event) => finish(event.error);
          try {
            speech.speak(next);
          } catch (error) {
            finish(String(error));
          }
        };
        // Same-origin visible tabs share a lock for the lifetime of each utterance.
        // Do not queue behind another tab: its duplicate is already being spoken.
        if (navigator.locks) {
          void navigator.locks
            .request(
              `midscene-robot-voice:${language}:${text}`,
              { ifAvailable: true },
              (lock) => {
                if (!lock) {
                  done();
                  return;
                }
                return new Promise<void>((resolve) => play(resolve));
              },
            )
            .catch((error) => {
              if (epoch === playbackEpoch) done(String(error));
            });
        } else play();
      };
      const voices = speech.getVoices();
      if (voices.length) {
        speakWithVoices(voices);
        return;
      }
      // Some browsers populate voices asynchronously. The speaker's watchdog
      // bounds this wait; mute, language changes and teardown remove the listener.
      const loaded = () => {
        if (epoch !== playbackEpoch) return;
        const available = speech.getVoices();
        if (!available.length) return;
        stopWaitingForVoices?.();
        speakWithVoices(available);
      };
      stopWaitingForVoices = () => {
        speech.removeEventListener('voiceschanged', loaded);
        stopWaitingForVoices = undefined;
      };
      speech.addEventListener('voiceschanged', loaded);
      loaded();
    },
    cancel() {
      playbackEpoch++;
      stopWaitingForVoices?.();
      releaseLock?.();
      releaseLock = undefined;
      if (utterance) {
        utterance.onend = null;
        utterance.onerror = null;
        utterance = undefined;
      }
      if (voiceSupported) window.speechSynthesis.cancel();
    },
  },
  changed,
);
/** Short tones share the voice mute and visibility gate. */
export const robotCue = new CuePlayer();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useVoiceSettings() {
  const language = useLanguage();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!voiceSupported) return;
    const update = () => setVoices(window.speechSynthesis.getVoices());
    update();
    window.speechSynthesis.addEventListener('voiceschanged', update);
    return () =>
      window.speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);
  useSyncExternalStore(
    subscribe,
    () =>
      `${enabled}:${robotVoice.error ?? ''}:${selectedVoices.en}:${selectedVoices.zh}`,
    () => 'true:',
  );
  return {
    enabled,
    voices: voices.filter(
      (voice) => voice.lang.toLowerCase().split(/[-_]/)[0] === language,
    ),
    selectedVoice: selectedVoices[language] ?? '',
    setVoice(uri: string) {
      selectedVoices[language] = uri || null;
      try {
        localStorage.setItem(VOICE_KEY + language, uri);
      } catch {
        /* Keep in memory. */
      }
      robotVoice.cancel();
      robotVoice.error = undefined;
      changed();
    },
    supported: voiceSupported,
    error: robotVoice.error,
    setEnabled(next: boolean) {
      enabled = next;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* Keep in memory. */
      }
      const active = activated && document.visibilityState !== 'hidden';
      robotVoice.configure(next, robotVoice.language, active);
      robotCue.configure(next, active);
      changed();
    },
  };
}
/** Install once at the app boundary, independently of which robot panels are open. */
export function useBrowserVoice(enabledBoundary = true) {
  const language = useLanguage();
  useEffect(() => {
    if (!enabledBoundary) return;
    const configure = () => {
      const active = activated && document.visibilityState !== 'hidden';
      robotVoice.configure(enabled, language, active);
      robotCue.configure(enabled, active);
    };
    const activate = () => {
      activated = true;
      robotCue.prime();
      configure();
    };
    const storage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key?.startsWith(VOICE_KEY) || event.key === null) {
        selectedVoices.en = preferredVoice('en');
        selectedVoices.zh = preferredVoice('zh');
        robotVoice.cancel();
        changed();
      }
      if (event.key === STORAGE_KEY || event.key === null) {
        enabled = event.newValue !== 'false';
        configure();
      }
    };
    configure();
    document.addEventListener('pointerdown', activate, true);
    document.addEventListener('keydown', activate, true);
    document.addEventListener('visibilitychange', configure);
    window.addEventListener('storage', storage);
    return () => {
      document.removeEventListener('pointerdown', activate, true);
      document.removeEventListener('keydown', activate, true);
      document.removeEventListener('visibilitychange', configure);
      window.removeEventListener('storage', storage);
      robotVoice.cancel();
      robotCue.cancel();
    };
  }, [language, enabledBoundary]);
}
