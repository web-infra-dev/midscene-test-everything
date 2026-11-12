import { Buffer } from 'node:buffer';
import { request } from 'node:http';
import { RobotArmError } from '@midscene/arm-kit/adapter-development';

export const MG400_HTTP_PORT = 22000;
export interface Mg400HttpOptions {
  port?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}
interface Mg400HttpExchange extends Mg400HttpOptions {
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
}

function parseJsonBody(text: string, path: string): unknown {
  const trimmed = text.trim();
  if (trimmed) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Some controller handlers prepend a plain-text diagnostic to JSON.
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(trimmed.slice(start, end + 1));
        } catch {
          // Report the original response below.
        }
      }
    }
  }
  throw new RobotArmError(
    'PROTOCOL_ERROR',
    `MG400 HTTP ${path} returned ${trimmed ? 'a non-JSON' : 'an empty'} body`,
    502,
    { body: trimmed.slice(0, 200), path },
  );
}

/** One bounded exchange; writes are never retried. */
export async function exchangeMg400Http(
  host: string,
  exchange: Mg400HttpExchange,
): Promise<unknown> {
  const {
    path,
    method = 'GET',
    body,
    port = MG400_HTTP_PORT,
    timeoutMs = 5000,
    signal,
  } = exchange;
  if (
    typeof host !== 'string' ||
    !host.trim() ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  )
    throw new RobotArmError(
      'INVALID_CONFIG',
      'Invalid MG400 HTTP options',
      400,
    );
  const interrupted = () =>
    signal?.reason instanceof RobotArmError
      ? signal.reason
      : new RobotArmError(
          'ACTION_STOPPED',
          'MG400 HTTP request interrupted',
          409,
        );
  if (signal?.aborted) throw interrupted();
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise<unknown>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(result);
    };
    const req = request(
      {
        host,
        port,
        path,
        method,
        headers:
          payload === undefined
            ? undefined
            : {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload),
              },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) {
            req.destroy(
              new RobotArmError(
                'PROTOCOL_ERROR',
                'MG400 HTTP response exceeds 2 MiB',
                502,
                { path },
              ),
            );
          } else chunks.push(chunk);
        });
        res.on('error', (error) =>
          finish(
            new RobotArmError(
              'DISCONNECTED',
              `MG400 HTTP ${path} response interrupted: ${error.message}`,
              503,
              { path },
            ),
          ),
        );
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            finish(
              new RobotArmError(
                'VENDOR_ERROR',
                `MG400 HTTP ${method} ${path} failed with status ${status}`,
                502,
                { status, path, body: text.trim().slice(0, 200) },
              ),
            );
            return;
          }
          try {
            finish(undefined, parseJsonBody(text, path));
          } catch (error) {
            finish(error);
          }
        });
      },
    );
    const abort = () => req.destroy(interrupted());
    signal?.addEventListener('abort', abort, { once: true });
    // Wall-clock deadline, including connect and slow/trickling responses.
    const timer = setTimeout(
      () =>
        req.destroy(
          new RobotArmError(
            'CONNECTION_TIMEOUT',
            `MG400 HTTP ${path} timed out after ${timeoutMs}ms`,
            504,
            { path, timeoutMs },
          ),
        ),
      timeoutMs,
    );
    req.on('error', (error) =>
      finish(
        error instanceof RobotArmError
          ? error
          : new RobotArmError(
              'DISCONNECTED',
              `MG400 HTTP ${path} failed: ${error.message}`,
              503,
              { path },
            ),
      ),
    );
    if (signal?.aborted) abort();
    else {
      if (payload !== undefined) req.write(payload);
      req.end();
    }
  });
}
