import type { IncomingMessage, ServerResponse } from 'node:http';
import { setTimeout } from 'node:timers/promises';
import type { ConnectionState, IPhoneDeviceOptions } from '../types.js';
import type { Connection, ConnectionManager } from './connections.js';

type WaitOptions = {
  onState?: (state: ConnectionState) => void;
  timeoutMs?: number;
};

/** A workspace's handle to a phone in the service's shared runtime. */
export class LocalDevice {
  private connection?: Connection;
  private deviceId?: string;
  private destroyed = false;

  constructor(
    private options: IPhoneDeviceOptions,
    private manager: ConnectionManager,
  ) {}

  get id() {
    return this.deviceId;
  }

  connect(options?: WaitOptions) {
    return this.open(this.options, false, options);
  }

  async refreshConnection(options?: WaitOptions) {
    if (!this.deviceId) throw new Error('Connect the device before refreshing');
    if (this.connection) await this.manager.close(this.connection);
    await this.open({ id: this.deviceId }, true, options);
  }

  private async open(
    options: IPhoneDeviceOptions,
    restore: boolean,
    { onState, timeoutMs = 10 * 60_000 }: WaitOptions = {},
  ) {
    if (this.destroyed) throw new Error('Device destroyed');
    const { id } = this.manager.begin(options, restore);
    const connection = this.manager.get(id);
    this.connection = connection;
    const deadline = Date.now() + timeoutMs;
    let previous: ConnectionState | undefined;
    try {
      while (Date.now() < deadline) {
        connection.lifetime.signal.throwIfAborted();
        const state = connection.state;
        if (!previous || JSON.stringify(state) !== JSON.stringify(previous)) {
          previous = structuredClone(state);
          onState?.(previous);
        }
        if (state.phase === 'ready') {
          this.deviceId = state.device!.id;
          return;
        }
        if (state.phase === 'failed' || state.phase === 'closed')
          throw new Error(state.error ?? 'Device connection closed');
        await setTimeout(300, undefined, {
          signal: connection.lifetime.signal,
        });
      }
      throw new Error('Device connection timed out');
    } catch (error) {
      await this.manager.close(connection);
      if (this.connection === connection) this.connection = undefined;
      throw error;
    }
  }

  async getConnectionState() {
    if (!this.connection) throw new Error('Device not connected');
    return structuredClone(this.connection.state);
  }

  async handleSetup(
    id: string,
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
  ) {
    const setup = this.connection?.setup;
    if (setup?.id !== id) {
      res.writeHead(410, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'This setup has ended. Reconnect the device.',
        }),
      );
      return;
    }
    await setup.handle(req, res, path);
  }

  controlConnection() {
    const connection = this.connection;
    if (
      connection?.state.phase !== 'ready' ||
      connection.lifetime.signal.aborted ||
      !connection.session
    )
      return undefined;
    return { session: connection.session, signal: connection.lifetime.signal };
  }

  screenshot() {
    const connection = this.controlConnection();
    if (!connection) throw new Error('Device not ready');
    return connection.session.screenshot();
  }

  previewScreenshot() {
    const connection = this.controlConnection();
    if (connection) return connection.session.screenshot();
    const screen = this.connection?.previewScreen;
    if (!screen || this.connection?.lifetime.signal.aborted) {
      throw new Error('Preview not available');
    }
    return screen.getFrame({ allowUnchanged: true, timeoutMs: 2000 });
  }

  async destroy() {
    this.destroyed = true;
    if (this.connection) await this.manager.close(this.connection);
  }
}
