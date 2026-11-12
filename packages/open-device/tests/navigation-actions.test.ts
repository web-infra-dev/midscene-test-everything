import assert from 'node:assert/strict';
import { test } from '@rstest/core';
import { OpenDeviceAgent } from '../dist/index.js';
import type { InputAction } from '../dist/protocol.js';
import { TestDevice } from './fixtures/test-device.js';

test('Device and borrowed Agent expose navigation with cancellation preserved', async () => {
  const phone = new TestDevice();
  const calls: { action: InputAction; signal?: AbortSignal }[] = [];
  phone.execute = async (action, options) => {
    calls.push({ action, signal: options?.signal });
  };
  const signal = new AbortController().signal;
  await phone.home({ signal });
  await phone.back({ signal });
  const agent = new OpenDeviceAgent(phone);
  try {
    for (const name of ['Home', 'Back']) {
      const action = agent.interface
        .actionSpace()
        .find((item) => item.name === name);
      assert.ok(action);
      await action.call(undefined, { signal } as Parameters<
        typeof action.call
      >[1]);
    }
    assert.deepEqual(
      calls.map((item) => item.action.type),
      ['home', 'back', 'home', 'back'],
    );
    assert.ok(calls.every((item) => item.signal === signal));
  } finally {
    await agent.destroy();
  }
});
