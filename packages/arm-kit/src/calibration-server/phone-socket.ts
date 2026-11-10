import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { CALIBRATION_PHONE_POLICY } from '../assisted-contracts.js';
import type { CalibrationWorkflow } from '../calibration/workflow.js';
import { RobotArmError } from '../contracts.js';

/** Hosts authenticate the session token before passing the upgrade here. */
export class PhoneSocketServer {
  private readonly server = new WebSocketServer({
    noServer: true,
    maxPayload: 65536,
  });
  private active?: WebSocket;
  constructor(
    private readonly service: Pick<
      CalibrationWorkflow,
      'phoneView' | 'phoneHeartbeat' | 'disconnectPhone'
    > & {
      receivePhone(
        update: Parameters<CalibrationWorkflow['receivePhone']>[0],
      ): void;
      subscribe?: CalibrationWorkflow['subscribe'];
    },
  ) {}
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
      let acceptedSequence = 0;
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
      const unsubscribe = this.service.subscribe?.(publish);
      socket.on('message', (data, binary) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        try {
          if (!binary && data.toString() === 'ping' && socket === this.active) {
            this.service.phoneHeartbeat();
            expire.refresh();
            socket.send('pong');
            publish();
            return;
          }
          const update = JSON.parse(data.toString());
          if (
            binary ||
            (pageId && (pageId !== update.pageId || this.active !== socket))
          )
            throw new Error('Invalid phone session');
          // An already processed report on this live connection carries no new observation.
          // Ignore it without refreshing freshness or disconnecting a healthy page.
          if (
            pageId &&
            Number.isSafeInteger(update.sequence) &&
            update.sequence > 0 &&
            update.sequence <= acceptedSequence
          )
            return;
          this.service.receivePhone(update);
          pageId = update.pageId;
          acceptedSequence = update.sequence;
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
      socket.on('close', (code) => {
        clearTimeout(expire);
        unsubscribe?.();
        if (this.active === socket) {
          this.active = undefined;
          this.service.disconnectPhone(code === 1005 || code === 1006);
        }
      });
    });
  }
  /** Renew transport without closing the server or leaving phone fullscreen. */
  renew() {
    this.active?.close(1012, 'Phone assignment updated');
  }
  close(reason?: string) {
    for (const socket of this.server.clients) {
      if (reason) socket.close(1000, reason);
      else socket.terminate();
    }
    this.server.close();
  }
}
