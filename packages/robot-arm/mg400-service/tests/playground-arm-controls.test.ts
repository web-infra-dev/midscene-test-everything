import { afterEach, expect, it, rstest } from '@rstest/core';
import { useConnection } from '../src/ui/connection';
afterEach(() => rstest.unstubAllGlobals());
function ready() {
  useConnection.setState({
    phase: 'connected',
    recoveryRequired: false,
    controlPending: undefined,
    controlError: undefined,
  });
}
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
it('shows stop failures without losing the connected workspace or hiding them on polling', async () => {
  ready();
  const fetch = rstest
    .fn()
    .mockResolvedValueOnce(response({ error: 'Stop unconfirmed' }, false))
    .mockResolvedValueOnce(
      response({ phase: 'connected', recoveryRequired: true }),
    );
  rstest.stubGlobal('fetch', fetch);
  await useConnection.getState().stop();
  expect(useConnection.getState().phase).toBe('connected');
  expect(useConnection.getState().controlError).toContain('Stop unconfirmed');
  await useConnection.getState().check();
  expect(useConnection.getState().controlError).toContain('Stop unconfirmed');
  expect(useConnection.getState().recoveryRequired).toBe(true);
});
it('does not let an old status poll overwrite a completed stop', async () => {
  ready();
  let finish!: (value: unknown) => void;
  rstest.stubGlobal(
    'fetch',
    rstest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(
        response({ phase: 'connected', recoveryRequired: true }),
      ),
  );
  const polling = useConnection.getState().check();
  await useConnection.getState().stop();
  finish(response({ phase: 'connected', recoveryRequired: false }));
  await polling;
  expect(useConnection.getState().recoveryRequired).toBe(true);
});
it('a new stop takes precedence over a pending recovery response', async () => {
  ready();
  let finish!: (value: unknown) => void;
  rstest.stubGlobal(
    'fetch',
    rstest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(
        response({ phase: 'connected', recoveryRequired: true }),
      ),
  );
  const recovering = useConnection.getState().recover();
  await useConnection.getState().stop();
  finish(response({ phase: 'connected', recoveryRequired: false }));
  await recovering;
  expect(useConnection.getState().recoveryRequired).toBe(true);
  expect(useConnection.getState().controlPending).toBeUndefined();
});
