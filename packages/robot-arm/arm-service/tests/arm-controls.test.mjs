import assert from 'node:assert/strict';
import { test } from '@rstest/core';
import { PlaygroundArmControls } from '../src/server/arm-controls.ts';

test('global stop dispatches once and blocks recovery until the stop completes', async () => {
  let finish;
  let calls = 0;
  let recoveries = 0;
  const controls = new PlaygroundArmControls({
    stop: () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    recover: async () => {
      recoveries++;
    },
  });
  const stop = controls.stop();
  assert.equal(controls.stop(), stop);
  assert.equal(calls, 1);
  await assert.rejects(controls.recover(), /Wait for the physical stop/);
  finish();
  await stop;
  await controls.recover();
  assert.equal(recoveries, 1);
});
test('a failed stop is surfaced and can be retried', async () => {
  let count = 0;
  const controls = new PlaygroundArmControls({
    stop: async () => {
      if (++count === 1) throw new Error('Stop unconfirmed');
    },
    recover: async () => {},
  });
  await assert.rejects(controls.stop(), /Stop unconfirmed/);
  await controls.stop();
  assert.equal(count, 2);
});
