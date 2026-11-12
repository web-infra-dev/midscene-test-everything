/**
 * MG400 four-axis controller mode semantics, shared by the dashboard status
 * queries and the 30004 feedback decoder. Mode 8 is trajectory recording and
 * mode 11 is JOG.
 */
export const MG400_KNOWN_MODES: readonly number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
];
/** Modes that report the arm as enabled; 10 is paused but still enabled. */
export const MG400_ENABLED_MODES: readonly number[] = [5, 6, 7, 8, 10];
/** Modes that report motion in progress. */
export const MG400_MOVING_MODES: readonly number[] = [7, 8, 11];
/** Manual drag (backdrive) is mode 6. */
export const MG400_DRAG_MODE = 6;
/**
 * Paused (mode 10). The controller is enabled but refuses motion until it
 * receives `Continue()`. Paused is *not* a fault: it carries no error codes, and
 * reporting it as one used to make `Clear faults` impossible to satisfy.
 */
export const MG400_PAUSE_MODE = 10;
export function isMg400Mode(value: number): boolean {
  return MG400_KNOWN_MODES.includes(value);
}
export function isMg400ModeEnabled(mode: number): boolean {
  return MG400_ENABLED_MODES.includes(mode);
}
export function isMg400ModeMoving(mode: number): boolean {
  return MG400_MOVING_MODES.includes(mode);
}
export function isMg400ModePaused(mode: number): boolean {
  return mode === MG400_PAUSE_MODE;
}
