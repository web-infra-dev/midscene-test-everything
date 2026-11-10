import { randomUUID } from 'node:crypto';
import { Agent, type AgentOpt } from '@midscene/core/agent';
import { IOSHIDInterface } from '../interface.js';
import type { DeviceSession } from '../runtime/device-session.js';
import type { InputAction, TaskRequest, TaskState } from '../types.js';
import type { Connection, ConnectionManager } from './connections.js';

class SessionDevice extends IOSHIDInterface {
  constructor(private session: DeviceSession) {
    super();
  }
  describe() {
    return `iOS HID device: ${this.session.config.name}`;
  }
  execute(action: InputAction, options?: { signal?: AbortSignal }) {
    return this.session.execute(action, options?.signal);
  }
  protected getFrame() {
    return this.session.screenshot();
  }
  async destroy() {} // The task owns the connection and closes it in finally.
}
interface TaskEntry {
  request: TaskRequest;
  state: TaskState;
  abort: AbortController;
  completion?: Promise<void>;
  connection?: Connection;
}

/** Declarative tasks, one queue per saved device. No remote JavaScript execution. */
export class HostTaskManager {
  private entries = new Map<string, TaskEntry>();
  private queues = new Map<string, Promise<void>>();
  private closed = false;
  constructor(
    private connections: ConnectionManager,
    private agentOptions?: AgentOpt,
  ) {}
  submit(request: TaskRequest): TaskState {
    if (this.closed) throw new Error('Task service closed');
    if (
      !request ||
      typeof request.requestId !== 'string' ||
      request.requestId.length > 100 ||
      !request.requestId ||
      typeof request.deviceId !== 'string' ||
      typeof request.instruction !== 'string' ||
      !request.instruction.trim() ||
      request.instruction.length > 10000
    )
      throw new Error('Invalid task request');
    const previous = [...this.entries.values()].find(
      (t) => t.request.requestId === request.requestId,
    );
    if (previous) {
      if (
        previous.request.deviceId !== request.deviceId ||
        previous.request.instruction !== request.instruction
      )
        throw new Error('Request ID already used for another task');
      return { ...previous.state };
    }
    // Bound in-memory history and active queue size.
    if (this.entries.size >= 200) {
      for (const [id, entry] of this.entries)
        if (['succeeded', 'failed', 'cancelled'].includes(entry.state.phase)) {
          this.entries.delete(id);
          break;
        }
      if (this.entries.size >= 200) throw new Error('Task queue full');
    }
    const entry: TaskEntry = {
      request: structuredClone(request),
      state: { id: randomUUID(), deviceId: request.deviceId, phase: 'queued' },
      abort: new AbortController(),
    };
    this.entries.set(entry.state.id, entry);
    const prior = this.queues.get(request.deviceId) ?? Promise.resolve();
    const completion = prior.then(() => this.run(entry));
    entry.completion = completion;
    this.queues.set(request.deviceId, completion);
    void completion.finally(() => {
      if (this.queues.get(request.deviceId) === completion)
        this.queues.delete(request.deviceId);
    });
    return { ...entry.state };
  }
  get(id: string) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('Task not found');
    return { ...entry.state };
  }
  async cancel(id: string) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('Task not found');
    if (['succeeded', 'failed', 'cancelled'].includes(entry.state.phase))
      return;
    entry.abort.abort(new Error('Task cancelled'));
    if (entry.state.phase === 'queued') entry.state.phase = 'cancelled';
    if (entry.connection) await this.connections.close(entry.connection);
  }
  private async run(entry: TaskEntry) {
    if (entry.abort.signal.aborted) return;
    let agent: Agent | undefined;
    let succeeded = false;
    let heartbeat: NodeJS.Timeout | undefined;
    try {
      entry.state.phase = 'connecting';
      const state = this.connections.begin({ id: entry.request.deviceId });
      const connection = this.connections.get(state.id);
      entry.connection = connection;
      heartbeat = setInterval(() => {
        connection.touchedAt = Date.now();
      }, 5000);
      const deadline = Date.now() + 10 * 60_000;
      while (connection.state.phase !== 'ready') {
        entry.abort.signal.throwIfAborted();
        if (Date.now() > deadline) throw new Error('Task connection timed out');
        if (['failed', 'closed'].includes(connection.state.phase))
          throw new Error(connection.state.error ?? 'Device connection closed');
        entry.state.setupUrl = connection.state.setupUrl;
        entry.state.setupKind = connection.state.setupKind;
        entry.state.phase =
          connection.state.phase === 'setup-required'
            ? 'setup-required'
            : 'connecting';
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      entry.abort.signal.throwIfAborted();
      entry.state.phase = 'running';
      entry.state.setupUrl = undefined;
      entry.state.setupKind = undefined;
      agent = new Agent(
        new SessionDevice(connection.session!),
        this.agentOptions,
      );
      entry.state.result = await agent.aiAct(entry.request.instruction, {
        abortSignal: entry.abort.signal,
      });
      entry.abort.signal.throwIfAborted();
      succeeded = true;
    } catch (error) {
      entry.state.phase = entry.abort.signal.aborted ? 'cancelled' : 'failed';
      entry.state.error =
        error instanceof Error ? error.message : String(error);
    } finally {
      clearInterval(heartbeat);
      try {
        await agent?.destroy();
      } catch (error) {
        entry.state.error = `Task cleanup failed: ${String(error)}`;
        entry.state.phase = 'failed';
      } finally {
        if (entry.connection)
          await this.connections.close(entry.connection).catch((error) => {
            entry.state.error = String(error);
            entry.state.phase = 'failed';
          });
        entry.connection = undefined;
      }
    }
    if (succeeded && entry.state.phase === 'running')
      entry.state.phase = entry.abort.signal.aborted
        ? 'cancelled'
        : 'succeeded';
  }
  async close() {
    this.closed = true;
    await Promise.allSettled(
      [...this.entries.values()].map((e) => this.cancel(e.state.id)),
    );
    await Promise.allSettled(
      [...this.entries.values()].map((e) => e.completion),
    );
  }
}
