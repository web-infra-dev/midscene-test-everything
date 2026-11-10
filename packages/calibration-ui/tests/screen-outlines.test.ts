import { expect, it } from '@rstest/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScreenOutlines } from '../src/components/robot-arm/ScreenOutlines';

const correction = {
  points: {
    topLeft: { x: 40, y: 30 },
    topRight: { x: 440, y: 30 },
    bottomRight: { x: 440, y: 330 },
    bottomLeft: { x: 40, y: 330 },
  },
  sourceWidth: 640,
  sourceHeight: 480,
  rotation: 0 as const,
};

it('draws one outline and one label per saved screen', () => {
  const html = renderToStaticMarkup(
    createElement(ScreenOutlines, {
      outlines: [
        { id: 'left', name: 'Left screen', correction, active: true },
        {
          id: 'right',
          name: 'Right screen',
          correction: { ...correction, rotation: 90 },
        },
      ],
    }),
  );
  expect((html.match(/<polygon/g) ?? []).length).toBe(2);
  expect(html).toContain('Left screen');
  expect(html).toContain('Right screen');
  expect(html).toContain('data-active="true"');
  expect(html).toContain('data-active="false"');
  // The overlay shares the preview's letterboxing instead of stretching.
  expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
  expect(html).toContain('viewBox="0 0 640 480"');
});

it('renders nothing for a camera without a saved perspective', () => {
  const html = renderToStaticMarkup(
    createElement(ScreenOutlines, { outlines: [] }),
  );
  expect(html).toBe('');
});

it('labels all three positions concisely and reports off-frame parking', () => {
  const html = renderToStaticMarkup(
    createElement(ScreenOutlines, {
      outlines: [
        {
          id: 'phone',
          name: '',
          correction,
          previewPositions: {
            reference: { x: 240, y: 180 },
            safe: { x: 700, y: 300 },
            cameraBoundary: { x: 0, y: 120 },
          },
        },
      ],
    }),
  );
  expect(html).toContain('标定参考位');
  expect(html).not.toContain('估算');
  expect(html).toContain('安全避让位 · 画面外');
  expect(html).toContain('translate(240 180)');
  expect(html).not.toContain('translate(700');
  expect(html).toContain('相机侧边界');
  expect(html).toContain('translate(0 120)');
});

it.each([
  { x: -1, y: 100 },
  { x: 640, y: 100 },
  { x: 100, y: 480 },
  { x: 100, y: -1 },
])('omits a boundary beyond the camera frame', (cameraBoundary) => {
  const html = renderToStaticMarkup(
    createElement(ScreenOutlines, {
      outlines: [
        {
          id: 'phone',
          name: '',
          correction,
          previewPositions: { cameraBoundary },
        },
      ],
    }),
  );
  expect(html).not.toContain('相机侧边界');
  expect(html).not.toContain('画面外');
  expect(html).not.toContain('calibration-position-markers');
});
