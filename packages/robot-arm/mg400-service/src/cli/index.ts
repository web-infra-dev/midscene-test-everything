#!/usr/bin/env node
import * as cli from '@clack/prompts';
import { startArmPlayground } from '../server/index.js';
import {
  armDeviceToken,
  playgroundPort,
  registerShutdown,
  reportError,
} from './runtime.js';
import { setupMg400 } from './setup.js';

async function main() {
  const port = playgroundPort();
  const setup = await setupMg400();
  if (!setup) return;
  const deviceAccessToken = await armDeviceToken();
  const playground = await startArmPlayground({
    deviceAccessToken,
    ...setup,
    port,
  });
  let closing: Promise<void> | undefined;
  registerShutdown(() => {
    closing ??= playground.close();
    return closing;
  });
  cli.log.info(`Universal Device API docs: ${playground.url}/api/docs/`);
  cli.outro(`打开 ${playground.url} 查看机械臂管理台。`);
}

main().catch(reportError);
