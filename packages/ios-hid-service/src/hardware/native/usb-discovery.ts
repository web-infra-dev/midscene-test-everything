import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { nativeHelper } from './compiler.js';

/** One lazy, persistent discovery process per device service. Capture processes are separate. */
export class USBDiscoveryClient {
  private child?: ChildProcessWithoutNullStreams;
  private starting?: Promise<void>;
  private closed = false;
  private closing?: Promise<void>;
  private pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: NodeJS.Timeout;
    }
  >();
  private stderr = '';
  constructor(private resolveHelper = () => nativeHelper('usb-capture')) {}
  private start() {
    if (this.closed) return Promise.reject(new Error('USB discovery closed'));
    this.starting ??= (async () => {
      const helper = await this.resolveHelper();
      if (this.closed) throw new Error('USB discovery closed');
      const child = spawn(helper, ['watch'], { stdio: 'pipe' });
      this.child = child;
      this.stderr = '';
      const lines = createInterface({ input: child.stdout });
      lines.on('line', (line) => {
        try {
          const value = JSON.parse(line);
          const pending = this.pending.get(value.id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(value.id);
          if (value.error) pending.reject(new Error(value.error));
          else pending.resolve(value.result);
        } catch {
          /* Non-protocol output does not satisfy a pending request. */
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        this.stderr = `${this.stderr}${chunk}`.slice(-4096);
      });
      const failed = (error: Error) => {
        if (this.child !== child) return;
        this.child = undefined;
        this.starting = undefined;
        lines.close();
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(error);
        }
        this.pending.clear();
      };
      child.on('error', failed);
      child.on('close', (code, signal) =>
        failed(
          new Error(
            `USB discovery exited (code=${code}, signal=${signal})${this.stderr ? `: ${this.stderr}` : ''}`,
          ),
        ),
      );
    })().catch((error) => {
      this.starting = undefined;
      throw error;
    });
    return this.starting;
  }
  async list(): Promise<unknown> {
    await this.start();
    if (this.closed || !this.child)
      throw new Error('USB discovery unavailable');
    const id = randomUUID();
    const child = this.child;
    return new Promise((resolve, reject) => {
      const fail = (error: Error) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        reject(error);
      };
      const timer = setTimeout(() => {
        fail(new Error('USB discovery timed out'));
        child.kill('SIGKILL');
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(
        `${JSON.stringify({ id, method: 'list' })}\n`,
        (error) => {
          if (error) fail(error);
        },
      );
    });
  }
  close(): Promise<void> {
    this.closed = true;
    this.closing ??= (async () => {
      await this.starting?.catch(() => {});
      const child = this.child;
      if (!child || child.exitCode !== null || child.signalCode !== null)
        return;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('USB discovery closed'));
      }
      this.pending.clear();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
        child.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
        child.stdin.end();
      });
    })();
    return this.closing;
  }
}
