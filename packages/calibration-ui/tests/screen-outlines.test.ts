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
