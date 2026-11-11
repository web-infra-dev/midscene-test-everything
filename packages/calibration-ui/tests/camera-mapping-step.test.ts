import { expect, it } from '@rstest/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mergeSession } from '../src/components/MarkerCalibrationDialog';
import { CameraMappingStep } from '../src/components/robot-arm/CameraMappingStep';

const camera = { name: 'Bench camera', online: true };
const screens = [
  { id: 'screen-a', name: 'Screen A', hasCorrection: true },
  { id: 'screen-b', name: 'Screen B' },
];
const correction = {
  points: {
    topLeft: { x: 0, y: 0 },
    topRight: { x: 400, y: 0 },
    bottomRight: { x: 400, y: 300 },
    bottomLeft: { x: 0, y: 300 },
  },
  sourceWidth: 640,
  sourceHeight: 480,
  rotation: 0 as const,
};
const pendingCount = (html: string) =>
  (html.match(/data-done="false"/g) ?? []).length;

it('merges a successful status snapshot without carrying forward a failed marker read', () => {
  const target = { id: 'phone', name: 'Phone', state: 'succeeded' as const };
  const next = {
    id: 'session',
    state: 'succeeded' as const,
    streamId: 'cam',
    createdAt: 0,
    expiresAt: 1000,
    targets: [target],
  };
  const previous = {
    ...next,
    token: 'session-token',
    targets: [
      {
        ...target,
        state: 'failed' as const,
        token: 'page-token',
        error: 'Missing markers',
      },
    ],
  };
  expect(mergeSession(previous, next)).toEqual({
    ...next,
    token: 'session-token',
    targets: [{ ...target, token: 'page-token' }],
  });
});

it('lists every camera-mapping requirement for the selected screen', () => {
  const html = renderToStaticMarkup(
    createElement(CameraMappingStep, {
      camera,
      screens,
      screenId: 'screen-a',
      base: '/api/devices/screen-a/calibration',
      correction,
      output: { width: 400, height: 300 },
      phoneConnected: false,
      footer: null,
      onSelectScreen() {},
      onPair() {},
      onDetect() {},
      onApply: async () => {},
      onConfirm: async () => {},
      onContinue() {},
      refresh: async () => {},
    }),
  );
  expect(html).toContain('camera-checklist-list');
  expect(html).toContain('Screen A');
  // The page and the mapping itself are still missing.
  expect(pendingCount(html)).toBe(2);
  expect(html).not.toContain('相机映射已确认');
});

it('marks the mapping confirmed once the page and the perspective are in place', () => {
  const html = renderToStaticMarkup(
    createElement(CameraMappingStep, {
      camera,
      screens,
      screenId: 'screen-a',
      base: '/api/devices/screen-a/calibration',
      correction,
      output: { width: 400, height: 300 },
      phoneConnected: true,
      footer: null,
      onSelectScreen() {},
      onPair() {},
      onDetect() {},
      onApply: async () => {},
      onConfirm: async () => {},
      onContinue() {},
      refresh: async () => {},
    }),
  );
  expect(pendingCount(html)).toBe(0);
  expect(html).toContain('相机映射已确认');
  // Detection stays the primary way to (re)build the preset.
  expect(html).toContain('识别屏幕标记');
  expect(html).toContain('校正透视');
});

it('shows a failed mapping check against an applied perspective until confirmation succeeds', () => {
  const render = (mappingError?: string) =>
    renderToStaticMarkup(
      createElement(CameraMappingStep, {
        camera,
        screens,
        screenId: 'screen-a',
        base: '/calibration',
        correction,
        phoneConnected: true,
        mappingReady: true,
        mappingError,
        footer: null,
        onSelectScreen() {},
        onPair() {},
        onDetect() {},
        onApply: async () => {},
        onContinue() {},
        refresh: async () => {},
      }),
    );
  const failed = render(
    'Keep at least four of the six calibration markers visible and in focus.',
  );
  expect(failed).toContain('至少有四个');
  expect(failed).not.toContain('相机映射已确认');
  const confirmed = render();
  expect(confirmed).toContain('相机映射已确认');
  expect(confirmed).not.toContain('至少有五个');
});

it('names every screen that already has a perspective applied', () => {
  const html = renderToStaticMarkup(
    createElement(CameraMappingStep, {
      camera,
      screens: [
        { id: 'screen-a', name: 'Screen A', hasCorrection: true, correction },
        {
          id: 'screen-b',
          name: 'Screen B',
          hasCorrection: true,
          correction,
        },
      ],
      screenId: 'screen-a',
      base: '/api/devices/screen-a/calibration',
      correction,
      output: { width: 400, height: 300 },
      validity: 'valid',
      phoneConnected: true,
      footer: null,
      onSelectScreen() {},
      onPair() {},
      onDetect() {},
      onApply: async () => {},
      onConfirm: async () => {},
      onContinue() {},
      refresh: async () => {},
    }),
  );
  expect(html).toContain('已应用透视');
  expect(html).toContain('Screen A');
  expect(html).toContain('Screen B');
  expect(html).not.toContain('尚未应用透视');
});

it('shows that no perspective is applied yet', () => {
  const html = renderToStaticMarkup(
    createElement(CameraMappingStep, {
      camera,
      screens: [{ id: 'screen-b', name: 'Screen B' }],
      screenId: 'screen-b',
      base: '/api/devices/screen-b/calibration',
      phoneConnected: false,
      footer: null,
      onSelectScreen() {},
      onPair() {},
      onDetect() {},
      onApply: async () => {},
      onContinue() {},
      refresh: async () => {},
    }),
  );
  expect(html).toContain('尚未应用透视');
  expect(html).not.toContain('已应用透视 ·');
});

it('detects markers first and keeps corner placement as the secondary action', () => {
  const html = renderToStaticMarkup(
    createElement(CameraMappingStep, {
      camera,
      screens: [{ id: 'screen-b', name: 'Screen B' }],
      screenId: 'screen-b',
      base: '/api/devices/screen-b/calibration',
      phoneConnected: true,
      footer: null,
      onSelectScreen() {},
      onPair() {},
      onDetect() {},
      onApply: async () => {},
      onContinue() {},
      refresh: async () => {},
    }),
  );
  const detect = html.indexOf('识别屏幕标记');
  const manual = html.indexOf('设置透视');
  expect(detect).toBeGreaterThan(-1);
  // The detector fits the page rectangle from the markers the phone shows; the
  // four corners are the fallback for a view the markers cannot explain.
  expect(manual).toBeGreaterThan(detect);
});

it('offers clearing the applied perspective without dropping the screen', () => {
  const props = {
    camera,
    screens: [
      { id: 'screen-a', name: 'Screen A', hasCorrection: true, correction },
    ],
    screenId: 'screen-a',
    base: '/api/devices/screen-a/calibration',
    correction,
    output: { width: 400, height: 300 },
    phoneConnected: true,
    footer: null,
    onSelectScreen() {},
    onPair() {},
    onDetect() {},
    onApply: async () => {},
    onConfirm: async () => {},
    onContinue() {},
    refresh: async () => {},
  };
  const withClear = renderToStaticMarkup(
    createElement(CameraMappingStep, { ...props, onClear: async () => {} }),
  );
  expect(withClear).toContain('清除透视');
  // The screen row stays; only the applied framing can be released.
  expect(withClear).toContain('Screen A');
  const withoutHandler = renderToStaticMarkup(
    createElement(CameraMappingStep, props),
  );
  expect(withoutHandler).not.toContain('清除透视');
});

it('never renders a raw device id in the screen picker', () => {
  const html = renderToStaticMarkup(
    createElement(CameraMappingStep, {
      camera,
      screens,
      // The camera id is not one of the screens: the picker must prompt instead
      // of showing the device path.
      screenId:
        'dshow:@device_pnp_\\\\?\\usb#vid_046d&pid_085c&mi_00#7&1f9beaa4',
      base: '/api/devices/cam/calibration',
      phoneConnected: false,
      footer: null,
      onSelectScreen() {},
      onPair() {},
      onDetect() {},
      onApply: async () => {},
      onContinue() {},
      refresh: async () => {},
    }),
  );
  expect(html).not.toContain('usb#vid_046d');
  expect(html).not.toContain('dshow');
  expect(html).toContain('选择要标定的屏幕');
});

it('waits for a fullscreen page before confirming the mapping', () => {
  const base = {
    camera,
    screens: [
      { id: 'screen-a', name: 'Screen A', hasCorrection: true, correction },
    ],
    screenId: 'screen-a',
    base: '/api/devices/screen-a/calibration',
    correction,
    output: { width: 400, height: 300 },
    phoneConnected: true,
    footer: null,
    onSelectScreen() {},
    onPair() {},
    onDetect() {},
    onApply: async () => {},
    onConfirm: async () => {},
    onContinue() {},
    refresh: async () => {},
  };
  const windowed = renderToStaticMarkup(
    createElement(CameraMappingStep, { ...base, phoneFullscreen: false }),
  );
  expect(windowed).toContain('请保持每个屏幕页面在前台并全屏显示。');
  expect(windowed).not.toContain('相机映射已确认');
  // Camera online and the screen are done; page and mapping still pending.
  expect(pendingCount(windowed)).toBe(2);
  const fullscreen = renderToStaticMarkup(
    createElement(CameraMappingStep, { ...base, phoneFullscreen: true }),
  );
  expect(fullscreen).toContain('相机映射已确认');
  expect(pendingCount(fullscreen)).toBe(0);
});

it('stays usable when the camera has no saved screen yet', () => {
  const html = renderToStaticMarkup(
    createElement(CameraMappingStep, {
      camera,
      screens: [],
      base: '/api/devices/cam/calibration',
      phoneConnected: false,
      footer: null,
      onSelectScreen() {},
      onPair() {},
      onDetect() {},
      onApply: async () => {},
      onContinue() {},
      refresh: async () => {},
    }),
  );
  expect(html).toContain('camera-checklist-list');
  expect(pendingCount(html)).toBe(4);
});
