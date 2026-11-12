import type { PerspectiveValidityResult } from './perspective-validity.js';

/** A weak frame cannot undo a measured mismatch. Recovery needs positive evidence. */
export class PerspectiveValidityTracker {
  private readonly cameras = new Map<
    string,
    {
      key: string;
      frameId: number;
      lastAt: number;
      mismatch?: PerspectiveValidityResult;
      mismatchAt?: number;
      mismatchFrame?: number;
      recoverySince?: number;
      recoveryFrames: number;
      published: PerspectiveValidityResult;
    }
  >();

  observe(input: {
    cameraId: string;
    key: string;
    frameId: number;
    at: number;
    raw: PerspectiveValidityResult;
    previousMismatch?: {
      validity: PerspectiveValidityResult;
      at: number;
      frameId: number;
    };
  }): PerspectiveValidityResult {
    let state = this.cameras.get(input.cameraId);
    if (!state || state.key !== input.key) {
      if (this.cameras.size >= 32)
        this.cameras.delete(this.cameras.keys().next().value!);
      state = {
        key: input.key,
        frameId: -1,
        lastAt: input.at,
        recoveryFrames: 0,
        published: input.raw,
        ...(input.previousMismatch?.validity.state === 'invalid'
          ? {
              mismatch: input.previousMismatch.validity,
              mismatchAt: input.previousMismatch.at,
              mismatchFrame: input.previousMismatch.frameId,
            }
          : {}),
      };
      this.cameras.set(input.cameraId, state);
    }
    if (input.frameId < state.frameId && input.at > state.lastAt) {
      // Capture may restart with frame 1. Keep mismatches, discard recovery.
      state.frameId = -1;
      state.recoverySince = undefined;
      state.recoveryFrames = 0;
    }
    if (input.frameId <= state.frameId || input.at < state.lastAt)
      return state.published;
    if (input.at - state.lastAt > 4000) {
      state.recoverySince = undefined;
      state.recoveryFrames = 0;
    }
    state.frameId = input.frameId;
    state.lastAt = input.at;
    if (input.raw.state === 'invalid') {
      state.mismatch = input.raw;
      state.mismatchAt = input.at;
      state.mismatchFrame = input.frameId;
      state.recoverySince = undefined;
      state.recoveryFrames = 0;
    } else if (state.mismatch) {
      if (input.raw.state === 'valid') {
        state.recoverySince ??= input.at;
        state.recoveryFrames++;
        if (state.recoveryFrames >= 3 && input.at - state.recoverySince >= 1500)
          state.mismatch = undefined;
      } else {
        state.recoverySince = undefined;
        state.recoveryFrames = 0;
      }
      if (state.mismatch) {
        state.published = {
          ...state.mismatch,
          currentPoints: input.raw.currentPoints,
          proposedPoints: undefined,
          temporal: {
            currentState: input.raw.state,
            retainedMismatch: true,
            mismatchDetectedAt: new Date(state.mismatchAt!).toISOString(),
            mismatchFrameId: state.mismatchFrame!,
            recoveryFrames: state.recoveryFrames,
          },
        };
        return state.published;
      }
    }
    state.published = input.raw;
    return state.published;
  }
}
