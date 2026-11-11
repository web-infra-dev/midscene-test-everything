import assert from 'node:assert/strict';
import { rstest, test } from '@rstest/core';
import { agentFromIOSHID } from '../dist/index.js';

const options = { host: 'http://localhost:5801', token: 'test-token' };
const phone = {
  id: 'phone-1',
  name: 'Test iPhone',
  screenSource: 'usb',
  status: 'available',
};

test('the service Agent selects the sole configured phone and releases its lease on destroy', async () => {
  const calls: string[] = [];
  rstest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname;
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${path}`);
    assert.equal(
      new Headers(init?.headers).get('Authorization'),
      'Bearer test-token',
    );
    if (path.endsWith('/devices')) return Response.json({ devices: [phone] });
    if (method === 'POST') {
      assert.deepEqual(JSON.parse(String(init?.body)), { deviceId: phone.id });
      return Response.json({
        id: 'lease',
        deviceId: phone.id,
        expiresInMs: 30000,
      });
    }
    return Response.json({});
  });

  const agent = await agentFromIOSHID(options);
  await Promise.all([agent.destroy(), agent.destroy()]);
  assert.deepEqual(calls, [
    'GET /api/v1/devices',
    'POST /api/v1/sessions',
    'DELETE /api/v1/sessions/lease',
  ]);
});

test('the service Agent requires an explicit ID when multiple phones are configured', async () => {
  const request = rstest.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      devices: [phone, { ...phone, id: 'phone-2', status: 'offline' }],
    }),
  );
  await assert.rejects(agentFromIOSHID(options), /Specify deviceId/);
  assert.equal(request.mock.calls.length, 1);
});
