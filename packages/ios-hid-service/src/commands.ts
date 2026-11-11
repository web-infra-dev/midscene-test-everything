#!/usr/bin/env node
import { Command } from 'commander';
import {
  install,
  parsePort,
  start,
  status,
  stop,
  uninstall,
} from './launch-agent.js';
import {
  defaultPort,
  logPath,
  printRunningService,
  readToken,
} from './settings.js';

import { update } from './update.js';

const program = new Command()
  .name('hid-service')
  .description('Manage the Midscene iOS HID Device Service');

program.hook('preAction', () => {
  if (process.platform !== 'darwin')
    throw new Error('iOS HID Device Service requires macOS');
});

program
  .command('install')
  .description('Register and start the macOS login service')
  .option('--port <port>', 'Listen port (default: 5801)', parsePort)
  .action(async ({ port }: { port?: number }) =>
    printRunningService(await install(port, defaultPort)),
  );
program
  .command('update')
  .description('Check for or install a published device service release')
  .option('--check', 'Show the available version without installing it')
  .option('--manifest <url>', 'Use an alternative HTTPS release manifest')
  .action(update);
program
  .command('start')
  .description('Start the installed service')
  .action(async () => printRunningService(await start()));
program
  .command('status')
  .description('Show service status and addresses')
  .action(async () => {
    const current = await status();
    if (current.state === 'Running' && current.port !== undefined)
      printRunningService(current.port);
    else console.log(current.state);
    if (current.port !== undefined) console.log(`Log: ${logPath}`);
  });
program
  .command('stop')
  .description('Stop the service for this login')
  .action(async () => {
    await stop();
    console.log('Stopped for this login.');
  });
program
  .command('uninstall')
  .description('Remove the login service')
  .action(async () => {
    await uninstall();
    console.log('Login service removed.');
  });
program
  .command('token')
  .description('Print the device API access token')
  .action(async () => console.log(await readToken()));
await program.parseAsync().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
