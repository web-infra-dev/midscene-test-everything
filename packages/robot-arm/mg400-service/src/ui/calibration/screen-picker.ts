export function shouldShowScreenPicker(options: {
  step: number;
  markerOpen: boolean | string;
  batchActive: boolean;
  screenCount: number;
  soleScreen: boolean;
}) {
  if (options.batchActive) return false;
  if (options.step === 2) return options.screenCount > 0;
  return options.step === 3 && !options.soleScreen && options.screenCount > 0;
}
