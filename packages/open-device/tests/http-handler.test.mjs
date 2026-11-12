import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { createDeviceHandler } from '../dist/server/index.js';

test('two screens on one controller share a lease and expose only supported actions', async () => {
  const lifetime = new AbortController();
  const actions = [];
  const screens = ['left', 'right'].map((id) => ({
    id,
    name: id,
    status: 'available',
    actions: ['tap'],
    resourceId: 'arm',
  }));
  const handler = createDeviceHandler({
    token: 'test-token',
    listDevices: () => screens,
    readyDevice: (id) =>
      screens.some((screen) => screen.id === id)
        ? {
            signal: lifetime.signal,
            resourceId: 'arm',
            actions: ['tap'],
            execute: async (action) => {
              actions.push(action);
            },
            screenshot: async () => ({
              jpeg: Buffer.from('frame'),
              width: 10,
              height: 10,
              sequence: 1,
              receivedAt: 1,
            }),
          }
        : undefined,
  });

  function request(method, path, body, token = 'test-token') {
    const req = Object.assign(
      Readable.from(body ? [JSON.stringify(body)] : []),
      {
        method,
        url: `/api/v1${path}`,
        headers: { authorization: `Bearer ${token}` },
      },
    );
    return new Promise((resolve) => {
      const res = Object.assign(new EventEmitter(), {
        setHeader() {},
        writeHead(status) {
          this.status = status;
        },
        end(payload) {
          resolve({ status: this.status, data: JSON.parse(payload) });
        },
      });
      assert.equal(handler.handle(req, res), true);
    });
  }

  try {
    assert.equal(
      (await request('GET', '/devices', undefined, 'wrong')).status,
      401,
    );
    const created = await request('POST', '/sessions', { deviceId: 'left' });
    assert.equal(created.status, 201);
    const lease = `/sessions/${created.data.id}`;
    assert.equal(
      (await request('POST', '/sessions', { deviceId: 'right' })).status,
      409,
    );
    const list = await request('GET', '/devices');
    assert.deepEqual(
      list.data.devices.map(({ status }) => status),
      ['busy', 'busy'],
    );
    assert.ok(list.data.devices.every((screen) => !('resourceId' in screen)));
    assert.equal(
      (await request('POST', `${lease}/actions`, { type: 'home' })).status,
      422,
    );
    const tap = { type: 'tap', point: { x: 2, y: 3 } };
    assert.equal((await request('POST', `${lease}/actions`, tap)).status, 200);
    assert.deepEqual(actions, [tap]);
    assert.equal(
      (await request('GET', `${lease}/screenshot`)).data.jpeg,
      Buffer.from('frame').toString('base64'),
    );
    assert.equal((await request('DELETE', lease)).status, 200);
    assert.equal(
      (await request('POST', '/sessions', { deviceId: 'right' })).status,
      201,
    );
    lifetime.abort();
    assert.deepEqual(
      (await request('GET', '/devices')).data.devices.map(
        ({ status }) => status,
      ),
      ['available', 'available'],
    );
  } finally {
    await handler.close();
  }
});
