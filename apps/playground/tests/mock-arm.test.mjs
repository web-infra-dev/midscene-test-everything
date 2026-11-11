import assert from 'node:assert/strict';
import { test } from '@rstest/core';
import { MockMg400Adapter } from '../mock-arm.ts';
import { mockArmRequested } from '../setup.ts';

test('mock mode is opt-in through the flag or the environment', () => {
  assert.equal(mockArmRequested([], {}), false);
  assert.equal(mockArmRequested(['dev.ts'], {}), false);
  assert.equal(mockArmRequested(['dev.ts', '--mock'], {}), true);
  assert.equal(
    mockArmRequested(['dev.ts'], { ARM_PLAYGROUND_MOCK: '1' }),
    true,
  );
  assert.equal(
    mockArmRequested(['dev.ts'], { ARM_PLAYGROUND_MOCK: 'TRUE' }),
    true,
  );
  assert.equal(
    mockArmRequested(['dev.ts'], { ARM_PLAYGROUND_MOCK: '0' }),
    false,
  );
});

test('the simulated MG400 publishes hardware-shaped defaults without a controller', async () => {
  const adapter = new MockMg400Adapter();
  assert.equal(adapter.id, 'mg400-mock');
  assert.equal(adapter.connectionIdentity, 'mock://mg400');
  assert.equal(adapter.kinematics.jointCount, 4);
  assert.equal(adapter.kinematics.orientation, 'yaw');
  assert.deepEqual(adapter.kinematics.cartesianDof, ['x', 'y', 'z', 'rz']);
  assert.equal(adapter.setupDefaults?.actionSpeed.value, 1);
  assert.equal(adapter.setupDefaults?.motion?.safeHeightMm, 5);

  await adapter.driver.connect();
  try {
    const state = await adapter.driver.getState();
    assert.equal(state.connection, 'connected');
    assert.equal(state.pose?.pose.positionMm.z, 100);
  } finally {
    await adapter.driver.disconnect();
  }
});
