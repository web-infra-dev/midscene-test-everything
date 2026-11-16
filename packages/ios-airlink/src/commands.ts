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

import { fileURLToPath } from 'node:url';
import { cliVersion, stageRelease } from './npm-release.js';
import { update } from './update.js';

const program = new Command()
  .name('ios-airlink')
  .description('Manage the Midscene iOS AirLink');

program.hook('preAction', () => {
  if (process.platform !== 'darwin')
    throw new Error('iOS AirLink requires macOS');
});

program
  .command('install')
  .description('Register and start the macOS login service')
  .option('--port <port>', 'Listen port (default: 5801)', parsePort)
  .action(async ({ port }: { port?: number }) => {
    const version = await cliVersion();
    const runningPort = await install(port, defaultPort, async () => {
      if (!version)
        return {
          entry: fileURLToPath(new URL('./service-entry.js', import.meta.url)),
          version,
        };
      console.log(`  › Installing ${version} from npm`);
      return { ...(await stageRelease(version)), version };
    });
    printRunningService(runningPort);
  });
program
  .command('update')
  .description('Update the installed service to the latest npm release')
  .option('--check', 'Show the available version without installing it')
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
