import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type ConnectDevice,
  createConnectHandler,
} from '@midscene/connect/server';

export interface RegistryEntry {
  id: string;
  name: string;
  status: 'available' | 'offline';
  /** Extra discovery fields, e.g. `screenSource`. */
  [key: string]: unknown;
}

const devicePath = /^\/devices\/([^/]+)(?:\/.*)?$/;

/**
 * Serve many devices of one service over the Midscene Connect protocol.
 * Each device lives at `/devices/<id>/api`; `GET /devices` lists them.
 * Clients connect with `url: http://host:port/devices/<id>`.
 */
export function createConnectRegistry({
  token,
  list,
  device,
}: {
  token: string;
  list(): RegistryEntry[] | Promise<RegistryEntry[]>;
  /** Build the device for an id. Rebuilt when the entry name changes. */
  device(entry: RegistryEntry): ConnectDevice;
}) {
  const handlers = new Map<
    string,
    { name: string; handler: ReturnType<typeof createConnectHandler> }
  >();
  const bearer = Buffer.from(`Bearer ${token}`);

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(body));
  };

  const handlerFor = (entry: RegistryEntry) => {
    const cached = handlers.get(entry.id);
    if (cached?.name === entry.name) return cached.handler;
    const handler = createConnectHandler(device(entry), {
      token,
      basePath: `/devices/${encodeURIComponent(entry.id)}/api`,
    });
    handlers.set(entry.id, { name: entry.name, handler });
    return handler;
  };

  /** Returns false for requests outside `/devices`. */
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/devices' || path === '/devices/') {
      const supplied = Buffer.from(req.headers.authorization ?? '');
      if (
        supplied.length !== bearer.length ||
        !timingSafeEqual(supplied, bearer)
      ) {
        res.setHeader('WWW-Authenticate', 'Bearer');
        send(res, 401, {
          error: 'A valid bearer token is required',
          code: 'UNAUTHORIZED',
        });
        return true;
      }
      if (req.method !== 'GET') {
        send(res, 405, { error: 'Use GET', code: 'METHOD_NOT_ALLOWED' });
        return true;
      }
      send(res, 200, {
        devices: (await list()).map((entry) => ({
          ...entry,
          path: `/devices/${encodeURIComponent(entry.id)}`,
        })),
      });
      return true;
    }
    const match = devicePath.exec(path);
    if (!match) return false;
    const id = decodeURIComponent(match[1]);
    const entry = (await list()).find((item) => item.id === id);
    if (!entry) {
      send(res, 404, { error: `Device not found: ${id}`, code: 'NOT_FOUND' });
      return true;
    }
    if (!handlerFor(entry).handle(req, res))
      send(res, 404, { error: `No route for ${path}`, code: 'NOT_FOUND' });
    return true;
  }

  return { handle };
}
