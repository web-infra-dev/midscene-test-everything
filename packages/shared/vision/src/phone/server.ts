import { randomUUID } from 'node:crypto';
import {
  type IncomingMessage,
  type ServerResponse,
  createServer,
} from 'node:http';
import { networkInterfaces } from 'node:os';
import type { Duplex } from 'node:stream';
import type {
  CalibrationPageReply,
  CalibrationPageUpdate,
  CalibrationPhoneStatus,
} from '@midscene/robotics-shared/assisted-contracts';
import { calibrationPhonePage } from './page.js';
import { CalibrationPhoneSession } from './session.js';
import { PhoneSocketServer } from './socket.js';

/** LAN surface contains only the existing phone helper protocol, never Host controls. */
export class ScreenPhoneServer {
  readonly session = new CalibrationPhoneSession();
  private listeners = new Set<() => void>();
  private socket = new PhoneSocketServer(this);
  private port = 0;
  private starting?: Promise<void>;
  private server = createServer((req, res) => this.handle(req, res));

  constructor(private token: string = randomUUID()) {}

  handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.searchParams.get('token') !== this.token) {
      res.writeHead(403).end();
      return;
    }
    if (
      req.method !== 'GET' ||
      !['/phone-calibration', '/phone-calibration/'].includes(url.pathname)
    ) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(calibrationPhonePage(this.session.openPage()));
  }
  upgrade(req: IncomingMessage, stream: Duplex, head: Buffer) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.searchParams.get('token') !== this.token) {
      stream.destroy();
      return;
    }
    this.socket.upgrade(req, stream, head);
  }
  start() {
    this.starting ??= new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.on('upgrade', (req, stream, head) =>
        this.upgrade(req, stream, head),
      );
      this.server.listen(0, '0.0.0.0', () => {
        const address = this.server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Missing phone helper address'));
          return;
        }
        this.port = address.port;
        resolve();
      });
    });
    return this.starting;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  phoneView(): CalibrationPageReply {
    return { view: 'markers', anchors: [] };
  }
  receivePhone(update: CalibrationPageUpdate) {
    this.session.receive(update);
    for (const listener of this.listeners) listener();
  }
  phoneHeartbeat() {
    this.session.lastSeen = Date.now();
  }
  disconnectPhone() {
    this.session.lastSeen = 0;
  }
  status(port = this.port): CalibrationPhoneStatus {
    return {
      state: this.session.presence(),
      model: this.session.update?.model?.slice(0, 80),
      links: Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
        (addresses ?? [])
          .filter((a) => a.family === 'IPv4' && !a.internal)
          .map((a) => ({
            name: `${name} · ${a.address}`,
            url: `http://${a.address}:${port}/phone-calibration?token=${encodeURIComponent(this.token)}`,
          })),
      ),
    };
  }
  async close() {
    await this.starting?.catch(() => undefined);
    this.socket.close();
    this.server.closeAllConnections();
    if (this.server.listening)
      await new Promise<void>((resolve) => this.server.close(() => resolve()));
    this.listeners.clear();
  }
}
