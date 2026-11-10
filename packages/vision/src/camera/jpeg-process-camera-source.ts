import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
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
  private processClosed = false;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly processName: string,
    private readonly frameOutput: Readable = child.stdout,
    private readonly diagnosticOutputs: Readable[] = [child.stderr],
  ) {
    super();
    frameOutput.on('data', (chunk: Buffer) => {
      for (const frame of this.parser.push(chunk)) this.emit('frame', frame);
    });
    for (const output of diagnosticOutputs)
      output.on('data', (chunk: Buffer) => {
        this.stderrTail = `${this.stderrTail}${chunk.toString('utf8')}`.slice(
          -8_192,
        );
      });
    let spawnError: Error | undefined;
    child.on('error', (error) => {
      spawnError = error;
      if (!this.intentionalClose) this.emit('error', error);
    });
    child.on('close', () => {
      this.processClosed = true;
    });
    child.on('exit', (code, signal) => {
      if (spawnError) return;
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
      const forceTimer = setTimeout(() => this.child.kill('SIGKILL'), 2_000);
      forceTimer.unref();
      const finish = () => {
        clearTimeout(forceTimer);
        this.child.off('exit', finish);
        this.child.off('close', finish);
        // Extra media pipes can be inherited by native subprocesses. Their EOF
        // must not keep a finished receiver (or its caller) alive indefinitely.
        this.frameOutput.destroy();
        for (const output of this.diagnosticOutputs) output.destroy();
        this.child.stdin.destroy();
        resolve();
      };
      if (
        this.processClosed ||
        this.child.exitCode !== null ||
        this.child.signalCode !== null
      ) {
        finish();
        return;
      }
      this.child.once('exit', finish);
      this.child.once('close', finish);
      this.child.kill('SIGTERM');
    });
    return this.closePromise;
  }
}
