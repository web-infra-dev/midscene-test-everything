import { afterEach, expect, it, rstest } from '@rstest/core';

afterEach(() => {
  rstest.unstubAllGlobals();
  rstest.resetModules();
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  });
it('a slow task-list response cannot erase a task created while it was loading', async () => {
  let finishList!: (response: Response) => void;
  const task = { id: 'new', cameraId: 'camera', name: 'Task 1' };
  rstest.stubGlobal(
    'fetch',
    rstest.fn((_url, options) =>
      options?.method === 'POST'
        ? Promise.resolve(json(task))
        : new Promise<Response>((resolve) => {
            finishList = resolve;
          }),
    ),
  );
  const { useTasks } = await import('../src/ui/tasks');
  const reading = useTasks.getState().refresh();
  await useTasks.getState().add('camera');
  finishList(json({ tasks: [] }));
  await reading;
  expect(useTasks.getState().tasks).toEqual([task]);
});

it('restores a running request from the host and cancels that exact request after a page reload', async () => {
  const requests: string[] = [];
  let running = true;
  rstest.stubGlobal(
    'fetch',
    rstest.fn(async (url, options) => {
      requests.push(String(url));
      if (options?.method === 'POST') {
        running = false;
        return json({ status: 'cancelled' });
      }
      return json({
        tasks: [
          {
            id: 'task',
            cameraId: 'camera',
            name: 'Task',
            phase: running ? 'running' : 'idle',
            requestId: running ? 'request/1' : undefined,
          },
        ],
      });
    }),
  );
  const { useTasks } = await import('../src/ui/tasks');
  await useTasks.getState().refresh();
  expect(useTasks.getState().tasks[0].requestId).toBe('request/1');
  await useTasks.getState().cancel('task', 'request/1');
  expect(requests).toContain('/api/tasks/task/cancel/request%2F1');
  expect(useTasks.getState().tasks[0].phase).toBe('idle');
});

it('clears a recovered polling error without hiding a failed task operation', async () => {
  const fetch = rstest
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(json({ tasks: [] }));
  rstest.stubGlobal('fetch', fetch);
  const { useTasks } = await import('../src/ui/tasks');
  await useTasks.getState().refresh();
  expect(useTasks.getState().pollError).toContain('offline');
  useTasks.setState({ error: 'Physical stop was not confirmed' });
  await useTasks.getState().refresh();
  expect(useTasks.getState().pollError).toBeUndefined();
  expect(useTasks.getState().error).toBe('Physical stop was not confirmed');
});

it('a task created by the old robot session cannot repopulate the new workspace', async () => {
  let finish!: (res: Response) => void;
  rstest.stubGlobal(
    'fetch',
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const { useTasks } = await import('../src/ui/tasks');
  const adding = useTasks.getState().add('camera');
  useTasks.getState().reset();
  finish(json({ id: 'old', cameraId: 'camera', name: 'Old' }));
  await adding;
  expect(useTasks.getState().tasks).toEqual([]);
  expect(useTasks.getState().pending).toBe(false);
});
