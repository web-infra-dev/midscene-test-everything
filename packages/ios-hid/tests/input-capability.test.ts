import assert from 'node:assert/strict';
import { test } from '@rstest/core';
import { IOSHIDAgent, IOSHIDDevice } from '../dist/index.js';
import { HIDInputSession } from '../dist/input/session.js';
import type { InputAction } from '../dist/types.js';

test('Device and Agent advertise ASCII Input while retaining the standard action behavior', async () => {
  const phone = new IOSHIDDevice();
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

test('unsupported text provides recovery guidance without typing or clearing existing input', async () => {
  const reports: number[][] = [];
  const input = new HIDInputSession(
    {
      send: async (_peer: string, _report: number, bytes: number[]) => {
        reports.push(bytes);
        return true;
      },
    } as unknown as ConstructorParameters<typeof HIDInputSession>[0],
    'phone',
  );
  const screen = {
    getFrame: async () => {
      throw new Error('Text input must not capture a frame');
    },
    close: async () => {},
  };
  await assert.rejects(
    input.execute({ type: 'typeText', text: 'abc瑞幸', replace: true }, screen),
    (error: Error) => {
      assert.match(error.message, /ASCII only/);
      assert.match(error.message, /瑞/);
      assert.match(error.message, /Do not retry Input/);
      assert.match(error.message, /on-screen keyboard/);
      return true;
    },
  );
  assert.deepEqual(
    reports,
    [],
    'validate the entire text before clearing or sending its ASCII prefix',
  );
});
