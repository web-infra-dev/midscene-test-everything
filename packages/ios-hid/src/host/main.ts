import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { configDirectory } from '../config/store.js';
import { IOSHIDHost } from './host.js';

const lock = join(configDirectory, 'host.lock');
await mkdir(configDirectory, { recursive: true, mode: 0o700 });
async function lockHost() {
  try {
    await writeFile(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const pid = Number(await readFile(lock, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0)
      throw new Error('Invalid Host lock');
    try {
      process.kill(pid, 0);
      throw new Error('Host already running');
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== 'ESRCH') throw reason;
    }
    if ((await readFile(lock, 'utf8')) === String(pid)) await rm(lock);
    await writeFile(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
  }
}
await lockHost();
const host = new IOSHIDHost();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    await host.close();
  } finally {
    await rm(lock, { force: true });
  }
}
host.onShutdown = stop;
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
try {
  await host.start();
} catch (error) {
  console.error(error);
  await stop();
  process.exitCode = 1;
}
