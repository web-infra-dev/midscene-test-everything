import { expect, it } from '@rstest/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CameraCornerEditor } from '../src/ui/CameraCornerEditor.js';

const baseCorrection = {
  sourceWidth: 1000,
  sourceHeight: 800,
  rotation: 0 as const,
  points: {
    topLeft: { x: 50, y: 80 },
    topRight: { x: 450, y: 80 },
    bottomRight: { x: 450, y: 700 },
    bottomLeft: { x: 50, y: 700 },
  },
};

it('draws every calibrated screen while editing one active outline', () => {
  const secondCorrection = {
    ...baseCorrection,
    points: {
      topLeft: { x: 520, y: 40 },
      topRight: { x: 940, y: 40 },
      bottomRight: { x: 940, y: 760 },
      bottomLeft: { x: 520, y: 760 },
    },
  };
  const html = renderToStaticMarkup(
    createElement(CameraCornerEditor, {
      value: baseCorrection,
      src: '/live',
      disabled: false,
      overlays: [
        {
          id: 'screen-a',
          name: 'Screen A',
          value: baseCorrection,
          active: true,
        },
        {
          id: 'screen-b',
          name: 'Screen B',
          value: secondCorrection,
          active: false,
        },
      ],
    }),
  );

  expect(html).toContain('<title>Screen A</title>');
  expect(html).toContain('<title>Screen B</title>');
  expect(html).toContain('camera-corner-overlay-active');
  expect(html.match(/camera-corner-overlay(?:\s|")/g)).toHaveLength(2);
});
