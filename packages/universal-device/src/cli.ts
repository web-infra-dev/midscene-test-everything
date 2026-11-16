#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { z } from 'zod';
import {
  ServiceError,
  type UniversalDeviceOptions,
  type UniversalDeviceProfile,
  acquireUniversalDeviceSession,
  captureSessionScreenshot,
  executeSessionAction,
  listUniversalDevices,
  releaseUniversalDeviceSession,
  renewUniversalDeviceSession,
} from './client/service-client.js';
import { type InputAction, inputAction } from './input-action.js';
import { startMcpServer } from './mcp.js';

const defaultCliLeaseMs = 180_000;

type LeaseState = {
  sessionId: string;
  deviceId: string;
  host: string;
  leaseMs: number;
  expiresAt: number;
};

function loadDotEnv() {
  try {
    process.loadEnvFile();
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
}

function getConnection(opts: { host?: string }): UniversalDeviceOptions {
  const host = opts.host || process.env.MIDSCENE_UNIVERSAL_DEVICE_SERVICE_URL;
  if (!host?.trim()) {
    throw new Error(
      'Set MIDSCENE_UNIVERSAL_DEVICE_SERVICE_URL or pass --host URL.',
    );
  }
  const token = process.env.MIDSCENE_UNIVERSAL_DEVICE_SERVICE_TOKEN;
  if (!token?.trim()) {
    throw new Error('Set MIDSCENE_UNIVERSAL_DEVICE_SERVICE_TOKEN.');
  }
  return { host: new URL(host).origin, token };
}

function leaseFilePath(host: string, deviceId: string) {
  const key = createHash('sha256')
    .update(`${host}|${deviceId}`)
    .digest('hex')
    .slice(0, 16);
  return join(tmpdir(), `midscene-universal-device-${key}.json`);
}

async function readLeaseState(
  host: string,
  deviceId: string,
): Promise<LeaseState | undefined> {
  try {
    const raw = await readFile(leaseFilePath(host, deviceId), 'utf8');
    const parsed = JSON.parse(raw) as Partial<LeaseState>;
    if (
      typeof parsed.sessionId === 'string' &&
      typeof parsed.deviceId === 'string' &&
      typeof parsed.host === 'string' &&
      typeof parsed.leaseMs === 'number' &&
      typeof parsed.expiresAt === 'number'
    ) {
      return parsed as LeaseState;
    }
  } catch {
    // Missing or unreadable state file simply means no active local lease.
  }
  return undefined;
}

async function writeLeaseState(state: LeaseState) {
  await writeFile(
    leaseFilePath(state.host, state.deviceId),
    JSON.stringify(state),
    { mode: 0o600 },
  );
}

async function removeLeaseState(host: string, deviceId: string) {
  await rm(leaseFilePath(host, deviceId), { force: true }).catch(() => {});
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseAction(raw: string): InputAction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid action JSON: ${detail}`);
  }
  const result = inputAction.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) =>
        issue.path.length
          ? `${issue.path.join('.')}: ${issue.message}`
          : issue.message,
      )
      .join('; ');
    throw new Error(`Invalid action: ${issues}`);
  }
  return result.data;
}

async function resolveDevice(
  connection: UniversalDeviceOptions,
  explicitId: string | undefined,
  action?: InputAction,
): Promise<{ deviceId: string; profile?: UniversalDeviceProfile }> {
  if (explicitId) return { deviceId: explicitId };

  const profiles = await listUniversalDevices(connection);
  if (profiles.length === 0) throw new Error('No devices configured.');
  if (profiles.length > 1) {
    throw new Error(
      'Select a device with --device. Run universal-device devices.',
    );
  }
  const profile = profiles[0];
  if (action && !profile.actions.includes(action.type)) {
    throw new Error(`Device does not support ${action.type}.`);
  }
  return { deviceId: profile.id, profile };
}

async function withEphemeralSession<T>(
  connection: UniversalDeviceOptions,
  deviceId: string,
  run: (sessionId: string) => Promise<T>,
): Promise<T> {
  const session = await acquireUniversalDeviceSession({
    ...connection,
    deviceId,
    leaseMs: defaultCliLeaseMs,
  });
  let interrupted = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (interrupted) return;
    interrupted = true;
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
    void releaseUniversalDeviceSession({ ...connection, sessionId: session.id })
      .catch(() => {})
      .finally(() => process.exit());
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    return await run(session.id);
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await releaseUniversalDeviceSession({
      ...connection,
      sessionId: session.id,
    }).catch(() => {});
  }
}

async function verifyLocalLease(
  connection: UniversalDeviceOptions,
  deviceId: string,
): Promise<LeaseState | undefined> {
  const existing = await readLeaseState(connection.host, deviceId);
  if (!existing) return undefined;
  try {
    await renewUniversalDeviceSession({
      ...connection,
      sessionId: existing.sessionId,
    });
    const refreshed: LeaseState = {
      ...existing,
      expiresAt: Date.now() + existing.leaseMs,
    };
    await writeLeaseState(refreshed);
    return refreshed;
  } catch (error) {
    if (error instanceof ServiceError && error.status === 410) {
      await removeLeaseState(connection.host, deviceId);
      return undefined;
    }
    throw error;
  }
}

async function runWithLease<T>(
  connection: UniversalDeviceOptions,
  deviceId: string,
  run: (sessionId: string) => Promise<T>,
): Promise<T> {
  const existing = await readLeaseState(connection.host, deviceId);
  if (!existing) {
    return withEphemeralSession(connection, deviceId, run);
  }
  try {
    const result = await run(existing.sessionId);
    await writeLeaseState({
      ...existing,
      expiresAt: Date.now() + existing.leaseMs,
    });
    return result;
  } catch (error) {
    if (error instanceof ServiceError && error.status === 410) {
      await removeLeaseState(connection.host, deviceId);
      throw new Error(
        'Control session expired. Run "universal-device acquire" again.',
      );
    }
    throw error;
  }
}

function buildProgram() {
  const program = new Command();
  program
    .name('universal-device')
    .description('CLI and MCP server for Midscene Universal Device')
    .option(
      '--host <url>',
      'Device service URL (or set MIDSCENE_UNIVERSAL_DEVICE_SERVICE_URL)',
    )
    .option(
      '--device <id>',
      'Target device ID (or set MIDSCENE_UNIVERSAL_DEVICE_ID)',
    )
    .addHelpText(
      'after',
      `
Environment:
  MIDSCENE_UNIVERSAL_DEVICE_SERVICE_URL     Device service URL (unless --host is passed)
  MIDSCENE_UNIVERSAL_DEVICE_SERVICE_TOKEN   Required Bearer token for the device service
  MIDSCENE_UNIVERSAL_DEVICE_ID              Default target device ID

Action examples:
  {"type":"tap","point":{"x":120,"y":240}}
  {"type":"swipe","from":{"x":120,"y":440},"to":{"x":120,"y":150},"durationMs":350}
  {"type":"typeText","text":"hello"}
  {"type":"home"} | {"type":"back"} | {"type":"scroll","direction":"down"}`,
    );

  const globalIds = () => {
    const opts = program.opts<{ host?: string; device?: string }>();
    return {
      host: opts.host,
      deviceId: opts.device || process.env.MIDSCENE_UNIVERSAL_DEVICE_ID,
    };
  };

  program
    .command('devices')
    .description('List devices and their supported actions as JSON')
    .action(async () => {
      const connection = getConnection(globalIds());
      const profiles = await listUniversalDevices(connection);
      console.log(JSON.stringify(profiles, null, 2));
    });

  program
    .command('status')
    .description('Show target device status and local lease state as JSON')
    .action(async () => {
      const { host, deviceId: explicitId } = globalIds();
      const connection = getConnection({ host });
      const profiles = await listUniversalDevices(connection);
      if (profiles.length === 0) throw new Error('No devices configured.');
      if (!explicitId && profiles.length > 1) {
        throw new Error(
          'Select a device with --device. Run universal-device devices.',
        );
      }
      const profile = explicitId
        ? profiles.find((item) => item.id === explicitId)
        : profiles[0];
      if (!profile) throw new Error(`Device not found: ${explicitId}`);

      const lease = await verifyLocalLease(connection, profile.id);
      console.log(
        JSON.stringify({ ...profile, acquired: Boolean(lease) }, null, 2),
      );
    });

  program
    .command('acquire')
    .description('Acquire an exclusive control lease for the target device')
    .option(
      '--lease-ms <ms>',
      'Lease idle timeout in milliseconds (5000..300000)',
      String(defaultCliLeaseMs),
    )
    .action(async (cmdOpts: { leaseMs: string }) => {
      const leaseMs = Number(cmdOpts.leaseMs);
      if (!Number.isInteger(leaseMs) || leaseMs < 5_000 || leaseMs > 300_000) {
        throw new Error(
          '--lease-ms must be an integer between 5000 and 300000.',
        );
      }
      const { host, deviceId: explicitId } = globalIds();
      const connection = getConnection({ host });
      const { deviceId } = await resolveDevice(connection, explicitId);

      const existing = await verifyLocalLease(connection, deviceId);
      if (existing) {
        console.log(
          JSON.stringify({
            ok: true,
            deviceId,
            sessionId: existing.sessionId,
            expiresInMs: existing.expiresAt - Date.now(),
            reused: true,
          }),
        );
        return;
      }

      const session = await acquireUniversalDeviceSession({
        ...connection,
        deviceId,
        leaseMs,
      });
      await writeLeaseState({
        sessionId: session.id,
        deviceId: session.deviceId,
        host: connection.host,
        leaseMs: session.expiresInMs,
        expiresAt: Date.now() + session.expiresInMs,
      });
      console.log(
        JSON.stringify({
          ok: true,
          deviceId: session.deviceId,
          sessionId: session.id,
          expiresInMs: session.expiresInMs,
        }),
      );
    });

  program
    .command('release')
    .description('Release the locally held control lease for the target device')
    .action(async () => {
      const { host, deviceId: explicitId } = globalIds();
      const connection = getConnection({ host });
      const { deviceId } = await resolveDevice(connection, explicitId);
      const existing = await readLeaseState(connection.host, deviceId);
      if (!existing) {
        console.log(JSON.stringify({ ok: true, deviceId, released: false }));
        return;
      }
      await releaseUniversalDeviceSession({
        ...connection,
        sessionId: existing.sessionId,
      });
      await removeLeaseState(connection.host, deviceId);
      console.log(JSON.stringify({ ok: true, deviceId, released: true }));
    });

  program
    .command('screenshot')
    .argument('<file>', 'Output JPEG file path')
    .description('Save a JPEG and print { file, width, height } as JSON')
    .action(async (file: string) => {
      const { host, deviceId: explicitId } = globalIds();
      const connection = getConnection({ host });
      const { deviceId } = await resolveDevice(connection, explicitId);
      const { jpeg, width, height } = await runWithLease(
        connection,
        deviceId,
        (sessionId) => captureSessionScreenshot({ ...connection, sessionId }),
      );
      await writeFile(file, jpeg);
      console.log(JSON.stringify({ file, width, height }));
    });

  program
    .command('action')
    .argument('<json>', "Action JSON (or '-' to read JSON from stdin)")
    .description('Execute one Universal Device action')
    .action(async (raw: string) => {
      const action = parseAction(raw === '-' ? await readStdin() : raw);
      const { host, deviceId: explicitId } = globalIds();
      const connection = getConnection({ host });
      const { deviceId } = await resolveDevice(connection, explicitId, action);
      await runWithLease(connection, deviceId, (sessionId) =>
        executeSessionAction({ ...connection, sessionId, action }),
      );
      console.log(JSON.stringify({ ok: true, deviceId, type: action.type }));
    });

  program
    .command('mcp')
    .description('Start a stdio MCP server for Universal Device')
    .action(async () => {
      const { host, deviceId } = globalIds();
      await startMcpServer({ host, deviceId });
    });

  return program;
}

async function main() {
  loadDotEnv();
  await buildProgram().parseAsync(process.argv);
}

main().catch((error: unknown) => {
  if (error instanceof z.ZodError) {
    console.error(error.issues.map((i) => i.message).join('; '));
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});
