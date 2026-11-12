import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  correctedScreenToPointer,
  pointerToScreen,
} from '../dist/hardware/pointer/mapping.js';
import { measureAbsoluteCorrection } from '../dist/hardware/pointer/setup.js';

test('camera probes correct absolute positioning in a rotated, offset image', async () => {
  const geometry = { width: 400, height: 800, turn: 1 };
  const { width, height, turn } = geometry;
  const cameraPosition = (report) => {
    const point = pointerToScreen(report, turn);
    return { x: point.x * 0.94 + 0.04, y: point.y * 0.96 + 0.01 };
  };
  let current = { x: 0.5, y: 0.5 };
  let pending = current;
  let lag = 0;
  let sequence = 0;
  const { correction } = await measureAbsoluteCorrection(
    {
      getFrame: async () => {
        if (lag-- <= 0) current = pending;
        const x = current.x * (width - 1);
        const y = current.y * (height - 1);
        const jpeg = await sharp(
          Buffer.from(
            `<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><circle cx="${x}" cy="${y}" r="10" fill="#444"/></svg>`,
          ),
        )
          .png()
          .toBuffer();
        return { jpeg, width, height, sequence: ++sequence, receivedAt: 0 };
      },
      close: async () => {},
    },
    {
      absolute: async (report) => {
        pending = cameraPosition(report);
        lag = 2;
      },
    },
    geometry,
    new AbortController().signal,
  );
  const target = { x: 0.17, y: 0.83 };
  const actual = cameraPosition(
    correctedScreenToPointer(target, turn, correction),
  );
  assert.ok(
    Math.hypot(
      (actual.x - target.x) * (width - 1),
      (actual.y - target.y) * (height - 1),
    ) < 2,
  );
});
