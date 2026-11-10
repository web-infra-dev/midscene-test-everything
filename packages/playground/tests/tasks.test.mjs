import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from '@rstest/core';
import { PlaygroundTasks } from '../src/server/tasks.ts';

class Device {
  interfaceType = 'robot-arm';
  async connect() {}
  async size() {
    return { width: 400, height: 800 };
  }
  actionSpace() {
    return [];
  }
  describe() {
    return 'Test arm';
  }
  async destroy() {
    this.destroyed = true;
  }
}
function fixture({
  DeviceClass = Device,
  behavior = {},
  physicalCamera = (id) => id,
} = {}) {
  const agents = [];
  const devices = {
    arm: {},
    cameras: {},
    async open(id) {
      return { cameraId: physicalCamera(id) };
    },
  };
  const tasks = new PlaygroundTasks(devices, {
    Device: DeviceClass,
    createAgent: (device, options) => {
      const agent = {
        interface: device,
        options,
        ...behavior,
        async destroy() {
          await device.pending?.catch(() => undefined);
          await device.destroy();
        },
      };
      agents.push(agent);
      return agent;
    },
  });
  return { tasks, agents };
}

test('mounts the pinned official Playground routes with independent task agents', async () => {
  const { tasks, agents } = fixture();
  const a = await tasks.create('camera-a');
  const b = await tasks.create('camera-b');
  const server = createServer(tasks.entries.get(a.id).server.app);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/action-space`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
    assert.equal(
      tasks.entries.get(a.id).server.getSessionInfo().connected,
      true,
    );
    const directory = await mkdtemp(join(tmpdir(), 'arm-report-test-'));
    try {
      const file = join(directory, 'report.html');
      await writeFile(file, '<html><body>Test report</body></html>');
      const report = await tasks.entries
        .get(a.id)
        .server.registerReportFile(file);
      assert.equal(report.url.startsWith(`/api/tasks/${a.id}/reports/`), true);
      assert.equal(
        report.replayUrl.startsWith(`/api/tasks/${a.id}/reports/`),
        true,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    await tasks.remove(a.id);
    assert.equal(agents[0].interface.destroyed, true);
    assert.equal(agents[1].interface.destroyed, undefined);
    assert.equal(tasks.entries.has(b.id), true);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await tasks.close();
  }
});

test('model changes stay on the selected task and reject changes during execution', async () => {
  const { tasks } = fixture();
  try {
    const a = await tasks.create('camera-a');
    const b = await tasks.create('camera-b');
    const config = {
      MIDSCENE_MODEL_NAME: 'test-model',
      MIDSCENE_MODEL_API_KEY: 'test-only-key',
      MIDSCENE_MODEL_BASE_URL: 'http://127.0.0.1:1/v1',
      MIDSCENE_MODEL_FAMILY: 'qwen3-vl',
    };
    await tasks.configure(a.id, config);
    assert.deepEqual(tasks.entries.get(a.id).modelConfig, config);
    assert.equal(tasks.entries.get(b.id).modelConfig, undefined);
    tasks.entries.get(a.id).server.currentTaskId = 'running';
    await tasks.configure(a.id, config);
    await assert.rejects(
      tasks.configure(a.id, { ...config, MIDSCENE_MODEL_NAME: 'other-model' }),
      /running task/,
    );
    await assert.rejects(tasks.configure(a.id, {}), /running task/);
    assert.deepEqual(tasks.entries.get(a.id).modelConfig, config);
    tasks.entries.get(a.id).server.currentTaskId = undefined;
    await assert.rejects(
      tasks.configure(a.id, { MIDSCENE_MODEL_NAME: 'incomplete' }),
    );
    assert.deepEqual(tasks.entries.get(a.id).modelConfig, config);
    await tasks.configure(a.id, {});
    assert.equal(tasks.entries.get(a.id).modelConfig, undefined);
    assert.equal(tasks.entries.get(a.id).signature, undefined);
    assert.equal(tasks.entries.get(a.id).server._configDirty, true);
    assert.equal(tasks.entries.get(b.id).modelConfig, undefined);
  } finally {
    await tasks.close();
  }
});

test('the next execution recreates only the configured task and restores server defaults after reset', async () => {
  const { tasks, agents } = fixture({
    behavior: {
      async resetDump() {},
      async finalizeReport() {},
      async aiQuery() {
        return 'done';
      },
    },
  });
  const a = await tasks.create('camera-a');
  const b = await tasks.create('camera-b');
  const originalB = tasks.entries.get(b.id).server.agent;
  const server = createServer(tasks.entries.get(a.id).server.app);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const execute = async () => {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/execute`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'aiQuery', prompt: 'test' }),
        },
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).result, 'done');
    };
    const config = {
      MIDSCENE_MODEL_NAME: 'test-model',
      MIDSCENE_MODEL_API_KEY: 'test-only-key',
      MIDSCENE_MODEL_BASE_URL: 'http://127.0.0.1:1/v1',
      MIDSCENE_MODEL_FAMILY: 'qwen3-vl',
    };
    await tasks.configure(a.id, config);
    await execute();
    assert.deepEqual(agents.at(-1).options.modelConfig, config);
    assert.equal(agents[0].interface.destroyed, true);
    await tasks.configure(a.id, {});
    await execute();
    assert.equal(agents.at(-1).options.modelConfig, undefined);
    assert.equal(tasks.entries.get(b.id).server.agent, originalB);
    assert.equal(agents[1].interface.destroyed, undefined);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await tasks.close();
  }
});

class MovingDevice extends Device {
  move() {
    this.moving = true;
    this.pending = new Promise((resolve, reject) => {
      this.finish = () => {
        this.moving = false;
        resolve('completed');
      };
      this.cancel = () => {
        this.moving = false;
        reject(new Error('Device work cancelled'));
      };
    });
    return this.pending;
  }
  async destroy() {
    this.cancel?.();
    await super.destroy();
  }
}
async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Condition did not settle');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('concurrent tasks execute independently and cancellation releases only the selected Device', async () => {
  const { tasks, agents } = fixture({
    DeviceClass: MovingDevice,
    behavior: {
      async resetDump() {},
      async finalizeReport() {
        return undefined;
      },
      async aiQuery() {
        return this.interface.move();
      },
    },
  });
  const a = await tasks.create('camera-a');
  const b = await tasks.create('camera-b');
  // Match Agent.destroy's idle-before-device ordering. Without the host's
  // device-first cleanup this wait deadlocks until the physical move finishes.
  const oldDestroy = agents[0].destroy;
  const deviceA = agents[0].interface;
  const deviceB = agents[1].interface;
  const server = createServer((req, res) => {
    const [, id, ...rest] = req.url.split('/');
    req.url = `/${rest.join('/')}`;
    tasks.entries.get(id).server.app(req, res);
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (id, path, body = {}) =>
      fetch(`${base}/${id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(async (response) => ({
        status: response.status,
        body: await response.json(),
      }));
    const first = post(a.id, 'execute', {
      type: 'aiQuery',
      prompt: 'a',
      requestId: 'run-a',
    });
    const second = post(b.id, 'execute', {
      type: 'aiQuery',
      prompt: 'b',
      requestId: 'run-b',
    });
    await until(() => deviceA.moving && deviceB.moving);
    assert.equal(
      tasks.list().find((task) => task.id === a.id).requestId,
      'run-a',
    );
    assert.equal(
      tasks.list().find((task) => task.id === b.id).phase,
      'running',
    );
    const cancelled = await post(a.id, 'cancel/run-a');
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.status, 'cancelled');
    assert.equal(deviceA.destroyed, true);
    assert.equal(deviceB.moving, true);
    assert.equal(deviceB.destroyed, undefined);
    assert.match((await first).body.error, /cancelled/);
    deviceB.finish();
    assert.equal((await second).body.result, 'completed');
    assert.equal(
      tasks.entries.get(a.id).server.getSessionInfo().connected,
      true,
    );
    assert.notEqual(tasks.entries.get(a.id).server.agent.destroy, oldDestroy);
  } finally {
    deviceA.cancel?.();
    deviceB.cancel?.();
    await tasks.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a failed Device stop never reports successful cancellation or creates a replacement Agent', async () => {
  class FailedStop extends Device {
    async destroy() {
      throw new Error('Stop could not be confirmed');
    }
  }
  const { tasks, agents } = fixture({ DeviceClass: FailedStop });
  const task = await tasks.create('camera');
  const entry = tasks.entries.get(task.id);
  entry.server.currentTaskId = 'running';
  const server = createServer(entry.server.app);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/cancel/running`,
      { method: 'POST' },
    );
    assert.equal(response.status, 500);
    assert.equal((await response.json()).code, 'TASK_CLEANUP_FAILED');
    assert.equal(agents.length, 1);
    assert.equal(entry.server.getSessionInfo().connected, false);
    await assert.rejects(tasks.remove(task.id), /Stop could not be confirmed/);
  } finally {
    await tasks.close().catch(() => undefined);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('closing a task aborts its planning request before waiting for Agent cleanup', async () => {
  const { tasks, agents } = fixture();
  const task = await tasks.create('camera');
  const controller = new AbortController();
  tasks.entries.get(task.id).server.taskAbortControllers.planning = controller;
  agents[0].interface.pending = new Promise((resolve) =>
    controller.signal.addEventListener('abort', resolve, { once: true }),
  );
  await tasks.remove(task.id);
  assert.equal(controller.signal.aborted, true);
  assert.equal(tasks.entries.size, 0);
  await tasks.close();
});

test('repeated and concurrent creation reuses one conversation per device', async () => {
  const { tasks, agents } = fixture();
  try {
    const [a, same] = await Promise.all([
      tasks.create('camera-a'),
      tasks.create('camera-a'),
    ]);
    assert.equal(a.id, same.id);
    assert.equal((await tasks.create('camera-a')).id, a.id);
    const b = await tasks.create('camera-b');
    assert.notEqual(a.id, b.id);
    assert.equal(agents.length, 2);
    assert.equal(tasks.list().length, 2);
  } finally {
    await tasks.close();
  }
});

test('stopping one physical camera closes tasks for all of its screens', async () => {
  const { tasks } = fixture({
    physicalCamera: (id) => (id === 'right' ? 'left' : id),
  });
  try {
    for (const id of ['left', 'right', 'other']) await tasks.create(id);
    await tasks.closeCamera('left');
    assert.deepEqual(
      tasks.list().map((t) => t.cameraId),
      ['other'],
    );
  } finally {
    await tasks.close();
  }
});
