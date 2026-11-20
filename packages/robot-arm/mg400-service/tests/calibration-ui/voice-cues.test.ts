import { describe, expect, it, rstest } from '@rstest/core';
import { CuePlayer, cuePatterns } from '../../src/ui/calibration/voice/cues';

function fakeContext() {
  const oscillators: Array<{
    start: ReturnType<typeof rstest.fn>;
    stop: ReturnType<typeof rstest.fn>;
    disconnect: ReturnType<typeof rstest.fn>;
  }> = [];
  const context = {
    currentTime: 10,
    destination: {},
    resume: rstest.fn(async () => undefined),
    createOscillator: rstest.fn(() => {
      const oscillator = {
        type: 'sine',
        frequency: { setValueAtTime: rstest.fn() },
        connect: rstest.fn(),
        disconnect: rstest.fn(),
        start: rstest.fn(),
        stop: rstest.fn(),
        onended: null,
      };
      oscillators.push(oscillator);
      return oscillator;
    }),
    createGain: rstest.fn(() => ({
      gain: {
        setValueAtTime: rstest.fn(),
        exponentialRampToValueAtTime: rstest.fn(),
      },
      connect: rstest.fn(),
      disconnect: rstest.fn(),
    })),
  };
  return { context, oscillators };
}

describe('audio cues', () => {
  it('stays silent when muted or inactive', () => {
    const { context } = fakeContext();
    const create = rstest.fn(() => context);
    const player = new CuePlayer(create as never);
    player.configure(false, true);
    expect(player.play('scan')).toBe(false);
    player.configure(true, false);
    expect(player.play('fit')).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('primes the audio context during a user gesture', () => {
    const { context } = fakeContext();
    const create = rstest.fn(() => context);
    const player = new CuePlayer(create as never);
    player.prime();
    expect(create).toHaveBeenCalledOnce();
    expect(context.resume).toHaveBeenCalledOnce();
    player.configure(true, true);
    expect(player.play('scan')).toBe(true);
    expect(create).toHaveBeenCalledOnce();
  });

  it('schedules the scan pattern and reuses one audio context', () => {
    const { context, oscillators } = fakeContext();
    const create = rstest.fn(() => context);
    const player = new CuePlayer(create as never);
    player.configure(true, true);
    expect(player.play('scan')).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    expect(oscillators).toHaveLength(cuePatterns.scan.length);
    expect(context.resume).toHaveBeenCalledOnce();
    expect(oscillators[0].start).toHaveBeenCalled();
    expect(oscillators[0].stop).toHaveBeenCalled();
    expect(player.play('fit')).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    expect(oscillators).toHaveLength(
      cuePatterns.scan.length + cuePatterns.fit.length,
    );
  });

  it('cancels scheduled tones and never throws without Web Audio', () => {
    const { context, oscillators } = fakeContext();
    const player = new CuePlayer(() => context as never);
    player.configure(true, true);
    player.play('scan');
    player.cancel();
    expect(oscillators[0].stop).toHaveBeenCalledTimes(2);
    expect(oscillators[0].disconnect).toHaveBeenCalled();
    const unavailable = new CuePlayer(() => {
      throw new Error('No Web Audio');
    });
    unavailable.configure(true, true);
    expect(unavailable.play('fit')).toBe(false);
  });
});
