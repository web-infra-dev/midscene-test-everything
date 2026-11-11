#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedCLI } from './launch-agent.js';

try {
  const args = process.argv.slice(2);
  let registered =
    process.platform === 'darwin' ? await installedCLI() : undefined;
  if (registered && args[0] === 'update') {
    try {
      await access(join(dirname(registered), 'launcher.js'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // Older releases need the new updater for their first npm upgrade.
      registered = undefined;
    }
  }
  const entry =
    registered ?? fileURLToPath(new URL('./commands.js', import.meta.url));
  const result = spawnSync(process.execPath, [entry, ...args], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.signal) process.kill(process.pid, result.signal);
  else process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
