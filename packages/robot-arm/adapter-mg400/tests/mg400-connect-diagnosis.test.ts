import type { AddressInfo } from 'node:net';
import { type Server, type Socket, createServer } from 'node:net';
import { afterEach, describe, expect, it, rstest } from '@rstest/core';
import { prepareMg400TcpConnection } from '../src/mg400-control-channel.js';
rstest.mock('../src/mg400-control-channel.js', () => ({
  prepareMg400TcpConnection: rstest.fn(async () => {
    throw new Error('TCP/IP preparation failed');
  }),
}));
import { Mg400Adapter } from '../src/mg400.js';

let server: Server | undefined;
const sockets: Socket[] = [];

afterEach(async () => {
  rstest.clearAllMocks();
  for (const socket of sockets.splice(0)) socket.destroy();
  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

/**
 * Controller double that refuses every command with vendor code -1, the way a
 * controller sitting in local ("online") mode does.
 */
async function refusingController(ready = () => false): Promise<number> {
  server = createServer((socket) => {
    sockets.push(socket);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let end = buffer.indexOf(')');
      while (end >= 0) {
        const command = buffer.slice(0, end + 1);
        buffer = buffer.slice(end + 1);
        const replies: Record<string, string> = {
          RobotMode: '4',
          GetErrorID: '[]',
          GetPose: '100,0,100,0',
          PositiveSolution: '100,0,100,0',
          GetAngle: '1,2,3,4',
          InverseSolution: '1,2,3,4',
        };
        const name = command.trim().split('(')[0];
        socket.write(
          ready()
            ? `0,{${replies[name] ?? ''}},${command};`
            : `-1,{},${command};`,
        );
        end = buffer.indexOf(')');
      }
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

describe('MG400 connection diagnosis', () => {
  it('prepares only TCP/IP inside connect and surfaces preparation failure', async () => {
    const port = await refusingController();
    const adapter = new Mg400Adapter({
      host: '127.0.0.1',
      dashboardPort: port,
      motionPort: port,
      feedbackPort: 0,
    });
    try {
      await expect(adapter.connect()).rejects.toMatchObject({
        message: 'TCP/IP preparation failed',
      });
      expect(prepareMg400TcpConnection).toHaveBeenCalledTimes(1);
    } finally {
      await adapter.disconnect();
    }
  }, 15000);

  it('completes connect after TCP preparation and never re-prepares a working connection', async () => {
    let ready = false;
    const port = await refusingController(() => ready);
    rstest
      .mocked(prepareMg400TcpConnection)
      .mockImplementationOnce(async () => {
        ready = true;
      });
    const adapter = new Mg400Adapter({
      host: '127.0.0.1',
      dashboardPort: port,
      motionPort: port,
      feedbackPort: 0,
    });
    try {
      await adapter.connect();
      expect((await adapter.getState()).connected).toBe(true);
      await adapter.connect();
      expect(prepareMg400TcpConnection).toHaveBeenCalledTimes(1);
    } finally {
      await adapter.disconnect();
    }
  });

  it('leaves other connection failures untouched', async () => {
    // Bind then close so the port is known to be free.
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const adapter = new Mg400Adapter({
      host: '127.0.0.1',
      dashboardPort: port,
      motionPort: port,
      feedbackPort: 0,
    });
    try {
      await expect(adapter.connect()).rejects.not.toMatchObject({
        message: 'TCP/IP preparation failed',
      });
    } finally {
      await adapter.disconnect();
    }
  }, 15000);
});
