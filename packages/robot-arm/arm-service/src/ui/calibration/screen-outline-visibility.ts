import type { CalibrationImagingStatus } from '@midscene/robotics-shared/assisted-contracts';

const CALIBRATING_IMAGING_STATES = new Set<CalibrationImagingStatus['state']>([
  'exposure',
  'white-balance',
  'tone',
  'focus',
]);

export function shouldShowScreenOutlines(
  imaging: CalibrationImagingStatus | undefined,
  applying: boolean,
) {
  return !applying && !CALIBRATING_IMAGING_STATES.has(imaging?.state ?? 'idle');
}

export function shouldHideSelectedScreenOutline(input: {
  awaitingOriginTap: boolean;
  markerAdd: boolean;
  markerOpen: boolean | string;
  screenId: string;
  selectedId: string;
  step: number;
}) {
  return (
    input.step === 1 &&
    !input.markerAdd &&
    (input.awaitingOriginTap || Boolean(input.markerOpen)) &&
    input.screenId === input.selectedId
  );
}
