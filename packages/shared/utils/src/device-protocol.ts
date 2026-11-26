/**
 * Internal input model shared by the hardware services, plus the adapter that
 * exposes it as `@midscene/connect` primitives.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type Point = { x: number; y: number };

export type InputAction =
  | { type: 'home' }
  | { type: 'back' }
  | { type: 'clearInput' }
  | { type: 'tap'; point: Point }
  | { type: 'doubleTap'; point: Point }
  | { type: 'longPress'; point: Point; durationMs?: number }
  | { type: 'dragAndDrop'; from: Point; to: Point; durationMs?: number }
  | { type: 'swipe'; from: Point; to: Point; durationMs?: number }
  | {
      type: 'scroll';
      direction: 'up' | 'down';
      steps?: number;
      point?: Point;
    }
  | { type: 'typeText'; text: string; replace?: boolean }
  | { type: 'key'; key: string };

export type InputActionType = InputAction['type'];

export interface ScreenFrame {
  jpeg: Buffer;
  width: number;
  height: number;
  sequence: number;
  receivedAt: number;
}

export type PreviewReader = {
  getFrame(): Promise<Pick<ScreenFrame, 'jpeg' | 'sequence'> | undefined>;
  close(): Promise<void>;
};

type ConnectPrimitive = (...args: any[]) => Promise<void>;

const point = (p: Point): Point => ({ x: p.x, y: p.y });

/**
 * Map an `InputAction` executor onto `@midscene/connect` primitive names.
 * Only primitives backed by a supported action type are returned.
 */
export function connectPrimitives(
  execute: (action: InputAction) => Promise<void>,
  supported: readonly InputActionType[],
): Record<string, ConnectPrimitive> {
  const has = (type: InputActionType) => supported.includes(type);
  const actions: Record<string, ConnectPrimitive> = {};
  if (has('tap'))
    actions.tap = (p: Point) => execute({ type: 'tap', point: point(p) });
  if (has('tap') && has('doubleTap'))
    actions.doubleClick = (p: Point) =>
      execute({ type: 'doubleTap', point: point(p) });
  if (has('tap') && has('longPress'))
    actions.longPress = (p: Point, opts?: { duration?: number }) =>
      execute({
        type: 'longPress',
        point: point(p),
        durationMs: opts?.duration,
      });
  if (has('tap') && has('dragAndDrop'))
    actions.dragAndDrop = (from: Point, to: Point) =>
      execute({ type: 'dragAndDrop', from: point(from), to: point(to) });
  if (has('swipe'))
    actions.swipe = (from: Point, to: Point, opts?: { duration?: number }) =>
      execute({
        type: 'swipe',
        from: point(from),
        to: point(to),
        durationMs: opts?.duration,
      });
  if (has('scroll'))
    actions.scroll = (param: {
      direction?: string;
      scrollType?: string;
      distance?: number;
      locate?: { center: [number, number] };
    }) => {
      const direction = param.direction ?? 'down';
      if (direction !== 'up' && direction !== 'down')
        throw new Error('Only vertical scrolling is supported');
      if (param.scrollType && param.scrollType !== 'singleAction')
        throw new Error('Only single scroll actions are supported');
      const center = param.locate?.center;
      return execute({
        type: 'scroll',
        direction,
        steps:
          param.distance == null
            ? undefined
            : Math.min(24, Math.max(1, Math.round(param.distance / 80))),
        point: center ? { x: center[0], y: center[1] } : undefined,
      });
    };
  if (has('typeText') && has('key') && has('clearInput')) {
    actions.typeText = (text: string, opts?: { replace?: boolean }) =>
      execute({ type: 'typeText', text, replace: opts?.replace });
    actions.keyboardPress = (key: string) => execute({ type: 'key', key });
    actions.clearInput = () => execute({ type: 'clearInput' });
  }
  if (has('home')) actions.homeButton = () => execute({ type: 'home' });
  if (has('back')) actions.backButton = () => execute({ type: 'back' });
  return actions;
}

export async function readDeviceToken(path: string) {
  const token = (await readFile(path, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new Error('Invalid device service access token');
  return token;
}

export async function ensureDeviceToken(path: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, randomBytes(32).toString('hex'), {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  return readDeviceToken(path);
}
