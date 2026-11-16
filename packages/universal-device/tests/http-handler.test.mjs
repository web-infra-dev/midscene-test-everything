import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { createDeviceHandler, openAPI } from '../dist/server/index.js';

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

  function request(method, path, body, token = 'test-token', headers = {}) {
    const req = Object.assign(
      Readable.from(body ? [JSON.stringify(body)] : []),
      {
        method,
        url: `/api/v1${path}`,
        headers: { authorization: `Bearer ${token}`, ...headers },
      },
    );
    return new Promise((resolve) => {
      const res = Object.assign(new EventEmitter(), {
        headers: {},
        setHeader(name, value) {
          this.headers[name.toLowerCase()] = value;
        },
        writeHead(status, resHeaders = {}) {
          this.status = status;
          for (const [k, v] of Object.entries(resHeaders)) {
            this.headers[k.toLowerCase()] = v;
          }
        },
        end(payload) {
          const isJson =
            this.headers['content-type'] === 'application/json' ||
            typeof payload === 'string';
          resolve({
            status: this.status,
            headers: this.headers,
            data: isJson ? JSON.parse(payload) : payload,
          });
        },
      });
      assert.equal(handler.handle(req, res), true);
    });
  }

  try {
    const unauthorized = await request('GET', '/devices', undefined, 'wrong');
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.data.code, 'UNAUTHORIZED');

    const created = await request('POST', '/sessions', {
      deviceId: 'left',
      leaseMs: 60_000,
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.expiresInMs, 60_000);
    const lease = `/sessions/${created.data.id}`;
    const busy = await request('POST', '/sessions', { deviceId: 'right' });
    assert.equal(busy.status, 409);
    assert.equal(busy.data.code, 'DEVICE_BUSY');

    const list = await request('GET', '/devices');
    assert.deepEqual(
      list.data.devices.map(({ status }) => status),
      ['busy', 'busy'],
    );
    assert.ok(list.data.devices.every((screen) => !('resourceId' in screen)));
    const unsupported = await request('POST', `${lease}/actions`, {
      type: 'home',
    });
    assert.equal(unsupported.status, 422);
    assert.equal(unsupported.data.code, 'ACTION_UNSUPPORTED');

    const tap = { type: 'tap', point: { x: 2, y: 3 } };
    assert.equal((await request('POST', `${lease}/actions`, tap)).status, 200);
    assert.deepEqual(actions, [tap]);
    assert.equal(
      (await request('GET', `${lease}/screenshot`)).data.jpeg,
      Buffer.from('frame').toString('base64'),
    );
    const binaryShot = await request(
      'GET',
      `${lease}/screenshot`,
      undefined,
      'test-token',
      { accept: 'image/jpeg' },
    );
    assert.equal(binaryShot.status, 200);
    assert.equal(binaryShot.headers['content-type'], 'image/jpeg');
    assert.equal(binaryShot.headers['x-screen-width'], '10');
    assert.equal(binaryShot.headers['x-screen-height'], '10');
    assert.deepEqual(binaryShot.data, Buffer.from('frame'));

    assert.equal((await request('DELETE', lease)).status, 200);
    const expired = await request('POST', `${lease}/heartbeat`);
    assert.equal(expired.status, 410);
    assert.equal(expired.data.code, 'SESSION_EXPIRED');

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

    const openApiTypes = new Set(
      openAPI.components.schemas.InputAction.oneOf.flatMap(
        (variant) => variant.properties.type.enum,
      ),
    );
    assert.deepEqual([...openApiTypes].sort(), [
      'back',
      'clearInput',
      'doubleTap',
      'dragAndDrop',
      'home',
      'key',
      'longPress',
      'scroll',
      'swipe',
      'tap',
      'typeText',
    ]);
  } finally {
    await handler.close();
  }
});
