import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DeviceProfile } from '../protocol.js';
import { ControlSessions, type ControlledDevice } from './control-sessions.js';
import { handleDeviceDocs } from './docs.js';

export { ControlError, type ControlledDevice } from './control-sessions.js';
export { openAPI } from './openapi.js';

export function createDeviceHandler(options: {
  token: string;
  listDevices():
    | (DeviceProfile & { resourceId?: string })[]
    | Promise<(DeviceProfile & { resourceId?: string })[]>;
  readyDevice(id: string): ControlledDevice | undefined;
}) {
  if (!options.token.trim())
    throw new Error('Device API access token is required');
  const token = Buffer.from(`Bearer ${options.token}`);
  const sessions = new ControlSessions(options.readyDevice);

  function handle(req: IncomingMessage, res: ServerResponse): boolean {
    let path: string;
    try {
      path = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      return false;
    }
    if (handleDeviceDocs(req, res, path)) return true;
    if (!path.startsWith('/api/v1/')) return false;
    res.setHeader('Cache-Control', 'no-store');
    const supplied = Buffer.from(req.headers.authorization ?? '');
    const send = (status: number, body: unknown) => {
      if (res.destroyed) return;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (token.length !== supplied.length || !timingSafeEqual(token, supplied)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      send(401, { error: 'A device service access token is required' });
    } else if (path === '/api/v1/devices' && req.method === 'GET') {
      void Promise.resolve()
        .then(() => options.listDevices())
        .then((devices) =>
          send(200, {
            devices: devices.map(({ resourceId, ...device }) => ({
              ...device,
              status: sessions.busy(resourceId ?? device.id)
                ? 'busy'
                : device.status,
            })),
          }),
        )
        .catch(() => send(503, { error: 'The device backend is unavailable' }));
    } else {
      void sessions.handle(req, res, path.slice('/api/v1'.length));
    }
    return true;
  }
  return { handle, sessions, close: () => sessions.close() };
}
export { ensureDeviceToken, readDeviceToken } from './token.js';
