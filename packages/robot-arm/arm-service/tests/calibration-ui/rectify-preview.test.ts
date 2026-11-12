import { expect, it } from '@rstest/core';
import { rectifyPreview } from '../../src/ui/calibration/rectify-preview';

const source = {
  width: 2,
  height: 2,
  // TL red, TR green, BL blue, BR yellow
  data: Uint8ClampedArray.from([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
  ]),
};
const correction = {
  sourceWidth: 2,
  sourceHeight: 2,
  rotation: 0 as const,
  points: {
    topLeft: { x: 0, y: 0 },
    topRight: { x: 1, y: 0 },
    bottomRight: { x: 1, y: 1 },
    bottomLeft: { x: 0, y: 1 },
  },
};

it('rectifies decoded pixels into the saved target rectangle', () => {
  const output = rectifyPreview(source, correction, 2, 2);
  expect(output.width).toBe(2);
  expect(output.height).toBe(2);
  expect([...output.data]).toEqual([...source.data]);
});

it('applies the saved output rotation to the preview', () => {
  const output = rectifyPreview(source, correction, 2, 2, 90);
  // A 90 degree target rotation puts the source bottom-left pixel top-left.
  expect([...output.data.slice(0, 4)]).toEqual([0, 0, 255, 255]);
});

it('writes opaque black when a target pixel falls outside the camera frame', () => {
  const offset = {
    ...correction,
    points: {
      topLeft: { x: 0.5, y: 0.5 },
      topRight: { x: 1.5, y: 0.5 },
      bottomRight: { x: 1.5, y: 1.5 },
      bottomLeft: { x: 0.5, y: 1.5 },
    },
  };
  const output = rectifyPreview(source, offset, 2, 2);
  expect([...output.data.slice(12, 16)]).toEqual([0, 0, 0, 255]);
});
