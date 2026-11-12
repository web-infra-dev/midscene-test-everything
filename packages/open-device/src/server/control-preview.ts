import type { ServerResponse } from 'node:http';
import { setTimeout } from 'node:timers/promises';
import type { PreviewReader } from '../protocol.js';

const boundary = 'midscene-frame';
const intervalMs = 100;

export class ControlPreview {
  private clients = new Set<ServerResponse>();
  private pump?: AbortController;
  private latestPart?: Buffer;

  constructor(
    private open: (signal: AbortSignal) => PreviewReader,
    private lease: AbortSignal,
  ) {}

  add(response: ServerResponse) {
    response.writeHead(200, {
      'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    this.clients.add(response);
    if (this.latestPart) response.write(this.latestPart);
    response.once('close', () => {
      this.clients.delete(response);
      if (!this.clients.size) {
        this.pump?.abort();
        this.pump = undefined;
        this.latestPart = undefined;
      }
    });
    if (!this.pump) {
      this.pump = new AbortController();
      void this.run(this.pump);
    }
  }

  private async run(pump: AbortController) {
    const signal = AbortSignal.any([this.lease, pump.signal]);
    let reader: PreviewReader | undefined;
    let lastSequence: number | undefined;
    const end = () => {
      if (this.pump !== pump) return;
      this.pump = undefined;
      this.latestPart = undefined;
      const clients = [...this.clients];
      this.clients.clear();
      for (const client of clients) client.destroy();
    };
    signal.addEventListener('abort', end, { once: true });
    try {
      signal.throwIfAborted();
      reader = this.open(signal);
      while (!signal.aborted) {
        const started = performance.now();
        const available = [...this.clients].some(
          (client) => !client.destroyed && !client.writableNeedDrain,
        );
        const frame = available ? await reader.getFrame() : undefined;
        if (signal.aborted) break;
        if (frame && frame.sequence !== lastSequence) {
          lastSequence = frame.sequence;
          const part = Buffer.concat([
            Buffer.from(
              `--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.jpeg.length}\r\n\r\n`,
            ),
            frame.jpeg,
            Buffer.from('\r\n'),
          ]);
          this.latestPart = part;
          for (const client of this.clients) {
            if (!client.destroyed && !client.writableNeedDrain)
              client.write(part);
          }
        }
        await setTimeout(
          Math.max(1, intervalMs - (performance.now() - started)),
          undefined,
          { signal },
        );
      }
    } catch {
      // Closing the response lets the browser reconnect to a recovered session.
    } finally {
      signal.removeEventListener('abort', end);
      end();
      await reader?.close().catch(() => {});
    }
  }
}
