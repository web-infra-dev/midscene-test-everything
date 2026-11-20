import { expect, test } from '@rstest/core';
import {
  visualScreenOriginMm,
  visualTipOffsetMm,
} from '../src/server/twin-geometry';

test('a pen at the calibrated flange height touches the visual screen', () => {
  const tool = {
    contactFrame: 'flange' as const,
    offsetMm: { x: 0, y: 0, z: 0 },
  };
  const contact = { x: 20, y: 30, z: 150 };
  const screen = visualScreenOriginMm(contact, tool);
  const offset = visualTipOffsetMm(tool);
  expect(offset.z).toBeLessThan(0);
  expect(screen).toEqual({ ...contact, z: contact.z + offset.z });
});

test.each([0, 15, 85])(
  'a measured %i mm pen uses the calibrated tip plane directly',
  (length) => {
    const tool = { offsetMm: { x: 0, y: 0, z: -length } };
    const origin = { x: 20, y: 30, z: 50 };
    expect(visualTipOffsetMm(tool)).toEqual(tool.offsetMm);
    expect(visualScreenOriginMm(origin, tool)).toEqual(origin);
  },
);
