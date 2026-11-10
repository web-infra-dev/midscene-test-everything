import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlaygroundServer } from '@midscene/playground';
import { onTestFinished, test } from '@rstest/core';
import { DeviceWorkspaces } from '../dist/workspaces.js';
import { SimulatedManager } from './fixtures/simulated-workspaces.js';

test('two real upstream servers isolate sessions, inputs, status and teardown under one origin', async () => {
  const managers: SimulatedManager[] = [];
  const registry = new DeviceWorkspaces(
    '/tmp',
    () => {
      const manager = new SimulatedManager();
      managers.push(manager);
      return manager;
    },
    false,
  );
  const server = new PlaygroundServer();
  registry.mount(server);
  await server.launch(0);
  onTestFinished(async () => {
    await registry.close();
    await server.close();
  });
  const base = `http://127.0.0.1:${server.port}`;
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Midscene-Playground': 'workspace',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = await res.json();
    assert.equal(res.ok, true, JSON.stringify(value));
    return value;
  };
  const a = await request('/ios-hid/workspaces', 'POST');
  const b = await request('/ios-hid/workspaces', 'POST');
  await request(`${a.apiBase}/session`, 'POST', {
    name: 'phone-a',
    source: 'usb',
    deviceId: 'usb-a',
    bluetoothPeerId: 'bt-a',
  });
  await request(`${b.apiBase}/session`, 'POST', {
    name: 'phone-b',
    source: 'camera',
    cameraId: 'camera-b',
    bluetoothPeerId: 'bt-b',
  });
  assert.equal(managers[0].destroyed, 0, 'adding B must not disconnect A');
  assert.notEqual(
    (await request(`${a.apiBase}/status`)).id,
    (await request(`${b.apiBase}/status`)).id,
  );
  await request(`${b.apiBase}/interact`, 'POST', {
    actionType: 'Tap',
    x: 20,
    y: 30,
  });
  assert.deepEqual(managers[0].calls, []);
  assert.deepEqual(managers[1].calls, [
    { type: 'tap', point: { x: 20, y: 30 } },
  ]);
  assert.ok(await request(`${a.apiBase}/screenshot`));
  assert.ok(await request(`${b.apiBase}/screenshot`));
  const reportDirectory = await mkdtemp(join(tmpdir(), 'ios-hid-report-'));
  const reportPath = join(reportDirectory, 'a.html');
  await writeFile(reportPath, '<!doctype html><title>phone-a report</title>');
  onTestFinished(() => rm(reportDirectory, { recursive: true, force: true }));
  registry.get(a.id)!.server.agent!.finalizeReport = async () => reportPath;
  managers[0].blockTasks = managers[1].blockTasks = true;
  const startedA = new Promise<void>((resolve) => {
    managers[0].onStarted = resolve;
  });
  const startedB = new Promise<void>((resolve) => {
    managers[1].onStarted = resolve;
  });
  const runningA = request(`${a.apiBase}/execute`, 'POST', {
    type: 'aiAct',
    prompt: 'simulated A',
    requestId: 'task-a',
  });
  const runningB = request(`${b.apiBase}/execute`, 'POST', {
    type: 'aiAct',
    prompt: 'simulated B',
    requestId: 'task-b',
  });
  await Promise.all([startedA, startedB]);
  const busyRefresh = await fetch(`${base}${a.apiBase}/refresh`, {
    method: 'POST',
    headers: { 'X-Midscene-Playground': 'workspace' },
  });
  assert.equal(busyRefresh.status, 409);
  assert.equal(managers[0].recoveries, 0);

  const wrongCancel = await request(`${b.apiBase}/cancel/task-a`, 'POST', {});
  assert.notEqual(wrongCancel.status, 'cancelled');
  assert.equal(managers[0].taskSignal!.aborted, false);
  const cancellation = await request(`${b.apiBase}/cancel/task-b`, 'POST', {});
  assert.equal(cancellation.status, 'cancelled');
  assert.equal(managers[1].taskSignal!.aborted, true);
  assert.equal(
    managers[0].taskSignal!.aborted,
    false,
    'cancelling B does not cancel A',
  );
  managers[0].finishTask();
  const resultA = await runningA;
  assert.equal(resultA.result, 'phone-a');
  assert.ok(resultA.report.url.startsWith(`${a.apiBase}/reports/`));
  const report = await fetch(`${base}${resultA.report.url}`);
  assert.match(await report.text(), /phone-a report/);
  const wrongReport = await fetch(
    `${base}${resultA.report.url.replace(a.apiBase, b.apiBase)}`,
  );
  assert.equal(
    wrongReport.status,
    404,
    'a report is accessible only under its owning workspace',
  );
  assert.match((await runningB).error, /cancel/i);
  managers[1].testScreenError = 'camera unplugged';
  const blocked = await fetch(`${base}${b.apiBase}/interact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionType: 'Tap', x: 30, y: 40 }),
  });
  assert.equal(blocked.status, 409);
  assert.equal(managers[1].calls.length, 1);
  await request(`${a.apiBase}/interact`, 'POST', {
    actionType: 'Tap',
    x: 10,
    y: 10,
  });
  assert.equal(
    managers[0].calls.length,
    1,
    'A remains usable when B has no picture',
  );
  const originalAgent = registry.get(b.id)!.server.agent;
  const originalSession = registry.get(b.id)!.server.getSessionInfo();
  managers[1].recoveryError = '仍未连接';
  const failedRefresh = await fetch(`${base}${b.apiBase}/refresh`, {
    method: 'POST',
    headers: { 'X-Midscene-Playground': 'workspace' },
  });
  assert.equal(failedRefresh.status, 400);
  assert.equal(managers[1].destroyed, 0);
  managers[1].recoveryError = undefined;
  const recovered = await request(`${b.apiBase}/refresh`, 'POST');
  assert.equal(recovered.id, b.id);
  assert.equal(recovered.state.phase, 'ready');
  assert.equal(recovered.screenError, undefined);
  assert.equal(registry.get(b.id)!.server.agent, originalAgent);
  assert.deepEqual(
    registry.get(b.id)!.server.getSessionInfo(),
    originalSession,
  );
  assert.equal(managers[0].recoveries, 0);
  assert.match(
    await (await fetch(`${base}${resultA.report.url}`)).text(),
    /phone-a report/,
  );
  const noCapability = await fetch(`${base}${b.apiBase}/refresh`, {
    method: 'POST',
  });
  assert.equal(noCapability.status, 403);
  await request(`${b.apiBase}/interact`, 'POST', {
    actionType: 'Tap',
    x: 30,
    y: 40,
  });
  assert.equal(
    managers[1].calls.length,
    2,
    'same Agent accepts input after recovery',
  );
  const feedAbort = new AbortController();
  const feed = await fetch(`${base}/ios-hid/workspaces/events`, {
    signal: feedAbort.signal,
  });
  const feedReader = feed.body!.getReader();
  const initialEvent = new TextDecoder().decode(
    (await feedReader.read()).value,
  );
  assert.ok(initialEvent.includes(a.id));
  assert.ok(initialEvent.includes(b.id));
  managers[1].connection!.phase = 'failed';
  // biome-ignore lint/complexity/useLiteralKeys: Bracket access preserves type checking for non-public test hooks.
  managers[1]['notifyStateChange']();
  const changedEvent = new TextDecoder().decode(
    (await feedReader.read()).value,
  );
  assert.ok(
    changedEvent.includes('failed'),
    'workspace changes arrive through SSE',
  );
  feedAbort.abort();
  const reconnectAbort = new AbortController();
  const reconnected = await fetch(`${base}/ios-hid/workspaces/events`, {
    signal: reconnectAbort.signal,
  });
  const restored = new TextDecoder().decode(
    (await reconnected.body!.getReader().read()).value,
  );
  assert.ok(restored.includes(a.id));
  assert.ok(restored.includes(b.id));
  assert.ok(
    restored.includes('failed'),
    'reconnecting receives the latest full snapshot',
  );
  reconnectAbort.abort();
  const list = await request('/ios-hid/workspaces');
  assert.equal(
    list.find(
      (item: { id: string; state: { phase: string }; connected: boolean }) =>
        item.id === a.id,
    ).state.phase,
    'ready',
  );
  assert.equal(
    list.find(
      (item: { id: string; state: { phase: string }; connected: boolean }) =>
        item.id === b.id,
    ).connected,
    true,
    'failed devices retain their workspace',
  );
  await request(`/ios-hid/workspaces/${b.id}`, 'DELETE');
  assert.equal(managers[1].destroyed, 1);
  assert.equal(managers[0].destroyed, 0);
  assert.ok(await request(`${a.apiBase}/screenshot`));
  const missing = await fetch(`${base}${b.apiBase}/status`);
  assert.equal(missing.status, 404);
});
