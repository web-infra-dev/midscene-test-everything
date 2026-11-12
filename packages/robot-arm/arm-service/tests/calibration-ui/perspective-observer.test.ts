import { afterEach, expect, it, rstest } from '@rstest/core';
import {
  type PerspectiveObservation,
  observePerspective,
} from '../../src/ui/calibration/utils/perspective-observer';

afterEach(() => {
  rstest.useRealTimers();
  rstest.unstubAllGlobals();
});
const response = (state = 'invalid') =>
  Response.json({ validity: { state }, summary: { state, driftRatio: 0.02 } });
it('does not overlap requests and discards an in-flight response after switching screens', async () => {
  let release!: (response: Response) => void;
  const fetcher = rstest.fn(
    () =>
      new Promise<Response>((done) => {
        release = done;
      }),
  );
  rstest.stubGlobal('fetch', fetcher);
  const updates: PerspectiveObservation[] = [];
  const watcher = observePerspective({
    baseUrl: '/old',
    visible: () => true,
    publish: (value) => updates.push(value),
  });
  await watcher.refresh();
  expect(fetcher).toHaveBeenCalledTimes(1);
  watcher.close();
  release(response());
  await Promise.resolve();
  await Promise.resolve();
  expect(updates).toHaveLength(0);
});
it('keeps a mismatch visible through a failed check and clears the transport error on retry', async () => {
  const fetcher = rstest
    .fn()
    .mockResolvedValueOnce(response())
    .mockRejectedValueOnce(new Error('camera offline'))
    .mockResolvedValue(response('valid'));
  rstest.stubGlobal('fetch', fetcher);
  const updates: PerspectiveObservation[] = [];
  const watcher = observePerspective({
    baseUrl: '/screen',
    visible: () => true,
    publish: (value) => updates.push(value),
  });
  try {
    await rstest.waitFor(() => expect(updates).toHaveLength(1));
    await watcher.refresh();
    expect(updates[1]).toMatchObject({
      summary: { state: 'invalid' },
      error: 'camera offline',
    });
    await watcher.refresh();
    expect(updates[2].summary?.state).toBe('valid');
    expect(updates[2].error).toBeUndefined();
  } finally {
    watcher.close();
  }
});
it('skips hidden pages and immediately checks the current screen when shown again', async () => {
  rstest.stubGlobal('fetch', rstest.fn().mockResolvedValue(response()));
  let visible = false;
  const updates: PerspectiveObservation[] = [];
  const watcher = observePerspective({
    baseUrl: '/screen',
    visible: () => visible,
    publish: (value) => updates.push(value),
  });
  try {
    await watcher.refresh();
    expect(fetch).not.toHaveBeenCalled();
    visible = true;
    await watcher.refresh();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(updates[0].summary?.state).toBe('invalid');
  } finally {
    watcher.close();
  }
});
it('retains server-stored mismatch evidence when the first live frame is unavailable', async () => {
  rstest.stubGlobal(
    'fetch',
    rstest.fn().mockResolvedValue(
      Response.json(
        {
          error: 'no frame',
          summary: { state: 'invalid', driftRatio: 0.02 },
        },
        { status: 409 },
      ),
    ),
  );
  const updates: PerspectiveObservation[] = [];
  const watcher = observePerspective({
    baseUrl: '/screen',
    visible: () => true,
    publish: (value) => updates.push(value),
  });
  try {
    await rstest.waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toMatchObject({
      summary: { state: 'invalid' },
      error: 'no frame',
    });
  } finally {
    watcher.close();
  }
});

it('pauses silently without a reference page, preserves confirmed mismatches and resumes', async () => {
  rstest.stubGlobal(
    'fetch',
    rstest
      .fn()
      .mockResolvedValueOnce(response('suspected'))
      .mockResolvedValueOnce(
        Response.json({
          skipped: 'reference-page-unavailable',
          summary: { state: 'suspected' },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          skipped: 'reference-page-unavailable',
          summary: { state: 'invalid' },
        }),
      )
      .mockResolvedValueOnce(response('valid')),
  );
  const updates: PerspectiveObservation[] = [];
  const watcher = observePerspective({
    baseUrl: '/screen',
    visible: () => true,
    publish: (value) => updates.push(value),
  });
  try {
    await rstest.waitFor(() => expect(updates).toHaveLength(1));
    await watcher.refresh();
    expect(updates[1]).toEqual({});
    await watcher.refresh();
    expect(updates[2]).toEqual({ summary: { state: 'invalid' } });
    await watcher.refresh();
    expect(updates[3].summary?.state).toBe('valid');
  } finally {
    watcher.close();
  }
});
