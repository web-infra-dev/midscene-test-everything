import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { afterAll, afterEach, test } from '@rstest/core';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { streamCameraPreview } from '../src/server/camera-preview';
import { type CameraEntry, useCameras } from '../src/ui/cameras';
import { CameraRail } from '../src/ui/components/CameraRail';
import { CameraStagePreview } from '../src/ui/components/CameraStagePreview';

const globals = globalThis as typeof globalThis & { React?: typeof React };
const previousReact = globals.React;
globals.React = React;
const originalFetch = globalThis.fetch;
afterAll(() => {
  globals.React = previousReact;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  useCameras.setState(useCameras.getInitialState());
});

const camera: CameraEntry = {
  id: 'usb/camera',
  name: 'USB Camera',
  stream: { state: 'running', width: 1920, height: 1080, hasFrame: true },
};

test('thumbnail uses the running camera preview and stops showing it when stopped', () => {
  const render = (entry: CameraEntry, selectedId = 'other') =>
    renderToStaticMarkup(
      React.createElement(CameraRail, {
        entries: [entry],
        selectedId,
        onSelect: () => {},
      }),
    );
  const running = render(camera);
  // Standalone preview requires an explicit raw view before robot connection.
  assert.ok(
    running.includes('/api/cameras/preview?id=usb%2Fcamera&amp;view=raw'),
  );
  assert.ok(running.includes('运行中'));
  assert.ok(!running.includes('未启动'));
  // The stage owns the selected camera's stream; the rail must not open a
  // second one.
  const selected = render(camera, camera.id);
  assert.ok(!selected.includes('/api/cameras/preview'));
  assert.ok(selected.includes('运行中'));
  const stopped = render({ ...camera, stream: undefined });
  assert.ok(!stopped.includes('<img'));
  assert.ok(stopped.includes('未启动'));
});

test('keeps a legacy camera response distinct from a detached or matching installation', async () => {
  for (const [payload, expected] of [
    [{ deviceSession: 'connected-1' }, 'connected-1'],
    [{}, undefined],
    [{ deviceSession: null }, null],
    [{ deviceSession: 'connected-2' }, 'connected-2'],
  ] as const) {
    globalThis.fetch = async () =>
      Response.json({ cameras: [camera], ...payload });
    await useCameras.getState().refresh(false);
    assert.equal(useCameras.getState().deviceSession, expected);
    assert.equal(useCameras.getState().selectedId, camera.id);
  }
});
test('a failed list refresh preserves the selected stream and reports the error', async () => {
  useCameras.setState({
    cameras: [camera],
    selectedId: camera.id,
    status: 'ready',
  });
  globalThis.fetch = async () => {
    assert.equal(useCameras.getState().status, 'loading');
    assert.equal(useCameras.getState().cameras[0], camera);
    throw new Error('Refresh failed');
  };
  await useCameras.getState().refresh();
  assert.equal(useCameras.getState().selectedId, camera.id);
  assert.equal(useCameras.getState().cameras[0], camera);
  assert.equal(useCameras.getState().error, 'Refresh failed');

  globalThis.fetch = async () => new Response(JSON.stringify({ cameras: [] }));
  await useCameras.getState().refresh();
  assert.equal(useCameras.getState().selectedId, null);
  assert.deepEqual(useCameras.getState().cameras, []);
  assert.equal(useCameras.getState().error, undefined);
});

test('preserves the rotated screen corner order and label', () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      CameraStagePreview,
      {
        outlines: [
          {
            id: 'rotated',
            name: 'Screen 1',
            correction: {
              sourceWidth: 1000,
              sourceHeight: 800,
              rotation: 0,
              points: {
                topLeft: { x: 700, y: 100 },
                topRight: { x: 700, y: 400 },
                bottomRight: { x: 300, y: 400 },
                bottomLeft: { x: 300, y: 100 },
              },
            },
          },
        ],
      },
      React.createElement('img', { src: 'preview.jpg', alt: '' }),
    ),
  );
  assert.ok(markup.includes('points="700,100 700,400 300,400 300,100"'));
  assert.ok(markup.includes('aria-label="Screen 1"'));
});

test('a raw preview labels every calibrated screen outline', () => {
  const correction = {
    sourceWidth: 1000,
    sourceHeight: 800,
    rotation: 0 as const,
    points: {
      topLeft: { x: 100, y: 100 },
      topRight: { x: 400, y: 100 },
      bottomRight: { x: 400, y: 500 },
      bottomLeft: { x: 100, y: 500 },
    },
  };
  const markup = renderToStaticMarkup(
    React.createElement(
      CameraStagePreview,
      {
        outlines: [
          {
            id: 'base',
            name: 'Screen 1',
            correction,
            active: true,
          },
          {
            id: 'screen-2',
            name: 'Screen 2',
            correction: {
              ...correction,
              points: Object.fromEntries(
                Object.entries(correction.points).map(([key, point]) => [
                  key,
                  { x: point.x + 400, y: point.y },
                ]),
              ) as typeof correction.points,
            },
          },
        ],
      },
      React.createElement('img', { src: 'preview.jpg', alt: '' }),
    ),
  );
  assert.ok(markup.includes('Screen 1'));
  assert.ok(markup.includes('Screen 2'));
  assert.equal((markup.match(/<polygon/g) ?? []).length, 2);
});

test('a corrected preview is framed by the saved target instead of the camera frame', () => {
  const render = (frameSize?: { width: number; height: number }) =>
    renderToStaticMarkup(
      React.createElement(
        CameraStagePreview,
        { frameSize },
        React.createElement('img', { src: 'preview.jpg', alt: '' }),
      ),
    );
  const corrected = render({ width: 1080, height: 2400 });
  assert.ok(corrected.includes('camera-stage-preview is-framed'));
  assert.ok(corrected.includes('--rv-preview-aspect:0.45'));
  const raw = render();
  assert.ok(!raw.includes('is-framed'));
  assert.ok(!raw.includes('--rv-preview-aspect'));
});

test('a connected corrected preview follows the camera frame rate', async () => {
  const stream = new EventEmitter();
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    frames: 0,
    writeHead() {},
    write(chunk: Buffer) {
      if (chunk.toString('latin1').includes('Content-Type: image/jpeg'))
        this.frames += 1;
      return true;
    },
    end() {
      this.writableEnded = true;
    },
    destroy() {
      this.destroyed = true;
      this.emit('close');
    },
  });
  await streamCameraPreview(
    response as never,
    {
      camera: {
        stream,
        camera: { id: 'camera' },
        getRectifiedPreviewTarget: () => ({
          width: 100,
          height: 100,
          rotation: 0,
        }),
        rectifiedFrame: async () => Buffer.from('jpeg'),
      },
    } as never,
    true,
    'client',
    'test',
  );
  for (let index = 0; index < 15; index += 1) {
    stream.emit('frame', {
      jpeg: Buffer.from('frame'),
      id: index,
      capturedAt: Date.now(),
    });
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  response.emit('close');
  assert.ok(
    response.frames >= 10,
    `Expected an unthrottled corrected preview, received ${response.frames} frames`,
  );
});
