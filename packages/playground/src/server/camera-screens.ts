import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CameraSessionManager } from '@midscene/arm-kit';
import type { PerspectiveTarget } from '@midscene/arm-kit-shared/camera/vision-types';
import type { CameraCorrection } from '@midscene/arm-kit-shared/contracts';

/** The first screen keeps the existing camera-level perspective correction. */
export const BASE_SCREEN_ID = 'base';
export const MAX_CAMERA_SCREENS = 8;

export interface CameraScreenInfo {
  id: string;
  name: string;
  base: boolean;
  hasCorrection: boolean;
  correction?: CameraCorrection;
  perspectiveTarget?: PerspectiveTarget;
}

interface ScreenRecord {
  id: string;
  name: string;
}

interface ScreenManifest {
  cameraId: string;
  screens: ScreenRecord[];
}

const screenQueues = new Map<string, Promise<unknown>>();

function serialize<T>(
  cameraId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = screenQueues.get(cameraId) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(operation);
  screenQueues.set(cameraId, pending);
  void pending
    .finally(() => {
      if (screenQueues.get(cameraId) === pending) screenQueues.delete(cameraId);
    })
    .catch(() => undefined);
  return pending;
}

function manifestFile(cameras: CameraSessionManager, cameraId: string) {
  return path.join(
    cameras.dataDirectory,
    'screens',
    `${createHash('sha256').update(cameraId).digest('hex')}.json`,
  );
}

function cleanName(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  return name && name.length <= 60 ? name : undefined;
}

function nextName(records: readonly ScreenRecord[]) {
  const used = new Set([
    'screen 1',
    ...records.map((record) => record.name.toLocaleLowerCase('en-US')),
  ]);
  for (let index = 2; ; index += 1) {
    const name = `Screen ${index}`;
    if (!used.has(name.toLocaleLowerCase('en-US'))) return name;
  }
}

async function readManifest(
  cameras: CameraSessionManager,
  cameraId: string,
): Promise<ScreenManifest> {
  let raw: string;
  try {
    raw = await readFile(manifestFile(cameras, cameraId), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { cameraId, screens: [] };
    throw error;
  }
  const value = JSON.parse(raw) as Partial<ScreenManifest>;
  if (value.cameraId !== cameraId || !Array.isArray(value.screens))
    throw new Error('Stored camera screens do not match this camera');
  return {
    cameraId,
    screens: value.screens.flatMap((screen) => {
      if (
        !screen ||
        typeof screen.id !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(screen.id) ||
        typeof screen.name !== 'string' ||
        !screen.name.trim() ||
        screen.name.length > 60
      )
        return [];
      return [{ id: screen.id, name: screen.name.trim() }];
    }),
  };
}

async function writeManifest(
  cameras: CameraSessionManager,
  manifest: ScreenManifest,
) {
  const file = manifestFile(cameras, manifest.cameraId);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(manifest), { mode: 0o600 });
  await rename(temporary, file);
}

async function screenInfo(
  cameras: CameraSessionManager,
  cameraId: string,
  record: ScreenRecord,
): Promise<CameraScreenInfo> {
  const stored = await cameras.persistedPerspective(cameraId, record.id);
  return {
    id: record.id,
    name: record.name,
    base: false,
    hasCorrection: Boolean(stored?.correction),
    ...(stored?.correction ? { correction: stored.correction } : {}),
    ...(stored?.target ? { perspectiveTarget: stored.target } : {}),
  };
}

export async function listCameraScreens(
  cameras: CameraSessionManager,
  cameraId: string,
): Promise<CameraScreenInfo[]> {
  const [manifest, base] = await Promise.all([
    readManifest(cameras, cameraId),
    cameras.persistedPerspective(cameraId),
  ]);
  const extras = await Promise.all(
    manifest.screens.map((record) => screenInfo(cameras, cameraId, record)),
  );
  return [
    {
      id: BASE_SCREEN_ID,
      name: 'Screen 1',
      base: true,
      hasCorrection: Boolean(base?.correction),
      ...(base?.correction ? { correction: base.correction } : {}),
      ...(base?.target ? { perspectiveTarget: base.target } : {}),
    },
    ...extras,
  ];
}

export async function addCameraScreen(
  cameras: CameraSessionManager,
  cameraId: string,
  name?: unknown,
): Promise<CameraScreenInfo> {
  return serialize(cameraId, async () => {
    const manifest = await readManifest(cameras, cameraId);
    if (manifest.screens.length + 1 >= MAX_CAMERA_SCREENS)
      throw Object.assign(
        new Error(`A camera supports at most ${MAX_CAMERA_SCREENS} screens`),
        { status: 409 },
      );
    const record: ScreenRecord = {
      id: randomUUID(),
      name: cleanName(name) ?? nextName(manifest.screens),
    };
    manifest.screens.push(record);
    await writeManifest(cameras, manifest);
    return screenInfo(cameras, cameraId, record);
  });
}

export async function removeCameraScreen(
  cameras: CameraSessionManager,
  cameraId: string,
  screenId: string,
): Promise<void> {
  if (screenId === BASE_SCREEN_ID)
    throw Object.assign(new Error('The base screen cannot be deleted'), {
      status: 400,
    });
  await serialize(cameraId, async () => {
    const manifest = await readManifest(cameras, cameraId);
    if (!manifest.screens.some((screen) => screen.id === screenId))
      throw Object.assign(new Error('Screen not found'), { status: 404 });
    manifest.screens = manifest.screens.filter(
      (screen) => screen.id !== screenId,
    );
    await writeManifest(cameras, manifest);
    await cameras.clearPerspective(cameraId, screenId);
  });
}

/** Reject marker sessions for a screen id that is not part of this camera. */
export async function assertCameraScreen(
  cameras: CameraSessionManager,
  cameraId: string,
  screenId?: string,
): Promise<void> {
  if (!screenId || screenId === BASE_SCREEN_ID) return;
  const manifest = await readManifest(cameras, cameraId);
  if (!manifest.screens.some((screen) => screen.id === screenId))
    throw Object.assign(new Error('Screen not found'), { status: 404 });
}
