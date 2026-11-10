import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DeviceConfigStore } from '../config/store.js';
import type { DeviceConfig, IOSHIDDeviceOptions } from '../types.js';
import { json, readJSON } from './http.js';
import type { SetupSession } from './setup.js';

/** A script without an explicit identity can select one through the active presenter. */
export class DeviceSelectionSession implements SetupSession {
  readonly id = randomUUID();
  readonly result: Promise<DeviceConfig>;
  private resolve!: (config: DeviceConfig) => void;
  private reject!: (error: Error) => void;
  private finished = false;
  constructor(
    private candidates: DeviceConfig[],
    private store: DeviceConfigStore,
    private options: IOSHIDDeviceOptions,
  ) {
    this.result = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    void this.result.catch(() => undefined);
  }
  async handle(req: IncomingMessage, res: ServerResponse, path: string) {
    if (this.finished) throw new Error('Device selection finished');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && path === '/devices') {
      json(
        res,
        this.candidates.map(({ id, name, screen }) => ({
          id,
          name,
          source: screen.source,
        })),
      );
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    if (req.headers['x-midscene-setup'] !== this.id) {
      res.writeHead(403).end();
      return;
    }
    const value = (await readJSON(req)) as { id?: string; name?: string };
    if (this.finished) throw new Error('Device selection finished');
    if (path === '/cancel') {
      this.finished = true;
      this.reject(new Error('Device selection cancelled'));
      json(res, {});
      return;
    }
    if (path !== '/select') {
      res.writeHead(404).end();
      return;
    }
    let selected: DeviceConfig;
    if (value.id) {
      if (!this.candidates.some((d) => d.id === value.id))
        throw new Error('Device not found');
      selected = this.store.resolve({ ...this.options, id: value.id });
    } else {
      if (
        typeof value.name !== 'string' ||
        !value.name.trim() ||
        value.name.length > 120
      )
        throw new Error('Enter a name for the new device');
      if (this.store.list().some((d) => d.name === value.name!.trim()))
        throw new Error('Choose a new name or select the saved device');
      selected = this.store.resolve({
        name: value.name.trim(),
        screen: this.options.screen,
      });
    }
    this.finished = true;
    json(res, {});
    this.resolve(selected);
  }
  async close() {
    if (this.finished) return;
    this.finished = true;
    this.reject(new Error('Device selection closed'));
  }
}
