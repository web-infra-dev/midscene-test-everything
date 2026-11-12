import net from 'node:net';
import { RobotArmError } from '@midscene/arm-kit/adapter-development';
import { Mg400ControllerClient } from './mg400-controller.js';
import { mg400Faults } from './mg400-faults.js';
import { exchangeMg400Http } from './mg400-http.js';

/** ASCII dashboard channel. Refused wholesale while the controller keeps it. */
export const MG400_DASHBOARD_PORT = 29999;
const modeReply = /^0,\{\s*\d+\s*\},\s*RobotMode\(\);$/;
const modeRefusal = /^-1,\{\s*\},\s*RobotMode\(\);$/;

export interface Mg400DashboardProbeOptions {
  port?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Send `RobotMode()` once and return the raw reply, or `null` when the channel
 * stayed silent, failed, or was refused.
 *
 * A refused controller still answers, with vendor code `-1` and no data:
 * `-1,{},RobotMode();`. Discovery can retain this reply to identify the host.
 * Connection preparation requires a successful mode read.
 */
export function probeMg400Dashboard(
  host: string,
  options: Mg400DashboardProbeOptions & { includeRefusal?: boolean } = {},
): Promise<string | null> {
  const { port = MG400_DASHBOARD_PORT, timeoutMs = 2000, signal } = options;
  return new Promise<string | null>((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        signal.reason instanceof RobotArmError
          ? signal.reason
          : new RobotArmError('ACTION_STOPPED', 'MG400 probe interrupted', 409),
      );
      return;
    }
    const socket = new net.Socket();
    let settled = false;
    let buffer = '';
    const finish = (value: string | null, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const onAbort = () =>
      finish(
        null,
        signal?.reason instanceof RobotArmError
          ? signal.reason
          : new RobotArmError('ACTION_STOPPED', 'MG400 probe interrupted', 409),
      );
    const timer = setTimeout(() => finish(null), Math.max(1, timeoutMs));
    signal?.addEventListener('abort', onAbort, { once: true });
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const end = buffer.indexOf(';');
      if (end >= 0) {
        const line = buffer.slice(0, end + 1).trim();
        finish(
          modeReply.test(line) ||
            (options.includeRefusal && modeRefusal.test(line))
            ? line
            : null,
        );
      }
    });
    // A refused or resetting controller is a "not usable" answer, not a crash.
    socket.on('error', () => finish(null));
    socket.on('close', () => finish(null));
    socket.connect(port, host, () => socket.write('RobotMode()\n'));
  });
}

/** Identify controllers on both factory addresses before preparing a unique target. */
export async function discoverMg400Hosts(
  probe = probeMg400Dashboard,
): Promise<string[]> {
  const hosts = ['192.168.1.6', '192.168.2.6'];
  const replies = await Promise.all(
    hosts.map((host) => probe(host, { timeoutMs: 1500, includeRefusal: true })),
  );
  const ready = hosts.filter((_, i) => modeReply.test(replies[i] ?? ''));
  return ready.length
    ? ready
    : hosts.filter((_, i) => modeRefusal.test(replies[i] ?? ''));
}

/** Firmware differs in how it maps the two DobotStudio control-mode values.
 * Only a successful RobotMode() read confirms TCP/IP readiness.
 */
export async function prepareMg400TcpConnection(
  host: string,
  options: Mg400DashboardProbeOptions & {
    httpPort?: number;
    settleMs?: number;
    readinessTimeoutMs?: number;
    checkConnection?: () => void;
  } = {},
): Promise<void> {
  const {
    httpPort,
    settleMs = 400,
    readinessTimeoutMs = 10_000,
    checkConnection,
    ...probe
  } = options;
  const http = {
    port: httpPort,
    timeoutMs: probe.timeoutMs,
    signal: probe.signal,
  };
  for (const mode of ['tp', 'tcp'] as const) {
    checkConnection?.();
    const connection = await exchangeMg400Http(host, {
      ...http,
      path: '/connection/state',
    });
    if ((connection as { value?: unknown })?.value !== 'connected')
      throw new RobotArmError(
        'VENDOR_ERROR',
        'MG400 controller is unavailable or occupied; TCP/IP connection preparation was not applied',
        409,
      );
    checkConnection?.();
    const body = await exchangeMg400Http(host, {
      ...http,
      method: 'POST',
      path: '/settings/function/remoteControl',
      body: { mode, name: '' },
    });
    if ((body as { status?: unknown })?.status !== true)
      throw new RobotArmError(
        'VENDOR_ERROR',
        'MG400 did not accept TCP/IP development connection preparation',
        502,
      );
    const deadline = Date.now() + readinessTimeoutMs;
    let reply: string | null;
    do {
      if (settleMs > 0)
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.min(settleMs, Math.max(0, deadline - Date.now())),
          ),
        );
      checkConnection?.();
      reply = await probeMg400Dashboard(host, {
        ...probe,
        includeRefusal: true,
      });
      if (reply && modeReply.test(reply)) return;
    } while (Date.now() < deadline);
    // A silent or lost connection is not evidence of an alternate mode mapping.
    if (!reply || !modeRefusal.test(reply)) break;
  }
  checkConnection?.();
  const state = await new Mg400ControllerClient(host, http)
    .readState(probe.signal)
    .catch(() => undefined);
  checkConnection?.();
  probe.signal?.throwIfAborted();
  const faults = mg400Faults(
    state?.raw.alarms.map((group) => group ?? []) ?? [],
  );
  const detail = faults.length
    ? faults.map((fault) => `[${fault.code}] ${fault.message}`).join('. ')
    : 'Check TCP/IP development mode in DobotStudio and close other controller clients before reconnecting.';
  throw new RobotArmError(
    'VENDOR_ERROR',
    `MG400 at ${host} is reachable but the TCP/IP command channel did not become ready. ${detail}`,
    409,
    {
      host,
      dashboardPort: probe.port ?? MG400_DASHBOARD_PORT,
      readinessTimeoutMs,
    },
  );
}
