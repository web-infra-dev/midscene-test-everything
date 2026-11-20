import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type {
  CameraControlMode,
  CameraControlProperty,
  CameraControlValue,
  CameraHardwareControl,
} from './types.js';

interface BridgeResponse {
  id: string;
  ok: boolean;
  controls?: Partial<Record<CameraControlProperty, CameraControlValue>>;
  error?: string;
}

interface PendingRequest {
  resolve(value: BridgeResponse): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface MacosCameraHardwareControlOptions {
  platform?: NodeJS.Platform;
  spawnProcess?: typeof spawn;
}

export class MacosCameraHardwareControl implements CameraHardwareControl {
  private child?: ChildProcessWithoutNullStreams;
  private opened = false;
  private ready = false;
  private closing = false;
  private stdout = '';
  private stderr = '';
  private failure?: Error;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly platform: NodeJS.Platform;
  private readonly spawnProcess: typeof spawn;

  constructor(
    readonly deviceId: string,
    private readonly uid: string,
    private readonly executable: () => Promise<string>,
    options: MacosCameraHardwareControlOptions = {},
  ) {
    this.platform = options.platform ?? process.platform;
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  async open(): Promise<void> {
    if (this.opened) return;
    if (this.platform !== 'darwin')
      throw new Error('macOS camera controls are available on macOS only');

    const executable = await this.executable();
    const child = this.spawnProcess(executable, ['control', this.uid], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.readStdout(chunk));
    child.stderr.on('data', (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-4000);
    });
    child.once('error', (error) => this.fail(error));
    child.once('exit', (code, signal) => {
      this.fail(
        new Error(
          `macOS camera control process exited (code=${code}, signal=${signal})${
            this.stderr ? `: ${this.stderr.trim()}` : ''
          }`,
        ),
      );
    });
    try {
      await this.waitForReady(60_000);
      this.opened = true;
    } catch (error) {
      child.kill();
      this.child = undefined;
      throw error;
    }
  }

  async read(): Promise<
    Partial<Record<CameraControlProperty, CameraControlValue>>
  > {
    const response = await this.request({ action: 'query' });
    return response.controls ?? {};
  }

  async set(
    property: CameraControlProperty,
    value: number,
    mode: CameraControlMode,
  ): Promise<void> {
    await this.request({
      action: 'set',
      property,
      value,
      mode,
    });
  }

  async close(): Promise<void> {
    if (!this.child || this.closing) return;
    this.closing = true;
    try {
      await this.request({ action: 'shutdown' }, 2_000);
    } catch {
      // The helper may already be gone.
    }
    this.child.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.child?.kill();
        resolve();
      }, 1_000);
      this.child?.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.child = undefined;
    this.opened = false;
    this.ready = false;
  }

  private waitForReady(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (this.child?.exitCode !== null) {
          clearInterval(timer);
          reject(
            new Error(
              `macOS camera control process failed to start${
                this.stderr ? `: ${this.stderr.trim()}` : ''
              }`,
            ),
          );
        } else if (this.failure) {
          clearInterval(timer);
          reject(this.failure);
        } else if (this.ready) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - started >= timeoutMs) {
          clearInterval(timer);
          reject(
            new Error(
              `macOS camera control process did not become ready${
                this.stderr ? `: ${this.stderr.trim()}` : ''
              }`,
            ),
          );
        }
      }, 25);
    });
  }

  private request(
    command: Record<string, unknown>,
    timeoutMs = 8_000,
  ): Promise<BridgeResponse> {
    if (!this.child || !this.opened)
      return Promise.reject(
        new Error(`macOS camera control is not open for ${this.deviceId}`),
      );
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `macOS camera control command timed out: ${command.action}`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    });
  }

  private readStdout(chunk: string) {
    this.stdout += chunk;
    while (true) {
      const newline = this.stdout.indexOf('\n');
      if (newline < 0) return;
      const line = this.stdout.slice(0, newline).trim();
      this.stdout = this.stdout.slice(newline + 1);
      if (!line) continue;
      let response: BridgeResponse;
      try {
        response = JSON.parse(line) as BridgeResponse;
      } catch {
        this.stderr = `${this.stderr}\n${line}`.slice(-4000);
        continue;
      }
      if (response.id === 'ready' && response.ok) {
        this.ready = true;
        continue;
      }
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      if (response.ok) pending.resolve(response);
      else
        pending.reject(
          new Error(response.error || 'macOS camera control command failed'),
        );
    }
  }

  private fail(error: Error) {
    if (this.closing) return;
    this.failure = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
