#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import {
  UniversalDevice,
  type UniversalDeviceOptions,
  listUniversalDevices,
} from './client/service-client.js';
import { type InputAction, inputAction } from './input-action.js';

const help = `Usage: universal-device [--host URL] [--device ID] <command>

Commands:
  devices                List devices and their supported actions as JSON
  screenshot <file>      Save a JPEG and print { file, width, height } as JSON
  action '<json>'        Execute one action (pass '-' to read JSON from stdin)

Options:
  --host URL             Device service URL (or set MIDSCENE_UNIVERSAL_DEVICE_SERVICE_URL)
  --device ID            Target device ID (or set MIDSCENE_UNIVERSAL_DEVICE_ID; optional for a single-device service)
  -h, --help             Show help

Environment:
  MIDSCENE_UNIVERSAL_DEVICE_SERVICE_URL     Device service URL (unless --host is passed)
  MIDSCENE_UNIVERSAL_DEVICE_SERVICE_TOKEN   Required Bearer token for the device service

Action examples:
  {"type":"tap","point":{"x":120,"y":240}}
  {"type":"swipe","from":{"x":120,"y":440},"to":{"x":120,"y":150},"durationMs":350}
  {"type":"typeText","text":"hello"}
  {"type":"home"} | {"type":"back"} | {"type":"scroll","direction":"down"}
`;

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

async function resolveDeviceId(
  connection: UniversalDeviceOptions,
  explicitId: string | undefined,
  action: InputAction | undefined,
): Promise<string> {
  if (explicitId) return explicitId;

  const profiles = await listUniversalDevices(connection);
  if (profiles.length === 0) throw new Error('No devices configured.');
  if (profiles.length > 1)
    throw new Error('Select a device with --device. Run universal-device devices.');

  const profile = profiles[0];
  if (action && !profile.actions.includes(action.type))
    throw new Error(`Device does not support ${action.type}.`);
  return profile.id;
}

async function withDevice<T>(
  connection: UniversalDeviceOptions,
  deviceId: string,
  run: (device: UniversalDevice) => Promise<T>,
): Promise<T> {
  const device = await UniversalDevice.connect({ ...connection, deviceId });
  let interrupted = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (interrupted) return;
    interrupted = true;
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
    void device.destroy().catch(() => {}).finally(() => process.exit());
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    return await run(device);
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    await device.destroy().catch(() => {});
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      host: { type: 'string' },
      device: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, argument, ...extra] = positionals;
  if (values.help || !command || command === 'help') {
    process.stdout.write(help);
    return;
  }
  if (
    extra.length ||
    (command === 'devices'
      ? argument !== undefined
      : !['screenshot', 'action'].includes(command) || !argument)
  ) {
    throw new Error('Invalid command or arguments. Run universal-device --help.');
  }

  try {
    process.loadEnvFile();
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }

  const action =
    command === 'action'
      ? parseAction(argument === '-' ? await readStdin() : argument)
      : undefined;

  const host = values.host || process.env.MIDSCENE_UNIVERSAL_DEVICE_SERVICE_URL;
  if (!host?.trim())
    throw new Error(
      'Set MIDSCENE_UNIVERSAL_DEVICE_SERVICE_URL or pass --host URL.',
    );
  const token = process.env.MIDSCENE_UNIVERSAL_DEVICE_SERVICE_TOKEN;
  if (!token?.trim())
    throw new Error('Set MIDSCENE_UNIVERSAL_DEVICE_SERVICE_TOKEN.');
  const connection: UniversalDeviceOptions = { host, token };

  if (command === 'devices') {
    const profiles = await listUniversalDevices(connection);
    console.log(JSON.stringify(profiles, null, 2));
    return;
  }

  const deviceId = await resolveDeviceId(
    connection,
    values.device || process.env.MIDSCENE_UNIVERSAL_DEVICE_ID,
    action,
  );

  await withDevice(connection, deviceId, async (device) => {
    if (action) {
      await device.execute(action);
      console.log(JSON.stringify({ ok: true, deviceId, type: action.type }));
    } else {
      const { jpeg, width, height } = await device.screenshot();
      await writeFile(argument, jpeg);
      console.log(JSON.stringify({ file: argument, width, height }));
    }
  });
}

main().catch((error: unknown) => {
  if (error instanceof z.ZodError) {
    console.error(error.issues.map((i) => i.message).join('; '));
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});
