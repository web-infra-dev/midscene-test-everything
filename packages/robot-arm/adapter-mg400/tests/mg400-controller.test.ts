import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from '@rstest/core';
import {
  Mg400ControllerClient,
  buildMg400ClearAlarmRequest,
  parseMg400ExchangeState,
} from '../src/mg400-controller.js';
import { mg400Faults } from '../src/mg400-faults.js';
import { exchangeMg400Http } from '../src/mg400-http.js';

const sample = () => ({
  controlMode: 'disable',
  coordinate: 'joint',
  jogMode: 'step',
  toolCoordinate: 3,
  userCoordinate: 2,
  alarms: [[70], [], [], [], [], null],
  outputs: [1, 2, 3, 4, 5, 6, 7, 8],
  jointCoordinate: [0.973604, -1.164202, 8.869067, 523.995667],
  cartesianCoordinate: [278.897614, 4.739651, 94.179764, 524.969299],
  autoManual: 'manual',
  prjState: 'paused',
  firmwareSpecific: { retained: true },
});
let server: Server | undefined;
const requests: { method: string; path: string; body: unknown }[] = [];
afterEach(async () => {
  server?.closeAllConnections();
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  requests.length = 0;
});
async function fixture(
  reply: (req: IncomingMessage, res: ServerResponse, body: unknown) => void,
) {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString();
      const body = text ? JSON.parse(text) : undefined;
      requests.push({ method: req.method!, path: req.url!, body });
      res.setHeader('content-type', 'application/json');
      reply(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    client: new Mg400ControllerClient('127.0.0.1', { port, timeoutMs: 500 }),
    port,
  };
}

describe('MG400 controller protocol', () => {
  it('reads native state without normalizing turns, null groups or firmware fields', async () => {
    const { client } = await fixture((_req, res) =>
      res.end(JSON.stringify(sample())),
    );
    const first = await client.readState();
    expect(first).toMatchObject({ vendor: 'dobot-mg400', raw: sample() });
    expect(Date.parse(first.receivedAt)).not.toBeNaN();
    first.raw.jointCoordinate[3] = 0;
    expect((await client.readState()).raw.jointCoordinate[3]).toBe(523.995667);
    expect(requests.map((r) => [r.method, r.path])).toEqual([
      ['GET', '/protocol/exchange'],
      ['GET', '/protocol/exchange'],
    ]);
  });

  it.each([
    { alarms: [70] },
    { alarms: [[70.1]] },
    { alarms: null },
    { outputs: [] },
    { outputs: [256, 0, 0, 0, 0, 0, 0, 0] },
    { jointCoordinate: [1, 2, 3, Number.NaN] },
    { cartesianCoordinate: [1, 2] },
    { controlMode: 'unknown' },
    { toolCoordinate: -1 },
    { coordinate: '' },
  ])('rejects malformed state %j', (invalid) => {
    expect(() => parseMg400ExchangeState({ ...sample(), ...invalid })).toThrow(
      /Invalid MG400 exchange/,
    );
  });

  it('constructs the documented full clear request with output writing disabled', () => {
    const state = parseMg400ExchangeState(sample());
    const request = buildMg400ClearAlarmRequest(state);
    expect(request).toEqual({
      controlMode: 'disable',
      coordinate: 'joint',
      jogMode: 'step',
      toolCoordinate: 3,
      userCoordinate: 2,
      hardware: true,
      alarms: true,
      outputs: { enable: false, value: [1, 2, 3, 4, 5, 6, 7, 8] },
    });
    request.outputs.value[0] = 99;
    expect(state.outputs[0]).toBe(1);
  });

  it('waits past the write ACK for fresh, fault-free state without resume or enable', async () => {
    let writes = 0;
    let afterWriteReads = 0;
    const { client } = await fixture((req, res) => {
      const state = sample();
      if (req.method === 'POST') {
        writes++;
        // Deliberately misleading ACK: the subsequent GET still has a fault.
        res.end(
          JSON.stringify({ ...state, alarms: [[], [], [], [], [], null] }),
        );
        return;
      }
      if (writes && ++afterWriteReads === 2)
        state.alarms = [[], [], [], [], [], null];
      res.end(JSON.stringify(state));
    });
    expect((await client.clearAlarms()).raw.alarms[0]).toEqual([]);
    expect(requests.map((r) => r.method)).toEqual([
      'GET',
      'POST',
      'GET',
      'GET',
    ]);
    expect(requests[1].body).toMatchObject({
      controlMode: 'disable',
      alarms: true,
      outputs: { enable: false },
    });
  });

  it('reports persistent faults and the actual request/response; does not retry the write', async () => {
    const { client } = await fixture((req, res) =>
      res.end(
        JSON.stringify(req.method === 'POST' ? { status: true } : sample()),
      ),
    );
    await expect(client.clearAlarms(180)).rejects.toMatchObject({
      code: 'STATE_UNCONFIRMED',
      message: expect.stringContaining('70'),
      details: {
        request: { alarms: true },
        response: { status: true },
        beforeState: { raw: { jointCoordinate: sample().jointCoordinate } },
        lastState: { raw: { alarms: [[70], [], [], [], [], null] } },
      },
    });
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  });

  it.each([{ status: false }, false, {}, { status: 'true' }])(
    'rejects unsuccessful or malformed ACK %j',
    async (ack) => {
      const { client } = await fixture((req, res) =>
        res.end(JSON.stringify(req.method === 'POST' ? ack : sample())),
      );
      await expect(client.clearAlarms()).rejects.toMatchObject({
        code: expect.stringMatching(/VENDOR_ERROR|PROTOCOL_ERROR/),
      });
      expect(requests.map((r) => r.method)).toEqual(['GET', 'POST']);
    },
  );

  it('does not write from malformed or failed reads', async () => {
    const { client } = await fixture((_req, res) => res.end('{}'));
    await expect(client.clearAlarms()).rejects.toMatchObject({
      code: 'PROTOCOL_ERROR',
    });
    expect(requests.map((r) => r.method)).toEqual(['GET']);
  });

  it('serializes clear transactions and rereads output/coordinate values for each', async () => {
    let writes = 0;
    const { client } = await fixture((req, res) => {
      if (req.method === 'POST') writes++;
      res.end(
        JSON.stringify({
          ...sample(),
          alarms: [[], [], [], [], [], null],
          userCoordinate: writes,
          outputs: Array(8).fill(writes),
        }),
      );
    });
    await Promise.all([client.clearAlarms(), client.clearAlarms()]);
    expect(requests.map((r) => r.method)).toEqual([
      'GET',
      'POST',
      'GET',
      'GET',
      'POST',
      'GET',
    ]);
    expect(requests[1].body).toMatchObject({
      userCoordinate: 0,
      outputs: { value: Array(8).fill(0) },
    });
    expect(requests[4].body).toMatchObject({
      userCoordinate: 1,
      outputs: { value: Array(8).fill(1) },
    });
  });

  it('cancels an outstanding read and invalidates a queued clear before either can write', async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { client } = await fixture(() => started());
    const results = Promise.allSettled([
      client.clearAlarms(),
      client.clearAlarms(),
    ]);
    await ready;
    client.interrupt();
    expect(await results).toMatchObject([
      { status: 'rejected', reason: { code: 'ACTION_STOPPED' } },
      { status: 'rejected', reason: { code: 'ACTION_STOPPED' } },
    ]);
    expect(requests.map((r) => r.method)).toEqual(['GET']);
  });

  it('does not confirm or retry a write whose response is lost', async () => {
    const { client } = await fixture((req, res) => {
      if (req.method === 'POST') res.socket!.destroy();
      else res.end(JSON.stringify(sample()));
    });
    await expect(client.clearAlarms()).rejects.toMatchObject({
      code: 'DISCONNECTED',
      details: {
        operation: 'ClearAlarms',
        request: { alarms: true },
        lastState: { raw: { controlMode: 'disable' } },
      },
    });
    expect(requests.map((r) => r.method)).toEqual(['GET', 'POST']);
  });
  it('interrupts a submitted write without accepting a late ACK or sending another write', async () => {
    let submitted!: () => void;
    const ready = new Promise<void>((resolve) => {
      submitted = resolve;
    });
    let held: ServerResponse | undefined;
    const { client } = await fixture((req, res) => {
      if (req.method === 'POST') {
        held = res;
        submitted();
      } else res.end(JSON.stringify(sample()));
    });
    const rejected = expect(client.clearAlarms()).rejects.toMatchObject({
      code: 'ACTION_STOPPED',
    });
    await ready;
    client.interrupt();
    held!.end(JSON.stringify({ status: true }));
    await rejected;
    expect(requests.map((r) => r.method)).toEqual(['GET', 'POST']);
  });

  it('bounds slow HTTP responses by a wall-clock deadline', async () => {
    const intervals: ReturnType<typeof setInterval>[] = [];
    const { port } = await fixture((_req, res) => {
      res.write('{');
      intervals.push(setInterval(() => res.write(' '), 10));
    });
    try {
      await expect(
        exchangeMg400Http('127.0.0.1', {
          port,
          path: '/protocol/exchange',
          timeoutMs: 80,
        }),
      ).rejects.toMatchObject({ code: 'CONNECTION_TIMEOUT' });
    } finally {
      for (const interval of intervals) clearInterval(interval);
    }
  });

  it('reports truncated HTTP bodies instead of leaving the request pending', async () => {
    const { client } = await fixture((_req, res) => {
      res.writeHead(200, { 'content-length': 10000 });
      res.write('{');
      res.end();
      res.socket?.destroy();
    });
    await expect(client.readState()).rejects.toMatchObject({
      code: 'DISCONNECTED',
    });
  });
});

describe('MG400 fault provenance', () => {
  it('identifies MG400 linkage limits without inventing a J5 motor axis', () => {
    const faults = mg400Faults([[72, 73], [73]]);
    expect(faults[0]).toMatchObject({
      raw: {
        group: 0,
        kind: 'linkage-limit',
        mechanism: 'parallelogram',
        direction: 'positive',
      },
    });
    expect(faults[1]).toMatchObject({
      message: expect.stringContaining('parallelogram negative limit'),
      raw: { group: 0, kind: 'linkage-limit', direction: 'negative' },
    });
    expect(faults[0].raw).not.toHaveProperty('axis', 5);
    expect(faults[1].raw).not.toHaveProperty('axis', 5);
    expect(faults[2]).toMatchObject({
      category: 'motion',
      raw: { group: 1, axis: 1 },
    });
    expect(faults[2].message).not.toContain('parallelogram');
  });
  it('keeps controller and servo occurrences of the same code distinct', () => {
    const faults = mg400Faults([[70], [70], [], [19]]);
    expect(faults).toMatchObject([
      {
        code: '70',
        recoverable: false,
        category: 'controller',
        message: expect.stringContaining('joint 4 positive limit'),
        raw: { group: 0, axis: 4, kind: 'joint-limit' },
      },
      {
        code: '70',
        recoverable: false,
        category: 'motion',
        raw: { group: 1, axis: 1 },
      },
      { code: '19', raw: { group: 3, axis: 3 } },
    ]);
    expect(faults[1].message).not.toContain('limit');
  });
  it('only synthesizes a fault for error mode without nonzero alarm codes', () => {
    expect(mg400Faults([[0]], 9)).toMatchObject([
      { code: '-9', raw: { synthetic: true } },
    ]);
    expect(mg400Faults([[]], 10)).toEqual([]);
  });
});
