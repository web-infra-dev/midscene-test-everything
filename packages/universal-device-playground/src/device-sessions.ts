import type { PlaygroundServer } from '@midscene/playground';
import type { NextFunction, Request, Response } from 'express';

export const deviceRoute = '/devices/:deviceId/:connectionId';
const connectionIdPattern = /^[a-f0-9]{32}$/;
const idleMs = 5 * 60_000;
const leaveGraceMs = 15_000;

// The upstream bundle uses root-relative API paths. Scope its requests before
// it starts. Preview and report URLs are scoped by the server.
export const deviceBootstrap = `<script>
(() => {
  const route = location.pathname.replace(/\\/$/, '');
  if (!/^\\/devices\\/[^/]+\\/[a-f0-9]{32}$/.test(route)) return;
  const request = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    if (url.origin !== location.origin || /^\\/(devices|static|open-device\\/ui)\\//.test(url.pathname)) {
      return request(input, init);
    }
    url.pathname = route + url.pathname;
    return request(input instanceof Request ? new Request(url, input) : url, init);
  };
  addEventListener('pagehide', event => {
    if (!event.persisted) navigator.sendBeacon(route + '/leave');
  });
})();
</script>`;

export function deviceScope({ deviceId, connectionId }: Request['params']) {
  if (deviceId && connectionId && connectionIdPattern.test(connectionId))
    return `/devices/${encodeURIComponent(deviceId)}/${connectionId}`;
}

interface DeviceSession {
  server: Promise<PlaygroundServer>;
  expiresAt: number;
  requests: number;
}

export class PlaygroundDeviceSessions {
  private readonly sessions = new Map<string, DeviceSession>();
  private readonly sweep = setInterval(() => this.expire(), 5_000).unref();
  private closing?: Promise<void>;

  constructor(
    private readonly create: (scope: string) => Promise<PlaygroundServer>,
  ) {}

  handle(scope: string, req: Request, res: Response, next: NextFunction) {
    if (this.closing) {
      res.status(503).json({ error: 'Playground is shutting down.' });
      return;
    }
    let session = this.sessions.get(scope);
    if (!session) {
      session = { server: this.create(scope), expiresAt: 0, requests: 0 };
      this.sessions.set(scope, session);
    }
    const active = session;
    active.expiresAt = Date.now() + idleMs;
    active.requests++;
    res.set('Cache-Control', 'no-store');
    res.once('close', () => {
      active.requests--;
    });
    void active.server.then(
      (server) => {
        if (!res.destroyed) server.app(req, res, next);
      },
      (error: unknown) => {
        if (this.sessions.get(scope) === active) this.sessions.delete(scope);
        if (!res.destroyed) next(error);
      },
    );
  }

  leave(scope: string) {
    const session = this.sessions.get(scope);
    if (session) session.expiresAt = Date.now() + leaveGraceMs;
  }

  private expire() {
    const now = Date.now();
    for (const [scope, session] of this.sessions) {
      if (session.requests || session.expiresAt > now) continue;
      this.sessions.delete(scope);
      void this.closeSession(session).catch((error) =>
        console.warn('Could not close Playground device session:', error),
      );
    }
  }

  private async closeSession(session: DeviceSession) {
    const server = await session.server.catch(() => undefined);
    await server?.close();
  }

  close() {
    this.closing ??= (async () => {
      clearInterval(this.sweep);
      const sessions = [...this.sessions.values()];
      this.sessions.clear();
      await Promise.all(sessions.map((session) => this.closeSession(session)));
    })();
    return this.closing;
  }
}
