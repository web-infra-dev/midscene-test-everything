import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { expect, it, rstest } from '@rstest/core';
import { macosCameraControlTarget } from '../src/camera/macos-camera-backend.js';
import { MacosCameraHardwareControl } from '../src/camera/macos-camera-control.js';

function fixture() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    kill: rstest.fn(() => true),
  });
  const requests: Array<Record<string, unknown>> = [];
  let pending = '';
  child.stdin.on('data', (chunk: Buffer) => {
    pending += chunk.toString();
    for (;;) {
      const newline = pending.indexOf('\n');
      if (newline < 0) break;
      requests.push(JSON.parse(pending.slice(0, newline)));
      pending = pending.slice(newline + 1);
    }
  });
  const spawnProcess = rstest.fn(() => child) as unknown as typeof spawn;
  const control = new MacosCameraHardwareControl(
    'camera',
    'native-camera-uid',
    async () => '/tmp/macos-camera',
    { platform: 'darwin', spawnProcess },
  );
  return { child, control, requests, spawnProcess };
}

async function nextRequest(requests: Array<Record<string, unknown>>) {
  for (let attempt = 0; attempt < 20 && !requests.length; attempt++)
    await new Promise((resolve) => setImmediate(resolve));
  const request = requests.shift();
  if (!request) throw new Error('Camera control request was not sent');
  return request;
}

function respond(
  child: ReturnType<typeof fixture>['child'],
  request: Record<string, unknown>,
  value: Record<string, unknown>,
) {
  child.stdout.write(`${JSON.stringify({ id: request.id, ...value })}\n`);
}

it('bridges camera control queries, writes and shutdown', async () => {
  const { child, control, requests, spawnProcess } = fixture();
  const opening = control.open();
  child.stdout.write('{"id":"ready","ok":true}\n');
  await opening;

  const reading = control.read();
  const query = await nextRequest(requests);
  expect(query.action).toBe('query');
  respond(child, query, {
    ok: true,
    controls: {
      focus: {
        property: 'focus',
        value: 0.42,
        mode: 'manual',
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.42,
        supportsAuto: true,
        supportsManual: true,
      },
    },
  });
  await expect(reading).resolves.toMatchObject({
    focus: { value: 0.42, mode: 'manual' },
  });

  const writing = control.set('focus', 0.6, 'manual');
  const set = await nextRequest(requests);
  expect(set).toMatchObject({
    action: 'set',
    property: 'focus',
    value: 0.6,
    mode: 'manual',
  });
  respond(child, set, { ok: true });
  await writing;

  const closing = control.close();
  const shutdown = await nextRequest(requests);
  expect(shutdown.action).toBe('shutdown');
  respond(child, shutdown, { ok: true });
  await new Promise((resolve) => setImmediate(resolve));
  child.emit('exit', 0, null);
  await closing;

  expect(spawnProcess).toHaveBeenCalledWith(
    '/tmp/macos-camera',
    ['control', 'native-camera-uid'],
    expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
  );
});

it('reports helper command failures to the imaging caller', async () => {
  const { child, control, requests } = fixture();
  const opening = control.open();
  child.stdout.write('{"id":"ready","ok":true}\n');
  await opening;

  const reading = control.read();
  const query = await nextRequest(requests);
  respond(child, query, {
    ok: false,
    error: 'Manual focus is unavailable',
  });

  await expect(reading).rejects.toThrow('Manual focus is unavailable');
});

it('rejects startup when the camera helper cannot launch', async () => {
  const { child, control } = fixture();
  const opening = control.open();
  await new Promise((resolve) => setImmediate(resolve));
  child.emit('error', new Error('Camera access was denied'));

  await expect(opening).rejects.toThrow('Camera access was denied');
  expect(child.kill).toHaveBeenCalled();
});

it('targets UVC by USB location and falls back to the AVFoundation UID', () => {
  expect(
    macosCameraControlTarget({
      uid: '0x046d0x085e',
      usbLocationId: 0x1420_0000,
    }),
  ).toBe('uvc:337641472');
  expect(
    macosCameraControlTarget({
      uid: 'CC00000000000000000000000000000',
    }),
  ).toBe('CC00000000000000000000000000000');
});
