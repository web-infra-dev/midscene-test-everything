import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { expect, it, rstest } from '@rstest/core';
import { createCalibrationClient } from '../../arm-service/src/ui/calibration/client.js';
import { createCalibrationHandler } from '../src/calibration-server/handler.js';
import type { CalibrationWorkflow } from '../src/calibration/workflow.js';
function transport(service: Partial<CalibrationWorkflow>) {
  const handler = createCalibrationHandler({
    service: service as CalibrationWorkflow,
    basePath: '/devices/a/calibration',
  });
  return async (url: unknown, init?: RequestInit) => {
    const request = Readable.from(
      init?.body ? [String(init.body)] : [],
    ) as IncomingMessage;
    request.url = String(url);
    request.method = init?.method ?? 'GET';
    let status = 200;
    let body = '';
    const response = {
      writeHead: (value: number) => {
        status = value;
      },
      end: (value: string) => {
        body = value;
      },
    } as unknown as ServerResponse;
    const matched = await handler(request, response);
    expect(matched).toBe(true);
    return new Response(body, {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}
it('uses the same mounted routes and session identifiers from the browser client', async () => {
  const state = { id: 'session/a', stage: 'ready' };
  const command = rstest.fn(async () => state);
  const fetch = transport({
    status: () => state,
    command,
  } as unknown as Partial<CalibrationWorkflow>);
  const client = createCalibrationClient({
    baseUrl: '/devices/a/calibration/',
    fetch: fetch as typeof globalThis.fetch,
  });
  expect(await client.assistedCalibration()).toEqual(state);
  await client.assistedCalibrationCommand(state.id, 'start', true);
  expect(command).toHaveBeenCalledWith('session/a', 'start', true, undefined);
});
it('does not interpret a string confirmation as permission to run a command', async () => {
  const command = rstest.fn();
  const fetch = transport({ command });
  const response = await fetch(
    '/devices/a/calibration/assisted-calibration/s/commands',
    {
      method: 'POST',
      body: JSON.stringify({ action: 'start', confirmed: 'true' }),
    },
  );
  expect(response.status).toBe(400);
  expect(command).not.toHaveBeenCalled();
});
