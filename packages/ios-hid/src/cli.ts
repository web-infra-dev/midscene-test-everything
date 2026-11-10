#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findLocalHost } from './client/ensure-local-host.js';
import { configDirectory } from './config/store.js';
const command = process.argv[2];
if (command !== 'stop' && command !== 'status')
  throw new Error('Usage: midscene-ios-hid <status|stop>');
const host = await findLocalHost();
if (!host) console.log('iOS HID Host is not running.');
else if (command === 'stop') {
  const lock = join(configDirectory, 'host.lock');
  const previousOwner = await readFile(lock, 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  });
  await host.shutdown();
  // The response acknowledges shutdown before native resources and the singleton
  // lock are released. Wait for that release so a subsequent start is safe.
  const deadline = Date.now() + 30_000;
  while (previousOwner !== undefined) {
    let owner: string;
    try {
      owner = await readFile(lock, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      break;
    }
    if (owner !== previousOwner) break;
    if (Date.now() >= deadline)
      throw new Error(
        'Host shutdown timed out; inspect host.log before restarting',
      );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log('iOS HID Host stopped.');
} else {
  const devices = await host.listDevices();
  console.log(`iOS HID Host is running; ${devices.length} saved device(s).`);
}
