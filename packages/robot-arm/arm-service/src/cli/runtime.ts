import { homedir } from 'node:os';
import { join } from 'node:path';
import * as cli from '@clack/prompts';
import { ensureDeviceToken } from '@midscene/universal-device/server';

export function playgroundPort() {
  const port = Number(process.env.ARM_PLAYGROUND_PORT ?? 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('ARM_PLAYGROUND_PORT 必须是 1 至 65535 之间的端口。');
  return port;
}

export function reportError(error: unknown) {
  cli.log.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

export function registerShutdown(close: () => Promise<void>) {
  const shutdown = () => void close().catch(reportError);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

export const armDeviceToken = () =>
  ensureDeviceToken(
    join(homedir(), '.midscene', 'arm-service', 'access-token'),
  );
