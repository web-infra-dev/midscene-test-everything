#!/usr/bin/env node
import { Command } from 'commander';
import { runServer } from './server.js';
import { defaultPort, printRunningService, readToken } from './settings.js';

function parsePort(value: string) {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
    throw new Error('Port must be an integer between 1 and 65535');
  return Number(value);
}

async function startService(port: number) {
  const server = await runServer(port);
  let stopping = false;
  const close = () => {
    if (stopping) return;
    stopping = true;
    void server.close().catch((error: Error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  printRunningService(server.port);
}

const program = new Command()
  .name('ios-airlink')
  .description('Run and connect to Midscene iOS AirLink');

program.hook('preAction', () => {
  if (process.platform !== 'darwin')
    throw new Error('iOS AirLink requires macOS');
});

program
  .command('start')
  .description('Run AirLink in the foreground')
  .option('--port <port>', 'Listen port', parsePort, defaultPort)
  .action(async ({ port }: { port: number }) => startService(port));

program
  .command('token')
  .description('Print the device API access token')
  .action(async () => console.log(await readToken()));

await program.parseAsync().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
