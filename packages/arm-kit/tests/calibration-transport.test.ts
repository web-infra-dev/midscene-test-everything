import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it, rstest } from '@rstest/core';
import { WebSocket } from 'ws';
import { calibrationPageMarkers } from '../src/assisted-contracts.js';
import { CalibrationHost } from '../src/calibration-server/host.js';
import type { CameraSession } from '../src/camera/session.js';
import { ArmController } from '../src/controller.js';
import { fixture } from './fixtures.js';

it('streams the initial snapshot, page handoff and disconnect over the real transports', async () => {
  const f = await fixture();
  await f.runtime.shutdown();
  const arm = new ArmController({ adapter: f.adapter, profileStore: f.store });
  const host = new CalibrationHost({
    arm,
    camera: { getPerspectiveValidity: () => undefined } as CameraSession,
    deviceId: 'cam',
  });
  const server = createServer((req, res) => void host.handle(req, res));
  server.on('upgrade', (req, socket, head) =>
    host.phoneSocket.upgrade(req, socket, head),
  );
  const stop = new AbortController();
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = `127.0.0.1:${(server.address() as AddressInfo).port}`;
    const events = async () => {
      const response = await fetch(
        `http://${address}/api/calibration/assisted-calibration/events`,
        { signal: stop.signal },
      );
      expect(response.headers.get('content-type')).toBe('text/event-stream');
      return response.body!.getReader();
    };
    const update = (pageId: string) =>
      JSON.stringify({
        pageId,
        sequence: 1,
        platform: 'android',
        displayMode: 'fullscreen',
        visible: true,
        layout: {
          revision: 1,
          width: 400,
          height: 800,
          screen: { width: 400, height: 800, devicePixelRatio: 1 },
          markers: calibrationPageMarkers(400, 800),
        },
      });
    const open = async () => {
      const socket = new WebSocket(`ws://${address}/phone-calibration/session`);
      await once(socket, 'open');
      return socket;
    };
    const snapshot = async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
    ) => {
      const { value } = await reader.read();
      return JSON.parse(
        new TextDecoder().decode(value).trim().slice('data: '.length),
      );
    };
    const paused = await fetch(
      `http://${address}/api/calibration/camera/validity`,
    );
    expect(paused.status).toBe(200);
    expect(await paused.json()).toEqual({
      skipped: 'reference-page-unavailable',
    });
    const reader = await events();
    expect((await snapshot(reader)).phone.state).toBe('waiting');
    const first = await open();
    const oldPage = host.service.openPhonePage();
    first.send(update(oldPage));
    expect(JSON.parse(String((await once(first, 'message'))[0])).view).toBe(
      'markers',
    );
    expect((await snapshot(reader)).phone.state).toBe('connected');
    const request = host.service.requestMarkerDisplay();
    expect(
      JSON.parse(String((await once(first, 'message'))[0])).markerRequest,
    ).toBe(request);
    const report = JSON.parse(update(oldPage));
    first.send(
      JSON.stringify({
        ...report,
        sequence: 2,
        markersPainted: true,
        markerRequest: 'previous',
      }),
    );
    await rstest.waitFor(() =>
      expect(host.service.phoneStatus().diagnostics?.updateSequence).toBe(2),
    );
    expect(host.service.markerObservation(request)).toBeUndefined();
    first.send(
      JSON.stringify({
        ...report,
        sequence: 3,
        markersPainted: true,
        markerRequest: request,
      }),
    );
    await rstest.waitFor(() =>
      expect(host.service.markerObservation(request)?.pageId).toBe(oldPage),
    );
    for (const [index, mode] of [
      { platform: 'android', displayMode: 'browser' },
      { platform: 'harmonyos', displayMode: 'standalone' },
      { platform: 'ios', displayMode: 'fullscreen' },
      { platform: 'ios', displayMode: 'standalone' },
    ].entries()) {
      const sequence = 4 + index;
      first.send(
        JSON.stringify({
          ...report,
          sequence,
          ...mode,
          markersPainted: true,
          markerRequest: request,
        }),
      );
      await rstest.waitFor(() =>
        expect(host.service.phoneStatus().diagnostics?.updateSequence).toBe(
          sequence,
        ),
      );
      const eligible =
        mode.platform === 'ios' && mode.displayMode === 'standalone';
      expect(host.service.setup().phoneConnected).toBe(eligible);
      expect(Boolean(host.service.markerObservation(request))).toBe(eligible);
      expect(host.service.phoneStatus().state).toBe('connected');
    }
    host.service.finishMarkerDisplay(request, true);
    expect(JSON.parse(String((await once(first, 'message'))[0])).view).toBe(
      'touch-preview',
    );
    const resumed = await events();
    expect((await snapshot(resumed)).phone.state).toBe('connected');
    const next = await open();
    const retired = once(first, 'close');
    next.send(update(host.service.openPhonePage()));
    expect((await retired)[0]).toBe(4410);
    const stale = await open();
    stale.send(update(oldPage));
    expect((await once(stale, 'close'))[0]).toBe(4410);
    next.send('ping');
    expect(String((await once(next, 'message'))[0])).toBe('pong');
    next.terminate();
    // Page handoff also publishes a connected snapshot. Consume queued events
    // until the transport reports the subsequent disconnect.
    await rstest.waitFor(async () =>
      expect((await snapshot(reader)).phone.state).toBe('reconnecting'),
    );
  } finally {
    stop.abort();
    await host.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await arm.close();
    await f.cleanup();
  }
});
