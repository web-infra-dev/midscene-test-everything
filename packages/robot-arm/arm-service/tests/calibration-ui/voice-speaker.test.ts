import { afterEach, describe, expect, it, rstest } from '@rstest/core';
import { voiceMessages } from '../../src/ui/calibration/voice/messages';
import { VoiceSpeaker } from '../../src/ui/calibration/voice/speaker';

function fixture() {
  const port = { speak: rstest.fn(), cancel: rstest.fn() };
  const speaker = new VoiceSpeaker(port);
  speaker.configure(true, 'en', true);
  return { speaker, port, finish: () => port.speak.mock.calls.at(-1)?.[2]() };
}
afterEach(() => rstest.useRealTimers());
describe('voice queue', () => {
  it('keeps routine events silent even at high priority', () => {
    const { speaker, port } = fixture();
    for (const event of [
      'deviceBound',
      'markersCountdown',
      'hover',
      'mappingDone',
      'autoCompleted',
      'payloadDone',
    ] as const)
      speaker.notify(event, 3);
    expect(port.speak).not.toHaveBeenCalled();
  });
  it('follows language and cancels queued speech when disabled', () => {
    rstest.useFakeTimers();
    const { speaker, port } = fixture();
    speaker.configure(true, 'zh', true);
    speaker.notify('beforeDrag');
    speaker.notify('phoneLost');
    expect(port.speak.mock.calls[0].slice(0, 2)).toEqual([
      '先扶稳机械臂。',
      'zh',
    ]);
    const staleCallback = port.speak.mock.calls[0][2];
    speaker.configure(false, 'zh', true);
    staleCallback();
    speaker.notify('fault', 3);
    expect(port.speak).toHaveBeenCalledTimes(1);
    expect(port.cancel).toHaveBeenCalled();
  });
  it('deduplicates repeated events', () => {
    rstest.useFakeTimers();
    const { speaker, port, finish } = fixture();
    speaker.notify('batchNext');
    finish();
    rstest.advanceTimersByTime(1000);
    speaker.notify('batchNext');
    expect(port.speak).toHaveBeenCalledTimes(1);
    rstest.advanceTimersByTime(1500);
    speaker.notify('batchNext');
    expect(port.speak).toHaveBeenCalledTimes(2);
    speaker.cancel();
  });
  it('preempts ordinary speech and discards outdated queue entries', () => {
    rstest.useFakeTimers();
    const { speaker, port, finish } = fixture();
    speaker.notify('beforeDrag');
    speaker.notify('phoneLost');
    speaker.notify('emergencySent', 3);
    expect(port.speak.mock.calls.at(-1)?.[0]).toBe('Emergency stop sent');
    finish();
    expect(port.speak).toHaveBeenCalledTimes(2);
    speaker.notify('returnSafe');
    speaker.notify('phoneLost');
    rstest.advanceTimersByTime(4500);
    finish();
    expect(port.speak).toHaveBeenCalledTimes(3);
    speaker.cancel();
  });
  it('keeps the latest calibration instruction and lets a stop interrupt motion warnings', () => {
    rstest.useFakeTimers();
    const { speaker, port, finish } = fixture();
    speaker.configure(true, 'zh', true);
    speaker.notify('approachStart', 2, 'calibration');
    speaker.notify('beforeDrag', 1, 'calibration');
    speaker.notify('autoStarted', 1, 'calibration');
    finish();
    expect(port.speak.mock.calls.map(([text]) => text)).toEqual([
      voiceMessages.approachStart[1],
      voiceMessages.autoStarted[1],
    ]);
    speaker.notify('batchNext', 2, 'calibration');
    speaker.notify('autoVerifying', 2, 'calibration');
    expect(port.speak.mock.calls.at(-1)?.[0]).toBe(
      voiceMessages.autoVerifying[1],
    );
    speaker.notify('emergencySent', 3);
    speaker.notify('referenceReturn', 2, 'calibration');
    speaker.notify('phoneReady', 1, 'calibration');
    expect(port.speak.mock.calls.at(-1)?.[0]).toBe(
      voiceMessages.emergencySent[1],
    );
    finish();
    expect(port.speak.mock.calls.at(-1)?.[0]).toBe(
      voiceMessages.referenceReturn[1],
    );
    speaker.cancel();
  });
  it('does not play before activation or while hidden; switches language without old speech', () => {
    rstest.useFakeTimers();
    const { speaker, port } = fixture();
    speaker.configure(true, 'en', false);
    speaker.notify('fault');
    expect(port.speak).not.toHaveBeenCalled();
    speaker.configure(true, 'en', true);
    speaker.notify('beforeDrag');
    speaker.notify('phoneLost');
    speaker.configure(true, 'zh', true);
    speaker.notify('preview');
    expect(port.speak.mock.calls.at(-1)?.[0]).toBe('语音提示已开启');
    expect(port.speak).toHaveBeenCalledTimes(2);
    speaker.cancel();
  });
  it('survives browser errors and releases a stalled utterance', () => {
    rstest.useFakeTimers();
    const { speaker, port } = fixture();
    port.speak.mockImplementationOnce(() => {
      throw new Error('No voice');
    });
    expect(() => speaker.notify('beforeDrag')).not.toThrow();
    expect(speaker.error).toContain('No voice');
    speaker.notify('phoneLost');
    rstest.advanceTimersByTime(10000);
    expect(speaker.error).toBe('Speech timed out');
    speaker.notify('fault', 2);
    expect(port.speak.mock.calls.at(-1)?.[0]).toBe('Robot fault');
    speaker.cancel();
  });
});
