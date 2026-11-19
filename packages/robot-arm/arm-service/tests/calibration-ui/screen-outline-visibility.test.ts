import { expect, it } from '@rstest/core';
import {
  shouldHideSelectedScreenOutline,
  shouldShowScreenOutlines,
} from '../../src/ui/calibration/screen-outline-visibility';

it('shows every screen outline only after camera calibration finishes', () => {
  expect(shouldShowScreenOutlines(undefined, false)).toBe(true);
  expect(shouldShowScreenOutlines({ state: 'ready' }, false)).toBe(true);
  expect(shouldShowScreenOutlines({ state: 'exposure' }, false)).toBe(false);
  expect(shouldShowScreenOutlines({ state: 'focus' }, false)).toBe(false);
  expect(shouldShowScreenOutlines({ state: 'ready' }, true)).toBe(false);
});

it('keeps the selected outline while adding a different screen', () => {
  const base = {
    awaitingOriginTap: false,
    markerAdd: false,
    markerOpen: true,
    screenId: 'desktop',
    selectedId: 'desktop',
    step: 1,
  };
  expect(shouldHideSelectedScreenOutline(base)).toBe(true);
  expect(shouldHideSelectedScreenOutline({ ...base, markerAdd: true })).toBe(
    false,
  );
  expect(shouldHideSelectedScreenOutline({ ...base, screenId: 'phone' })).toBe(
    false,
  );
});
