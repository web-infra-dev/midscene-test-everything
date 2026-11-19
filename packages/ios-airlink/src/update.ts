import { appendFileSync } from 'node:fs';
import { mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { styleText } from 'node:util';
import { activateRelease, installedVersion } from './launch-agent.js';
import { latestRelease, releaseTag, stageRelease } from './npm-release.js';
import { directory } from './settings.js';

function isNewerStableVersion(candidate: string, installed: string) {
  const next = candidate.split('.').map(BigInt);
  const current = installed.split('.').map(BigInt);
  for (let index = 0; index < next.length; index++) {
    if (next[index] !== current[index]) return next[index] > current[index];
  }
  return false;
}

export async function update(options: { check?: boolean }) {
  const current = await installedVersion();
  const installed = current.running ?? current.installed;
  const tag = installed && releaseTag(installed);
  console.log(`  Running    ${current.running ?? 'unavailable'}`);
  console.log(`  Installed  ${current.installed ?? 'unknown'}`);
  if (!installed || !tag)
    throw new Error('Cannot determine the installed version.');

  const release = await latestRelease(tag);
  const { version } = release;
  console.log(`  Available  ${version}`);
  const newer =
    tag === 'canary'
      ? version > installed
      : isNewerStableVersion(version, installed);
  if (!newer) {
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
    const active = await installedVersion();
    if (
      active.installed !== current.installed ||
      active.running !== current.running
    )
      throw new Error('The installed version changed. Run update again.');
    console.log(`  Log        ${log}`);
    report(`Installing ${version} from npm`);
    const stagedRelease = await stageRelease(version, release.integrity);
    staged = stagedRelease.directory;
    const port = await activateRelease(stagedRelease.entry, version, report);
    report(`Updated to ${version}. Device manager: http://localhost:${port}/`);
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
