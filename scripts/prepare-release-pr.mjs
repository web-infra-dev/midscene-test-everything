import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [increment] = process.argv.slice(2);
if (!['major', 'minor', 'patch'].includes(increment)) {
  throw new Error(
    'Usage: node scripts/prepare-release-pr.mjs major|minor|patch',
  );
}

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', ...opts }).trim();

if (git(['status', '--porcelain'])) {
  throw new Error('Working tree must be clean before preparing a release PR.');
}

const currentBranch = git(['branch', '--show-current']);
if (currentBranch !== 'main') {
  throw new Error(
    `Switch to main before preparing a release PR (current: ${currentBranch || 'detached'}).`,
  );
}

const version = execFileSync(
  'node',
  ['scripts/bump-release-version.mjs', increment],
  { cwd: root, encoding: 'utf8' },
).trim();
const branch = `release/v${version}`;
const title = `chore(release): v${version}`;

git(['checkout', '-b', branch]);
git(['add', '-u', '--', 'package.json', ':(glob)**/package.json']);
git(['commit', '-m', title]);
git(['push', '-u', 'origin', branch], { stdio: 'inherit' });

try {
  const prUrl = execFileSync(
    'gh',
    [
      'pr',
      'create',
      '--base',
      'main',
      '--head',
      branch,
      '--title',
      title,
      '--body',
      `Release \`v${version}\`. Merging this PR publishes the workspace packages to npm and creates a draft GitHub Release.`,
    ],
    { cwd: root, encoding: 'utf8' },
  ).trim();
  console.log(`Opened release PR: ${prUrl}`);
} catch {
  console.log(
    `Pushed ${branch}. Open a PR targeting main with title "${title}".`,
  );
}
