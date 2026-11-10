import { spawn } from 'node:child_process';
import { mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDirectory } from '../config/store.js';
import type { HostAddress } from '../types.js';
import { HostClient } from './host-client.js';

export async function findLocalHost() {
  try {
    const address = JSON.parse(
      await readFile(join(configDirectory, 'host.json'), 'utf8'),
    ) as HostAddress;
    const url = new URL(address.url);
    if (
      url.hostname !== '127.0.0.1' ||
      url.protocol !== 'http:' ||
      typeof address.token !== 'string'
    )
      throw new Error('Invalid local Host address');
    const client = new HostClient(address);
    await client.health();
    return client;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Incompatible'))
      throw error;
    return undefined;
  }
}
let starting: Promise<HostClient> | undefined;
export function ensureLocalHost(): Promise<HostClient> {
  starting ??= connect().finally(() => {
    starting = undefined;
  });
  return starting;
}
async function connect() {
  const existing = await findLocalHost();
  if (existing) return existing;
  if (process.platform !== 'darwin') throw new Error('iOS HID requires macOS');
  await mkdir(configDirectory, { recursive: true, mode: 0o700 });
  const log = await open(join(configDirectory, 'host.log'), 'a', 0o600);
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../host/main.js', import.meta.url))],
    {
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
    },
  );
  let failure: Error | undefined;
  child.once('error', (error) => {
    failure = error;
  });
  child.unref();
  await log.close();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (failure) throw failure;
    const client = await findLocalHost();
    if (client) return client;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(
    `iOS HID Host did not start. See ${join(configDirectory, 'host.log')}`,
  );
}
export async function openBrowser(url: string) {
  if (process.platform !== 'darwin')
    throw new Error(`Open the setup page: ${url}`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn('/usr/bin/open', [url], { stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Open setup page manually: ${url}`)),
    );
  });
}
