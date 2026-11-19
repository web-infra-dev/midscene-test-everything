import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { versionBump } from 'bumpp';
import { findReleasePackages } from './release-packages.mjs';

const [increment] = process.argv.slice(2);
const releaseTypes = ['major', 'minor', 'patch', 'canary'];
if (!releaseTypes.includes(increment)) {
  throw new Error(
    'Usage: node scripts/bump-release-version.mjs major|minor|patch|canary',
  );
}

const cwd = fileURLToPath(new URL('../', import.meta.url));
const packages = await findReleasePackages(cwd);
const files = [
  'package.json',
  ...packages.map(({ directory }) =>
    relative(cwd, join(directory, 'package.json')),
  ),
];
const root = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));

if (
  packages.some(({ manifest }) => manifest.version !== root.version) ||
  !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(root.version)
) {
  throw new Error(
    'The root and release package versions must match and be stable.',
  );
}

const release =
  increment === 'canary'
    ? `0.0.0-canary-${new Date().toISOString().slice(0, 19).replace(/\D/g, '')}`
    : increment;

const { newVersion, skippedFiles } = await versionBump({
  cwd,
  files,
  release,
  confirm: false,
  printCommits: false,
  ignoreScripts: true,
  install: false,
  commit: false,
  tag: false,
  push: false,
});
if (skippedFiles.length > 0) {
  throw new Error(`Could not update versions in ${skippedFiles.join(', ')}.`);
}
console.log(newVersion);
