import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, createReadStream, createWriteStream } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';

import { promisify, styleText } from 'node:util';
import { z } from 'zod';
import { activateRelease, installedVersion } from './launch-agent.js';
import { directory } from './settings.js';

const exec = promisify(execFile);
const packageName = '@midscene/ios-hid-service';
const releaseRoot =
  'https://github.com/web-infra-dev/midscene-robotics/releases/latest/download';
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const releaseManifest = z.object({
  version: z.string().regex(versionPattern),
  platform: z.literal('darwin'),
  arch: z.enum(['arm64', 'x64']),
  url: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

function httpsURL(value: string, base?: URL) {
  const url = new URL(value, base);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Update URLs must use HTTPS without embedded credentials.');
  return url;
}

async function download(url: URL, signal: AbortSignal): Promise<Response> {
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetch(url, { signal, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location)
        throw new Error('Update download redirected without a location.');
      url = httpsURL(location, url);
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`Update download failed (HTTP ${response.status}).`);
    }
    return response;
  }
  throw new Error('Too many redirects while downloading the update.');
}

function isNewer(candidate: string, installed: string) {
  const next = candidate.split('.').map(BigInt);
  const current = installed.split('.').map(BigInt);
  for (let index = 0; index < next.length; index++) {
    if (next[index] !== current[index]) return next[index] > current[index];
  }
  return false;
}

async function verifyArchive(file: string, sha256: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== sha256)
    throw new Error('The release checksum does not match. Retry the download.');
}

export async function update(options: { check?: boolean; manifest?: string }) {
  const current = await installedVersion();
  const manifestURL = httpsURL(
    options.manifest ?? `${releaseRoot}/ios-hid-service-${process.arch}.json`,
  );
  console.log('  › Checking published releases');
  const response = await download(manifestURL, AbortSignal.timeout(15_000));
  const release = releaseManifest.parse(await response.json());
  if (release.arch !== process.arch)
    throw new Error(
      `This release is for ${release.arch}. This Node executable uses ${process.arch}.`,
    );
  const archiveURL = httpsURL(
    release.url,
    new URL(response.url || manifestURL),
  );
  const installed = current.running ?? current.installed;
  console.log(`  Running    ${current.running ?? 'unavailable'}`);
  console.log(`  Installed  ${current.installed ?? 'unknown'}`);
  console.log(`  Available  ${release.version}`);
  if (!installed || !versionPattern.test(installed))
    throw new Error('Cannot determine the installed version.');
  if (!isNewer(release.version, installed)) {
    console.log('✓ No newer release is available.');
    return;
  }
  if (options.check) return;

  const releases = join(directory, 'releases');
  const log = join(directory, 'update.log');
  const lock = join(directory, 'update.lock');
  await mkdir(releases, { recursive: true, mode: 0o700 });
  try {
    await writeFile(lock, `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new Error(
      `An update lock exists at ${lock}. If the recorded process is gone, remove the stale lock and retry.`,
    );
  }

  const report = (message: string) => {
    const prefix =
      process.stdout.isTTY && process.env.NO_COLOR === undefined
        ? styleText('cyan', '›')
        : '›';
    console.log(`  ${prefix} ${message}`);
    try {
      appendFileSync(log, `${new Date().toISOString()}  ${message}\n`, {
        mode: 0o600,
      });
    } catch {
      console.warn(`  Could not append to ${log}`);
    }
  };

  let staged: string | undefined;
  try {
    // A second update may have completed while this process fetched the manifest.
    const active = await installedVersion();
    if (
      active.installed !== current.installed ||
      active.running !== current.running
    )
      throw new Error('The installed version changed. Run update again.');
    console.log(`  Log        ${log}`);
    staged = await mkdtemp(join(releases, `${release.version}-`));
    const archive = join(staged, 'release.tar.gz');
    report(`Downloading version ${release.version}`);
    const signal = AbortSignal.timeout(5 * 60_000);
    const bundle = await download(archiveURL, signal);
    const total = Number(bundle.headers.get('content-length'));
    let received = 0;
    let nextProgress = 25;
    const progress = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        const percent =
          total > 0 ? Math.min(100, Math.floor((received * 100) / total)) : 0;
        if (percent >= nextProgress) {
          report(`Download ${percent}%`);
          nextProgress = (Math.floor(percent / 25) + 1) * 25;
        }
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(bundle.body as unknown as ReadableStream),
      progress,
      createWriteStream(archive, { flags: 'wx', mode: 0o600 }),
      { signal },
    );

    report('Verifying checksum and unpacking');
    await verifyArchive(archive, release.sha256);
    await exec('/usr/bin/tar', ['-xzf', archive, '-C', staged], {
      timeout: 120_000,
    });
    await unlink(archive);
    const manifest = JSON.parse(
      await readFile(join(staged, 'package.json'), 'utf8'),
    );
    if (manifest.name !== packageName || manifest.version !== release.version)
      throw new Error(
        'The unpacked package does not match the release manifest.',
      );
    const entry = join(staged, 'dist', 'service-entry.js');
    await readFile(entry);
    const port = await activateRelease(entry, release.version, report);
    report(
      `Updated to ${release.version}. Device manager: http://localhost:${port}/`,
    );
  } catch (error) {
    report(error instanceof Error ? error.message : String(error));
    // Keep the new tree and its backup if rollback needs manual intervention.
    if (staged && !(error instanceof AggregateError))
      await rm(staged, { recursive: true, force: true });
    throw error;
  } finally {
    await unlink(lock);
  }
}
