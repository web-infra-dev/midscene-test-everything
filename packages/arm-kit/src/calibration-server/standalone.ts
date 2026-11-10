import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { CalibrationProfile } from '../contracts.js';
import {
  discoverWifiInterfaces,
  phoneAddresses,
} from '../network/phone-addresses.js';
import { CalibrationHost, type CalibrationHostOptions } from './host.js';
import { CalibrationPageLease } from './page-lease.js';

export interface CalibrationPageOptions {
  open?: boolean;
  /** Desktop page inactivity grace, allowing reloads and background-tab throttling. Default 90 seconds. */
  pageTimeoutMs?: number;
  /** Time to open the standalone page initially. Default five minutes. */
  pageStartTimeoutMs?: number;
  signal?: AbortSignal;
  staticDirectory?: string;
  /** Explicit LAN address advertised to the phone when automatic detection is unsuitable. */
  phoneHost?: string;
  onListening?: (url: string) => void;
}
export async function resolveCalibrationDirectory(
  directory?: string,
): Promise<string> {
  const root = directory
    ? path.resolve(directory)
    : path.dirname(
        createRequire(import.meta.url).resolve(
          '@midscene/arm-calibration-ui/standalone',
        ),
      );
  try {
    await readFile(path.join(root, 'index.html'));
  } catch (error) {
    if (
      !['ENOENT', 'ENOTDIR'].includes(
        (error as NodeJS.ErrnoException).code ?? '',
      )
    )
      throw error;
    throw new Error(`Calibration page not found in ${root}`, { cause: error });
  }
  return root;
}

export async function runCalibrationPage(
  options: CalibrationHostOptions & CalibrationPageOptions,
): Promise<CalibrationProfile> {
  options.signal?.throwIfAborted();
  const root = await resolveCalibrationDirectory(options.staticDirectory);
  const token = randomUUID();
  let port = 0;
  let reviewResult = false;
  let finishedResult: CalibrationProfile | undefined;
  const wifiInterfaces = options.phoneHost
    ? []
    : await discoverWifiInterfaces();
  const addresses = () =>
    options.phoneHost
      ? [{ address: options.phoneHost, name: options.phoneHost }]
      : phoneAddresses({ wifiInterfaces });
  const host = new CalibrationHost({
    ...options,
    phoneLinks: () =>
      addresses().map(({ address, name }) => ({
        name,
        url: `http://${address}:${port}/phone-calibration?token=${token}`,
      })),
  });
  await host.prepare();
  let pageLease: CalibrationPageLease;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const fail = (code: number, message: string) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    };
    try {
      if (url.pathname.startsWith('/phone-calibration')) {
        if (url.searchParams.get('token') !== token)
          return fail(403, 'Invalid phone session');
        return await host.handlePhone(req, res);
      }
      const remote = req.socket.remoteAddress;
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote ?? ''))
        return fail(403, 'Open calibration controls on the host computer');
      if (
        req.headers.origin &&
        ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(
          req.headers.origin,
        )
      )
        return fail(403, 'Origin not allowed');
      if (url.pathname === '/_calibration/finish') {
        if (req.method !== 'POST') return fail(405, 'Method not allowed');
        const state = host.service.status();
        if (state?.stage !== 'completed' || !state.result)
          return fail(409, 'Complete calibration before finishing');
        finishedResult = state.result;
        res.writeHead(204);
        res.end();
        return;
      }
      if (url.pathname === '/_calibration/page') {
        if (req.method !== 'POST') return fail(405, 'Method not allowed');
        if (!pageLease.renew()) return fail(410, pageLease.message);
        if (url.searchParams.has('review')) reviewResult = true;
        res.writeHead(204, {
          'Cache-Control': 'no-store',
          'X-Calibration-Page-Timeout': String(options.pageTimeoutMs ?? 90_000),
        });
        res.end();
        return;
      }
      if (pageLease.expired()) return fail(410, pageLease.message);
      if (await host.handle(req, res)) return;
      if (req.method !== 'GET') return fail(405, 'Method not allowed');
      const target = path.resolve(
        root,
        `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`,
      );
      if (!target.startsWith(`${root}${path.sep}`))
        return fail(404, 'Not found');
      const bytes = await readFile(target);
      const type: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
      };
      res.writeHead(200, {
        'Content-Type':
          type[path.extname(target)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(bytes);
    } catch (error) {
      if (!res.headersSent)
        fail(500, error instanceof Error ? error.message : String(error));
      else res.destroy();
    }
  });
  server.on('upgrade', (req, socket, head) => {
    const url = URL.parse(req.url ?? '/', 'http://localhost');
    if (!url) return socket.destroy();
    const calibration =
      url.searchParams.get('token') === token ? host : undefined;
    if (!calibration) return socket.destroy();
    calibration.phoneSocket.upgrade(req, socket, head);
  });
  try {
    pageLease = new CalibrationPageLease(
      options.pageTimeoutMs,
      options.pageStartTimeoutMs,
    );
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '0.0.0.0', () => {
        server.off('error', reject);
        resolve();
      });
    });
    port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}/`;
    options.onListening?.(url);
    if (!options.onListening) process.stdout.write(`Calibration: ${url}\n`);
    if (options.open !== false) {
      const executable =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'explorer.exe'
            : 'xdg-open';
      const child = spawn(executable, [url], {
        stdio: 'ignore',
        detached: true,
      });
      child.on('error', () => {
        process.stderr.write(`Open calibration manually: ${url}\n`);
      });
      child.unref();
    }
    return await new Promise<CalibrationProfile>((resolve, reject) => {
      const finish = (error?: unknown, result?: CalibrationProfile) => {
        clearInterval(timer);
        options.signal?.removeEventListener('abort', abort);
        error ? reject(error) : resolve(result!);
      };
      const abort = () =>
        finish(options.signal?.reason ?? new Error('Calibration cancelled'));
      const timer = setInterval(() => {
        if (finishedResult) return finish(undefined, finishedResult);
        const state = host.service.status();
        if (
          state?.stage === 'completed' &&
          state.result &&
          (!reviewResult || pageLease.expired())
        )
          finish(undefined, state.result);
        else if (state?.stage === 'cancelled')
          finish(new Error('Calibration cancelled'));
        else if (pageLease.expired()) finish(new Error(pageLease.message));
      }, 250);
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
    });
  } finally {
    try {
      await host.close();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}
