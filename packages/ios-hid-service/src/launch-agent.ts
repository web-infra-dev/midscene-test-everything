import { execFile } from 'node:child_process';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { directory, ensureToken, label, logPath } from './settings.js';

const exec = promisify(execFile);
const launchAgents = join(homedir(), 'Library', 'LaunchAgents');
const plist = join(launchAgents, `${label}.plist`);
const domain = `gui/${process.getuid?.()}`;
const target = `${domain}/${label}`;

function xml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[character]!,
  );
}

function launchAgent(port: number) {
  const args = [
    process.execPath,
    fileURLToPath(new URL('./service-entry.js', import.meta.url)),
    String(port),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map((arg) => `<string>${xml(arg)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(directory)}</string>
<key>EnvironmentVariables</key><dict>
<key>PATH</key><string>${xml(process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin')}</string>
</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(logPath)}</string>
<key>StandardErrorPath</key><string>${xml(logPath)}</string>
</dict></plist>
`;
}

export function parsePort(value: string) {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
    throw new Error('Port must be an integer between 1 and 65535');
  return Number(value);
}

async function installedPort() {
  try {
    await readFile(plist);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const { stdout } = await exec('/usr/bin/plutil', [
    '-extract',
    'ProgramArguments',
    'json',
    '-o',
    '-',
    plist,
  ]);
  const args = JSON.parse(stdout) as string[];
  return parsePort(args.at(-1) ?? '');
}

async function job() {
  try {
    const { stdout } = await exec('/bin/launchctl', ['print', target]);
    const pid = stdout.match(/^\s*pid = (\d+)\s*$/m)?.[1];
    return { pid: pid ? Number(pid) : undefined };
  } catch (error) {
    const failure = error as Error & { code?: number; stderr?: string };
    if (
      failure.code === 113 ||
      /could not find service/i.test(failure.stderr ?? '')
    )
      return undefined;
    throw error;
  }
}

async function healthy(port: number, pid?: number) {
  if (!pid) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return false;
    const health = await response.json();
    return health.service === label && health.pid === pid;
  } catch {
    return false;
  }
}

async function waitForHealth(port: number) {
  const deadline = Date.now() + 12_000;
  do {
    if (await healthy(port, (await job())?.pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw new Error(
    `Device service did not start on port ${port}. See ${logPath}`,
  );
}

async function checkPort(port: number) {
  await new Promise<void>((resolve, reject) => {
    const listener = createServer();
    listener.once('error', (error) => {
      reject(new Error(`Cannot use port ${port}: ${error.message}`));
    });
    listener.listen(port, '0.0.0.0', () => {
      listener.close((error) => (error ? reject(error) : resolve()));
    });
  });
}

export async function start() {
  const port = await installedPort();
  if (port === undefined) throw new Error('Run hid-service install first');
  if (!(await job())) {
    await checkPort(port);
    await exec('/bin/launchctl', ['bootstrap', domain, plist]);
  }
  await waitForHealth(port);
  return port;
}

export async function install(
  requestedPort: number | undefined,
  defaultPort: number,
) {
  const existing = await installedPort();
  if (existing !== undefined) {
    if (requestedPort !== undefined && requestedPort !== existing)
      throw new Error(
        `Service is already installed on port ${existing}. Uninstall it before changing the port.`,
      );
    return start();
  }

  const port = requestedPort ?? defaultPort;
  await checkPort(port);
  await ensureToken();
  await mkdir(launchAgents, { recursive: true });
  await writeFile(plist, launchAgent(port), { mode: 0o600, flag: 'wx' });
  let loaded = false;
  try {
    await exec('/bin/launchctl', ['bootstrap', domain, plist]);
    loaded = true;
    await waitForHealth(port);
    return port;
  } catch (error) {
    if (loaded) await stop();
    await unlink(plist);
    throw error;
  }
}

export async function status() {
  const port = await installedPort();
  if (port === undefined) return { state: 'Not installed' };
  const running = await job();
  const state = !running
    ? 'Stopped'
    : (await healthy(port, running.pid))
      ? 'Running'
      : 'Unhealthy';
  return { state, port };
}

export async function stop() {
  if (await job()) await exec('/bin/launchctl', ['bootout', target]);
}

export async function uninstall() {
  await stop();
  await unlink(plist).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
