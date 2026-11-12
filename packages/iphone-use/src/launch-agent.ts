import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';
import {
  directory,
  ensureToken,
  label,
  logPath,
  readToken,
} from './settings.js';

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

function launchAgent(port: number, entry: string) {
  const args = [process.execPath, entry, String(port)];
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

async function installedArguments() {
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
  return JSON.parse(stdout) as string[];
}

export async function installedCLI() {
  const args = await installedArguments();
  if (!args) return;
  const entry = args[1];
  if (
    typeof entry !== 'string' ||
    !isAbsolute(entry) ||
    basename(entry) !== 'service-entry.js'
  )
    throw new Error(
      'The device service registration has an invalid entry path.',
    );
  return join(dirname(entry), 'commands.js');
}

async function installedPort() {
  const args = await installedArguments();
  return args && parsePort(args.at(-1) ?? '');
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

async function runningHealth(port: number, pid?: number) {
  if (!pid) return undefined;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return undefined;
    const health = await response.json();
    if (health.service !== label || health.pid !== pid) return undefined;
    return {
      version: typeof health.version === 'string' ? health.version : undefined,
    };
  } catch {
    return undefined;
  }
}

async function waitForHealth(port: number, version?: string) {
  const deadline = Date.now() + 12_000;
  do {
    const health = await runningHealth(port, (await job())?.pid);
    if (health && (!version || health.version === version)) return;
    await setTimeout(250);
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
  if (port === undefined) throw new Error('Run iphone-use install first');
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
  resolveEntry: () => Promise<{ entry: string; version?: string }>,
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
  const { entry, version } = await resolveEntry();
  await ensureToken();
  await mkdir(launchAgents, { recursive: true });
  await writeFile(plist, launchAgent(port, entry), { mode: 0o600, flag: 'wx' });
  let loaded = false;
  try {
    await exec('/bin/launchctl', ['bootstrap', domain, plist]);
    loaded = true;
    await waitForHealth(port, version);
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
    : (await runningHealth(port, running.pid))
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

export async function installedVersion() {
  const args = await installedArguments();
  if (!args) throw new Error('Run iphone-use install first.');
  const port = parsePort(args.at(-1) ?? '');
  const running = await runningHealth(port, (await job())?.pid);
  const manifest = await readFile(
    join(dirname(args[1]), '../package.json'),
    'utf8',
  )
    .then(JSON.parse)
    .catch(() => undefined);
  return {
    running: running?.version,
    installed: manifest?.version as string | undefined,
  };
}

async function prepareUpdate(port: number, pid: number) {
  const response = await fetch(
    `http://127.0.0.1:${port}/iphone-use/update/prepare`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await readToken()}`,
        'X-Midscene-Service-Pid': String(pid),
      },
      signal: AbortSignal.timeout(5000),
    },
  );
  if (response.status === 404)
    throw new Error(
      'This running version cannot check device usage. When idle, stop it manually and run update again.',
    );
  const result = await response.json();
  if (response.status === 409 && Array.isArray(result.busy))
    throw new Error(
      `Devices in use or finishing an action: ${result.busy.join(', ')}. Disconnect and retry.`,
    );
  if (!response.ok)
    throw new Error(
      result.error ?? `Could not prepare the service (${response.status}).`,
    );
  if (!Number.isFinite(result.expiresAt))
    throw new Error('The device service returned an invalid update window.');
  return result.expiresAt as number;
}

async function waitForExit(pid: number) {
  const deadline = Date.now() + 20_000;
  do {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw error;
    }
    await setTimeout(100);
  } while (Date.now() < deadline);
  throw new Error(`Service process ${pid} did not exit.`);
}

export async function activateRelease(
  entry: string,
  version: string,
  report: (message: string) => void,
) {
  const original = await readFile(plist);
  const port = await installedPort();
  if (port === undefined) throw new Error('Run iphone-use install first.');
  const backup = join(dirname(entry), '../previous-launch-agent.plist');
  const replacement = `${plist}.${randomUUID()}.tmp`;
  let stopped = false;
  let switched = false;
  let previousPid: number | undefined;
  // Finish or roll back a started cutover before handling a terminal interrupt.
  const interrupted = () =>
    report('Interrupt received. Finishing the service switch safely.');
  process.on('SIGINT', interrupted);
  process.on('SIGTERM', interrupted);
  try {
    await writeFile(backup, original, { flag: 'wx', mode: 0o600 });
    await writeFile(replacement, original, { flag: 'wx', mode: 0o600 });
    await exec('/usr/bin/plutil', [
      '-replace',
      'ProgramArguments.1',
      '-string',
      entry,
      replacement,
    ]);
    const running = await job();
    previousPid = running?.pid;
    if (running && !previousPid)
      throw new Error(
        'The registered service is restarting. Retry when it is running or stopped.',
      );
    report('Checking device usage');
    if (previousPid && !(await runningHealth(port, previousPid)))
      throw new Error(
        'Cannot verify the running service. Check its status before updating.',
      );
    const expiresAt = previousPid && (await prepareUpdate(port, previousPid));
    if (
      (await job())?.pid !== previousPid ||
      !(await readFile(plist)).equals(original)
    )
      throw new Error(
        'The service registration changed during the update. Retry.',
      );

    report('Stopping the old service and releasing hardware');
    if (expiresAt && expiresAt - Date.now() < 5_000)
      throw new Error(
        'The update window expired before the service could stop. Retry.',
      );
    if (previousPid) await exec('/bin/launchctl', ['bootout', target]);
    stopped = true;
    if (previousPid) await waitForExit(previousPid);
    await rename(replacement, plist);
    switched = true;
    report(`Starting and verifying version ${version}`);
    await exec('/bin/launchctl', ['bootstrap', domain, plist]);
    await waitForHealth(port, version);
    return port;
  } catch (error) {
    if (stopped || switched) {
      report('Update failed. Restoring the previous registration');
      try {
        if (switched) {
          const failedPid = (await job())?.pid;
          await stop();
          if (failedPid) await waitForExit(failedPid);
          await writeFile(replacement, original, { flag: 'wx', mode: 0o600 });
          await rename(replacement, plist);
        }
        if (previousPid) {
          await checkPort(port);
          await start();
        }
      } catch (rollback) {
        throw new AggregateError(
          [error, rollback],
          `Update and rollback failed. Saved registration: ${backup}. ${String(rollback)}`,
        );
      }
    }
    throw error;
  } finally {
    process.off('SIGINT', interrupted);
    process.off('SIGTERM', interrupted);
    await unlink(replacement).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
}
