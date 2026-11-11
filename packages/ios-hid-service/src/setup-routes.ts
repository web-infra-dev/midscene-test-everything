import type { HostClient } from '@midscene/ios-hid';
import { connectIOSHIDHost } from '@midscene/ios-hid';
import type { DeviceConnection } from './device-connection.js';

import type { RequestHandler, Response, Router } from 'express';

export type Handler = RequestHandler;
export type Routes = Pick<Router, 'use' | 'delete' | 'get' | 'post' | 'all'>;

/** Both setup and Bluetooth use the same streaming proxy and cancellation. */
async function forwardEvents(
  upstream: globalThis.Response,
  res: Response,
  signal: AbortSignal,
) {
  if (!upstream.ok || !upstream.body)
    throw new Error('Event stream unavailable');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  for await (const chunk of upstream.body) {
    if (signal.aborted || res.destroyed) break;
    if (!res.write(chunk))
      await new Promise<void>((resolve) => {
        const done = () => {
          res.off('drain', done);
          signal.removeEventListener('abort', done);
          resolve();
        };
        res.once('drain', done);
        signal.addEventListener('abort', done, { once: true });
        if (signal.aborted) done();
      });
  }
  res.end();
}

/** The browser only talks to Playground; Host capability URLs stay on the server. */
export function mountSetupRoutes(
  app: Routes,
  manager: Pick<DeviceConnection, 'getConnectionState' | 'destroySession'>,
) {
  app.get('/ios-hid/bluetooth/events', (req, res) => {
    const cancellation = new AbortController();
    res.once('close', () => cancellation.abort());
    void (async () => {
      const host = await connectIOSHIDHost();
      const upstream = await fetch(`${host.address.url}/bluetooth/events`, {
        headers: { Authorization: `Bearer ${host.address.token}` },
        signal: cancellation.signal,
      });
      await forwardEvents(upstream, res, cancellation.signal);
    })().catch(() => {
      if (!res.destroyed) res.end();
    });
  });
  const previews = new Map<string, { host: HostClient; touched: number }>();
  // Host leases expire when frames stop; discard stale proxy entries as well.
  const prune = () => {
    for (const [id, entry] of previews)
      if (Date.now() - entry.touched > 60000) previews.delete(id);
  };
  app.post('/ios-hid/camera-preview/:cameraId', (req, res) => {
    if (req.headers['x-midscene-playground'] !== 'setup') {
      res.status(403).end();
      return;
    }
    prune();
    void (async () => {
      const host = await connectIOSHIDHost();
      const preview = await host.request<{ id: string }>(
        '/camera-previews',
        'POST',
        { cameraId: req.params.cameraId },
      );
      previews.set(preview.id, { host, touched: Date.now() });
      res.json(preview);
    })().catch((error: Error) =>
      res.status(400).json({ error: error.message }),
    );
  });
  app.all('/ios-hid/camera-preview/:id/:action', (req, res) => {
    const entry = previews.get(req.params.id);
    if (!entry) {
      res.status(410).json({ error: 'Camera preview expired' });
      return;
    }
    const close = req.params.action === 'close' && req.method === 'POST';
    if (!close && !(req.params.action === 'frame' && req.method === 'GET')) {
      res.status(404).end();
      return;
    }
    if (close && req.headers['x-midscene-playground'] !== 'setup') {
      res.status(403).end();
      return;
    }
    entry.touched = Date.now();
    void (async () => {
      if (close) {
        await entry.host.request(
          `/camera-previews/${req.params.id}/close`,
          'POST',
          {},
        );
        previews.delete(req.params.id);
        res.json({});
      } else {
        const frame = await entry.host.request<{ jpeg: string }>(
          `/camera-previews/${req.params.id}/frame`,
        );
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'no-store');
        res.send(Buffer.from(frame.jpeg, 'base64'));
      }
    })().catch((error: Error) => {
      if (!res.headersSent) res.status(400).json({ error: error.message });
    });
  });
  app.get('/ios-hid/discover/:source', (req, res) => {
    if (!['usb', 'camera', 'bluetooth'].includes(req.params.source)) {
      res.status(404).end();
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    void connectIOSHIDHost()
      .then((host) => host.request(`/discover/${req.params.source}`))
      .then((devices) => res.json(devices))
      .catch((error: Error) => res.status(400).json({ error: error.message }));
  });
  app.post('/ios-hid/cancel', (req, res) => {
    if (req.headers['x-midscene-playground'] !== 'setup') {
      res.status(403).end();
      return;
    }
    if (manager.getConnectionState()?.phase === 'ready') {
      res.status(409).json({
        error: 'Device is connected; use Disconnect in the workspace.',
      });
      return;
    }
    void manager
      .destroySession()
      .then(() => res.json({}))
      .catch((error: Error) => res.status(400).json({ error: error.message }));
  });
  app.all('/ios-hid/setup/:id/:action?', (req, res) => {
    void (async () => {
      const state = manager.getConnectionState();
      const target = state?.setupUrl ? new URL(state.setupUrl) : undefined;
      if (
        !target ||
        target.pathname.split('/').filter(Boolean).at(-1) !== req.params.id
      ) {
        res
          .status(410)
          .json({ error: 'This setup has ended. Reconnect the device.' });
        return;
      }
      const action = req.params.action ?? '';
      const allowed =
        req.method === 'GET'
          ? [
              'state',
              'devices',
              'frame',
              ...(state?.setupKind === 'device' ? ['events'] : []),
              ...(state?.setupKind === 'camera' ? [''] : []),
            ]
          : req.method === 'POST'
            ? [
                'select',
                'preview',
                'confirm',
                'cancel',
                'markers',
                'check',
                'detect',
                'verify-model',
              ]
            : [];
      if (!allowed.includes(action)) {
        res.status(404).end();
        return;
      }
      let body: string | undefined;
      if (req.method === 'POST') {
        if (req.headers['x-midscene-setup'] !== req.params.id) {
          res.status(403).end();
          return;
        }
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 65536) throw new Error('Setup request is too large');
          chunks.push(Buffer.from(chunk));
        }
        body = Buffer.concat(chunks).toString('utf8');
      }
      const cancellation = new AbortController();
      res.once('close', () => cancellation.abort());
      const response = await fetch(new URL(action, target), {
        method: req.method,
        headers:
          body === undefined
            ? undefined
            : {
                'Content-Type': 'application/json',
                'X-Midscene-Setup': req.params.id,
              },
        body,
        signal:
          action === 'events'
            ? cancellation.signal
            : AbortSignal.any([
                cancellation.signal,
                AbortSignal.timeout(
                  ['detect', 'verify-model'].includes(action) ? 150000 : 25000,
                ),
              ]),
      });
      if (action === 'events') {
        await forwardEvents(response, res, cancellation.signal);
        return;
      }
      res.status(response.status);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader(
        'Content-Type',
        response.headers.get('content-type') ?? 'application/octet-stream',
      );
      res.send(Buffer.from(await response.arrayBuffer()));
    })().catch((error: Error) => {
      if (!res.headersSent) res.status(400).json({ error: error.message });
      else res.end();
    });
  });
}
