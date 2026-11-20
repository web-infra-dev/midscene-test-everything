import type {
  AssistedCalibrationState,
  CalibrationBatchState,
  CalibrationSnapshot,
} from '../robot-arm-api';
import { robotCue, robotVoice } from './browser';
import type { VoiceEvent } from './messages';

type Prompt = [event: VoiceEvent, priority?: 1 | 2];
export function speakCalibration(event: VoiceEvent, priority: 1 | 2 = 1) {
  robotVoice.notify(event, priority, 'calibration');
}

function sessionPrompt(
  s: AssistedCalibrationState,
  previous: AssistedCalibrationState | undefined,
  mode: 'single' | 'batch',
): Prompt | undefined {
  const entered = s.stage !== previous?.stage;
  if (s.stage === 'collecting') {
    if (s.referenceTravel) {
      if (entered || s.referenceTravel !== previous?.referenceTravel)
        return [
          s.referenceTravel === 'approach'
            ? 'approachStart'
            : 'referenceReturn',
          2,
        ];
    } else if (entered) return ['autoStarted', 2];
    return;
  }
  if (!entered) return;
  if (s.stage === 'returning') return ['autoVerifying', 2];
  if (s.stage === 'avoiding-camera') return ['autoAvoiding', 2];
  if (mode === 'batch') return;
  switch (s.stage) {
    case 'review':
      return ['autoReview'];
    case 'interrupted':
    case 'capture-failed':
    case 'verification-failed':
      return ['autoFailed', 2];
    case 'cancelled':
      return ['autoStopped', 2];
  }
}

/** A fresh subscription is silent. Only subsequent transitions announce. */
export function calibrationAnnouncements(mode: 'single' | 'batch' = 'single') {
  let previous: CalibrationSnapshot | undefined;
  return (next: CalibrationSnapshot) => {
    const old = previous;
    previous = next;
    if (!old) return;
    const s = next.session;
    const prior = s && s.id === old.session?.id ? old.session : undefined;
    const lostFeedback =
      s &&
      old.phone.state === 'connected' &&
      (next.phone.state === 'paused' || next.phone.state === 'reconnecting');
    const prompt = s && sessionPrompt(s, prior, mode);
    if (lostFeedback) speakCalibration('phoneLost', 2);
    else if (prompt) speakCalibration(...prompt);
    if (s?.stage === 'collecting' && prior && s.samples > prior.samples)
      robotCue.play('click');
  };
}

function batchPrompt(batch: CalibrationBatchState): Prompt | undefined {
  if (batch.status === 'stopping' || batch.status === 'stopped')
    return ['batchStopping', 2];
  if (batch.status === 'failed') return ['autoFailed', 2];
  if (
    batch.status === 'completed' &&
    batch.items.some((item) => item.status === 'completed')
  )
    return ['batchCompleted'];
  if (batch.status === 'running' && batch.automaticSharedParking)
    return ['autoAvoiding', 2];
  const row = batch.items[batch.currentIndex];
  if (!row) return;
  if (
    batch.status === 'waiting' &&
    row.status === 'awaiting-acceptance' &&
    row.progress?.phase === 'awaiting-acceptance'
  )
    return ['autoReview'];
  if (
    batch.status === 'running' &&
    (row.status === 'transferring' ||
      (row.status === 'preparing' && batch.currentIndex > 0))
  )
    return ['batchNext', 2];
  if (batch.status === 'waiting' && row.status === 'failed')
    return ['autoFailed', 2];
}

export function batchAnnouncements() {
  let previous: CalibrationBatchState | null | undefined;
  return (next: CalibrationBatchState | null) => {
    const old = previous;
    if (old && next?.id === old.id && next.revision <= old.revision) return;
    previous = next;
    if (old === undefined || !next) return;
    const prompt = batchPrompt(next);
    const screenChanged =
      old?.id === next.id && old.currentIndex !== next.currentIndex;
    if (
      prompt &&
      (old?.id !== next.id ||
        screenChanged ||
        batchPrompt(old)?.[0] !== prompt[0])
    )
      speakCalibration(...prompt);
    else if (
      screenChanged &&
      next.status === 'running' &&
      next.items[next.currentIndex] &&
      !prompt
    )
      speakCalibration('batchNext', 2);
  };
}
