import type {
  AssistedCalibrationSetup,
  AssistedCalibrationState,
  CalibrationBatchState,
  CalibrationPhoneStatus,
  CalibrationSnapshot,
} from '../robot-arm-api';
import { robotCue, robotVoice } from './browser';
import type { VoiceEvent } from './messages';

type Prompt = [event: VoiceEvent, priority?: 1 | 2];
export function speakCalibration(event: VoiceEvent, priority: 1 | 2 = 1) {
  robotVoice.notify(event, priority, 'calibration');
}

function phonePrompt(phone: CalibrationPhoneStatus): Prompt {
  if (phone.state === 'connected') {
    if (phone.displayRequirement === 'fullscreen') return ['phoneFullscreen'];
    if (phone.displayRequirement === 'home-screen') return ['phoneHomeScreen'];
    return ['phoneReady'];
  }
  return phone.state === 'waiting' ? ['mappingWaiting'] : ['phoneLost', 2];
}

function setupPrompt(
  next: AssistedCalibrationSetup,
  old: AssistedCalibrationSetup,
): Prompt | undefined {
  if (
    next.markerCapture &&
    next.markerCapture.request !== old.markerCapture?.request
  )
    return [
      next.markerCapture.attempt > 1 ? 'markersRetry' : 'markersCountdown',
      2,
    ];
  if (next.mappingCheck && next.mappingCheck !== old.mappingCheck) {
    const events = {
      checking: 'mappingStart',
      confirmed: 'mappingDone',
      failed: 'mappingFailed',
    } as const;
    return [events[next.mappingCheck]];
  }
  if (!next.mappingCheck && next.mapping && !old.mapping)
    return ['mappingDone'];
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
    } else if (
      s.capture &&
      (entered ||
        !previous?.capture ||
        s.automaticPhase !== previous.automaticPhase)
    ) {
      return [s.automaticPhase === 'local' ? 'directionProbe' : 'autoSampling'];
    } else if (entered) return ['autoStarted', 2];
    return;
  }
  if (s.stage === 'safety') {
    const group = s.calibration?.progress?.group;
    if (group && (entered || group !== previous?.calibration?.progress?.group))
      return [group, 2];
    return;
  }
  if (s.stage === 'ready') {
    if (mode === 'batch' || s.error) return;
    if (
      entered ||
      Boolean(s.referencePosition) !== Boolean(previous?.referencePosition) ||
      Boolean(s.cameraBoundaryPosition) !==
        Boolean(previous?.cameraBoundaryPosition) ||
      s.teachingId !== previous?.teachingId
    ) {
      if (!s.referencePosition) return ['teachReference'];
      if (s.cameraBoundaryPosition && !s.teachingId) return ['confirmCorridor'];
      return ['samplingReady'];
    }
    return;
  }
  if (!entered) return;
  switch (s.stage) {
    case 'returning':
      return ['autoVerifying', 2];
    case 'avoiding-camera':
      return ['autoAvoiding', 2];
    case 'positioning':
      return ['teachReference'];
    case 'positioning-boundary':
      return ['teachBoundary'];
    case 'positioning-safe':
      return ['recordSafe'];
    case 'verifying':
      return ['verifyTargets', 2];
    case 'reprobing':
      return ['autoSampling', 2];
  }
  // The batch coordinator decides whether a screen needs operator acceptance.
  if (mode === 'batch') return;
  switch (s.stage) {
    case 'reference-required':
      return ['higherReference'];
    case 'boundary-review':
      return ['boundaryReview'];
    case 'return-ready':
      return ['autoWaitingSafe'];
    case 'review':
      return ['autoReview'];
    case 'completed':
      return ['autoCompleted'];
    case 'interrupted':
      if (
        s.collectionFailed &&
        s.explorationMode === 'slide' &&
        !s.awaitingSocketRecovery
      )
        return ['retryRegular', 2];
      return ['autoFailed', 2];
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
    let phoneChange: Prompt | undefined;
    if (
      next.phone.state !== old.phone.state ||
      next.phone.displayRequirement !== old.phone.displayRequirement
    ) {
      const phone = phonePrompt(next.phone);
      if (phone[0] !== phonePrompt(old.phone)[0]) phoneChange = phone;
    }
    // A snapshot can change both the active step and phone readiness.
    const prompts = [
      s && sessionPrompt(s, prior, mode),
      setupPrompt(next.setup, old.setup),
      phoneChange,
    ];
    const prompt =
      prompts.find((value) => value?.[1] === 2) ?? prompts.find(Boolean);
    if (prompt) speakCalibration(...prompt);
    if (s?.stage === 'collecting' && prior && s.samples > prior.samples)
      robotCue.play('click');
  };
}

function batchPrompt(batch: CalibrationBatchState): Prompt | undefined {
  if (batch.status === 'completed') return ['batchCompleted'];
  if (batch.status === 'stopping') return ['batchStopping', 2];
  if (batch.status === 'stopped') return ['batchStopped', 2];
  if (batch.status === 'failed') return ['autoFailed', 2];
  const row = batch.items[batch.currentIndex];
  if (!row) return;
  if (
    batch.status === 'running' &&
    (row.status === 'transferring' ||
      (row.status === 'preparing' && batch.currentIndex > 0))
  )
    return ['batchNext', 2];
  if (batch.status !== 'waiting') return;
  switch (row.status) {
    case 'awaiting-phone':
    case 'awaiting-mapping':
      return ['mappingWaiting'];
    case 'awaiting-setup':
      return ['toolSetup'];
    case 'awaiting-placement':
      return ['batchPlacement'];
    case 'awaiting-boundary-review':
      return ['boundaryReview'];
    case 'awaiting-acceptance':
      return [
        row.progress?.phase === 'awaiting-safe-position'
          ? 'autoWaitingSafe'
          : 'autoReview',
      ];
    case 'failed':
      return ['autoFailed', 2];
  }
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
    else if (screenChanged && next.status === 'running' && !prompt)
      speakCalibration('batchNext', 2);
  };
}
