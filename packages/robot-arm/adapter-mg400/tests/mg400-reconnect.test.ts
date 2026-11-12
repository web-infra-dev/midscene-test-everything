import { mkdtemp, rm } from 'node:fs/promises';
import { type Server, type Socket, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RobotArmRuntime } from '@midscene/arm-kit/internal/runtime';
import { ProfileStore } from '@midscene/arm-kit/internal/runtime/profile-store';
import { afterEach, describe, expect, it } from '@rstest/core';
import { Mg400Adapter } from '../src/mg400.js';

/**
 * Controller double for the DobotStudio interleaving. In `tp` mode the
 * controller drops the sockets this service owns and answers anything that is
 * re-opened with vendor code -1; switching back to `tcp` makes it serve them
 * again. That is what an operator sees when DobotStudio takes the command
 * channel and later hands it back.
 */
class ModeSwitchingController {
  mode: 'tcp' | 'tp' = 'tcp';
  readonly commands: string[] = [];
  connections = 0;
  private readonly sockets = new Set<Socket>();
  private readonly servers: Server[] = [];

  async start(): Promise<{ dashboardPort: number; motionPort: number }> {
    const dashboardPort = await this.listen();
    const motionPort = await this.listen();
    return { dashboardPort, motionPort };
  }

  setMode(mode: 'tcp' | 'tp'): void {
    this.mode = mode;
    if (mode === 'tp') for (const socket of this.sockets) socket.destroy();
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await Promise.all(
      this.servers.map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
  }

  private listen(): Promise<number> {
    const server = createServer((socket) => {
      this.connections++;
      this.sockets.add(socket);
      socket.on('error', () => undefined);
      socket.on('close', () => this.sockets.delete(socket));
      socket.setEncoding('utf8');
      let buffer = '';
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        let end = buffer.indexOf(')');
        while (end >= 0) {
          const command = buffer.slice(0, end + 1);
          buffer = buffer.slice(end + 1);
          this.commands.push(command);
          if (this.mode === 'tp') {
            socket.write(`-1,{},${command};`);
          } else {
            socket.write(`0,{${this.reply(command)}},${command};`);
          }
          end = buffer.indexOf(')');
        }
      });
    });
    this.servers.push(server);
    return new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string')
          reject(new Error('Controller port unavailable'));
        else resolve(address.port);
      });
    });
  }

  private reply(command: string): string {
    const name = command.slice(0, command.indexOf('('));
    switch (name) {
      case 'RobotMode':
        return '4';
      case 'GetErrorID':
        return '[]';
      case 'GetPose':
      case 'PositiveSolution':
        return '100,0,100,0';
      case 'GetAngle':
        return '1,2,3,4';
      case 'InverseSolution':
        return '1,2,3,4';
      default:
        return '';
    }
  }
}

const controllers: ModeSwitchingController[] = [];
afterEach(async () => {
  for (const controller of controllers.splice(0)) await controller.close();
});

async function fixture() {
  const controller = new ModeSwitchingController();
  controllers.push(controller);
  const ports = await controller.start();
  const adapter = new Mg400Adapter({
    host: '127.0.0.1',
    ...ports,
    feedbackPort: 0,
    commandTimeoutMs: 300,
    statePollIntervalMs: 0,
  });
  return { controller, adapter };
}

async function until(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Fixture condition timed out');
}

const connected = async (adapter: Mg400Adapter) => {
  try {
    return (await adapter.getState()).connected;
  } catch {
    return false;
  }
};

describe('MG400 channel recovery', () => {
  it('reopens its channels after the controller hands control back to TCP', async () => {
    const f = await fixture();
    try {
      await f.adapter.connect();
      expect(await connected(f.adapter)).toBe(true);

      f.controller.setMode('tp');
      await until(async () => !(await connected(f.adapter)));
      // Keep the refusal long enough for at least one retry to be refused.
      await new Promise((resolve) => setTimeout(resolve, 800));
      const refused = f.controller.connections;

      f.controller.setMode('tcp');
      await until(() => connected(f.adapter), 8000);
      expect(f.controller.connections).toBeGreaterThan(refused);
      expect(f.controller.commands).toContain('RobotMode()');
    } finally {
      await f.adapter.disconnect();
    }
  }, 15000);

  it('returns the runtime to a usable connection without an explicit reconnect', async () => {
    const f = await fixture();
    const directory = await mkdtemp(
      path.join(tmpdir(), 'mg400-reconnect-runtime-'),
    );
    const runtime = new RobotArmRuntime({
      adapter: f.adapter,
      profileStore: new ProfileStore(path.join(directory, 'profiles.json')),
    });
    try {
      await runtime.initialize();
      expect((await runtime.state()).state.connected).toBe(true);

      f.controller.setMode('tp');
      await until(async () => {
        try {
          await runtime.readiness();
          return false;
        } catch {
          return true;
        }
      });
      f.controller.setMode('tcp');

      await until(async () => {
        try {
          return (await runtime.state()).state.connected;
        } catch {
          return false;
        }
      }, 8000);
      expect((await runtime.state()).recoveryRequired).toBe(false);
      expect(
        f.controller.commands.some((command) => command.startsWith('Mov')),
      ).toBe(false);
    } finally {
      await f.adapter.disconnect();
      await rm(directory, { recursive: true, force: true });
    }
  }, 15000);

  it('stops retrying after an explicit disconnect', async () => {
    const f = await fixture();
    try {
      await f.adapter.connect();
      f.controller.setMode('tp');
      await until(async () => !(await connected(f.adapter)));
      await f.adapter.disconnect();
      const attempts = f.controller.connections;
      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(f.controller.connections).toBe(attempts);
    } finally {
      await f.adapter.disconnect();
    }
  }, 15000);
});
