import type { EffectiveCapabilities } from '@midscene/robotics-shared/contracts';
import { robotSetupDefaults } from '@midscene/robotics-shared/setup-contracts';
import { expect, it } from '@rstest/core';
import { axialTool } from '../src/components/robot-arm/setup-draft';

it('saves a blank length only for a straight-down stylus on a flange-contact capable arm', () => {
  const mg400 = {
    orientation: 'yaw',
    setupDefaults: robotSetupDefaults('mg400'),
  } as EffectiveCapabilities;
  expect(axialTool('-Z', null, mg400)).toEqual({
    contactFrame: 'flange',
    offsetMm: { x: 0, y: 0, z: 0 },
    contactDirection: { x: 0, y: 0, z: -1 },
  });
  expect(axialTool('-Z', 0, mg400)).not.toHaveProperty('contactFrame');
  expect(axialTool('-Z', 40, mg400).offsetMm.z).toBe(-40);
  expect(() => axialTool('-X', null, mg400)).toThrow();
  expect(() => axialTool('-Z', -1, mg400)).toThrow();
  expect(() =>
    axialTool('-Z', null, { ...mg400, setupDefaults: undefined }),
  ).toThrow();
  expect(() =>
    axialTool('-Z', null, { ...mg400, orientation: 'full' }),
  ).toThrow();
});
