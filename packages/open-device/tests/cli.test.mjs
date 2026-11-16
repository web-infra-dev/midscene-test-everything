import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createDeviceHandler } from '../dist/server/index.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

function runWithStdin(args, env, stdinText) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `CLI exited with code ${code}`));
    });
    child.stdin.end(stdinText);
  });
}

test('CLI lists capabilities, captures JPEG, sends actions and releases its session', async () => {
  const tap = { type: 'tap', point: { x: 2, y: 3 } };
  const actions = [];
  const frame = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const device = {
    id: 'phone',
    name: 'Test device',
    status: 'available',
    actions: ['tap'],
  };
  const handler = createDeviceHandler({
    token: 'test-token',
    listDevices: () => [device],
    readyDevice: () => ({
      signal: new AbortController().signal,
      actions: device.actions,
      execute: async (action) => actions.push(action),
      screenshot: async () => ({
        jpeg: frame,
        width: 10,
        height: 20,
        sequence: 1,
        receivedAt: 1,
      }),
    }),
  });
  const server = createServer((req, res) => {
    if (!handler.handle(req, res)) res.writeHead(404).end();
  });
  const directory = await mkdtemp(join(tmpdir(), 'open-device-cli-'));
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const env = {
      ...process.env,
      OPEN_DEVICE_SERVICE_URL: `http://127.0.0.1:${server.address().port}`,
      OPEN_DEVICE_SERVICE_TOKEN: 'test-token',
      OPEN_DEVICE_ID: '',
    };
    const run = (...args) => exec(process.execPath, [cli, ...args], { env });

    const devices = await run('devices');
    assert.deepEqual(JSON.parse(devices.stdout), [device]);

    const file = join(directory, 'screen.jpg');
    const screenshot = await run('screenshot', file);
    assert.deepEqual(JSON.parse(screenshot.stdout), {
      file,
      width: 10,
      height: 20,
    });
    assert.deepEqual(await readFile(file), frame);

    const actionOut = await run('--device', device.id, 'action', JSON.stringify(tap));
    assert.deepEqual(JSON.parse(actionOut.stdout), {
      ok: true,
      deviceId: device.id,
      type: 'tap',
    });

    const stdinOut = await runWithStdin(
      ['--device', device.id, 'action', '-'],
      env,
      JSON.stringify(tap),
    );
    assert.deepEqual(JSON.parse(stdinOut.stdout), {
      ok: true,
      deviceId: device.id,
      type: 'tap',
    });
    assert.deepEqual(actions, [tap, tap]);

    await assert.rejects(
      run('action', '{"type":"home"}'),
      /does not support home/,
    );
    await assert.rejects(
      run('action', '{"type":"tap"}'),
      /Invalid action: point:/,
    );

    assert.equal(
      JSON.parse((await run('devices')).stdout)[0].status,
      'available',
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await handler.close();
    await rm(directory, { recursive: true, force: true });
  }
});
