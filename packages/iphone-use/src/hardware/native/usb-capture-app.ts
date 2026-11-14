import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { openCameraApp } from '@midscene/robotics-vision/camera/macos-camera-app';
import { directory } from '../../settings.js';

const exec = promisify(execFile);
const native = new URL('../../../native/', import.meta.url);
const appName = 'Midscene iPhone Capture.app';
let building: Promise<string> | undefined;

async function resolveApp() {
  const bundled = fileURLToPath(new URL(appName, native));
  if (
    await access(bundled).then(
      () => true,
      () => false,
    )
  )
    return bundled;

  const manifest = JSON.parse(
    await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
  );
  if (!manifest.private)
    throw new Error(
      'The iPhone Use release is missing its signed capture app.',
    );

  const hash = createHash('sha256').update(process.arch);
  for (const file of [
    'usb-capture.swift',
    'USBIdentity.swift',
    'USBDiscovery.swift',
    'capture-app.plist',
    'capture-entitlements.plist',
    'build-capture-app.sh',
  ]) {
    hash.update(await readFile(new URL(file, native)));
  }
  const root = join(directory, 'native', hash.digest('hex').slice(0, 20));
  const app = join(root, appName);
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (
    await access(app).then(
      () => true,
      () => false,
    )
  )
    return app;
  const stage = await mkdtemp(join(root, 'build-'));
  try {
    const candidate = join(stage, appName);
    await exec(
      '/bin/sh',
      [
        fileURLToPath(new URL('build-capture-app.sh', native)),
        candidate,
        '-',
        process.arch === 'arm64' ? 'arm64' : 'x86_64',
      ],
      { timeout: 120_000 },
    );
    try {
      await rename(candidate, app);
    } catch (error) {
      await access(app).catch(() => {
        throw error;
      });
    }
    return app;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

function prepareUSBCaptureApp() {
  building ??= resolveApp().catch((error) => {
    building = undefined;
    throw error;
  });
  return building;
}

export async function openUSBCapture(deviceId: string, signal?: AbortSignal) {
  const app = await prepareUSBCaptureApp();
  return openCameraApp(
    app,
    ['capture', deviceId],
    signal,
    'Midscene iPhone Capture',
  );
}
