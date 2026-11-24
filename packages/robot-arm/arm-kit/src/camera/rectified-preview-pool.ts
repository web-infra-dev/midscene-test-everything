import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { RobotArmError } from '../contracts.js';
import {
  type RectifiedPreviewJob,
  type RectifiedPreviewRequest,
  transformRectifiedPreview,
} from './rectified-preview-transform.js';

interface PreviewWorker {
  worker: Worker;
  job?: PendingJob;
}

interface PendingJob {
  id: number;
  jpeg: Uint8Array;
  request: RectifiedPreviewRequest;
  resolve: (jpeg: Buffer) => void;
  reject: (error: Error) => void;
}

interface WorkerReply {
  id: number;
  jpeg?: Uint8Array;
  error?:
    | string
    | {
        message: string;
        code?: string;
        status?: number;
        details?: Record<string, unknown>;
      };
}

const MAX_WORKERS = 4;

/**
 * Rectification is CPU-bound. A small pool preserves the preview's full
 * resolution and interpolation while keeping the HTTP server responsive.
 */
export class RectifiedPreviewPool {
  private readonly workers: PreviewWorker[] = [];
  private queue: PendingJob[] = [];
  private nextJobId = 0;
  private workerUrl?: URL;

  constructor(
    private readonly parallelism = availableParallelism(),
    private readonly spawnWorker: (url: URL) => Worker = (url) =>
      new Worker(url),
  ) {}

  transform(jpeg: Buffer, request: RectifiedPreviewRequest) {
    if (this.parallelism < 2) {
      return transformRectifiedPreview(jpeg, request);
    }
    this.ensureWorkers();
    const id = ++this.nextJobId;
    return new Promise<Buffer>((resolve, reject) => {
      this.queue.push({
        id,
        jpeg: Uint8Array.from(jpeg),
        request,
        resolve,
        reject,
      });
      this.dispatch();
    });
  }

  async close() {
    const workers = this.workers.splice(0);
    const error = new Error('Preview transform pool closed');
    for (const job of this.queue.splice(0)) job.reject(error);
    for (const entry of workers) entry.job?.reject(error);
    await Promise.allSettled(workers.map((entry) => entry.worker.terminate()));
  }

  private ensureWorkers() {
    if (this.workers.length) return;
    this.workerUrl ??= this.resolveWorkerUrl();
    const count = Math.max(1, Math.min(MAX_WORKERS, this.parallelism - 1));
    for (let index = 0; index < count; index += 1)
      this.workers.push(this.createWorker());
  }

  private resolveWorkerUrl() {
    return import.meta.url.endsWith('.ts')
      ? new URL(
          '../../dist/camera/rectified-preview-worker.js',
          import.meta.url,
        )
      : new URL('./rectified-preview-worker.js', import.meta.url);
  }

  private createWorker(): PreviewWorker {
    const worker = this.spawnWorker(this.workerUrl!);
    const entry: PreviewWorker = { worker };
    worker.unref();
    worker.on('message', (reply: WorkerReply) => this.receive(entry, reply));
    worker.on('error', (error) => this.fail(entry, error));
    worker.on('exit', (code) => {
      this.fail(entry, new Error(`Preview worker exited (code=${code})`));
    });
    return entry;
  }

  private receive(entry: PreviewWorker, reply: WorkerReply) {
    const job = entry.job;
    if (!job || job.id !== reply.id) return;
    entry.job = undefined;
    if (reply.error || !reply.jpeg)
      job.reject(
        workerError(reply.error ?? 'Preview worker returned no image'),
      );
    else
      job.resolve(
        Buffer.from(
          reply.jpeg.buffer,
          reply.jpeg.byteOffset,
          reply.jpeg.byteLength,
        ),
      );
    this.dispatch();
  }

  private fail(entry: PreviewWorker, error: Error) {
    const index = this.workers.indexOf(entry);
    if (index < 0) return;
    entry.job?.reject(error);
    entry.job = undefined;
    this.workers.splice(index, 1);
    if (this.queue.length) {
      this.workers.push(this.createWorker());
      this.dispatch();
    }
  }

  private dispatch() {
    for (const entry of this.workers) {
      if (entry.job) continue;
      const job = this.queue.shift();
      if (!job) return;
      entry.job = job;
      const message: RectifiedPreviewJob & { id: number } = {
        id: job.id,
        jpeg: job.jpeg,
        ...job.request,
      };
      entry.worker.postMessage(message, [job.jpeg.buffer as ArrayBuffer]);
    }
  }
}

function workerError(error: NonNullable<WorkerReply['error']>) {
  if (typeof error === 'string') return new Error(error);
  if (typeof error.code === 'string' && Number.isInteger(error.status))
    return new RobotArmError(
      error.code,
      error.message,
      error.status,
      error.details,
    );
  return new Error(error.message);
}

export const rectifiedPreviewPool = new RectifiedPreviewPool();
