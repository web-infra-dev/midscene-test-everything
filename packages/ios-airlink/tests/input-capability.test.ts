import assert from 'node:assert/strict';
import { test } from '@rstest/core';
import { HIDInputSession } from '../dist/hardware/input/session.js';

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
