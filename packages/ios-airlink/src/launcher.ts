#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installedCLI } from './launch-agent.js';

try {
  const args = process.argv.slice(2);
  const registered =
    process.platform === 'darwin' ? await installedCLI() : undefined;
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
