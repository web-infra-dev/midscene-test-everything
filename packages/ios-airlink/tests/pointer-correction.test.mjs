import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  correctedScreenToPointer,
  pointerToScreen,
} from '../dist/hardware/pointer/mapping.js';
import {
  measureAbsoluteCorrection,
  measurePointerTurn,
} from '../dist/hardware/pointer/setup.js';

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
  let firstProbeFrame = 0;
  let sequence = 0;
  const { correction } = await measureAbsoluteCorrection(
    {
      getFrame: async () => {
        // The first probe moves twice before reaching its target. A duplicate
        // frame after the second move must not inherit the first move's age.
        if (firstProbeFrame === 1 || firstProbeFrame === 2) {
          if (firstProbeFrame === 2)
            await new Promise((resolve) => setTimeout(resolve, 240));
          current = { ...pending, x: pending.x + 0.03 * firstProbeFrame };
          firstProbeFrame++;
        } else if (firstProbeFrame === 3) {
          firstProbeFrame++;
          sequence--;
        } else if (lag-- <= 0) current = pending;
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
        if (firstProbeFrame === 0) {
          firstProbeFrame = 1;
        } else {
          lag = 2;
        }
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

test('orientation detection tolerates a missed low-contrast probe and stops on two unanimous votes', async () => {
  const width = 360;
  const height = 780;
  let current = { x: 0.5, y: 0.5 };
  let sequence = 0;
  let moves = 0;
  const result = await measurePointerTurn(
    {
      getFrame: async () => {
        // Simulate probe #1 landing on an invisible dark region (no cursor rendered).
        const invisible = moves === 1;
        const cx = current.x * (width - 1);
        const cy = current.y * (height - 1);
        const jpeg = await sharp(
          Buffer.from(
            `<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/>${invisible ? '' : `<circle cx="${cx}" cy="${cy}" r="11" fill="#333"/>`}</svg>`,
          ),
        )
          .jpeg({ quality: 95 })
          .toBuffer();
        return { jpeg, width, height, sequence: ++sequence, receivedAt: 0 };
      },
      close: async () => {},
    },
    {
      absolute: async (report) => {
        moves++;
        current = pointerToScreen(report, 0);
      },
    },
    new AbortController().signal,
  );
  assert.equal(result.turn, 0);
  assert.equal(moves, 3, 'stops once two probes agree after one miss');
});

async function noisyCameraCorrection(ambiguous = false) {
  const geometry = { width: 390, height: 844, turn: 0 };
  let position = { x: 0.5, y: 0.5 };
  let sequence = 0;
  let probeFrames = 0;
  return measureAbsoluteCorrection(
    {
      getFrame: async () => {
        // Replay the first corner using only approximate observed positions and sizes.
        // Real captures intermittently contained 4–11 pixel changes near the cursor.
        const noisy =
          position.x === 0.25 && position.y === 0.25 && ++probeFrames % 2 === 1;
        const jpeg = await sharp(
          Buffer.from(
            `<svg width="390" height="844"><rect width="100%" height="100%" fill="white"/>
          <circle cx="${position.x * 389}" cy="${position.y * 843}" r="10" fill="#333"/>
          ${ambiguous && position.x === 0.25 ? '<circle cx="124" cy="224" r="9" fill="#333"/>' : ''}
          ${noisy ? '<rect x="123" y="223" width="3" height="3" fill="#666"/><rect x="80" y="250" width="3" height="3" fill="#666"/>' : ''}
          </svg>`,
          ),
        )
          .png()
          .toBuffer();
        return {
          ...geometry,
          jpeg,
          sequence: ++sequence,
          receivedAt: Date.now(),
        };
      },
    },
    {
      absolute: async (report) => {
        position = pointerToScreen(report, 0);
      },
    },
    geometry,
    new AbortController().signal,
  );
}

test('camera correction rejects two cursor-sized candidates at a corner', async () => {
  await assert.rejects(
    noisyCameraCorrection(true),
    /Could not measure camera pointer position/,
  );
});

test('camera correction can locate a stationary cursor among intermittent small changes', async () => {
  const { correction } = await noisyCameraCorrection();
  const target = { x: 0.43, y: 0.57 };
  const mapped = correctedScreenToPointer(target, 0, correction);
  assert.ok(
    Math.hypot((mapped.x - target.x) * 389, (mapped.y - target.y) * 843) < 3,
  );
});
