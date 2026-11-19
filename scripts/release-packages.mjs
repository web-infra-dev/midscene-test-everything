import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function findReleasePackages(root) {
  // Run one at a time so pnpm's dependency order is preserved in stdout.
  const output = execFileSync(
    'pnpm',
    [
      '--recursive',
      '--sort',
      '--workspace-concurrency=1',
      'exec',
      'node',
      '-p',
      '"PKG_DIR:" + process.cwd()',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  const directories = output
    .trimEnd()
    .split(/\r?\n/)
    .filter((line) => line.startsWith('PKG_DIR:'))
    .map((line) => line.slice('PKG_DIR:'.length))
    .filter((directory) => directory && directory !== resolve(root));

  const packages = await Promise.all(
    directories.map(async (directory) => ({
      directory,
      manifest: JSON.parse(
        await readFile(join(directory, 'package.json'), 'utf8'),
      ),
    })),
  );
  const publishable = packages.filter(({ manifest }) => !manifest.private);
  if (publishable.length === 0) {
    throw new Error('No publishable workspace packages found.');
  }
  return publishable;
}
