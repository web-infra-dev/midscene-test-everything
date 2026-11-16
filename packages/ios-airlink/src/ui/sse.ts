export interface SSEHandlers {
  onMessage: (data: string) => void;
  onError?: () => void;
}

type ChannelBroadcast =
  | { type: 'data'; data: string }
  | { type: 'error' }
  | { type: 'request-latest' };

interface ChannelEntry {
  listeners: Set<SSEHandlers>;
  lastData?: string;
  isLeader: boolean;
  cleanup: () => void;
}

const channels = new Map<string, ChannelEntry>();

/**
 * Subscribe to an SSE endpoint, deduplicating connections within the current tab
 * and electing a single leader tab across same-origin tabs via Web Locks + BroadcastChannel
 * so HTTP/1.1's 6-connection-per-origin limit is never exhausted by EventSource streams.
 */
export function subscribeSSE(
  url: string,
  handlers: SSEHandlers,
  channelKey = url,
): () => void {
  let entry = channels.get(channelKey);
  if (!entry) {
    entry = createChannel(url, channelKey);
    channels.set(channelKey, entry);
  }
  entry.listeners.add(handlers);

  if (entry.lastData !== undefined) {
    const cached = entry.lastData;
    queueMicrotask(() => {
      if (entry?.listeners.has(handlers)) handlers.onMessage(cached);
    });
  }

  return () => {
    const current = channels.get(channelKey);
    if (!current) return;
    current.listeners.delete(handlers);
    if (current.listeners.size === 0) {
      channels.delete(channelKey);
      current.cleanup();
    }
  };
}

function createChannel(url: string, channelKey: string): ChannelEntry {
  const entry: ChannelEntry = {
    listeners: new Set(),
    isLeader: false,
    cleanup: () => {},
  };

  let source: EventSource | undefined;
  let releaseLock: (() => void) | undefined;
  let disposed = false;

  const emitData = (data: string) => {
    entry.lastData = data;
    for (const listener of entry.listeners) listener.onMessage(data);
  };

  const emitError = () => {
    for (const listener of entry.listeners) listener.onError?.();
  };

  const lockApi =
    typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const canShareAcrossTabs =
    typeof BroadcastChannel !== 'undefined' &&
    typeof lockApi?.request === 'function';

  let broadcast: BroadcastChannel | undefined;

  const openLeaderSource = () => {
    if (disposed || source) return;
    entry.isLeader = true;
    source = new EventSource(url);
    source.onmessage = (event) => {
      const data = String(event.data);
      broadcast?.postMessage({ type: 'data', data } satisfies ChannelBroadcast);
      emitData(data);
    };
    source.onerror = () => {
      broadcast?.postMessage({ type: 'error' } satisfies ChannelBroadcast);
      emitError();
    };
  };

  if (canShareAcrossTabs) {
    broadcast = new BroadcastChannel(`ios-airlink-sse:${channelKey}`);
    broadcast.onmessage = (event: MessageEvent<ChannelBroadcast>) => {
      const payload = event.data;
      if (!payload) return;
      if (payload.type === 'data') {
        emitData(payload.data);
      } else if (payload.type === 'error') {
        emitError();
      } else if (
        payload.type === 'request-latest' &&
        entry.isLeader &&
        entry.lastData !== undefined
      ) {
        broadcast?.postMessage({
          type: 'data',
          data: entry.lastData,
        } satisfies ChannelBroadcast);
      }
    };
    broadcast.postMessage({
      type: 'request-latest',
    } satisfies ChannelBroadcast);

    const abort = new AbortController();
    void lockApi
      .request(
        `ios-airlink-sse-lock:${channelKey}`,
        { signal: abort.signal },
        () =>
          new Promise<void>((resolve) => {
            if (disposed || abort.signal.aborted) {
              resolve();
              return;
            }
            releaseLock = resolve;
            openLeaderSource();
          }),
      )
      .catch(() => {});

    entry.cleanup = () => {
      disposed = true;
      entry.isLeader = false;
      source?.close();
      source = undefined;
      abort.abort();
      releaseLock?.();
      releaseLock = undefined;
      broadcast?.close();
      broadcast = undefined;
    };
  } else {
    openLeaderSource();
    entry.cleanup = () => {
      disposed = true;
      entry.isLeader = false;
      source?.close();
      source = undefined;
    };
  }

  return entry;
}
