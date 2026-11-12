import sharp from 'sharp';
import type { ScreenQuad } from '../../src/camera/vision-types.js';

export const FRAME_WIDTH = 1280;
export const FRAME_HEIGHT = 720;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function quadOf(rect: Rect): ScreenQuad {
  return {
    topLeft: { x: rect.x, y: rect.y },
    topRight: { x: rect.x + rect.width, y: rect.y },
    bottomRight: { x: rect.x + rect.width, y: rect.y + rect.height },
    bottomLeft: { x: rect.x, y: rect.y + rect.height },
  };
}

/** Rotate the saved outline about the screen centre, as a tilted preset does. */
export function rotateQuad(rect: Rect, degrees: number): ScreenQuad {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotate = (x: number, y: number) => ({
    x: cx + (x - cx) * cos - (y - cy) * sin,
    y: cy + (x - cx) * sin + (y - cy) * cos,
  });
  return {
    topLeft: rotate(rect.x, rect.y),
    topRight: rotate(rect.x + rect.width, rect.y),
    bottomRight: rotate(rect.x + rect.width, rect.y + rect.height),
    bottomLeft: rotate(rect.x, rect.y + rect.height),
  };
}

/** Grow a rectangle about its centre, as a hand-drawn outline often does. */
export function expand(rect: Rect, ratio: number): Rect {
  const width = rect.width * (1 + ratio);
  const height = rect.height * (1 + ratio);
  return {
    x: rect.x - (width - rect.width) / 2,
    y: rect.y - (height - rect.height) / 2,
    width,
    height,
  };
}

function iconGrid(rect: Rect, color: string): string {
  const columns = 4;
  const rows = 5;
  const cellWidth = rect.width / columns;
  const cellHeight = rect.height / rows;
  const size = Math.min(cellWidth, cellHeight) * 0.55;
  const parts: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = rect.x + cellWidth * (column + 0.5) - size / 2;
      const y = rect.y + cellHeight * (row + 0.5) - size / 2;
      const fill = (row + column) % 3 === 0 ? '#ededed' : color;
      parts.push(
        `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.22}" fill="${fill}"/>`,
      );
    }
  }
  return parts.join('');
}

/**
 * A desk, a phone body and a lit screen. `screen` is where the glass actually
 * is; `quad` is what the preset claims. Keeping them separable is what lets a
 * test move the phone without moving the saved quadrilateral.
 */
export async function renderFrame(input: {
  screen: Rect;
  quad?: Rect;
  /** Explicit saved corners, for rotations a rect cannot express. */
  points?: ScreenQuad;
  bezel?: number;
  desk?: string;
  body?: string;
  glass?: string;
  iconColor?: string;
  icons?: boolean;
  extra?: string;
}): Promise<{
  jpeg: Buffer;
  points: ScreenQuad;
  sourceWidth: number;
  sourceHeight: number;
}> {
  const bezel = input.bezel ?? 14;
  const body: Rect = {
    x: input.screen.x - bezel,
    y: input.screen.y - bezel,
    width: input.screen.width + bezel * 2,
    height: input.screen.height + bezel * 2,
  };
  const svg = `<svg width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${input.glass ?? '#3f3f4a'}"/>
        <stop offset="1" stop-color="${input.glass ?? '#24242c'}"/>
      </linearGradient>
    </defs>
    <rect width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}" fill="${input.desk ?? '#e6e6e6'}"/>
    <rect x="${body.x}" y="${body.y}" width="${body.width}" height="${body.height}" rx="26" fill="${input.body ?? '#141416'}"/>
    <rect x="${input.screen.x}" y="${input.screen.y}" width="${input.screen.width}" height="${input.screen.height}" rx="16" fill="url(#glass)"/>
    ${input.icons === false ? '' : iconGrid(input.screen, input.iconColor ?? '#6ea8ff')}
    ${input.extra ?? ''}
  </svg>`;
  const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
  return {
    jpeg,
    points: input.points ?? quadOf(input.quad ?? input.screen),
    sourceWidth: FRAME_WIDTH,
    sourceHeight: FRAME_HEIGHT,
  };
}

export const SCREEN: Rect = { x: 340, y: 150, width: 600, height: 420 };

/** The black status bar blends into the bezel, but the page boundary is visible. */
export async function renderStatusBarFrame(rotation: 0 | 90) {
  const screen = { ...SCREEN, width: 360, height: 500 };
  const width = rotation === 0 ? screen.width : screen.height;
  const height = rotation === 0 ? screen.height : screen.width;
  const topInset = height / 20;
  const stripWidth = rotation === 0 ? screen.width : topInset;
  const stripHeight = rotation === 0 ? topInset : screen.height;
  const frame = await renderFrame({
    screen,
    icons: false,
    bezel: 6,
    glass: '#b6b6b6',
    extra: `<rect x="${screen.x}" y="${screen.y}" width="${stripWidth}" height="${stripHeight}" fill="#141416"/>`,
  });
  return {
    ...frame,
    rotation,
    pageLayout: {
      revision: 1,
      width,
      height: height - topInset,
      screen: { width, height, devicePixelRatio: 1 },
      topInset,
      markers: [],
    },
  };
}
