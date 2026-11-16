import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [version, output] = process.argv.slice(2);
if (
  process.platform !== 'darwin' ||
  !['arm64', 'x64'].includes(process.arch) ||
  !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? '') ||
  !output
) {
  throw new Error(
    'On macOS, run pnpm ios-airlink:release <major.minor.patch> <output-dir>',
  );
}

const identity = process.env.IOS_AIRLINK_CAPTURE_SIGNING_IDENTITY?.trim();
if (!identity || identity === '-') {
  throw new Error(
    'Set IOS_AIRLINK_CAPTURE_SIGNING_IDENTITY to a Developer ID Application signing identity.',
  );
}

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const destination = resolve(output);
const stage = await mkdtemp(join(tmpdir(), 'ios-airlink-release-'));
const arch = process.arch;
const archiveName = `ios-airlink-${version}-darwin-${arch}.tar.gz`;
const archive = join(destination, archiveName);

try {
  execFileSync(
    'pnpm',
    [
      '--filter',
      '@midscene/ios-airlink',
      'deploy',
      '--prod',
      join(stage, 'service'),
    ],
    {
      cwd: repository,
      stdio: 'inherit',
      env: { ...process.env, npm_config_ignore_scripts: 'true' },
    },
  );
  const service = join(stage, 'service');
  execFileSync(
    '/bin/sh',
    [
      join(service, 'native/build-capture-app.sh'),
      join(service, 'native/Midscene iOS AirLink Capture.app'),
      identity,
      'universal',
    ],
    { stdio: 'inherit' },
  );
  const packageFile = join(service, 'package.json');
  const manifest = JSON.parse(await readFile(packageFile, 'utf8'));
  manifest.version = version;
  await writeFile(packageFile, `${JSON.stringify(manifest, null, 2)}\n`);
  // Verify the release has its built UI, helpers, and loadable Node dependencies.
  await Promise.all([
    readFile(join(service, 'dist/ui/index.html')),
    readFile(join(service, 'native/hid.m')),
  ]);
  execFileSync(process.execPath, ['dist/commands.js', '--help'], {
    cwd: service,
    stdio: 'inherit',
  });
  execFileSync(
    process.execPath,
    ['--input-type=module', '-e', "await import('./dist/server.js')"],
    {
      cwd: service,
      stdio: 'inherit',
    },
  );
  await mkdir(destination, { recursive: true });
  execFileSync('/usr/bin/tar', ['-czf', archive, '-C', service, '.'], {
    stdio: 'inherit',
  });
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  const release = {
    version,
    platform: 'darwin',
    arch,
    url: archiveName,
    sha256: hash.digest('hex'),
  };
  const releaseFile = join(destination, `ios-airlink-${arch}.json`);
  await writeFile(releaseFile, `${JSON.stringify(release, null, 2)}\n`);
  console.log(`Release archive: ${archive}\nRelease manifest: ${releaseFile}`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
