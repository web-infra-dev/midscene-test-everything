import type { ScreenQuad } from './vision-types.js';

export type PerspectiveValidityVerdict = 'aligned' | 'mismatch' | 'uncertain';
export type PerspectiveValidityConfidence = 'high' | 'medium' | 'low';
export type PerspectiveValidityState =
  | 'valid'
  | 'invalid'
  | 'suspected'
  | 'unverified';
export type PerspectiveEdgeSide = 'top' | 'right' | 'bottom' | 'left';
export type PerspectiveEdgeClass = 'on-edge' | 'off-edge' | 'no-edge';
export type PerspectiveValidityReasonCode =
  | 'ALIGNED'
  | 'SHIFTED'
  | 'SCALED'
  | 'ROTATED'
  | 'OFF_SCREEN_BOUNDARY'
  | 'INSUFFICIENT_CONTRAST'
  | 'INSUFFICIENT_EVIDENCE'
  | 'MODEL_REPORTS_MISMATCH';

/** What a model said about the outline. Advisory: it cannot produce `invalid`. */
export interface PerspectiveValidityModelVerdict {
  /** Advisory movement observations; never replace geometric evidence. */
  cameraObservation?: 'changed' | 'not-observed' | 'uncertain';
  screenObservation?: 'changed' | 'not-observed' | 'uncertain';
  likelyCause?: 'camera' | 'screen' | 'both' | 'unknown';
  recommendation?: string;
  verdict: 'aligned' | 'mismatch' | 'uncertain';
  worstEdge: PerspectiveEdgeSide | 'none';
  confidence: 'high' | 'medium' | 'low';
  /** Diagnostic only: never rendered as UI copy. */
  reason?: string;
}

export interface PerspectiveValidityModelReport
  extends PerspectiveValidityModelVerdict {
  skipped?: 'not-configured' | 'disabled' | 'failed';
  error?: string;
}

export interface PerspectiveEdgeReport {
  side: PerspectiveEdgeSide;
  class: PerspectiveEdgeClass;
  /** Median gradient peak across the edge, 8-bit levels per 2 px. */
  contrast: number;
  /** Signed offset of the measured boundary, working pixels. */
  offsetPx: number;
  /** Share of usable samples that agree with the offset. */
  inlierRatio: number;
  samples: number;
}

export interface PerspectiveValidityBand {
  /** Border widths in output pixels, order top, right, bottom, left. */
  widthsPx: [number, number, number, number];
  /** Sides whose band is wide and whose saved edge is not on the glass. */
  foreignSides: PerspectiveEdgeSide[];
  /** Widest band as a fraction of the output width. */
  maxRatio: number;
}

export interface PerspectiveValidityResult {
  temporal?: {
    currentState: PerspectiveValidityState;
    retainedMismatch: boolean;
    mismatchDetectedAt: string;
    mismatchFrameId: number;
    recoveryFrames: number;
  };
  state: PerspectiveValidityState;
  verdict: PerspectiveValidityVerdict;
  confidence: PerspectiveValidityConfidence;
  reasonCode: PerspectiveValidityReasonCode;
  /** Largest saved-corner displacement, source pixels. */
  driftPx: number;
  /** Same displacement as a fraction of the screen width. */
  driftRatio: number;
  /** 0.004 means the observed screen is 0.4% larger than the saved quad. */
  scaleDelta: number;
  rotationDeg: number;
  fitResidualPx: number;
  /** Mean of |TL-TR| and |BL-BR| of the working quad, in working pixels. */
  screenWidthPx: number;
  sourceWidth: number;
  sourceHeight: number;
  edges: PerspectiveEdgeReport[];
  texture: { inside: number; outside: number; ratio: number };
  band: PerspectiveValidityBand;
  /** Model fallback, present when the geometry stage could not decide. */
  model?: PerspectiveValidityModelReport;
  /** Hint only: a tilted phone changes perspective, which a similarity cannot express. */
  proposedPoints?: ScreenQuad;
  /**
   * Where the saved quad sits after the fitted screen motion. The stylus
   * attribution needs the observed screen, not the saved one, to tell a moved
   * camera from a moved phone.
   */
  currentPoints?: ScreenQuad;
}

/** Evidence is separate from the mapping fingerprint and never authorizes motion. */
export interface PerspectiveValiditySummary {
  state: PerspectiveValidityState;
  reasonCode: PerspectiveValidityReasonCode;
  confidence: PerspectiveValidityConfidence;
  driftRatio: number;
  checkedAt: string;
  ageMs: number;
  expired: boolean;
}
export interface PerspectiveValidityCheck {
  validity: PerspectiveValidityResult;
  checkedAt: string;
  frameId: number;
}
