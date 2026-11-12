import { expect, it } from '@rstest/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PerspectiveObservationCard } from '../../src/ui/calibration/components/PerspectiveObservationCard';
import type { PerspectiveObservation } from '../../src/ui/calibration/hooks/usePerspectiveValidity';
import { useCalibrationLanguage } from '../../src/ui/calibration/i18n';

function render(observation: PerspectiveObservation) {
  useCalibrationLanguage.getState().setLanguage('zh');
  return renderToStaticMarkup(
    createElement(PerspectiveObservationCard, {
      observation,
      screenName: '屏幕 A',
      onRecalibrate() {},
    }),
  );
}
const summary = (state: 'invalid' | 'valid' | 'unverified') => ({
  state,
  confidence: 'high' as const,
  reasonCode: 'SHIFTED' as const,
  driftRatio: 0.025,
  checkedAt: new Date().toISOString(),
  ageMs: 0,
  expired: false,
});
it('names the affected screen and offers correction for a confirmed mismatch', () => {
  const html = render({ summary: summary('invalid') });
  expect(html).toContain('屏幕 A');
  expect(html).toContain('透视校正已失效');
  expect(html).toContain('2.5%');
  expect(html).toContain('重新校正');
});
it('stays quiet for aligned or unmeasurable scenes without false success', () => {
  expect(render({ summary: summary('valid') })).toBe('');
  expect(render({ summary: summary('unverified') })).toBe('');
});
it('keeps the mismatch finding visible when the camera check fails', () => {
  const html = render({
    summary: summary('invalid'),
    error: 'camera disconnected',
  });
  expect(html).toContain('透视校正已失效');
  expect(html).not.toContain('camera disconnected');
});
