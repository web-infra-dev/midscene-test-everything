import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { JpegStreamParser } from './jpeg-stream-parser.js';
import type { CameraSource } from './types.js';

/** Turns a native process's concatenated JPEG output into camera frames. */
export class JpegProcessCameraSource
  extends EventEmitter
  implements CameraSource
{
  private readonly parser = new JpegStreamParser();
  private closePromise?: Promise<void>;
  private intentionalClose = false;
  private stderrTail = '';

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly processName: string,
  ) {
    super();
    child.stdout.on('data', (chunk: Buffer) => {
      for (const frame of this.parser.push(chunk)) this.emit('frame', frame);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString('utf8')}`.slice(
        -8_192,
      );
    });
    child.on('error', (error) => this.emit('error', error));
    child.on('exit', (code, signal) => {
      if (this.intentionalClose) return;
      const details = this.stderrTail.trim();
      if (details) {
        this.emit(
          'error',
          new Error(
            `${this.processName} exited (code=${code}, signal=${signal}): ${details}`,
          ),
        );
      } else {
        this.emit('exit', { code, signal });
      }
    });
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.intentionalClose = true;
    this.closePromise = new Promise<void>((resolve) => {
      let settled = false;
      const timers: NodeJS.Timeout[] = [];
      const finish = () => {
        if (settled) return;
        settled = true;
        for (const timer of timers) clearTimeout(timer);
        resolve();
      };
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        finish();
        return;
      }
      // SIGTERM should be enough. Escalate to SIGKILL, and still resolve if the
      // OS never reports an exit so a capture process cannot wedge the camera
      // manager's serialized queue forever.
      const forceTimer = setTimeout(() => {
        try {
          this.child.kill('SIGKILL');
        } catch {
          finish();
        }
      }, 2_000);
      forceTimer.unref();
      timers.push(forceTimer);
      const deadlineTimer = setTimeout(finish, 3_500);
      deadlineTimer.unref();
      timers.push(deadlineTimer);
      this.child.once('exit', finish);
      try {
        this.child.kill('SIGTERM');
      } catch {
        finish();
      }
    });
    return this.closePromise;
  }
}
