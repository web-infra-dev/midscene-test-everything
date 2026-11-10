import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { CALIBRATION_PHONE_POLICY } from '@midscene/robotics-shared/assisted-contracts';
import type {
  CalibrationPageReply,
  CalibrationPageUpdate,
} from '@midscene/robotics-shared/assisted-contracts';
import { WebSocket, WebSocketServer } from 'ws';
export interface PhoneSessionService {
  subscribe(listener: () => void): () => void;
  phoneView(): CalibrationPageReply;
  receivePhone(update: CalibrationPageUpdate): unknown;
  phoneHeartbeat(): void;
  disconnectPhone(): void;
}
import { RobotArmError } from '@midscene/robotics-shared/contracts';

/** Hosts authenticate the session token before passing the upgrade here. */
export class PhoneSocketServer {
  private readonly server = new WebSocketServer({
    noServer: true,
    maxPayload: 65536,
  });
  private active?: WebSocket;
  constructor(private readonly service: PhoneSessionService) {}
  upgrade(req: IncomingMessage, stream: Duplex, head: Buffer) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (
      url.pathname !== '/phone-calibration/session' ||
      (req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}` &&
        req.headers.origin !== `https://${req.headers.host}`)
    ) {
      stream.destroy();
      return;
    }
    this.server.handleUpgrade(req, stream, head, (socket) => {
      let pageId: string | undefined;
      let previous: string | undefined;
      const expire = setTimeout(
        () => socket.terminate(),
        CALIBRATION_PHONE_POLICY.measurementFreshMs,
      );
      const publish = () => {
        if (socket !== this.active || socket.readyState !== WebSocket.OPEN)
          return;
        const view = JSON.stringify(this.service.phoneView());
        if (view !== previous) {
          socket.send(view);
          previous = view;
        }
      };
      const unsubscribe = this.service.subscribe(publish);
      socket.on('message', (data, binary) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        try {
          if (!binary && data.toString() === 'ping' && socket === this.active) {
            this.service.phoneHeartbeat();
            expire.refresh();
            socket.send('pong');
            return;
          }
          const update = JSON.parse(data.toString());
          if (
            binary ||
            (pageId && (pageId !== update.pageId || this.active !== socket))
          )
            throw new Error('Invalid phone session');
          this.service.receivePhone(update);
          pageId = update.pageId;
          const old = this.active;
          this.active = socket;
          if (old && old !== socket) old.close(4410, 'Page replaced');
          expire.refresh();
          publish();
        } catch (error) {
          socket.close(
            error instanceof RobotArmError && error.status === 410
              ? 4410
              : 1008,
            'Phone update rejected',
          );
        }
      });
      socket.on('error', () => socket.terminate());
      socket.on('close', () => {
        clearTimeout(expire);
        unsubscribe();
        if (this.active === socket) {
          this.active = undefined;
          this.service.disconnectPhone();
        }
      });
    });
  }
  close() {
    for (const socket of this.server.clients) socket.terminate();
    this.server.close();
  }
}
