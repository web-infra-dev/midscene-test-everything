import { expect, it } from '@rstest/core';
import { measuredPerspectiveTarget } from '../src/camera/vision-geometry.js';

it('measures the screen rectangle instead of the camera frame', () => {
  const quad = {
    topLeft: { x: 100, y: 50 },
    topRight: { x: 500, y: 50 },
    bottomRight: { x: 500, y: 850 },
    bottomLeft: { x: 100, y: 850 },
  };
  expect(measuredPerspectiveTarget(quad, 0)).toEqual({
    width: 400,
    height: 800,
  });
  // A screen lying on its side keeps the measured aspect but swaps the axes.
  expect(measuredPerspectiveTarget(quad, 90)).toEqual({
    width: 800,
    height: 400,
  });
  expect(measuredPerspectiveTarget(quad, 270)).toEqual({
    width: 800,
    height: 400,
  });
});

it('averages opposite edges of a skewed quad', () => {
  const quad = {
    topLeft: { x: 10, y: 20 },
    topRight: { x: 410, y: 20 },
    bottomRight: { x: 430, y: 620 },
    bottomLeft: { x: 30, y: 620 },
  };
  expect(measuredPerspectiveTarget(quad, 0)).toEqual({
    width: 400,
    height: 600,
  });
});
