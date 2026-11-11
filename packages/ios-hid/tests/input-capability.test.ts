import assert from 'node:assert/strict';
import { test } from '@rstest/core';
import { IOSHIDAgent } from '../dist/index.js';
import type { InputAction } from '../dist/types.js';
import { TestDevice } from './fixtures/test-device.js';

test('Device and Agent advertise ASCII Input while retaining the standard action behavior', async () => {
  const phone = new TestDevice();
  const calls: InputAction[] = [];
  phone.execute = async (action) => {
    calls.push(action);
  };
  const agent = new IOSHIDAgent(phone);
  try {
    for (const device of [phone, agent.interface]) {
      const input = device
        .actionSpace()
        .find((action) => action.name === 'Input');
      assert.ok(input);
      assert.ok(input.description);
      assert.match(input.description, /ASCII only/);
      assert.match(input.description, /Never pass Chinese/);
      assert.match(input.description, /on-screen keyboard/);
      const param = input.paramSchema!.parse({
        value: 'coffee',
        mode: 'replace',
      });
      await input.call(param);
    }
    assert.deepEqual(calls, [
      { type: 'typeText', text: 'coffee', replace: true },
      { type: 'typeText', text: 'coffee', replace: true },
    ]);
    assert.ok(phone.actionSpace().some((action) => action.name === 'Tap'));
  } finally {
    await agent.destroy();
  }
});
