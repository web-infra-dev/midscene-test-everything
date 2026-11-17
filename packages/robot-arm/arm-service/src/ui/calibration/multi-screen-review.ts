export function hasMultipleCalibrationTargets(
  session: { targets: readonly unknown[] } | undefined,
) {
  return (session?.targets.length ?? 0) > 1;
}
