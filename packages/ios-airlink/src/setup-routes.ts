import type { ServerResponse } from 'node:http';

import { listCameras } from '@midscene/robotics-vision';
import type { Router } from 'express';
import type { DeviceConnection } from './device-connection.js';
import { CameraPreviews } from './hardware/runtime/camera-previews.js';
import type { IPhoneRuntime } from './hardware/runtime/runtime.js';
import { listUSBDevices } from './hardware/screen/usb.js';

export function mountSetupRoutes(
  app: Router,
  manager: DeviceConnection,
  runtime: IPhoneRuntime,
) {
  const streams = new Set<ServerResponse>();
  const previews = new CameraPreviews(runtime.cameras);
  const previewTimer = setInterval(() => void previews.sweep(), 5000);
  previewTimer.unref();
  app.get('/ios-airlink/bluetooth/events', (_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    streams.add(res);
    const unsubscribe = runtime.input.subscribe((status) => {
      if (
        !res.destroyed &&
        !res.writableEnded &&
        !res.write(`data: ${JSON.stringify(status)}\n\n`)
      )
        res.end();
    });
    const heartbeat = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write(': heartbeat\n\n');
    }, 15000);
    res.once('close', () => {
      unsubscribe();
      clearInterval(heartbeat);
      streams.delete(res);
    });
  });
  app.post('/ios-airlink/camera-preview/:cameraId', (req, res) => {
    if (req.headers['x-midscene-playground'] !== 'setup') {
      res.status(403).end();
      return;
    }
    void previews
      .open(req.params.cameraId)
      .then((preview) => res.json(preview))
      .catch((error: Error) => res.status(400).json({ error: error.message }));
  });
  app.get('/ios-airlink/camera-preview/:id/frame', (req, res) => {
    void previews
      .frame(req.params.id)
      .then((frame) => {
        res.set('Cache-Control', 'no-store').type('jpeg').send(frame.jpeg);
      })
      .catch((error: Error) => res.status(400).json({ error: error.message }));
  });
  app.post('/ios-airlink/camera-preview/:id/close', (req, res) => {
    if (req.headers['x-midscene-playground'] !== 'setup') {
      res.status(403).end();
      return;
    }
    void previews
      .release(req.params.id)
      .then(() => res.json({}))
      .catch((error: Error) => res.status(400).json({ error: error.message }));
  });
  const discover = {
    usb: listUSBDevices,
    camera: () => listCameras({ includeBuiltIn: true }),
    bluetooth: () => runtime.input.status(),
  };
  app.get('/ios-airlink/discover/:source', (req, res) => {
    const source = req.params.source as keyof typeof discover;
    if (!Object.hasOwn(discover, source)) {
      res.status(404).end();
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    void discover[source]()
      .then((devices) => res.json(devices))
      .catch((error: Error) => res.status(400).json({ error: error.message }));
  });
  app.post('/ios-airlink/cancel', (req, res) => {
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
  app.all('/ios-airlink/setup/:id/:action?', (req, res) => {
    const state = manager.getConnectionState();
    if (state?.setupId !== req.params.id) {
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
            ...(state.setupKind === 'device' ? ['events'] : []),
            ...(state.setupKind === 'camera' ? [''] : []),
          ]
        : req.method === 'POST'
          ? ['select', 'preview', 'confirm', 'cancel', 'markers', 'check']
          : [];
    if (!allowed.includes(action)) {
      res.status(404).end();
      return;
    }
    void manager
      .handleSetup(req.params.id, req, res, `/${action}`)
      .catch((error: Error) => {
        if (res.destroyed) return;
        if (!res.headersSent) res.status(400).json({ error: error.message });
        else res.end();
      });
  });
  return async () => {
    clearInterval(previewTimer);
    for (const stream of streams) stream.end();
    streams.clear();
    await previews.close();
  };
}
