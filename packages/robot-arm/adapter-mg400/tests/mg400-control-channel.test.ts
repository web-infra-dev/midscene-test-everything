import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  type Server as TcpServer,
  createServer as createTcpServer,
} from 'node:net';
import { afterEach, describe, expect, it } from '@rstest/core';
import {
  discoverMg400Hosts,
  prepareMg400TcpConnection,
  probeMg400Dashboard,
} from '../src/mg400-control-channel.js';

interface Controller {
  httpPort: number;
  dashboardPort: number;
  posted: string[];
  connections: number;
  close(): Promise<void>;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

/**
 * Controller double: an HTTP API on one port that records mode writes, and an
 * ASCII dashboard on another that only answers `0,` for the modes it accepts.
 */
async function controller(
  accepts: ReadonlySet<string>,
  startMode = 'tp',
  refusedProbes = 0,
): Promise<Controller> {
  const posted: string[] = [];
  let mode = startMode;
  const state = { connections: 0 };

  const http: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (req.method === 'POST') {
        const parsed = JSON.parse(body || '{}') as { mode?: unknown };
        if (typeof parsed.mode === 'string') {
          mode = parsed.mode;
          posted.push(parsed.mode);
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: true }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify(
          req.url === '/protocol/exchange'
            ? {
                controlMode: 'disable',
                coordinate: 'joint',
                jogMode: 'jog',
                toolCoordinate: 0,
                userCoordinate: 0,
                alarms: [[85], [], [], [], [], null],
                outputs: Array(8).fill(0),
                jointCoordinate: [0, 0, 0, 0],
                cartesianCoordinate: [0, 0, 0, 0],
              }
            : { value: 'connected' },
        ),
      );
    });
  });

  const dashboard: TcpServer = createTcpServer((socket) => {
    state.connections += 1;
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      if (!chunk.includes('RobotMode')) return;
      socket.write(
        accepts.has(mode) && state.connections > refusedProbes
          ? '0,{4},RobotMode();'
          : '-1,{},RobotMode();',
      );
    });
    socket.on('error', () => {});
  });

  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) =>
    dashboard.listen(0, '127.0.0.1', resolve),
  );
  const controller: Controller = {
    httpPort: (http.address() as AddressInfo).port,
    dashboardPort: (dashboard.address() as AddressInfo).port,
    posted,
    get connections() {
      return state.connections;
    },
    async close() {
      await new Promise<void>((resolve) => http.close(() => resolve()));
      await new Promise<void>((resolve) => dashboard.close(() => resolve()));
    },
  };
  cleanups.push(() => controller.close());
  return controller;
}

describe('MG400 dashboard channel', () => {
  it('returns the reply when the controller serves the channel', async () => {
    const target = await controller(new Set(['tp']));
    await expect(
      probeMg400Dashboard('127.0.0.1', {
        port: target.dashboardPort,
        timeoutMs: 500,
      }),
    ).resolves.toBe('0,{4},RobotMode();');
  });

  it('treats the vendor refusal code as unusable, not as a reply', async () => {
    const target = await controller(new Set<string>());
    await expect(
      probeMg400Dashboard('127.0.0.1', {
        port: target.dashboardPort,
        timeoutMs: 500,
      }),
    ).resolves.toBeNull();
  });
});
describe('TCP/IP-only preparation', () => {
  it('waits for delayed readiness without applying the setting again', async () => {
    const target = await controller(new Set(['tp']), 'tcp', 2);
    await prepareMg400TcpConnection('127.0.0.1', {
      port: target.dashboardPort,
      httpPort: target.httpPort,
      settleMs: 10,
      readinessTimeoutMs: 1000,
      timeoutMs: 500,
    });
    expect(target.connections).toBe(3);
    expect(target.posted).toEqual(['tp']);
  });
  it('writes only the supported development value and verifies the command channel', async () => {
    const target = await controller(new Set(['tp']), 'tcp');
    await prepareMg400TcpConnection('127.0.0.1', {
      port: target.dashboardPort,
      httpPort: target.httpPort,
      settleMs: 0,
      timeoutMs: 500,
    });
    expect(target.posted).toEqual(['tp']);
  });
  it('uses the alternate firmware value only after a persistent mode refusal', async () => {
    const target = await controller(new Set(['tcp']), 'tp');
    await prepareMg400TcpConnection('127.0.0.1', {
      port: target.dashboardPort,
      httpPort: target.httpPort,
      settleMs: 5,
      readinessTimeoutMs: 100,
      timeoutMs: 500,
    });
    expect(target.posted).toEqual(['tp', 'tcp']);
  });
  it('does not try another mode when the Dashboard is silent', async () => {
    const target = await controller(new Set());
    const silent = createTcpServer((socket) => {
      socket.on('error', () => {});
      socket.once('data', () => socket.destroy());
    });
    await new Promise<void>((resolve) =>
      silent.listen(0, '127.0.0.1', resolve),
    );
    try {
      await expect(
        prepareMg400TcpConnection('127.0.0.1', {
          port: (silent.address() as AddressInfo).port,
          httpPort: target.httpPort,
          settleMs: 5,
          readinessTimeoutMs: 30,
          timeoutMs: 500,
        }),
      ).rejects.toThrow(/\[85\].*emergency stop/);
      expect(target.posted).toEqual(['tp']);
    } finally {
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  });
});

describe('MG400 discovery', () => {
  const hosts = ['192.168.1.6', '192.168.2.6'];
  for (const expected of hosts) {
    it(`selects the MG400 at ${expected} and checks both endpoints`, async () => {
      const checked: string[] = [];
      expect(
        await discoverMg400Hosts(async (host) => {
          checked.push(host);
          return host === expected ? '0,{4},RobotMode();' : '0,{},Other();';
        }),
      ).toEqual([expected]);
      expect(checked).toEqual(hosts);
    });
  }
  it('discovers a refusing controller without writing, then verifies a single mode change', async () => {
    const target = await controller(new Set(['tp']), 'tcp');
    const found = await discoverMg400Hosts((host, options) =>
      host === hosts[1]
        ? probeMg400Dashboard('127.0.0.1', {
            ...options,
            port: target.dashboardPort,
          })
        : Promise.resolve(null),
    );
    expect(found).toEqual([hosts[1]]);
    expect(target.posted).toEqual([]);
    await prepareMg400TcpConnection('127.0.0.1', {
      port: target.dashboardPort,
      httpPort: target.httpPort,
      settleMs: 0,
      timeoutMs: 500,
    });
    expect(target.posted).toEqual(['tp']);
    expect(
      await probeMg400Dashboard('127.0.0.1', { port: target.dashboardPort }),
    ).toBe('0,{4},RobotMode();');
  });
  it('prefers the ready controller when the other one refuses commands', async () => {
    expect(
      await discoverMg400Hosts(async (host) =>
        host === hosts[0] ? '0,{4},RobotMode();' : '-1,{},RobotMode();',
      ),
    ).toEqual([hosts[0]]);
  });
  it('reports absent and ambiguous controllers', async () => {
    expect(await discoverMg400Hosts(async () => null)).toEqual([]);
    expect(await discoverMg400Hosts(async () => '0,{4},RobotMode();')).toEqual(
      hosts,
    );
  });
});
