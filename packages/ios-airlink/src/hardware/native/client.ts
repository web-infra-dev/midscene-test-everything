import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { nativeHelper } from './compiler.js';

export interface BluetoothPeer {
  id: string;
  name: string;
  reports: number[];
  address?: string;
}
export interface HIDStatus {
  serviceName?: string;
  transport?: 'classic';
  state: string;
  hosts: BluetoothPeer[];
}

/** One classic HID peripheral for the device service, with explicit per-phone routing. */
export class NativeHIDClient {
  constructor(private readonly resolveHelper = () => nativeHelper('hid')) {}
  private revision = 0;
  private listeners = new Set<(status: HIDStatus) => void>();
  subscribe(listener: (status: HIDStatus) => void) {
    this.listeners.add(listener);
    let active = true;
    const revision = this.revision;
    void this.status()
      .then((status) => {
        if (active && revision === this.revision) listener(status);
      })
      .catch((error) => {
        if (active)
          listener({
            state: error.message,
            serviceName: 'Midscene',
            hosts: [],
          });
      });
    return () => {
      active = false;
      this.listeners.delete(listener);
    };
  }
  private child?: ChildProcessWithoutNullStreams;
  private starting?: Promise<void>;
  private pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: NodeJS.Timeout;
    }
  >();
  private stderr = '';
  private closed = false;
  private closing?: Promise<void>;

  private start(): Promise<void> {
    if (this.closed)
      return Promise.reject(new Error('Bluetooth client closed'));
    this.starting ??= (async () => {
      const helper = await this.resolveHelper();
      if (this.closed) throw new Error('Bluetooth client closed');
      const child = spawn(helper, [], { stdio: 'pipe' });
      this.child = child;
      child.stderr.on('data', (chunk: Buffer) => {
        this.stderr = `${this.stderr}${chunk}`.slice(-4096);
      });
      createInterface({ input: child.stdout }).on('line', (line) => {
        try {
          const value = JSON.parse(line);
          if (value.event === 'bluetooth-status') {
            this.revision++;
            for (const listener of this.listeners) listener(value.result);
            return;
          }
          const pending = this.pending.get(value.id);
          if (!pending) return;
          this.pending.delete(value.id);
          clearTimeout(pending.timer);
          if (value.error) pending.reject(new Error(value.error));
          else pending.resolve(value.result);
        } catch {
          this.fail(new Error('Invalid response from Bluetooth helper'));
        }
      });
      child.on('error', (error) => this.fail(error));
      child.on('close', () => {
        this.child = undefined;
        this.starting = undefined;
        this.fail(new Error(`Bluetooth helper exited: ${this.stderr}`));
      });
    })().catch((error) => {
      this.starting = undefined;
      throw error;
    });
    return this.starting;
  }

  async request<T>(command: Record<string, unknown>): Promise<T> {
    await this.start();
    if (this.closed) throw new Error('Bluetooth client closed');
    const child = this.child;
    if (!child || child.exitCode !== null)
      throw new Error('Bluetooth helper unavailable');
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Bluetooth command timed out; delivery is unknown'));
      }, 10_000);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      child.stdin.write(`${JSON.stringify({ ...command, id })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }
  status() {
    return this.request<HIDStatus>({ method: 'status' });
  }
  send(peer: string, report: number, bytes: number[]) {
    return this.request<boolean>({ method: 'send', peer, report, bytes });
  }
  private fail(error: Error) {
    for (const listener of this.listeners)
      listener({ state: error.message, serviceName: 'Midscene', hosts: [] });
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  close(): Promise<void> {
    this.closed = true;
    this.closing ??= this.closeProcess();
    return this.closing;
  }
  private async closeProcess() {
    await this.starting?.catch(() => undefined);
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    this.fail(new Error('Bluetooth helper closing'));
    child.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
