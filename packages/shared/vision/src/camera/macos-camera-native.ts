import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const native = new URL('../../native/', import.meta.url);

export const macosCameraSwiftSource = fileURLToPath(
  new URL('macos-camera.swift', native),
);
export const macosCameraUVCHeader = fileURLToPath(
  new URL('macos-camera-uvc.h', native),
);
export const macosCameraUVCSource = fileURLToPath(
  new URL('macos-camera-uvc.m', native),
);
export const macosCameraInfoPlist = new URL('macos-camera-Info.plist', native);
export const macosCameraEntitlements = new URL(
  'macos-camera-entitlements.plist',
  native,
);

export async function macosCameraSourceHash(
  additional: ReadonlyArray<string | Buffer> = [],
) {
  const digest = createHash('sha256');
  for (const path of [
    macosCameraSwiftSource,
    macosCameraUVCHeader,
    macosCameraUVCSource,
  ]) {
    digest.update(await fs.readFile(path));
  }
  for (const value of additional) digest.update(value);
  return digest.update(process.arch).digest('hex').slice(0, 16);
}

/**
 * Swift cannot link the IOKit refcon interface directly. Compile the small
 * Objective-C UVC bridge first, then import its C header from the Swift helper.
 */
export async function compileMacosCameraExecutable(output: string) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'midscene-uvc-'));
  const object = join(directory, `${basename(output)}.o`);
  try {
    await execFileAsync(
      '/usr/bin/xcrun',
      [
        '--sdk',
        'macosx',
        'clang',
        '-O',
        '-fobjc-arc',
        '-fblocks',
        '-c',
        macosCameraUVCSource,
        '-o',
        object,
      ],
      {
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      },
    );
    await execFileAsync(
      '/usr/bin/xcrun',
      [
        '--sdk',
        'macosx',
        'swiftc',
        '-O',
        macosCameraSwiftSource,
        object,
        '-import-objc-header',
        macosCameraUVCHeader,
        '-framework',
        'IOKit',
        '-o',
        output,
      ],
      {
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      },
    );
  } finally {
    await fs.rm(object, { force: true }).catch(() => undefined);
    await fs
      .rm(directory, { recursive: true, force: true })
      .catch(() => undefined);
  }
}
