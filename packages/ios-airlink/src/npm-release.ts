import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import pacote from 'pacote';
import { captureBuildFiles } from './hardware/native/usb-capture-app.js';
import { directory } from './settings.js';

const exec = promisify(execFile);
const packageName = '@midscene/ios-airlink';
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const canaryVersionPattern = /^0\.0\.0-canary-\d{14}$/;

export function releaseTag(version: string) {
  if (stableVersionPattern.test(version)) return 'latest';
  if (canaryVersionPattern.test(version)) return 'canary';
}

export async function cliVersion() {
  const { name, version } = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  if (
    name !== packageName ||
    typeof version !== 'string' ||
    !releaseTag(version)
  )
    throw new Error('The device service package has invalid metadata.');
  return version;
}

export async function latestRelease(tag: 'latest' | 'canary') {
  const { name, version, dist } = await pacote.manifest(
    `${packageName}@${tag}`,
    { preferOnline: true, fetchRetries: 1, fetchTimeout: 15_000 },
  );
  if (name !== packageName || releaseTag(version) !== tag || !dist?.integrity)
    throw new Error('The npm release has invalid metadata.');
  return { version, integrity: dist.integrity };
}

export async function stageRelease(version: string, integrity?: string) {
  const releases = join(directory, 'releases');
  await mkdir(releases, { recursive: true, mode: 0o700 });
  const staged = await mkdtemp(join(releases, `${version}-`));
  try {
    const archive = join(staged, 'release.tgz');
    await pacote.tarball.file(`${packageName}@${version}`, archive, {
      integrity,
      fetchRetries: 1,
      fetchTimeout: 120_000,
    });
    await exec(
      'npm',
      [
        'install',
        '--prefix',
        staged,
        '--omit=dev',
        '--no-audit',
        '--no-fund',
        '--no-save',
        archive,
      ],
      { cwd: staged, timeout: 5 * 60_000 },
    );
    await unlink(archive);
    const root = join(staged, 'node_modules', packageName);
    const manifest = JSON.parse(
      await readFile(join(root, 'package.json'), 'utf8'),
    );
    if (manifest.name !== packageName || manifest.version !== version)
      throw new Error(
        'The installed package does not match the requested release.',
      );
    const entry = join(root, 'dist', 'service-entry.js');
    await Promise.all([
      readFile(entry),
      readFile(join(root, 'dist', 'commands.js')),
      ...captureBuildFiles.map((file) => readFile(join(root, 'native', file))),
    ]);
    return { directory: staged, entry };
  } catch (error) {
    await rm(staged, { recursive: true, force: true });
    throw error;
  }
}
