import assert from 'node:assert/strict';
import { test } from '@rstest/core';
import { UniversalDeviceAgent } from '../dist/index.js';
import type { InputAction } from '../dist/protocol.js';
import { TestDevice } from './fixtures/test-device.js';

test('Device and Agent advertise ASCII Input while retaining the standard action behavior', async () => {
  const phone = new TestDevice();
  const calls: InputAction[] = [];
  phone.execute = async (action) => {
    calls.push(action);
  };
  const agent = new UniversalDeviceAgent(phone);
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

test('DoubleTap is advertised by the Agent only for supported devices', async () => {
  assert.ok(
    !new TestDevice().actionSpace().some(({ name }) => name === 'DoubleTap'),
  );
  const phone = new TestDevice({ doubleTap: true });
  const signal = new AbortController().signal;
  const calls: InputAction[] = [];
  phone.execute = async (action, options) => {
    assert.equal(options?.signal, signal);
    calls.push(action);
  };
  const agent = new UniversalDeviceAgent(phone);
  try {
    const doubleTap = agent.interface
      .actionSpace()
      .find(({ name }) => name === 'DoubleTap');
    assert.ok(doubleTap);
    await doubleTap.call({ locate: { center: [12, 34] } }, {
      signal,
    } as Parameters<typeof doubleTap.call>[1]);
    assert.deepEqual(calls, [{ type: 'doubleTap', point: { x: 12, y: 34 } }]);
  } finally {
    await agent.destroy();
  }
});
