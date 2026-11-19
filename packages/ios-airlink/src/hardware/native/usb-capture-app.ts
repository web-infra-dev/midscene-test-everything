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
const appName = 'Midscene iOS AirLink Capture.app';
export const captureBuildFiles = [
  'usb-capture.swift',
  'USBIdentity.swift',
  'USBDiscovery.swift',
  'capture-app.plist',
  'capture-entitlements.plist',
  'build-capture-app.sh',
] as const;
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

  const hash = createHash('sha256').update(process.arch);
  for (const file of captureBuildFiles) {
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
  await exec('/usr/bin/xcrun', ['--find', 'swiftc']).catch((cause) => {
    throw new Error(
      'USB capture requires Xcode Command Line Tools. Install them with xcode-select --install.',
      { cause },
    );
  });
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

export function prepareUSBCaptureApp() {
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
    'Midscene iOS AirLink Capture',
  );
}
